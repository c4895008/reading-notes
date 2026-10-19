import { useCallback, useEffect, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import { useBlocker, useLocation, useNavigate, useParams, useSearchParams, type BlockerFunction } from 'react-router-dom';
import { ApiError } from '../api/client';
import { createNote, getNote, NOTE_LIMITS, promoteNote, updateNote, type NoteInput, type NoteRef } from '../api/notes';
import type { NoteTag } from '../api/tags';
import ConfirmDialog from '../components/ConfirmDialog';
import { useExplorerContent } from '../components/Explorer';
import { BackIcon } from '../components/Icons';
import { NoteBody, QuoteBlock } from '../components/NoteContent';
import NotesExplorer from '../components/NotesExplorer';
import { useToast } from '../components/Toast';
import TagEditor from '../components/TagEditor';
import { randomKey } from '../lib/id';
import { NoteMissing, ReadingSkeleton } from './NoteView';
import './Page.css';
import './Notes.css';

type Draft = { title: string; quote: string; content: string };
type FieldErrors = Partial<Record<keyof Draft, string>>;
type NavState = { fromView?: boolean; back?: string } | null;
type Mode = 'create' | 'edit' | 'refine' | 'supplement';

const ID_RE = /^[1-9]\d{0,15}$/;

const EMPTY: Draft = { title: '', quote: '', content: '' };
const SAVE_FAILED = '这次没有保存成功。内容还在，可以再试一次。';

const count = (s: string) => [...s].length;

const toInput = (d: Draft): NoteInput => ({
  title: d.title.trim(),
  quote: d.quote.trim() ? d.quote : null,
  content: d.content.trim() ? d.content : '',
});

function AutoGrow(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} {...props} />;
}

function Counter({ value, max, id, showFrom = 0 }: { value: string; max: number; id: string; showFrom?: number }) {
  const n = count(value);
  if (n < showFrom) return null;
  return (
    <span id={id} className={`editor-count${n > max ? ' is-over' : ''}`} aria-live={n > max ? 'polite' : 'off'}>
      {n.toLocaleString()} / {max.toLocaleString()}
    </span>
  );
}

const TOAST: Record<Mode, string> = {
  create: '笔记已写下',
  edit: '修改已保存',
  refine: '已向上提炼一层',
  supplement: '已补充一条更具体的笔记',
};

// 按 ?under= 重建编辑器，避免在两个补充入口之间沿用草稿
export function NewNoteRoute() {
  const [params] = useSearchParams();
  const under = params.get('under');
  return <NoteEditor key={under ?? 'new'} under={under} />;
}

type Props = { refine?: NoteRef; under?: string | null };

export default function NoteEditor({ refine, under = null }: Props) {
  const params = useParams();
  const id = refine ? undefined : params.id;
  const mode: Mode = refine ? 'refine' : id ? 'edit' : under !== null ? 'supplement' : 'create';
  const isEdit = mode === 'edit';
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state as NavState;
  const toast = useToast();

  const editId = !refine && params.id && /^\d+$/.test(params.id) ? Number(params.id) : null;
  useExplorerContent(`notes:editor:${editId ?? under ?? 'new'}`, <NotesExplorer currentId={editId} />);

  const needsLoad = mode === 'edit' || mode === 'supplement';
  const [loadState, setLoadState] = useState<'loading' | 'missing' | 'error' | 'ready'>(needsLoad ? 'loading' : 'ready');
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [target, setTarget] = useState<NoteRef | null>(refine ?? null);
  const [initial, setInitial] = useState<Draft>(EMPTY);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pane, setPane] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [editTags, setEditTags] = useState<NoteTag[]>([]);

  const allowLeave = useRef(false);
  const idempotency = useRef<{ signature: string; key: string } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadId = mode === 'edit' ? id : mode === 'supplement' ? under : null;
    if (!loadId) return;
    if (!ID_RE.test(loadId)) {
      setLoadState('missing');
      return;
    }
    const ctrl = new AbortController();
    setLoadState('loading');
    getNote(loadId, ctrl.signal)
      .then((note) => {
        if (mode === 'edit') {
          const loaded = { title: note.title, quote: note.quote ?? '', content: note.content };
          setInitial(loaded);
          setDraft(loaded);
          setEditTags(note.tags);
        } else {
          setTarget({ id: note.id, title: note.title });
        }
        setLoadState('ready');
      })
      .catch((e: ApiError) => {
        if (ctrl.signal.aborted) return;
        setLoadError(e.message);
        setLoadState(e.status === 404 ? 'missing' : 'error');
      });
    return () => ctrl.abort();
  }, [mode, id, under, reload]);

  useEffect(() => {
    if (!isEdit && loadState === 'ready') titleRef.current?.focus();
  }, [isEdit, loadState]);

  const dirty = draft.title !== initial.title || draft.quote !== initial.quote || draft.content !== initial.content;

  const shouldBlock = useCallback<BlockerFunction>(
    // 提炼编辑器与阅读页同一路径，只靠 history state 区分，因此任何离开都要拦
    () => dirty && !allowLeave.current,
    [dirty],
  );
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const titleLength = count(draft.title.trim());
  const over = {
    title: titleLength > NOTE_LIMITS.title,
    quote: count(draft.quote.trim()) > NOTE_LIMITS.quote,
    content: count(draft.content) > NOTE_LIMITS.content,
  };
  const canSave = titleLength > 0 && !over.title && !over.quote && !over.content && !saving && loadState === 'ready';

  const update = (field: keyof Draft) => (e: { target: { value: string } }) => {
    setDraft((d) => ({ ...d, [field]: e.target.value }));
    if (fieldErrors[field]) setFieldErrors((f) => ({ ...f, [field]: undefined }));
  };

  async function save() {
    if (!canSave) return;
    const input = toInput(draft);
    setSaving(true);
    setSaveError(null);
    setFieldErrors({});
    try {
      let noteId: number;
      if (mode === 'edit') {
        noteId = (await updateNote(id!, input)).id;
      } else {
        // 同一内容重试沿用同一个 key，服务端会返回首次结果而非再建一条
        const signature = JSON.stringify(input);
        if (idempotency.current?.signature !== signature) idempotency.current = { signature, key: randomKey() };
        const key = idempotency.current.key;
        if (mode === 'refine') noteId = (await promoteNote(target!.id, input, key)).id;
        else noteId = (await createNote(input, key, mode === 'supplement' ? target!.id : undefined)).id;
      }
      allowLeave.current = true;
      toast(TOAST[mode]);
      const back = navState?.back ?? '/notes';
      if (mode === 'edit' && navState?.fromView) navigate(-1);
      else navigate(`/notes/${noteId}`, { replace: true, state: { back, fresh: mode === 'refine' || mode === 'supplement' } });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 404) {
        setSaveError(mode === 'edit' ? '这条笔记已不存在，无法保存。' : '原笔记已不存在，无法保存。');
      } else {
        setFieldErrors((err.details?.fields as FieldErrors | undefined) ?? {});
        setSaveError(err.status === 400 ? `${SAVE_FAILED}（${err.message}）` : SAVE_FAILED);
      }
      setSaving(false);
    }
  }

  function cancel() {
    if (mode === 'refine' || location.key !== 'default') navigate(-1);
    else navigate(id ? `/notes/${id}` : under && ID_RE.test(under) ? `/notes/${under}` : '/notes', { replace: true });
  }

  if (loadState === 'missing') return <NoteMissing />;

  const quoteText = draft.quote.trim();
  return (
    <div className="page page-enter editor">
      <div className="editor-bar">
        <button type="button" className="back-link" onClick={cancel}>
          <BackIcon />
          {mode === 'create' ? '笔记' : '取消'}
        </button>

        <div className="segmented" role="group" aria-label="编辑或预览">
          <button type="button" aria-pressed={pane === 'edit'} onClick={() => setPane('edit')}>
            编辑
          </button>
          <button type="button" aria-pressed={pane === 'preview'} onClick={() => setPane('preview')}>
            预览
          </button>
        </div>

        <button type="button" className="btn btn-primary" onClick={save} disabled={!canSave}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {target && (mode === 'refine' || mode === 'supplement') && (
        <div className="editor-context">
          <p className="editor-context-title">
            {mode === 'refine' ? '向上提炼' : '向下补充'} · 「{target.title}」
          </p>
          <p className="editor-context-hint">
            {mode === 'refine'
              ? '写一条更抽象的笔记，原笔记会成为它的下层。'
              : '写一条更具体的笔记，它会成为原笔记的最后一条下层笔记。'}
          </p>
        </div>
      )}

      {saveError && (
        <p className="editor-alert" role="alert">
          {saveError}
        </p>
      )}

      {loadState === 'loading' && <ReadingSkeleton />}

      {loadState === 'error' && (
        <div className="notes-state" role="alert">
          <p>{loadError}</p>
          <button type="button" className="btn btn-ghost" onClick={() => setReload((n) => n + 1)}>
            重试
          </button>
        </div>
      )}

      {loadState === 'ready' && pane === 'edit' && (
        <form
          className="editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="editor-field">
            <label htmlFor="note-title" className="visually-hidden">
              标题
            </label>
            <input
              ref={titleRef}
              id="note-title"
              className="editor-title"
              placeholder="标题"
              autoComplete="off"
              value={draft.title}
              onChange={update('title')}
              aria-invalid={over.title || Boolean(fieldErrors.title)}
              aria-describedby="note-title-count note-title-msg"
            />
            <div className="editor-foot">
              <span id="note-title-msg" className="field-msg is-error">
                {fieldErrors.title ?? (over.title ? `标题最多 ${NOTE_LIMITS.title} 字` : '')}
              </span>
              <Counter id="note-title-count" value={draft.title.trim()} max={NOTE_LIMITS.title} showFrom={60} />
            </div>
          </div>

          <div className="editor-field editor-quote">
            <label htmlFor="note-quote" className="editor-label">
              引文
            </label>
            <AutoGrow
              id="note-quote"
              className="editor-quote-input"
              placeholder="摘录原文，方便日后溯源。"
              rows={2}
              value={draft.quote}
              onChange={update('quote')}
              aria-invalid={over.quote || Boolean(fieldErrors.quote)}
              aria-describedby="note-quote-count note-quote-msg"
            />
            <div className="editor-foot">
              <span id="note-quote-msg" className="field-msg is-error">
                {fieldErrors.quote ?? (over.quote ? `引文最多 ${NOTE_LIMITS.quote} 字` : '')}
              </span>
              <Counter id="note-quote-count" value={draft.quote.trim()} max={NOTE_LIMITS.quote} />
            </div>
          </div>

          <div className="editor-field">
            <div className="editor-label-row">
              <label htmlFor="note-content" className="editor-label">
                想法
              </label>
              <span className="editor-hint">支持 Markdown</span>
            </div>
            <AutoGrow
              id="note-content"
              className="editor-content-input"
              placeholder="写下你的想法……"
              value={draft.content}
              onChange={update('content')}
              aria-invalid={over.content || Boolean(fieldErrors.content)}
              aria-describedby="note-content-count note-content-msg"
            />
            <div className="editor-foot">
              <span id="note-content-msg" className="field-msg is-error">
                {fieldErrors.content ?? (over.content ? `正文最多 ${NOTE_LIMITS.content.toLocaleString()} 字` : '')}
              </span>
              <Counter id="note-content-count" value={draft.content} max={NOTE_LIMITS.content} />
            </div>
          </div>
        </form>
      )}

      {isEdit && loadState === 'ready' && editId !== null && (
        <div className="editor-tags">
          <TagEditor noteId={editId} tags={editTags} onChange={setEditTags} />
        </div>
      )}

      {loadState === 'ready' && pane === 'preview' && (
        <article className="reading-card editor-preview" aria-label="预览">
          <h1 className={`reading-title${draft.title.trim() ? '' : ' is-placeholder'}`}>{draft.title.trim() || '（还没有标题）'}</h1>
          {quoteText && <QuoteBlock text={draft.quote.trim()} />}
          {draft.content.trim() ? <NoteBody source={draft.content} /> : <p className="reading-empty">还没有写下想法。</p>}
        </article>
      )}

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="舍弃这次修改？"
        message="离开后，这次没保存的内容不会留下。"
        confirmLabel="舍弃"
        cancelLabel="继续编辑"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </div>
  );
}
