import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { ApiError } from '../api/client';
import { changePassword, getMyBadges, setPresetAvatar, updateNickname, uploadAvatar, type WallBadge } from '../api/me';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import { BadgeDialog, BadgeIcon, type BadgeDetail } from '../components/Badge';
import ConfirmDialog from '../components/ConfirmDialog';
import PresetArt, { PRESET_NAMES } from '../components/presetArt';
import { useToast } from '../components/Toast';
import { formatDate } from '../lib/time';
import { Field, PasswordInput } from './AuthParts';
import './Page.css';
import './Settings.css';

const count = (s: string) => [...s].length;
const NICK_MAX = 20;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AVATAR_MAX = 2 * 1024 * 1024;
const AVATAR_ERROR = '这个文件不能用。请换一张 2MB 内的 jpg / png / webp 图片。';
const CROP_SIZE = 512;

const toBlob = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));

// 居中裁成正方形并重新编码，顺带去掉原图的 EXIF 等元数据
async function cropSquare(file: File): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(CROP_SIZE, side);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx || !side) return null;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const webp = await toBlob(canvas, 'image/webp');
  if (webp?.type === 'image/webp') return webp;
  return toBlob(canvas, 'image/jpeg');
}

function AvatarSection() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputId = useId();
  const reInputId = useId();

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  if (!user) return null;
  const current = user.avatar;

  async function pickPreset(n: number) {
    if (pending !== null || (current.type === 'preset' && current.preset === n)) return;
    setPending(n);
    setError(null);
    try {
      const { user: next } = await setPresetAvatar(n);
      updateUser(next);
      toast('头像已更换');
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setPending(null);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type) || file.size > AVATAR_MAX || file.size === 0) {
      setPreview(null);
      setError(AVATAR_ERROR);
      return;
    }
    const blob = await cropSquare(file);
    if (!blob) {
      setPreview(null);
      setError(AVATAR_ERROR);
      return;
    }
    setError(null);
    setPreview({ blob, url: URL.createObjectURL(blob) });
  }

  async function confirmUpload() {
    if (!preview) return;
    setUploading(true);
    try {
      const { user: next } = await uploadAvatar(preview.blob);
      updateUser(next);
      setPreview(null);
      toast('头像已更换');
    } catch (e) {
      const err = e as ApiError;
      setPreview(null);
      setError(err.code === 'AVATAR_INVALID' ? AVATAR_ERROR : err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="settings-avatar">
      <h2 id="settings-avatar" className="settings-heading">
        头像
      </h2>
      <p className="settings-desc">点选一款即换，全站同步。</p>

      <ul className="preset-grid">
        {PRESET_NAMES.map((name, i) => {
          const n = i + 1;
          const selected = current.type === 'preset' && current.preset === n;
          return (
            <li key={n}>
              <button
                type="button"
                className={`preset-tile${selected ? ' is-selected' : ''}${pending === n ? ' is-pending' : ''}`}
                aria-pressed={selected}
                aria-label={`预置头像：${name}`}
                disabled={pending !== null && pending !== n}
                onClick={() => pickPreset(n)}
              >
                <span className="preset-art">
                  <PresetArt preset={n} />
                </span>
                <span className="preset-name" aria-hidden="true">
                  {name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="custom-row">
        {current.type === 'custom' && (
          <span className="custom-current">
            <Avatar avatar={current} name={user.nickname} size={40} decorative />
            <span>正在使用自己的图片</span>
          </span>
        )}
        <input id={inputId} type="file" accept={AVATAR_TYPES.join(',')} className="visually-hidden" onChange={onFile} />
        <label htmlFor={inputId} className="btn btn-ghost custom-upload">
          {current.type === 'custom' ? '换一张图片' : '上传自己的图片'}
        </label>
        <p className="settings-aux">jpg / png / webp，2MB 以内；会居中裁成正方形。</p>
      </div>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}

      <ConfirmDialog
        open={!!preview}
        title="用这张做头像？"
        message="已按 1:1 居中裁切，下面是在各处显示的样子。"
        confirmLabel="使用这张"
        busy={uploading}
        onConfirm={confirmUpload}
        onCancel={() => setPreview(null)}
      >
        {preview && (
          <div className="crop-preview">
            <img src={preview.url} alt="裁切后的头像预览" className="crop-large" />
            <img src={preview.url} alt="" className="crop-small" />
            <input id={reInputId} type="file" accept={AVATAR_TYPES.join(',')} className="visually-hidden" onChange={onFile} disabled={uploading} />
            <label htmlFor={reInputId} className={`crop-reselect${uploading ? ' is-disabled' : ''}`}>
              重选
            </label>
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}

function NicknameSection() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [value, setValue] = useState(user?.nickname ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const trimmed = value.trim();
  const n = count(trimmed);
  const unchanged = trimmed === user.nickname;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || unchanged) return;
    if (!trimmed) return setError('请填写昵称');
    if (n > NICK_MAX) return setError(`昵称最多 ${NICK_MAX} 个字`);
    setBusy(true);
    setError(null);
    try {
      const { user: next } = await updateNickname(trimmed);
      updateUser(next);
      setValue(next.nickname);
      toast('昵称已更新');
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.details?.fields?.nickname ?? apiErr.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="settings-nickname">
      <h2 id="settings-nickname" className="settings-heading">
        昵称
      </h2>
      <form className="settings-form" onSubmit={submit} noValidate>
        <Field id="nickname" label="昵称" hint={`读友看到的名字，${n} / ${NICK_MAX}`} error={error}>
          {(describedBy) => (
            <input
              id="nickname"
              className="input"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              autoComplete="nickname"
              aria-describedby={describedBy}
              aria-invalid={!!error || n > NICK_MAX || undefined}
            />
          )}
        </Field>
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || unchanged}>
            {busy ? '保存中…' : '保存昵称'}
          </button>
        </div>
      </form>
    </section>
  );
}

type PwErrors = { current_password?: string; new_password?: string };

function PasswordSection() {
  const { endSession } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<PwErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const currentRef = useRef<HTMLDivElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const local: PwErrors = {};
    if (!current) local.current_password = '请填写当前密码';
    if (next.length < 8) local.new_password = '新密码至少 8 位';
    else if (next === current) local.new_password = '新密码不能与当前密码相同';
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;

    setBusy(true);
    try {
      await changePassword(current, next);
      endSession('密码已修改，请用新密码重新登录。');
    } catch (err) {
      const apiErr = err as ApiError;
      const fields = apiErr.details?.fields as PwErrors | undefined;
      if (fields) {
        setErrors(fields);
        if (fields.current_password) currentRef.current?.querySelector('input')?.focus();
      } else setFormError(apiErr.message);
      setBusy(false);
    }
  }

  return (
    <section className="settings-section" aria-labelledby="settings-password">
      <h2 id="settings-password" className="settings-heading">
        密码
      </h2>
      <p className="settings-desc">修改成功后，所有设备都需要用新密码重新登录。</p>
      <form className="settings-form" onSubmit={submit} noValidate>
        <div ref={currentRef}>
          <Field id="current-password" label="当前密码" error={errors.current_password}>
            {(describedBy) => (
              <PasswordInput
                id="current-password"
                value={current}
                onChange={(v) => {
                  setCurrent(v);
                  setErrors((p) => ({ ...p, current_password: undefined }));
                }}
                autoComplete="current-password"
                describedBy={describedBy}
                invalid={!!errors.current_password}
              />
            )}
          </Field>
        </div>
        <Field id="new-password" label="新密码" hint="至少 8 位" error={errors.new_password}>
          {(describedBy) => (
            <PasswordInput
              id="new-password"
              value={next}
              onChange={(v) => {
                setNext(v);
                setErrors((p) => ({ ...p, new_password: undefined }));
              }}
              autoComplete="new-password"
              describedBy={describedBy}
              invalid={!!errors.new_password}
            />
          )}
        </Field>
        {formError && (
          <p className="settings-error" role="alert">
            {formError}
          </p>
        )}
        <div className="settings-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? '修改中…' : '修改密码'}
          </button>
        </div>
      </form>
    </section>
  );
}

type WallState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; badges: WallBadge[] };

function BadgeSection() {
  const [state, setState] = useState<WallState>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [shown, setShown] = useState<BadgeDetail | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    getMyBadges(ctrl.signal)
      .then((badges) => setState({ status: 'ready', badges }))
      .catch((e: ApiError) => {
        if (!ctrl.signal.aborted) setState({ status: 'error', message: e.message });
      });
    return () => ctrl.abort();
  }, [reload]);

  const badges = state.status === 'ready' ? state.badges : [];

  return (
    <section className="settings-section" aria-labelledby="settings-badges" aria-busy={state.status === 'loading'}>
      <h2 id="settings-badges" className="settings-heading">
        我的徽章
      </h2>
      {state.status === 'ready' && !badges.some((b) => b.earned) && <p className="badge-wall-empty">徽章会随着你的讨论与提炼，一枚一枚亮起来。</p>}
      {state.status === 'error' && (
        <div className="settings-error" role="alert">
          {state.message}{' '}
          <button type="button" className="text-btn" onClick={() => setReload((n) => n + 1)}>
            重试
          </button>
        </div>
      )}
      {state.status === 'loading' && (
        <ul className="badge-wall" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="badge-tile-sk" />
          ))}
        </ul>
      )}
      {state.status === 'ready' && (
        <ul className="badge-wall">
          {badges.map((b) => (
            <li key={b.code}>
              <button
                type="button"
                className={`badge-tile${b.earned ? '' : ' is-locked'}`}
                aria-label={`${b.name}，${b.earned ? '已获得' : '未获得'}`}
                onClick={() => setShown({ code: b.code, name: b.name, earned: b.earned, awardedAt: b.awarded_at })}
              >
                <span className={`badge-medal${b.earned ? '' : ' is-locked'}`}>
                  <BadgeIcon code={b.code} size={26} />
                </span>
                <span className="badge-tile-name">{b.name}</span>
                <span className="badge-tile-sub">{b.earned && b.awarded_at ? `获得于 ${formatDate(b.awarded_at)}` : b.condition}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <BadgeDialog badge={shown} onClose={() => setShown(null)} />
    </section>
  );
}

export default function Settings() {
  const { user, signOut } = useAuth();
  if (!user) return null;

  return (
    <section className="page page-enter" aria-labelledby="page-title">
      <h1 id="page-title" className="page-title">
        设置
      </h1>

      <div className="account-card">
        <Avatar avatar={user.avatar} name={user.nickname} size={64} />
        <div className="account-who">
          <p className="account-name">{user.nickname}</p>
          <p className="account-username">@{user.username}</p>
        </div>
        <button type="button" className="btn btn-ghost account-logout" onClick={signOut}>
          退出登录
        </button>
      </div>

      <AvatarSection />
      <NicknameSection />
      <PasswordSection />
      <BadgeSection />
    </section>
  );
}
