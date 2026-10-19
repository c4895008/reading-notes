import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Badge } from '../api/auth';
import { BadgeIcon } from './Badge';
import './Toast.css';

type Show = (text: string, icon?: ReactNode) => void;

const ToastContext = createContext<Show | null>(null);

const DURATION = 2400;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<{ id: number; text: string; icon?: ReactNode }[]>([]);

  const show = useCallback<Show>((text, icon) => {
    setQueue((q) => [...q, { id: Date.now() + Math.random(), text, icon }]);
  }, []);

  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), DURATION);
    return () => clearTimeout(t);
  }, [current]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {current && (
          <div key={current.id} className={`toast${current.icon ? ' has-icon' : ''}`}>
            {current.icon && <span className="toast-icon">{current.icon}</span>}
            {current.text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx;
}

// 一次动作获得多枚时排进同一队列，依次展示
export function useBadgeToast() {
  const show = useToast();
  return useCallback(
    (badges: Badge[] | undefined) => {
      for (const b of badges ?? []) show(`获得徽章「${b.name}」`, <BadgeIcon code={b.code} size={18} />);
    },
    [show],
  );
}
