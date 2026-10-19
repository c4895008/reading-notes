import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';
import type { Config } from 'dompurify';

// 全站唯一的 Markdown 管线：解析选项与服务端提取纯文本时一致
const SAFE_URL = /^(?:https?:|mailto:)/i;
const LINK_ATTRS: [string, string][] = [
  ['target', '_blank'],
  ['rel', 'noopener noreferrer nofollow'],
];

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
md.validateLink = (url) => SAFE_URL.test(url.trim());

// 页面标题占 h1，正文标题整体降一级
md.core.ruler.push('shift_headings', (state) => {
  for (const token of state.tokens) {
    if (token.type === 'heading_open' || token.type === 'heading_close') {
      token.tag = `h${Math.min(6, Number(token.tag.slice(1)) + 1)}`;
    }
  }
});

// 表格对齐以 class 表达，清洗阶段可以不放行 style
md.core.ruler.push('table_align_class', (state) => {
  for (const token of state.tokens) {
    if (token.type !== 'th_open' && token.type !== 'td_open') continue;
    const align = /text-align:(left|center|right)/.exec(token.attrGet('style') ?? '')?.[1];
    token.attrs = token.attrs?.filter(([name]) => name !== 'style') ?? null;
    if (align) token.attrJoin('class', `md-align-${align}`);
  }
});

const renderToken: NonNullable<typeof md.renderer.rules.link_open> = (tokens, idx, options, _env, self) =>
  self.renderToken(tokens, idx, options);

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  for (const [name, value] of LINK_ATTRS) tokens[idx].attrSet(name, value);
  return renderToken(tokens, idx, options, env, self);
};

// 图片语法只渲染为链接文字，绝不生成 <img>，也就不会发起任何请求
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const src = token.attrGet('src') ?? '';
  const label = md.utils.escapeHtml(self.renderInlineAsText(token.children ?? [], options, env) || src);
  let depth = 0;
  for (let i = 0; i < idx; i += 1) {
    if (tokens[i].type === 'link_open') depth += 1;
    else if (tokens[i].type === 'link_close') depth -= 1;
  }
  if (depth > 0) return label;
  const attrs = LINK_ATTRS.map(([name, value]) => ` ${name}="${value}"`).join('');
  return `<a href="${md.utils.escapeHtml(src)}"${attrs}>${label}</a>`;
};

const PURIFY: Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 's', 'del', 'ul', 'ol', 'li', 'blockquote',
    'code', 'pre', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'start'],
  ALLOWED_URI_REGEXP: SAFE_URL,
  // 非 URI 属性也会被拿去匹配 ALLOWED_URI_REGEXP，需显式豁免，否则 target/rel 会被剥掉
  ADD_URI_SAFE_ATTR: ['target', 'rel', 'start'],
};

export function renderMarkdown(src: string): string {
  if (!src) return '';
  return DOMPurify.sanitize(md.render(src), PURIFY) as string;
}
