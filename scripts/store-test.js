// Checks multi-store rules against a running server (npm start). Uses the seeded demo logins.
const B = process.env.BASE || 'http://localhost:3000';
const j = async (p, b, t, m) => {
  const r = await fetch(B + '/api' + p, { method: m || (b ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { s: r.status, d: await r.json().catch(() => ({})) };
};
const L = async (u, p) => (await j('/login', { login: u, password: p })).d.token;
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) fails++; };

const [stu, posNM, posC3, run] = [await L('demo', 'demo123'), await L('pos', 'pos123'), await L('pos-c3', 'pos123'), await L('runner', 'runner123')];
const stores = (await j('/stores', null, stu)).d;
check('two stores exist', stores.length === 2, stores.map((s) => s.name).join(' + '));
const menu = (await j('/menu', null, stu)).d;
const nm = menu.filter((m) => m.store_id === 1), c3 = menu.filter((m) => m.store_id === 2);
check('Night Mess and C3 have separate menus', nm.length > 0 && c3.length > 0, `(${nm.length} / ${c3.length} items)`);

const mixed = await j('/orders', { items: [{ id: nm[0].id, qty: 1 }, { id: c3[0].id, qty: 1 }], type: 'dine_in' }, stu);
check('mixed-store order is refused', mixed.s === 400, mixed.d.error || '');

const o = await j('/orders', { items: [{ id: c3[0].id, qty: 2 }], type: 'delivery' }, stu);
check('C3 order placed', o.s === 200 && o.d.store === 'C3', `#${o.d.id} store=${o.d.store}`);

const seeNM = (await j('/staff/orders', null, posNM)).d.active.some((x) => x.id === o.d.id);
const seeC3 = (await j('/staff/orders', null, posC3)).d.active.some((x) => x.id === o.d.id);
const seeRun = (await j('/staff/orders', null, run)).d.active.some((x) => x.id === o.d.id);
check('Night Mess counter does NOT see the C3 order', !seeNM);
check('C3 counter sees it', seeC3);
check('runner (all stores) sees it', seeRun);

const wrong = await j(`/staff/orders/${o.d.id}/status`, { status: 'preparing' }, posNM);
check('Night Mess counter cannot change a C3 order', wrong.s === 403, wrong.d.error || '');
const right = await j(`/staff/orders/${o.d.id}/status`, { status: 'preparing' }, posC3);
check('C3 counter can', right.s === 200);

const stock = await j(`/staff/items/${c3[0].id}/available`, { available: false }, posNM);
check('Night Mess counter cannot mark a C3 item sold out', stock.s === 403, stock.d.error || '');

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll store checks passed');
process.exit(fails ? 1 : 0);
