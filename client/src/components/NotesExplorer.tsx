import NotesBrowser from './NotesBrowser';

export default function NotesExplorer({ currentId = null }: { currentId?: number | null }) {
  return <NotesBrowser currentId={currentId} />;
}
