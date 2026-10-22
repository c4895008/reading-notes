import { request } from './client';

export type NoteTag = { id: number; name: string };

export type Tag = NoteTag & { note_count: number };

export const TAG_NAME_MAX = 40;
export const TAGS_CHANGED = 'rn:tags-changed';

export const listTags = (signal?: AbortSignal) =>
  request<{ items: Tag[] }>('/tags', { signal }).then((d) => d.items);

export const createTag = (name: string) =>
  request<{ tag: NoteTag }>('/tags', { method: 'POST', body: { name } }).then((d) => {
    window.dispatchEvent(new Event(TAGS_CHANGED));
    return d.tag;
  });

export const renameTag = (id: number, name: string) =>
  request<{ tag: NoteTag }>(`/tags/${id}`, { method: 'PATCH', body: { name } }).then((d) => {
    window.dispatchEvent(new Event(TAGS_CHANGED));
    return d.tag;
  });

export const deleteTag = (id: number) => request<{ deleted: boolean }>(`/tags/${id}`, { method: 'DELETE' }).then((d) => {
  window.dispatchEvent(new CustomEvent(TAGS_CHANGED, { detail: { deletedId: id } }));
  return d;
});

export const setNoteTags = (noteId: string | number, tagIds: number[]) =>
  request<{ tags: NoteTag[] }>(`/notes/${encodeURIComponent(noteId)}/tags`, {
    method: 'PUT',
    body: { tag_ids: tagIds },
  }).then((d) => {
    window.dispatchEvent(new Event(TAGS_CHANGED));
    return d.tags;
  });
