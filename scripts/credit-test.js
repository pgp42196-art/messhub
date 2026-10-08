// Quick check of the credit limit and payment flow. Needs the loadtest students to exist.
const B = process.env.BASE || 'http://localhost:3000';
const j = async (p, b, t, m) => {
  const r = await fetch(B + '/api' + p, { method: m || (b ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { s: r.status, d: await r.json().catch(() => ({})) };
};
const L = async (u, p) => (await j('/login', { login: u, password: p })).d.token;
const adm = await L('admin', 'admin123'), stu = await L('LT00002', 'loadtest');
const u = (await j('/admin/users?q=LT00002', null, adm)).d[0];
console.log('owed', u.owed / 100, 'limit', u.credit_limit / 100);
await j('/admin/users/' + u.id, { credit_limit: String(u.owed / 100 + 50) }, adm, 'PATCH');
const menu = (await j('/menu', null, stu)).d;
const pricey = menu.find((m) => m.price > 5000);
const r = await j('/orders', { items: [{ id: pricey.id, qty: 1 }], type: 'dine_in' }, stu);
console.log(`order of ${pricey.price / 100} with only 50 credit left ->`, r.s, r.d.error || 'ok (BUG)');
await j('/admin/payments', { login: 'LT00002', amount: '10', note: 'test' }, adm);
console.log('owed after paying 10:', (await j('/tab', null, stu)).d.owed / 100);
