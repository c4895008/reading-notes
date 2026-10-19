import MarkdownIt from 'markdown-it';

// 与前端渲染管线同一套解析选项，保证「纯文本」与用户看到的内容一致
const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

export function markdownToText(src) {
  if (!src) return '';
  const parts = [];
  for (const token of md.parse(src, {})) {
    if (token.type === 'inline') {
      for (const child of token.children ?? []) {
        if (child.type === 'text' || child.type === 'code_inline' || child.type === 'image') parts.push(child.content);
        else if (child.type === 'softbreak' || child.type === 'hardbreak') parts.push(' ');
      }
      parts.push(' ');
    } else if (token.type === 'fence' || token.type === 'code_block') {
      parts.push(token.content, ' ');
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}
