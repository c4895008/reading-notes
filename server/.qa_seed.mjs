const B = 'http://127.0.0.1:3001/api';
let ip = 0;
async function api(method, path, { token, body, xff } = {}) {
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  if (xff) h['x-forwarded-for'] = xff;
  const r = await fetch(B + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (r.status >= 400) throw new Error(`${method} ${path} ${r.status} ${JSON.stringify(j)}`);
  return j.data;
}
const reg = async (username, nickname) => {
  const d = await api('POST', '/auth/register', { body: { username, password: 'qa-pass-1234', nickname }, xff: `10.9.0.${++ip}` });
  return { id: d.user.user_id, username, token: d.token };
};
const a = await reg('qa_m9a', '甲·巡检');
const b = await reg('qa_m9b', '乙·巡检');
const c = await reg('qa_m9c', '丙·巡检');
await reg('qa_m9d', '丁·空白');
for (const f of [b, c]) {
  const { request } = await api('POST', '/friends/requests', { token: a.token, body: { username: f.username } });
  await api('POST', `/friends/requests/${request.id}/accept`, { token: f.token });
}
const n1 = (await api('POST', '/notes', { token: a.token, body: { title: '论读书', quote: '读书之法，在循序而渐进，熟读而精思。', content: '**循序**与*精思*，缺一不可。\n\n- 一\n- 二' } })).note;
const n2 = (await api('POST', '/notes', { token: a.token, body: { title: '补一句：关于精思的一个很长很长的标题用来测试窄屏下的换行与截断效果', content: '精思之要，在于反复。', parent_id: n1.id } })).note;
await api('POST', '/notes', { token: a.token, body: { title: '散记', content: '另起一行' } });
const d = await api('POST', '/discussions', { token: a.token, body: { note_id: n2.id, invitee_ids: [b.id, c.id] } });
let k = 0;
const say = (u, t) => api('POST', `/discussions/${d.discussion_id}/messages`, { token: u.token, body: { content: t, client_message_id: `qa-m9-${Date.now()}-${++k}` } });
await say(b, '我先说：循序最难。');
await say(a, '同感，精思更难。');
await say(c, '一个很长的消息'.repeat(30));
// 丙向乙发申请，乙收件箱有一条待处理
await api('POST', '/friends/requests', { token: c.token, body: { username: 'qa_m9b' } });
console.log(JSON.stringify({ a: a.id, b: b.id, c: c.id, n1: n1.id, n2: n2.id, talk: d.discussion_id }));
