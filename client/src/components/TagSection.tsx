import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { createTag, deleteTag, listTags, renameTag, TAG_NAME_MAX, type Tag } from '../api/tags';
import ConfirmDialog from './ConfirmDialog';
import { MoreIcon, PlusIcon } from './Icons';
import './Tags.css';

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; items: Tag[] };

export default function TagSection() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<Tag | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [menuFor, setMenuFor] = useState<Tag | null>(null);
  const [removing, setRemoving] = useState<Tag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setState((s) => (s.status === 'error' ? { status: 'loading' } : s));
    listTags(ctrl.signal)
      .then((items) => setState({ status: 'ready', items }))
      .catch((e: ApiError) => {
        if (!ctrl.signal.aborted) setState({ status: 'error', message: e.message });
      });
    return () => ctrl.abort();
  }, [reload]);

  useEffect(() => {
    if (adding) addRef.current?.focus();
  }, [adding]);

  useEffect(() => {
    if (!menuFor) return;
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuFor(null);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [menuFor]);

  async function submitCreate() {
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createTag(name);
      setDraft('');
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
      addRef.current?.focus();
    }
  }

  function startRename(tag: Tag) {
    setMenuFor(null);
    setRenaming(tag);
    setRenameDraft(tag.name);
  }

  async function submitRename() {
    const name = renameDraft.trim();
    if (!renaming || busy) return;
    if (!name || name === renaming.name) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await renameTag(renaming.id, name);
      setRenaming(null);
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    if (!removing || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTag(removing.id);
      setRemoving(null);
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const addKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitCreate();
    } else if (e.key === 'Escape') {
      setAdding(false);
      setDraft('');
      setError(null);
    }
  };

  const renameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitRename();
    } else if (e.key === 'Escape') {
      setRenaming(null);
      setError(null);
    }
  };

  return (
    <section className="tagsec" aria-label="标签">
      <div className="tagsec-head">
        <span className="tagsec-title">标签</span>
        <button
          type="button"
          className="icon-btn tagsec-new"
          aria-label="新建标签"
          title="新建标签"
          aria-expanded={adding}
          onClick={() => setAdding((v) => !v)}
        >
          <PlusIcon size={16} />
        </button>
      </div>

      {adding && (
        <div className="tagsec-addrow">
          <input
            ref={addRef}
            className="tagsec-input"
            placeholder="标签名，回车创建"
            value={draft}
            maxLength={TAG_NAME_MAX}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={addKeyDown}
            aria-label="新标签名"
          />
        </div>
      )}

      {error && (
        <p className="tagsec-msg is-error" role="alert">
          {error}
        </p>
      )}

      {state.status === 'loading' && <p className="tagsec-hint">加载中…</p>}
      {state.status === 'error' && (
        <p className="tagsec-msg">
          {state.message}{' '}
          <button type="button" className="text-btn" onClick={() => setReload((n) => n + 1)}>
            重试
          </button>
        </p>
      )}

      {state.status === 'ready' && state.items.length === 0 && !adding && (
        <p className="tagsec-hint">还没有标签。点右上角 ＋ 新建，或在笔记页直接添加。</p>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <ul className="tagsec-list">
          {state.items.map((tag) => (
            <li key={tag.id}>
              {renaming?.id === tag.id ? (
                <div className="tagsec-row is-editing">
                  <input
                    className="tagsec-input"
                    value={renameDraft}
                    maxLength={TAG_NAME_MAX}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={renameKeyDown}
                    onBlur={() => setRenaming(null)}
                    aria-label={`重命名标签「${tag.name}」`}
                  />
                </div>
              ) : (
                <div className="tagsec-row">
                  <button type="button" className="tagsec-main" onClick={() => navigate(`/notes?tag=${tag.id}`)}>
                    <span className="tagsec-name">{tag.name}</span>
                    <span className="tagsec-count">{tag.note_count}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn tagsec-more"
                    aria-label={`标签「${tag.name}」的更多操作`}
                    aria-expanded={menuFor?.id === tag.id}
                    onClick={() => setMenuFor(menuFor?.id === tag.id ? null : tag)}
                  >
                    <MoreIcon size={16} />
                  </button>
                  {menuFor?.id === tag.id && (
                    <div className="tagsec-menu" ref={menuRef} role="menu">
                      <button type="button" role="menuitem" onClick={() => startRename(tag)}>
                        重命名
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="is-danger"
                        onClick={() => {
                          setMenuFor(null);
                          setRemoving(tag);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="删除标签？"
        message={removing ? `删除「${removing.name}」后，相关笔记会自动移除这个标签。笔记本身不受影响。` : undefined}
        confirmLabel="删除"
        danger
        busy={busy}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
