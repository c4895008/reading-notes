import { useMemo } from 'react';
import { renderMarkdown } from '../lib/markdown';
import './NoteContent.css';

export function QuoteBlock({ text }: { text: string }) {
  return (
    <blockquote className="quote-block">
      <span className="visually-hidden">引文：</span>
      {text}
    </blockquote>
  );
}

export function NoteBody({ source }: { source: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  if (!html) return null;
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
