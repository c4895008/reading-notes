import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Badge } from '../api/auth';
import { fullTime } from '../lib/time';
import './ConfirmDialog.css';
import './Badge.css';

type Info = { name: string; imagery: string; condition: string };

// 与服务端目录（services/badge.js）一致；名称与条件在产品内固定
export const BADGE_INFO: Record<string, Info> = {
  icebreaker: { name: '破冰', imagery: '冰晶绽开', condition: '首次在讨论中发送消息（读友侧）' },
  companion: { name: '同席', imagery: '并坐', condition: '在 3 场不同的讨论中都发送过消息（读友侧）' },
  kindler: { name: '东道', imagery: '请帖', condition: '首次发起讨论（发起人侧）' },
  fullhouse: { name: '满座', imagery: '齐聚', condition: '发起的某场讨论中，有 ≥ 3 位读友各发送过消息（发起人侧）' },
};

const svg = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

const GLYPHS: Record<string, ReactNode> = {
  icebreaker: (
    <>
      <path d="M12 12V3.5M12 12l7.36-4.25M12 12l7.36 4.25M12 12v8.5M12 12l-7.36 4.25M12 12L4.64 7.75" />
      <path d="M10.7 8.65 12 6.4l1.3 2.25M14.25 9.2h2.6l-1.3 2.25M15.55 12.55l1.3 2.25h-2.6M13.3 15.35 12 17.6l-1.3-2.25M9.75 14.8h-2.6l1.3-2.25M8.45 11.45 7.15 9.2h2.6" />
    </>
  ),
  companion: (
    <>
      <circle cx="8.5" cy="6.8" r="2.2" />
      <circle cx="15.5" cy="6.8" r="2.2" />
      <path d="M5 15c0-2.8 1.6-4.6 3.5-4.6S12 12.2 12 15M12 15c0-2.8 1.6-4.6 3.5-4.6S19 12.2 19 15" />
      <path d="M3.5 15h17M5.5 15v4.5M18.5 15v4.5" />
    </>
  ),
  kindler: (
    <>
      <path d="M4 7h16v11.5H4z" />
      <path d="M4 7l6.6 5.4M20 7l-6.6 5.4" />
      <circle cx="12" cy="13.4" r="1.8" />
    </>
  ),
  fullhouse: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="4.4" r="1.5" />
      <circle cx="19.23" cy="9.65" r="1.5" />
      <circle cx="16.47" cy="18.15" r="1.5" />
      <circle cx="7.53" cy="18.15" r="1.5" />
      <circle cx="4.77" cy="9.65" r="1.5" />
    </>
  ),
};

export function BadgeIcon({ code, size = 20 }: { code: string; size?: number }) {
  return <svg {...svg(size)}>{GLYPHS[code]}</svg>;
}

export type BadgeDetail = { code: string; name: string; earned?: boolean; awardedAt?: string | null };

// 他人的徽章只有 {code, name}，不含获得时间；未获得只显示条件
export function BadgeDialog({ badge, onClose }: { badge: BadgeDetail | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const open = badge !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const returnTo = document.activeElement as HTMLElement | null;
    dialog.showModal();
    closeRef.current?.focus();
    return () => {
      dialog.close();
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [open]);

  const info = badge ? BADGE_INFO[badge.code] : null;
  const earned = badge?.earned !== false;

  return (
    <dialog
      ref={ref}
      className="confirm badge-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {badge && (
        <div className="confirm-body badge-dialog-body">
          <span className={`badge-medal${earned ? '' : ' is-locked'}`}>
            <BadgeIcon code={badge.code} size={32} />
          </span>
          <h2 id={titleId} className="confirm-title">
            {info?.name ?? badge.name}
          </h2>
          {info && (
            <dl className="badge-facts">
              {earned && (
                <div>
                  <dt>图标意象</dt>
                  <dd>{info.imagery}</dd>
                </div>
              )}
              <div>
                <dt>获得条件</dt>
                <dd>{info.condition}</dd>
              </div>
              {earned && badge.awardedAt && (
                <div>
                  <dt>获得时间</dt>
                  <dd>
                    <time dateTime={badge.awardedAt}>{fullTime(badge.awardedAt)}</time>
                  </dd>
                </div>
              )}
            </dl>
          )}
          {!earned && <p className="badge-locked-note">尚未获得</p>}
          <div className="confirm-actions">
            <button ref={closeRef} type="button" className="btn btn-ghost" onClick={onClose}>
              知道了
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

// 行内小图标：读友列表、搜索结果、讨论页名单；0 枚时不渲染
export function BadgeRow({ badges }: { badges: Badge[] }) {
  const [shown, setShown] = useState<Badge | null>(null);
  if (!badges.length) return null;
  return (
    <>
      <span className="badge-row" role="list" aria-label="徽章">
        {badges.slice(0, 4).map((b) => (
          <span key={b.code} role="listitem">
            <button type="button" className="badge-chip" aria-label={`徽章：${b.name}`} title={b.name} onClick={() => setShown(b)}>
              <BadgeIcon code={b.code} size={18} />
            </button>
          </span>
        ))}
      </span>
      <BadgeDialog badge={shown} onClose={() => setShown(null)} />
    </>
  );
}
