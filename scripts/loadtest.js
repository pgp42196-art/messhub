// Usage: node scripts/loadtest.js   (env: BASE=http://localhost:3000 USERS=2000)
const BASE = process.env.BASE || 'http://localhost:3000';
const N = Number(process.env.USERS) || 2000;

const j = async (path, body, token, method) => {
  const t0 = performance.now();
  const r = await fetch(BASE + '/api' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data, ms: performance.now() - t0 };
};
// Windows caps queued connections, so ramp the client in waves (the server itself has no such cap on Linux).
const CONC = Number(process.env.CONC) || 250;
const pool = async (items, fn) => { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(CONC, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0); };
const report = (name, rs) => {
  const ms = rs.map((r) => r.ms), bad = rs.filter((r) => !r.ok);
  console.log(`${name.padEnd(26)} n=${rs.length}  ok=${rs.length - bad.length}  fail=${bad.length}  p50=${pct(ms, .5)}ms  p95=${pct(ms, .95)}ms  p99=${pct(ms, .99)}ms${bad[0] ? '  e.g. ' + (bad[0].data.error || bad[0].status) : ''}`);
};

const admin = (await j('/login', { login: 'admin', password: 'admin123' })).data.token;
if (!admin) { console.error('Cannot log in as admin. Is the server running?'); process.exit(1); }

const csv = Array.from({ length: N }, (_, i) => `LT${String(i).padStart(5, '0')},Load Student ${i},${10000 + (i % 400)},5000,loadtest`).join('\n');
let t = performance.now();
const imp = await j('/admin/users/import', { csv }, admin);
console.log(`Imported ${imp.data.imported} students in ${Math.round(performance.now() - t)}ms`);
const menu = (await j('/menu', null, admin)).data.filter((m) => m.available);

t = performance.now();
const logins = await pool(Array.from({ length: N }, (_, i) => i), (i) => j('/login', { login: `LT${String(i).padStart(5, '0')}`, password: 'loadtest' }));
report('login burst', logins);
console.log(`  (all ${N} logged in within ${Math.round(performance.now() - t)}ms)`);
const tokens = logins.filter((r) => r.ok).map((r) => r.data.token);

// open live (SSE) connections for everyone
const aborts = [];
let live = 0;
await pool(tokens, async (tok) => {
  const ac = new AbortController(); aborts.push(ac);
  try {
    const r = await fetch(`${BASE}/api/events?token=${tok}`, { signal: ac.signal });
    if (r.ok) { live++; r.body.pipeTo(new WritableStream({ write() {} })).catch(() => {}); }
  } catch {}
});
console.log(`live connections open: ${live}/${tokens.length}`);

const order = () => ({ items: [{ id: menu[Math.floor(Math.random() * menu.length)].id, qty: 1 + Math.floor(Math.random() * 2) }], type: Math.random() < .5 ? 'delivery' : 'dine_in', room: '17001' });
t = performance.now();
const orders = await pool(tokens, (tok) => j('/orders', order(), tok));
report('order burst (all at once)', orders);
console.log(`  (all orders done within ${Math.round(performance.now() - t)}ms)`);

const reads = await pool(tokens.flatMap((tok) => [['/menu', tok], ['/orders/mine', tok]]), ([p, tok]) => j(p, null, tok));
report('menu + my-orders reads', reads);

const q = await j('/staff/orders', null, admin);
console.log(`staff queue: ${q.data.active?.length} active orders loaded in ${Math.round(q.ms)}ms`);
const stats = await j('/admin/stats', null, admin);
console.log(`stats ok=${stats.ok} in ${Math.round(stats.ms)}ms · server sees ${stats.data.online} live connections`);
const health = await fetch(BASE + '/api/health').then((r) => r.json());
console.log('server health:', JSON.stringify(health));
aborts.forEach((a) => a.abort());
process.exit(0);

