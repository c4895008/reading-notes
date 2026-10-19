import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import Avatar from './Avatar';
import './AvatarMenu.css';

export default function AvatarMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const onMenuKey = (e: KeyboardEvent) => {
    const list = items();
    const idx = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(idx + 1) % list.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[(idx - 1 + list.length) % list.length]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  if (!user) return null;

  return (
    <div className="avatar-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="avatar-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`账户菜单：${user.nickname}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar avatar={user.avatar} name={user.nickname} size={32} decorative />
      </button>

      {open && (
        <div id={menuId} ref={menuRef} className="menu" role="menu" aria-label="账户" onKeyDown={onMenuKey}>
          <div className="menu-head">
            <Avatar avatar={user.avatar} name={user.nickname} size={40} decorative />
            <div className="menu-who">
              <p className="menu-name">{user.nickname}</p>
              <p className="menu-username">@{user.username}</p>
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              close(false);
              signOut();
            }}
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
