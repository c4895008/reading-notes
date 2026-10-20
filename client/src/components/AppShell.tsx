import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { refreshPendingCount, setPendingCount, usePendingCount } from '../lib/pendingRequests';
import { refreshUnreadTalks, setUnreadTalks, useUnreadTalks } from '../lib/unreadTalks';
import AvatarMenu from './AvatarMenu';
import { ExplorerProvider } from './Explorer';
import { FriendsIcon, GearIcon, LogoIcon, NoteIcon, PanelLeftIcon, TalkIcon, UserIcon } from './Icons';
import './AppShell.css';

const POLL_MS = 30_000;
const COLLAPSE_KEY = 'rn.explorer.collapsed';

const NAV = [
  { to: '/notes', label: '笔记', Icon: NoteIcon },
  { to: '/talks', label: '笔谈', Icon: TalkIcon },
  { to: '/friends', label: '读友', Icon: FriendsIcon },
];

const TABS = [...NAV, { to: '/settings', label: '我的', Icon: UserIcon }];

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
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  const pending = usePendingCount();
  const unreadTalks = useUnreadTalks();
  const [explorer, setExplorer] = useState<{ key: string; node: ReactNode } | null>(null);
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem(COLLAPSE_KEY) === '1',
  );

  const setExplorerContent = useCallback((key: string, node: ReactNode | null) => {
    setExplorer(node === null ? null : { key, node });
  }, []);

  const toggleExplorer = useCallback(() => {
    setCollapsed((v) => {
      window.localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1');
      return !v;
    });
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
    if (to === '/talks' && unreadTalks > 0) return `${label}，${unreadTalks} 场笔谈有未读消息`;
    return label;
  };

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

        <aside className="rail" aria-label="主导航">
          <Link to="/notes" className="rail-logo" aria-label="读书笔记">
            <LogoIcon size={26} />
          </Link>

          <nav className="rail-nav">
            {NAV.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className="rail-link"
                aria-label={navAriaLabel(to, label)}
                title={label}
              >
                <span className="rail-icon">
                  <Icon />
                  {badgeFor(to)}
                </span>
              </NavLink>
            ))}
          </nav>

          <div className="rail-foot">
            <NavLink to="/settings" className="rail-link" aria-label="设置" title="设置">
              <GearIcon />
            </NavLink>
            <AvatarMenu />
          </div>
        </aside>

        <header className="appbar">
          <Link to="/notes" className="brand">
            读书笔记
          </Link>
        </header>

        <div className="shell-body">
          {explorer && !collapsed && (
            <aside className="explorer" aria-label="浏览面板">
              <button
                type="button"
                className="icon-btn explorer-collapse"
                onClick={toggleExplorer}
                aria-label="收起浏览面板"
                title="收起浏览面板"
              >
                <PanelLeftIcon size={18} />
              </button>
              <div className="explorer-body" key={explorer.key}>{explorer.node}</div>
            </aside>
          )}

          <main id="main" className="shell-main" tabIndex={-1}>
            {explorer && collapsed && (
              <button
                type="button"
                className="icon-btn explorer-restore"
                onClick={toggleExplorer}
                aria-label="展开浏览面板"
                title="展开浏览面板"
              >
                <PanelLeftIcon size={18} />
              </button>
            )}
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
