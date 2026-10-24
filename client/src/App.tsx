import { createBrowserRouter, Navigate } from 'react-router-dom';
import { GuestOnly, RequireAuth } from './auth/guards';
import AppShell from './components/AppShell';
import Friends from './pages/Friends';
import Login from './pages/Login';
import NoteEditor, { NewNoteRoute } from './pages/NoteEditor';
import NotesList from './pages/NotesList';
import NoteView from './pages/NoteView';
import NotFound from './pages/NotFound';
import Register from './pages/Register';
import Settings from './pages/Settings';
import Talk from './pages/Talk';
import Talks from './pages/Talks';

// 数据路由：useBlocker（未保存离开确认）只在此模式下可用
export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: 'login', element: <Login /> },
      { path: 'register', element: <Register /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/notes" replace /> },
          { path: 'notes', element: <NotesList /> },
          { path: 'notes/new', element: <NewNoteRoute /> },
          { path: 'notes/:id', element: <NoteView /> },
          { path: 'notes/:id/edit', element: <NoteEditor key="edit" /> },
          { path: 'tags', element: <Navigate to="/notes" replace /> },
          { path: 'books', element: <Navigate to="/notes" replace /> },
          { path: 'talks', element: <Talks /> },
          { path: 'talks/:id', element: <Talk /> },
          { path: 'friends', element: <Friends /> },
          { path: 'settings', element: <Settings /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
