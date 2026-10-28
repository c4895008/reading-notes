import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createTag, deleteTag, renameTag, TAG_NAME_MAX, type Tag } from '../api/tags';
import { searchKey, squash, usePinyin } from '../lib/pinyin';
import { ConfirmPanel, RowActions } from './SwitcherParts';
import { CheckCircleIcon, PlusIcon, SearchIcon, TagIcon } from './Icons';
import './Switcher.css';

type Props = {
  open: boolean;
  tags: Tag[] | null;
  current: number | null;
  onPick: (id: number | null) => void;
  onClose: () => void;
};

type Option = { key: string; kind: 'all' } | { key: string; kind: 'tag'; tag: Tag } | { key: string; kind: 'create'; name: string };

export default function TagSwitcher({ open, tags, current, onPick, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [renaming, setRenaming] = useState<Tag | null>(null);
  const [draft, setDraft] = useState('');
  const [removing, setRemoving] = useState<Tag | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinyin = usePinyin(open);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    setQuery('');
    setRenaming(null);
    setRemoving(null);
    setError(null);
    dialog.showModal();
    inputRef.current?.focus();
    return () => {
      dialog.close();
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [open]);

  const keys = useMemo(() => new Map((tags ?? []).map((t) => [t.id, searchKey(t.name, pinyin)])), [tags, pinyin]);

  const name = query.trim();
  const needle = squash(query);
  const options = useMemo<Option[]>(() => {
    const list = tags ?? [];
    if (!needle) return [{ key: 'all', kind: 'all' }, ...list.map((tag) => ({ key: `t${tag.id}`, kind: 'tag' as const, tag }))];
    const rows: Option[] = list.filter((t) => keys.get(t.id)?.includes(needle)).map((tag) => ({ key: `t${tag.id}`, kind: 'tag', tag }));
    const exists = list.some((t) => t.name.toLowerCase() === name.toLowerCase());
    if (tags && name && !exists) rows.push({ key: 'create', kind: 'create', name });
    return rows;
  }, [tags, needle, name, keys]);

  useEffect(() => {
    const i = options.findIndex((o) => (o.kind === 'all' ? current === null : o.kind === 'tag' && o.tag.id === current));
    setActive(needle || i < 0 ? 0 : i);
  }, [options, current, needle]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function focusSearch() {
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function choose(option: Option) {
    if (option.kind === 'all') return onPick(null);
    if (option.kind === 'tag') return onPick(option.tag.id);
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const tag = await createTag(option.name);
      onPick(tag.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startRename(tag: Tag) {
    setError(null);
    setRenaming(tag);
    setDraft(tag.name);
  }

  function stopRename() {
    setRenaming(null);
    focusSearch();
  }

  async function submitRename() {
    const next = draft.trim();
    if (!renaming || busy) return;
    if (!next || next === renaming.name) return stopRename();
    setBusy(true);
    setError(null);
    try {
      await renameTag(renaming.id, next);
      stopRename();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (removing || renaming || e.target !== inputRef.current) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      const option = options[active];
      if (option) {
        e.preventDefault();
        choose(option);
      }
    }
  }

  return (
    <dialog
      ref={ref}
      className="bs"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        if (removing) {
          setRemoving(null);
          focusSearch();
        } else if (renaming) stopRename();
        else onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="bs-body">
          <h2 id={titleId} className="visually-hidden">
            标签
          </h2>
          <label className="bs-search">
            <SearchIcon size={20} />
            <input
              ref={inputRef}
              type="text"
              value={query}
              maxLength={TAG_NAME_MAX}
              placeholder="输入标签名或拼音筛选，回车新建...（ESC 关闭）"
              aria-label="搜索或新建标签"
              aria-controls="ts-options"
              onChange={(e) => {
                setQuery(e.target.value);
                setRemoving(null);
                setError(null);
              }}
            />
            <kbd className="bs-kbd">ESC</kbd>
          </label>

          {error && (
            <p className="bs-error bs-banner" role="alert">
              {error}
            </p>
          )}

          {removing ? (
            <ConfirmPanel
              title={`删除标签「${removing.name}」？`}
              message={`${removing.note_count} 条笔记将移除这个标签，笔记本身不受影响。`}
              onCancel={() => {
                setRemoving(null);
                focusSearch();
              }}
              onConfirm={async () => {
                await deleteTag(removing.id);
                setRemoving(null);
                focusSearch();
              }}
            />
          ) : (
            <>
              <div className="bs-tabs">
                <span className="bs-hint">{tags ? `共 ${tags.length} 个标签` : ''}</span>
                <span className="bs-hint">支持键盘 ↑↓ 导航，回车确定</span>
              </div>

              <ul ref={listRef} id="ts-options" className="bs-list" role="listbox" aria-label="标签">
                {tags === null && <li className="bs-state">加载中…</li>}
                {tags !== null && tags.length === 0 && !name && <li className="bs-state">还没有标签。输入名称后回车即可新建。</li>}
                {options.map((o, i) => {
                  const isActive = i === active;
                  if (o.kind === 'create') {
                    return (
                      <li key={o.key} role="presentation" className="bs-item" onMouseMove={() => setActive(i)}>
                        <div
                          role="option"
                          aria-selected={isActive}
                          data-index={i}
                          className={`bs-row is-create${isActive ? ' is-active' : ''}`}
                          onClick={() => choose(o)}
                        >
                          <span className="bs-tile is-tag" aria-hidden="true">
                            <PlusIcon size={18} />
                          </span>
                          <span className="bs-main">
                            <span className="bs-title">新建标签「{o.name}」</span>
                            <span className="bs-sub">{busy ? '创建中…' : '回车创建并按它筛选'}</span>
                          </span>
                          <span className="bs-go" aria-hidden="true">
                            ↵ 新建
                          </span>
                        </div>
                      </li>
                    );
                  }
                  const tag = o.kind === 'tag' ? o.tag : null;
                  const isCurrent = tag ? tag.id === current : current === null;
                  if (tag && renaming?.id === tag.id) {
                    return (
                      <li key={o.key} role="presentation" className="bs-item">
                        <div data-index={i} className={`bs-row${isActive ? ' is-active' : ''}${isCurrent ? ' is-current' : ''}`}>
                          <span className="bs-tile is-tag" aria-hidden="true">
                            <TagIcon size={18} />
                          </span>
                          <span className="bs-main">
                            <input
                              className="bs-rename"
                              value={draft}
                              maxLength={TAG_NAME_MAX}
                              autoFocus
                              aria-label={`重命名标签「${tag.name}」`}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                  e.preventDefault();
                                  submitRename();
                                }
                              }}
                              onBlur={() => !busy && setRenaming(null)}
                            />
                          </span>
                        </div>
                      </li>
                    );
                  }
                  return (
                    <li
                      key={o.key}
                      role="presentation"
                      className={`bs-item${tag ? ' has-acts' : ''}`}
                      onMouseMove={() => setActive(i)}
                      onFocus={() => setActive(i)}
                    >
                      <div
                        role="option"
                        aria-selected={isActive}
                        data-index={i}
                        className={`bs-row${isActive ? ' is-active' : ''}${isCurrent ? ' is-current' : ''}${tag ? '' : ' is-pinned'}`}
                        onClick={() => choose(o)}
                      >
                        <span className="bs-tile is-tag" aria-hidden="true">
                          <TagIcon size={18} />
                        </span>
                        <span className="bs-main">
                          <span className="bs-title-line">
                            <span className="bs-title">{tag ? `#${tag.name}` : '全部标签'}</span>
                            {isCurrent && tag && <span className="bs-badge">当前筛选</span>}
                          </span>
                          <span className="bs-sub">{tag ? `${tag.note_count} 条笔记` : '不限标签，查看全部笔记'}</span>
                        </span>
                        {isCurrent ? (
                          <span className="bs-check" aria-hidden="true">
                            <CheckCircleIcon size={22} />
                          </span>
                        ) : (
                          <span className="bs-go" aria-hidden="true">
                            ↵ 筛选
                          </span>
                        )}
                      </div>
                      {tag && (
                        <RowActions
                          editLabel={`重命名标签「${tag.name}」`}
                          deleteLabel={`删除标签「${tag.name}」`}
                          onEdit={() => startRename(tag)}
                          onDelete={() => {
                            setError(null);
                            setRemoving(tag);
                          }}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <div className="bs-foot">
            <span>行尾按钮可重命名或删除标签，删除不影响笔记本身。</span>
            <button type="button" className="bs-close" onClick={onClose}>
              关闭窗口
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
