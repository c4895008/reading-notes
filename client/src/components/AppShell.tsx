import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { refreshPendingCount, setPendingCount, usePendingCount } from '../lib/pendingRequests';
import { refreshUnreadTalks, setUnreadTalks, useUnreadTalks } from '../lib/unreadTalks';
import AvatarMenu from './AvatarMenu';
import { ExplorerProvider } from './Explorer';
import {
  FriendsIcon,
  GearIcon,
  LogoIcon,
  NoteIcon,
  PenIcon,
  PlusIcon,
  TalkIcon,
  UserIcon,
} from './Icons';
import './AppShell.css';

const POLL_MS = 30_000;

const PRIMARY_NAV = [
  { to: '/notes', label: '全部笔记', Icon: NoteIcon },
  { to: '/talks', label: '讨论', Icon: TalkIcon },
  { to: '/friends', label: '读友', Icon: FriendsIcon },
];

const TABS = [...PRIMARY_NAV, { to: '/settings', label: '我的', Icon: UserIcon }];

function CountBadge({ n }: { n: number }) {
  return (
    <span className="nav-badge" aria-hidden="true">
      {n > 99 ? '99+' : n}
    </span>
  );
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export default function AppShell() {
  const location = useLocation();
  const { user } = useAuth();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  const pending = usePendingCount();
  const unreadTalks = useUnreadTalks();
  const [explorer, setExplorer] = useState<{ key: string; node: ReactNode } | null>(null);

  const setExplorerContent = useCallback((key: string, node: ReactNode | null) => {
    setExplorer(node === null ? null : { key, node });
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      refreshPendingCount();
      refreshUnreadTalks();
    };
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      setPendingCount(0);
      setUnreadTalks(0);
    };
  }, []);

  const badgeFor = (to: string) => {
    if (to === '/friends' && pending > 0) return <CountBadge n={pending} />;
    if (to === '/talks' && unreadTalks > 0) return <CountBadge n={unreadTalks} />;
    return null;
  };

  const navAriaLabel = (to: string, label: string) => {
    if (to === '/friends' && pending > 0) return `${label}，${pending} 份待处理的读友申请`;
    if (to === '/talks' && unreadTalks > 0) return `${label}，${unreadTalks} 场讨论有未读消息`;
    return label;
  };

  const allNotesActive = location.pathname.startsWith('/notes');

  return (
    <ExplorerProvider setter={setExplorerContent}>
      <div className="shell">
        <a href="#main" className="skip-link">
          跳到主要内容
        </a>

        {!online && (
          <p className="offline-banner" role="status">
            网络已断开，恢复连接前的修改不会被保存。
          </p>
        )}

        <aside className="primary-sidebar" aria-label="主导航">
          <div className="sidebar-head">
            <Link to="/notes" className="workspace-brand" aria-label="读书笔记首页">
              <span className="workspace-logo">
                <LogoIcon size={20} />
              </span>
              <span className="workspace-copy">
                <strong>读书笔记</strong>
                <small>结构化阅读与思考</small>
              </span>
            </Link>

            <Link to="/notes/new" className="new-note-button" aria-label="写笔记" title="写笔记">
              <PenIcon size={17} />
              <span>写笔记</span>
            </Link>
          </div>

          <div className="sidebar-scroll">
            <nav className="sidebar-nav" aria-label="主导航菜单">
              <Link to="/notes" className="sidebar-link" aria-label="全部笔记" title="全部笔记" aria-current={allNotesActive ? 'page' : undefined}>
                <span className="sidebar-link-icon"><NoteIcon size={19} /></span>
                <span className="sidebar-link-label">全部笔记</span>
              </Link>
              <NavLink to="/talks" className="sidebar-link" aria-label={navAriaLabel('/talks', '讨论')} title="讨论">
                <span className="sidebar-link-icon"><TalkIcon size={19} /></span>
                <span className="sidebar-link-label">讨论</span>
                {unreadTalks > 0 && <CountBadge n={unreadTalks} />}
              </NavLink>
              <NavLink to="/friends" className="sidebar-link" aria-label={navAriaLabel('/friends', '读友')} title="读友">
                <span className="sidebar-link-icon"><FriendsIcon size={19} /></span>
                <span className="sidebar-link-label">读友</span>
                {pending > 0 && <CountBadge n={pending} />}
              </NavLink>
            </nav>
          </div>

          <div className="sidebar-foot">
            <NavLink to="/settings" className="sidebar-link sidebar-settings" aria-label="设置" title="设置">
              <span className="sidebar-link-icon"><GearIcon size={19} /></span>
              <span className="sidebar-link-label">设置</span>
            </NavLink>
            <div className="sidebar-account">
              <AvatarMenu />
              <div className="sidebar-account-copy">
                <strong>{user?.nickname}</strong>
                <span>@{user?.username}</span>
              </div>
            </div>
          </div>
        </aside>

        <header className="appbar">
          <Link to="/notes" className="brand">
            <LogoIcon size={20} />
            <span>读书笔记</span>
          </Link>
          <Link to="/notes/new" className="appbar-new" aria-label="写笔记">
            <PlusIcon size={19} />
          </Link>
        </header>

        <div className="shell-body">
          {explorer && (
            <aside className="explorer" aria-label="浏览面板">
              <div className="explorer-body" key={explorer.key}>{explorer.node}</div>
            </aside>
          )}

          <main id="main" className="shell-main" tabIndex={-1}>
            <Outlet />
          </main>
        </div>

        <nav className="tabbar" aria-label="底部导航">
          {TABS.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} className="tabbar-link" aria-label={navAriaLabel(to, label)}>
              <span className="tabbar-icon">
                <Icon />
                {badgeFor(to)}
              </span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </ExplorerProvider>
  );
}
