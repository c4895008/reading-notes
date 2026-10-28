import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import NotesBrowser from '../components/NotesBrowser';
import NotesExplorer from '../components/NotesExplorer';
import { useExplorerContent } from '../components/Explorer';
import { LogoIcon, PlusIcon, TreeIcon } from '../components/Icons';
import './Page.css';
import './Notes.css';

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatch(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return match;
}

function NotesHomeEmpty() {
  return (
    <div className="page page-enter notes-home">
      <div className="notes-home-empty">
        <span className="notes-home-mark">
          <LogoIcon size={30} />
        </span>
        <h1 className="notes-home-title">选择一条笔记开始阅读</h1>
        <p className="notes-home-hint">从左侧的列表或结构里挑一条；新的想法，也可以直接写下来。</p>
        <div className="notes-home-actions">
          <Link to="/notes/new" className="btn btn-primary">
            <PlusIcon size={16} />
            写笔记
          </Link>
          <Link to="/notes?view=tree" className="btn btn-ghost">
            <TreeIcon size={16} />
            结构总览
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function NotesList() {
  const compact = useMedia('(max-width: 899px)');
  // 桌面端把合并的列表/结构浏览面板注册进 Explorer；窄端 Explorer 隐藏，改在主区渲染
  useExplorerContent(compact ? 'rn:explorer:off' : 'rn:notes:home', compact ? null : <NotesExplorer />);
  if (compact) {
    return (
      <div className="page page-enter notes-page">
        <NotesBrowser />
      </div>
    );
  }
  return <NotesHomeEmpty />;
}
