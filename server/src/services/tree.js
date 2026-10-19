import { AppError } from '../errors.js';

// 结构算法全部是纯函数：输入某位作者的有效笔记 { id, parent_id, sort_order }，输出需要写回的位置变更
export const cycleNotAllowed = () => new AppError(400, 'CYCLE_NOT_ALLOWED', '不能选择这条笔记或它的下层笔记');
export const parentNotFound = () => new AppError(404, 'PARENT_NOT_FOUND', '目标笔记无权访问或不存在');

const bySortOrder = (a, b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity) || a.id - b.id;

export function buildIndex(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map();
  for (const r of rows) {
    // 父级不在有效集合内（理论上不会发生）时按顶层处理，保证节点不丢
    const parent = r.parent_id !== null && byId.has(r.parent_id) ? r.parent_id : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(r);
  }
  for (const list of children.values()) list.sort(bySortOrder);
  return { byId, children };
}

export const childrenOf = (index, parentId) => index.children.get(parentId) ?? [];

function parentOf(index, id) {
  const parent = index.byId.get(id)?.parent_id ?? null;
  return parent !== null && index.byId.has(parent) ? parent : null;
}

// 祖先链，根 → 直接父级
export function ancestorsOf(index, id) {
  const chain = [];
  const seen = new Set([id]);
  for (let cur = parentOf(index, id); cur !== null && !seen.has(cur); cur = parentOf(index, cur)) {
    seen.add(cur);
    chain.push(index.byId.get(cur));
  }
  return chain.reverse();
}

// 先序遍历整片森林（迭代实现，深链不爆栈）
export function preorder(index) {
  const out = [];
  const stack = childrenOf(index, null)
    .map((node) => ({ node, depth: 0 }))
    .reverse();
  while (stack.length) {
    const item = stack.pop();
    out.push(item);
    const kids = childrenOf(index, item.node.id);
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], depth: item.depth + 1 });
  }
  return out;
}

// target 是否为 root 本身或其后代：沿 target 的父链上行
export function isSelfOrDescendant(index, rootId, targetId) {
  const seen = new Set();
  for (let cur = targetId; cur !== null && !seen.has(cur); cur = parentOf(index, cur)) {
    if (cur === rootId) return true;
    seen.add(cur);
  }
  return false;
}

export function nextOrder(index, parentId, excludeId = null) {
  let max = 0;
  for (const n of childrenOf(index, parentId)) if (n.id !== excludeId) max = Math.max(max, n.sort_order ?? 0);
  return max + 1;
}

export function planCreate(index, parentId) {
  if (parentId !== null && !index.byId.has(parentId)) throw parentNotFound();
  return { parent_id: parentId, sort_order: nextOrder(index, parentId) };
}

// 向上提炼：新笔记 N 接替 S 的父级与兄弟位置，S 成为 N 的唯一子级，S 的子树不动
export function planPromote(index, sourceId) {
  const source = index.byId.get(sourceId);
  return {
    insert: { parent_id: parentOf(index, sourceId), sort_order: source.sort_order },
    source: { id: sourceId, sort_order: 1 },
  };
}

// 挂载 / 更换 / 解除：S 成为目标父级的最后一个子级；parentId 为 null 即解除为顶层
export function planMove(index, sourceId, parentId) {
  if (parentId !== null && !index.byId.has(parentId)) throw parentNotFound();
  if (parentId !== null && isSelfOrDescendant(index, sourceId, parentId)) throw cycleNotAllowed();
  if (parentOf(index, sourceId) === parentId) return [];
  return [{ id: sourceId, parent_id: parentId, sort_order: nextOrder(index, parentId, sourceId) }];
}

// 删除：直接子级按原相对顺序追加到顶层末尾，各自子树不变
export function planDelete(index, sourceId) {
  const base = nextOrder(index, null, sourceId);
  return childrenOf(index, sourceId).map((child, i) => ({ id: child.id, parent_id: null, sort_order: base + i }));
}
