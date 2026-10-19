import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ancestorsOf,
  buildIndex,
  childrenOf,
  isSelfOrDescendant,
  planCreate,
  planDelete,
  planMove,
  planPromote,
  preorder,
} from '../src/services/tree.js';

// 内存版「数据库」：按与 services/notes.js 相同的方式落地各 plan 的结果
function createStore() {
  let seq = 0;
  const rows = [];
  const index = () => buildIndex(rows);
  const find = (id) => rows.find((r) => r.id === id);
  const apply = (changes) => changes.forEach((c) => Object.assign(find(c.id), c));
  return {
    rows,
    create(parentId = null) {
      const id = ++seq;
      rows.push({ id, ...planCreate(index(), parentId) });
      return id;
    },
    promote(sourceId) {
      const plan = planPromote(index(), sourceId);
      const id = ++seq;
      rows.push({ id, ...plan.insert });
      Object.assign(find(sourceId), { parent_id: id, sort_order: plan.source.sort_order });
      return id;
    },
    move(sourceId, parentId) {
      apply(planMove(index(), sourceId, parentId));
    },
    remove(sourceId) {
      const changes = planDelete(index(), sourceId);
      rows.splice(rows.indexOf(find(sourceId)), 1);
      apply(changes);
      return changes.length;
    },
  };
}

// 森林的文本形状，如 "1(2,3) 4"
function shape(rows) {
  const index = buildIndex(rows);
  const render = (node) => {
    const kids = childrenOf(index, node.id);
    return kids.length ? `${node.id}(${kids.map(render).join(',')})` : String(node.id);
  };
  return childrenOf(index, null).map(render).join(' ');
}

function assertHealthy(rows) {
  const index = buildIndex(rows);
  assert.equal(preorder(index).length, rows.length, '每个节点都能从顶层到达（无环、无断链）');
  for (const r of rows) {
    if (r.parent_id !== null) assert.ok(index.byId.has(r.parent_id), `节点 ${r.id} 的父级必须有效`);
  }
  for (const [parent, kids] of index.children) {
    const orders = kids.map((k) => k.sort_order);
    assert.equal(new Set(orders).size, orders.length, `父级 ${parent} 下的排序值不重复`);
  }
}

test('新建：顶层与子级都追加到末尾', () => {
  const s = createStore();
  const a = s.create();
  const b = s.create();
  const c = s.create(a);
  const d = s.create(a);
  assert.equal(shape(s.rows), `${a}(${c},${d}) ${b}`);
  assert.throws(() => s.create(99), { code: 'PARENT_NOT_FOUND' });
});

test('向上提炼：顶层笔记 → 新笔记成为顶层并接替原位置', () => {
  const s = createStore();
  const a = s.create();
  const b = s.create();
  const c = s.create();
  const child = s.create(b);
  const n = s.promote(b);
  assert.equal(shape(s.rows), `${a} ${n}(${b}(${child})) ${c}`);
  assertHealthy(s.rows);
});

test('向上提炼：有父级的笔记 → 新笔记插在父级与原笔记之间，兄弟与子树不变', () => {
  const s = createStore();
  const p = s.create();
  const x = s.create(p);
  const target = s.create(p);
  const y = s.create(p);
  const leaf = s.create(target);
  const n = s.promote(target);
  assert.equal(shape(s.rows), `${p}(${x},${n}(${target}(${leaf})),${y})`);
  assert.deepEqual(
    ancestorsOf(buildIndex(s.rows), target).map((r) => r.id),
    [p, n],
  );
  const n2 = s.promote(n);
  assert.equal(shape(s.rows), `${p}(${x},${n2}(${n}(${target}(${leaf}))),${y})`);
  assertHealthy(s.rows);
});

test('挂载：成为目标的最后一个子级，并带着自己的子树', () => {
  const s = createStore();
  const a = s.create();
  const a1 = s.create(a);
  const b = s.create();
  const b1 = s.create(b);
  s.move(b, a);
  assert.equal(shape(s.rows), `${a}(${a1},${b}(${b1}))`);
  assertHealthy(s.rows);
});

test('更换父级：从原父级移走后追加到新父级末尾', () => {
  const s = createStore();
  const a = s.create();
  const b = s.create();
  const x = s.create(a);
  const y = s.create(a);
  const z = s.create(b);
  s.move(x, b);
  assert.equal(shape(s.rows), `${a}(${y}) ${b}(${z},${x})`);
  assertHealthy(s.rows);
});

test('解除父级：成为顶层末尾，子树不变；已是顶层则不变', () => {
  const s = createStore();
  const a = s.create();
  const x = s.create(a);
  const x1 = s.create(x);
  const b = s.create();
  s.move(x, null);
  assert.equal(shape(s.rows), `${a} ${b} ${x}(${x1})`);
  assert.deepEqual(planMove(buildIndex(s.rows), x, null), []);
  assertHealthy(s.rows);
});

test('挂到当前父级是空操作', () => {
  const s = createStore();
  const a = s.create();
  const x = s.create(a);
  s.create(a);
  assert.deepEqual(planMove(buildIndex(s.rows), x, a), []);
});

test('防环：不能挂到自己或任何后代之下', () => {
  const s = createStore();
  const a = s.create();
  const b = s.create(a);
  const c = s.create(b);
  const index = buildIndex(s.rows);
  assert.throws(() => planMove(index, a, a), { code: 'CYCLE_NOT_ALLOWED' });
  assert.throws(() => planMove(index, a, b), { code: 'CYCLE_NOT_ALLOWED' });
  assert.throws(() => planMove(index, a, c), { code: 'CYCLE_NOT_ALLOWED' });
  assert.throws(() => planMove(index, b, 404), { code: 'PARENT_NOT_FOUND' });
  assert.ok(isSelfOrDescendant(index, a, c));
  assert.ok(!isSelfOrDescendant(index, c, a));
  assert.doesNotThrow(() => planMove(index, c, a));
});

test('删除：直接子级按相对顺序升顶，孙辈子树不变', () => {
  const s = createStore();
  const a = s.create();
  const p = s.create();
  const c1 = s.create(p);
  const c2 = s.create(p);
  const c3 = s.create(p);
  const g = s.create(c2);
  const b = s.create();
  assert.equal(s.remove(p), 3);
  assert.equal(shape(s.rows), `${a} ${b} ${c1} ${c2}(${g}) ${c3}`);
  assertHealthy(s.rows);
});

test('删除：中间层被删时，子级升为顶层而不是挂到祖父', () => {
  const s = createStore();
  const root = s.create();
  const mid = s.create(root);
  const leaf = s.create(mid);
  assert.equal(s.remove(mid), 1);
  assert.equal(shape(s.rows), `${root} ${leaf}`);
  assert.equal(s.remove(leaf), 0);
  assert.equal(shape(s.rows), `${root}`);
});

test('先序遍历给出深度，深链不爆栈', () => {
  const s = createStore();
  let parent = s.create();
  for (let i = 0; i < 5000; i++) parent = s.create(parent);
  const order = preorder(buildIndex(s.rows));
  assert.equal(order.length, 5001);
  assert.equal(order.at(-1).depth, 5000);
  assert.equal(ancestorsOf(buildIndex(s.rows), parent).length, 5000);
});

test('任意顺序的结构操作组合：不成环、不断链、同级排序不重复', () => {
  let seed = 20261019;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let round = 0; round < 30; round++) {
    const s = createStore();
    for (let i = 0; i < 4; i++) s.create();
    for (let step = 0; step < 120; step++) {
      const ids = s.rows.map((r) => r.id);
      const pick = () => ids[rand(ids.length)];
      const op = ids.length === 0 ? 0 : rand(5);
      if (op === 0) s.create(ids.length && rand(2) ? pick() : null);
      else if (op === 1) s.promote(pick());
      else if (op === 2) s.move(pick(), null);
      else if (op === 3 && ids.length > 1) s.remove(pick());
      else {
        const source = pick();
        const target = pick();
        const before = shape(s.rows);
        if (isSelfOrDescendant(buildIndex(s.rows), source, target)) {
          assert.throws(() => s.move(source, target), { code: 'CYCLE_NOT_ALLOWED' });
          assert.equal(shape(s.rows), before, '被拦截的操作不改变结构');
        } else {
          s.move(source, target);
        }
      }
      assertHealthy(s.rows);
    }
  }
});
