import Fastify from 'fastify';
import fstatic from '@fastify/static';
import jwt from '@fastify/jwt';
import crypto from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const scrypt = promisify(crypto.scrypt);

// ---------- helpers ----------
const httpErr = (status, error) => Object.assign(new Error(error), { status });
const rupeesToPaise = (v) => Math.round(Number(String(v).replace(/[₹,\s]/g, '')) * 100);

async function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(pw, salt, 32, { N: 8192 });
  return `${salt}:${key.toString('hex')}`;
}
async function checkPw(pw, stored) {
  const [salt, hex] = String(stored).split(':');
  const key = await scrypt(pw, salt, 32, { N: 8192 });
  const want = Buffer.from(hex, 'hex');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text).replace(/\r/g, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell.trim()); cell = ''; }
    else if (c === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some(Boolean));
}
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// ---------- boot ----------
const db = await openDb();
const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
await app.register(jwt, { secret: SECRET, sign: { expiresIn: '30d' } });
await app.register(fstatic, { root: path.join(__dirname, '..', 'web') });

app.setErrorHandler((err, req, reply) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  reply.code(status).send({ error: status >= 500 ? 'Server hiccup, try again' : err.message });
});

const auth = (roles) => async (req, reply) => {
  try { await req.jwtVerify(); } catch { return reply.code(401).send({ error: 'Please log in again' }); }
  if (roles && !roles.includes(req.user.role)) return reply.code(403).send({ error: 'Not allowed' });
};
const STAFF = ['pos', 'runner', 'admin'];
const POS = ['pos', 'admin'];
const RUNNER = ['runner', 'admin'];
const ADMIN = ['admin'];

// ---------- live updates (SSE) ----------
const clients = new Set(); // { res, userId, role }
function emit(event, data, { userId, staff } = {}) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if ((userId && c.userId === userId) || (staff && STAFF.includes(c.role)) || (!userId && !staff)) {
      c.res.write(msg);
    }
  }
}
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25000).unref();

app.get('/api/events', async (req, reply) => {
  let user;
  try { user = app.jwt.verify(String(req.query.token || '')); } catch { return reply.code(401).send({ error: 'Please log in again' }); }
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const c = { res, userId: user.id, role: user.role };
  clients.add(c);
  req.raw.on('close', () => clients.delete(c));
});

// ---------- menu cache ----------
let menu = [];
let menuById = new Map();
async function loadMenu() {
  const { rows } = await db.query('SELECT id, store_id, category, name, price, veg, available FROM items ORDER BY category, name');
  menu = rows;
  menuById = new Map(rows.map((r) => [r.id, r]));
}
await loadMenu();
const menuChanged = async () => { await loadMenu(); emit('menu', {}); };

// ---------- auth ----------
const loginHits = new Map();
setInterval(() => loginHits.clear(), 60000).unref();

app.post('/api/login', async (req, reply) => {
  // Campus Wi-Fi puts many students behind one IP, so throttle failed tries per username, not per IP.
  const { login, password } = req.body || {};
  if (!login || !password) throw httpErr(400, 'Enter roll no and password');
  const key = String(login).trim().toLowerCase();
  if ((loginHits.get(key) || 0) >= 8) throw httpErr(429, 'Too many wrong tries, wait a minute');
  const { rows } = await db.query('SELECT * FROM users WHERE lower(login)=$1', [key]);
  const u = rows[0];
  if (!u || !u.active || !(await checkPw(String(password), u.pass_hash))) {
    loginHits.set(key, (loginHits.get(key) || 0) + 1);
    throw httpErr(401, 'Wrong roll no or password');
  }
  const token = app.jwt.sign({ id: u.id, role: u.role, name: u.name, store_id: u.store_id });
  return { token, me: publicUser(u) };
});

const publicUser = (u) => ({
  id: u.id, role: u.role, login: u.login, name: u.name, room: u.room,
  credit_limit: u.credit_limit, owed: u.owed, store_id: u.store_id,
});

app.get('/api/me', { preHandler: auth() }, async (req) => {
  const { rows } = await db.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!rows[0] || !rows[0].active) throw httpErr(401, 'Account inactive');
  return publicUser(rows[0]);
});

app.post('/api/password', { preHandler: auth() }, async (req) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 6) throw httpErr(400, 'New password needs 6+ characters');
  const { rows } = await db.query('SELECT pass_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await checkPw(String(current || ''), rows[0].pass_hash))) throw httpErr(400, 'Current password is wrong');
  await db.query('UPDATE users SET pass_hash=$1 WHERE id=$2', [await hashPw(String(next)), req.user.id]);
  return { ok: true };
});

// ---------- menu ----------
app.get('/api/menu', { preHandler: auth() }, async () => menu);
app.get('/api/stores', { preHandler: auth() }, async () => (await db.query('SELECT id, name, emoji, note FROM stores ORDER BY id')).rows);

// ---------- orders ----------
async function createOrder({ userId, items, type, room, note, source = 'app' }) {
  if (!Array.isArray(items) || !items.length || items.length > 40) throw httpErr(400, 'Your cart is empty');
  if (!['dine_in', 'delivery'].includes(type)) throw httpErr(400, 'Pick dine in or delivery');
  const lines = [];
  let total = 0;
  let storeId = null;
  for (const it of items) {
    const m = menuById.get(Number(it.id));
    const qty = Number(it.qty);
    if (!m || !Number.isInteger(qty) || qty < 1 || qty > 20) throw httpErr(400, 'Invalid item in cart');
    if (!m.available) throw httpErr(409, `${m.name} just sold out`);
    if (storeId != null && m.store_id !== storeId) throw httpErr(400, 'One order can only have items from one store');
    storeId = m.store_id;
    lines.push({ id: m.id, name: m.name, price: m.price, qty });
    total += m.price * qty;
  }
  const result = await db.tx(async (t) => {
    const { rows } = await t.query('SELECT id, room, owed, credit_limit, active FROM users WHERE id=$1 FOR UPDATE', [userId]);
    const u = rows[0];
    if (!u || !u.active) throw httpErr(403, 'Account inactive');
    if (u.credit_limit > 0 && u.owed + total > u.credit_limit) {
      throw httpErr(402, `Credit limit reached (limit ₹${u.credit_limit / 100}, owed ₹${u.owed / 100})`);
    }
    const dRoom = type === 'delivery' ? String(room || u.room || '').trim() : null;
    if (type === 'delivery' && !dRoom) throw httpErr(400, 'Add your room number for delivery');
    const otp = type === 'delivery' ? String(1000 + crypto.randomInt(9000)) : null;
    const status = source === 'pos' && type === 'dine_in' ? 'completed' : 'placed';
    const ins = await t.query(
      'INSERT INTO orders (user_id,store_id,type,room,status,otp,total,note,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [userId, storeId, type, dRoom, status, otp, total, String(note || '').slice(0, 200), source],
    );
    const id = ins.rows[0].id;
    const vals = [];
    const ph = lines.map((l, i) => { vals.push(id, l.id, l.name, l.price, l.qty); const b = i * 5; return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`; });
    await t.query(`INSERT INTO order_items (order_id,item_id,name,price,qty) VALUES ${ph.join(',')}`, vals);
    await t.query('UPDATE users SET owed = owed + $1 WHERE id=$2', [total, userId]);
    return id;
  });
  const order = (await fetchOrders('o.id=$1', [result]))[0];
  emit('order', { id: order.id, status: order.status }, { userId, staff: true });
  return order;
}

async function fetchOrders(where, params, tail = 'ORDER BY o.id DESC LIMIT 200') {
  const { rows } = await db.query(
    `SELECT o.id, o.user_id, o.store_id, o.type, o.room, o.status, o.otp, o.total, o.note, o.source, o.created_at, o.updated_at,
            u.name AS student, u.login AS roll, s.name AS store, s.emoji AS store_emoji
       FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN stores s ON s.id=o.store_id WHERE ${where} ${tail}`,
    params,
  );
  if (!rows.length) return [];
  const ph = rows.map((_, i) => `$${i + 1}`).join(',');
  const li = await db.query(`SELECT order_id, name, price, qty FROM order_items WHERE order_id IN (${ph}) ORDER BY id`, rows.map((r) => r.id));
  const by = new Map();
  for (const l of li.rows) { if (!by.has(l.order_id)) by.set(l.order_id, []); by.get(l.order_id).push(l); }
  return rows.map((r) => ({ ...r, items: by.get(r.id) || [] }));
}

app.post('/api/orders', { preHandler: auth(['student']) }, async (req) =>
  createOrder({ userId: req.user.id, ...(req.body || {}), source: 'app' }));

app.get('/api/orders/mine', { preHandler: auth() }, async (req) =>
  fetchOrders('o.user_id=$1', [req.user.id], 'ORDER BY o.id DESC LIMIT 50'));

async function setStatus(id, status, { actor, otp } = {}) {
  const out = await db.tx(async (t) => {
    const { rows } = await t.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id]);
    const o = rows[0];
    if (!o) throw httpErr(404, 'Order not found');
    const flow = {
      placed: ['preparing', 'rejected', 'cancelled'],
      preparing: ['ready', 'rejected'],
      ready: o.type === 'delivery' ? ['out_for_delivery', 'rejected'] : ['completed', 'rejected'],
      out_for_delivery: ['delivered'],
    };
    if (!(flow[o.status] || []).includes(status)) throw httpErr(409, `Can't move order from ${o.status} to ${status}`);
    if (status === 'delivered' && actor.role !== 'admin' && String(otp) !== o.otp) throw httpErr(400, 'Wrong delivery OTP');
    if (['rejected', 'cancelled'].includes(status)) {
      await t.query('UPDATE users SET owed = GREATEST(owed - $1, 0) WHERE id=$2', [o.total, o.user_id]);
    }
    await t.query('UPDATE orders SET status=$1, updated_at=now() WHERE id=$2', [status, id]);
    return o;
  });
  emit('order', { id, status }, { userId: out.user_id, staff: true });
  return { id, status };
}

app.post('/api/orders/:id/cancel', { preHandler: auth(['student']) }, async (req) => {
  const { rows } = await db.query('SELECT user_id FROM orders WHERE id=$1', [Number(req.params.id)]);
  if (!rows[0] || rows[0].user_id !== req.user.id) throw httpErr(404, 'Order not found');
  return setStatus(Number(req.params.id), 'cancelled', { actor: req.user });
});

app.get('/api/tab', { preHandler: auth(['student']) }, async (req) => {
  const [u, p] = await Promise.all([
    db.query('SELECT owed, credit_limit FROM users WHERE id=$1', [req.user.id]),
    db.query('SELECT amount, note, created_at FROM payments WHERE user_id=$1 ORDER BY id DESC LIMIT 20', [req.user.id]),
  ]);
  return { owed: u.rows[0].owed, credit_limit: u.rows[0].credit_limit, payments: p.rows };
});

// ---------- staff: POS + runner ----------
// Staff tied to one store only see that store; admin and unassigned staff see everything.
const storeScope = (req) => (req.user.store_id ? [` AND o.store_id=$1`, [req.user.store_id]] : ['', []]);

app.get('/api/staff/orders', { preHandler: auth(STAFF) }, async (req) => {
  const [and, params] = storeScope(req);
  const active = await fetchOrders(`o.status IN ('placed','preparing','ready','out_for_delivery')${and}`, params, 'ORDER BY o.id ASC LIMIT 300');
  const recent = await fetchOrders(`o.status IN ('completed','delivered','rejected','cancelled') AND o.updated_at > now() - interval '12 hours'${and}`, params, 'ORDER BY o.updated_at DESC LIMIT 40');
  return { active, recent };
});

app.post('/api/staff/orders/:id/status', { preHandler: auth(STAFF) }, async (req) => {
  const { status, otp } = req.body || {};
  const role = req.user.role;
  const allowed = {
    pos: ['preparing', 'ready', 'completed', 'rejected'],
    runner: ['out_for_delivery', 'delivered'],
    admin: ['preparing', 'ready', 'completed', 'rejected', 'out_for_delivery', 'delivered'],
  }[role];
  if (!allowed.includes(status)) throw httpErr(403, 'Not allowed for your role');
  if (req.user.store_id) {
    const o = await db.query('SELECT store_id FROM orders WHERE id=$1', [Number(req.params.id)]);
    if (o.rows[0] && o.rows[0].store_id !== req.user.store_id) throw httpErr(403, 'That order belongs to another store');
  }
  return setStatus(Number(req.params.id), status, { actor: req.user, otp });
});

app.get('/api/staff/students', { preHandler: auth(POS) }, async (req) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const { rows } = await db.query(
    "SELECT id, login, name, room, owed, credit_limit FROM users WHERE role='student' AND active AND (login ILIKE $1 OR name ILIKE $1 OR room ILIKE $1) ORDER BY login LIMIT 8", [q]);
  return rows;
});

app.post('/api/staff/pos-order', { preHandler: auth(POS) }, async (req) => {
  const { student_id, ...rest } = req.body || {};
  if (req.user.store_id) {
    const first = menuById.get(Number(rest.items?.[0]?.id));
    if (first && first.store_id !== req.user.store_id) throw httpErr(403, 'Those items belong to another store');
  }
  return createOrder({ userId: Number(student_id), ...rest, source: 'pos' });
});

app.post('/api/staff/items/:id/available', { preHandler: auth(POS) }, async (req) => {
  const item = menuById.get(Number(req.params.id));
  if (req.user.store_id && item && item.store_id !== req.user.store_id) throw httpErr(403, 'That item belongs to another store');
  await db.query('UPDATE items SET available=$1 WHERE id=$2', [!!req.body?.available, Number(req.params.id)]);
  await menuChanged();
  return { ok: true };
});

// ---------- admin: menu ----------
app.post('/api/admin/items', { preHandler: auth(ADMIN) }, async (req) => {
  const { category, name, price, veg = true, store_id = 1 } = req.body || {};
  const p = rupeesToPaise(price);
  if (!category || !name || !(p >= 0)) throw httpErr(400, 'Need category, name and price');
  await db.query(
    'INSERT INTO items (store_id,category,name,price,veg) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (store_id,category,name) DO UPDATE SET price=EXCLUDED.price, veg=EXCLUDED.veg',
    [Number(store_id), String(category).trim(), String(name).trim(), p, !!veg]);
  await menuChanged();
  return { ok: true };
});

app.patch('/api/admin/items/:id', { preHandler: auth(ADMIN) }, async (req) => {
  const { name, category, price, veg } = req.body || {};
  const id = Number(req.params.id);
  if (name != null) await db.query('UPDATE items SET name=$1 WHERE id=$2', [String(name).trim(), id]);
  if (category != null) await db.query('UPDATE items SET category=$1 WHERE id=$2', [String(category).trim(), id]);
  if (price != null) await db.query('UPDATE items SET price=$1 WHERE id=$2', [rupeesToPaise(price), id]);
  if (veg != null) await db.query('UPDATE items SET veg=$1 WHERE id=$2', [!!veg, id]);
  await menuChanged();
  return { ok: true };
});

app.delete('/api/admin/items/:id', { preHandler: auth(ADMIN) }, async (req) => {
  await db.query('UPDATE items SET available=FALSE WHERE id=$1', [Number(req.params.id)]);
  await db.query('DELETE FROM items WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM order_items WHERE item_id=$1)', [Number(req.params.id)]);
  await menuChanged();
  return { ok: true };
});

// CSV columns: category,name,price[,veg]
app.post('/api/admin/items/import', { preHandler: auth(ADMIN) }, async (req) => {
  let rows = parseCsv(req.body?.csv || '');
  if (rows.length && /^category$/i.test(rows[0][0])) rows = rows.slice(1);
  let n = 0, bad = 0;
  const storeId = Number(req.body?.store_id) || 1;
  await db.tx(async (t) => {
    for (const [category, name, price, veg] of rows) {
      const p = rupeesToPaise(price);
      if (!category || !name || !(p >= 0)) { bad++; continue; }
      await t.query(
        'INSERT INTO items (store_id,category,name,price,veg) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (store_id,category,name) DO UPDATE SET price=EXCLUDED.price, veg=EXCLUDED.veg',
        [storeId, category, name, p, !/^(n|no|false|0|nonveg|non-veg)$/i.test(veg || 'y')]);
      n++;
    }
  });
  await menuChanged();
  return { imported: n, skipped: bad };
});

// ---------- admin: students ----------
app.get('/api/admin/users', { preHandler: auth(ADMIN) }, async (req) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const { rows } = await db.query(
    'SELECT id, role, login, name, room, owed, credit_limit, store_id, active FROM users WHERE login ILIKE $1 OR name ILIKE $1 ORDER BY role, login LIMIT 300', [q]);
  return rows;
});

app.post('/api/admin/users', { preHandler: auth(ADMIN) }, async (req) => {
  const { role = 'student', login, name, room, password, credit_limit, store_id } = req.body || {};
  if (!['student', 'pos', 'runner', 'admin'].includes(role) || !login || !name) throw httpErr(400, 'Need role, login and name');
  const limit = credit_limit != null && credit_limit !== '' ? rupeesToPaise(credit_limit) : 0;
  await db.query(
    `INSERT INTO users (role,login,name,pass_hash,room,credit_limit,store_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (login) DO UPDATE SET name=EXCLUDED.name, room=EXCLUDED.room, credit_limit=EXCLUDED.credit_limit, store_id=EXCLUDED.store_id`,
    [role, String(login).trim(), String(name).trim(), await hashPw(String(password || login)), room || null, limit, store_id ? Number(store_id) : null]);
  return { ok: true };
});

// CSV columns: login,name,room[,credit_limit][,password]
app.post('/api/admin/users/import', { preHandler: auth(ADMIN) }, async (req) => {
  let rows = parseCsv(req.body?.csv || '');
  if (rows.length && /^(login|roll)/i.test(rows[0][0])) rows = rows.slice(1);
  let n = 0;
  for (const [login, name, room, limit, pw] of rows) {
    if (!login || !name) continue;
    const l = limit ? rupeesToPaise(limit) : 0;
    await db.query(
      `INSERT INTO users (role,login,name,pass_hash,room,credit_limit) VALUES ('student',$1,$2,$3,$4,$5)
       ON CONFLICT (login) DO UPDATE SET name=EXCLUDED.name, room=EXCLUDED.room, credit_limit=EXCLUDED.credit_limit`,
      [login, name, await hashPw(pw || login), room || null, l]);
    n++;
  }
  return { imported: n };
});

app.patch('/api/admin/users/:id', { preHandler: auth(ADMIN) }, async (req) => {
  const { credit_limit, active, password, room } = req.body || {};
  const id = Number(req.params.id);
  if (credit_limit != null) await db.query('UPDATE users SET credit_limit=$1 WHERE id=$2', [rupeesToPaise(credit_limit), id]);
  if (active != null) await db.query('UPDATE users SET active=$1 WHERE id=$2', [!!active, id]);
  if (room != null) await db.query('UPDATE users SET room=$1 WHERE id=$2', [String(room), id]);
  if (password) await db.query('UPDATE users SET pass_hash=$1 WHERE id=$2', [await hashPw(String(password)), id]);
  return { ok: true };
});

// ---------- admin: money ----------
app.post('/api/admin/payments', { preHandler: auth(ADMIN) }, async (req) => {
  const { login, amount, note } = req.body || {};
  const p = rupeesToPaise(amount);
  if (!login || !(p > 0)) throw httpErr(400, 'Need roll no and amount');
  return db.tx(async (t) => {
    const { rows } = await t.query("SELECT id, owed FROM users WHERE lower(login)=lower($1) AND role='student' FOR UPDATE", [String(login).trim()]);
    if (!rows[0]) throw httpErr(404, 'Student not found');
    await t.query('INSERT INTO payments (user_id, amount, note) VALUES ($1,$2,$3)', [rows[0].id, p, String(note || '').slice(0, 200)]);
    await t.query('UPDATE users SET owed = owed - $1 WHERE id=$2', [p, rows[0].id]);
    return { ok: true, owed: rows[0].owed - p };
  });
});

app.get('/api/admin/bills.csv', { preHandler: auth(ADMIN) }, async (req, reply) => {
  const { rows } = await db.query("SELECT login, name, room, owed, credit_limit FROM users WHERE role='student' ORDER BY login");
  const lines = ['roll_no,name,room,amount_due_rs,credit_limit_rs',
    ...rows.map((r) => [r.login, r.name, r.room, (r.owed / 100).toFixed(2), (r.credit_limit / 100).toFixed(2)].map(csvCell).join(','))];
  reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="term-bills.csv"');
  return lines.join('\n');
});

app.get('/api/admin/stats', { preHandler: auth(ADMIN) }, async () => {
  const [today, owed, top, hours, counts] = await Promise.all([
    db.query("SELECT COUNT(*)::int AS orders, COALESCE(SUM(total),0)::int AS revenue FROM orders WHERE created_at >= date_trunc('day', now()) AND status NOT IN ('rejected','cancelled')"),
    db.query("SELECT COALESCE(SUM(owed),0)::int AS owed, COUNT(*)::int AS students FROM users WHERE role='student'"),
    db.query(`SELECT oi.name, SUM(oi.qty)::int AS qty FROM order_items oi JOIN orders o ON o.id=oi.order_id
              WHERE o.status NOT IN ('rejected','cancelled') AND o.created_at > now() - interval '7 days' GROUP BY oi.name ORDER BY qty DESC LIMIT 8`),
    db.query(`SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS orders FROM orders
              WHERE created_at > now() - interval '7 days' GROUP BY 1 ORDER BY 1`),
    db.query("SELECT status, COUNT(*)::int AS n FROM orders WHERE created_at >= date_trunc('day', now()) GROUP BY status"),
  ]);
  return { today: today.rows[0], owed: owed.rows[0], top: top.rows, hours: hours.rows, counts: counts.rows, online: clients.size };
});

app.get('/api/health', async () => ({ ok: true, db: db.kind, online: clients.size }));

// ---------- one-time migration: the old default limit of ₹5000 becomes "no limit" ----------
await db.query('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
if (!(await db.query("SELECT 1 FROM meta WHERE k='nolimit'")).rows.length) {
  await db.query('UPDATE users SET credit_limit=0 WHERE credit_limit=500000');
  await db.query("INSERT INTO meta (k,v) VALUES ('nolimit','1')");
}

// ---------- seed ----------
if (!(await db.query('SELECT 1 FROM stores LIMIT 1')).rows.length) {
  await db.query("INSERT INTO stores (id,name,emoji,note) VALUES (1,'Night Mess','🌙','Late-night food, shakes & snacks'),(2,'C3','🏪','Quick snacks & drinks')");
  await db.query("SELECT setval(pg_get_serial_sequence('stores','id'), 2)");
}
// In production set ADMIN_PASSWORD / STAFF_PASSWORD so the well-known defaults never go live.
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'admin123';
const STAFF_PW = process.env.STAFF_PASSWORD;
const seedUsers = [
  ['admin', 'admin', 'Admin', ADMIN_PW, null],
  ['pos', 'pos', 'Night Mess Counter', STAFF_PW || 'pos123', 1],
  ['pos-c3', 'pos-c3', 'C3 Counter', STAFF_PW || 'pos123', 2],
  ['runner', 'runner', 'Room Runner', STAFF_PW || 'runner123', null],
];
for (const [role, login, name, pw, store] of seedUsers) {
  await db.query('INSERT INTO users (role,login,name,pass_hash,store_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (login) DO NOTHING',
    [role.startsWith('pos') ? 'pos' : role, login, name, await hashPw(pw), store]);
}
if (process.env.NODE_ENV !== 'production' && !(await db.query("SELECT 1 FROM users WHERE role='student' LIMIT 1")).rows.length) {
  await db.query("INSERT INTO users (role,login,name,pass_hash,room,credit_limit) VALUES ('student','demo','Demo Student',$1,'17001',0)", [await hashPw('demo123')]);
}
if (!menu.length) {
  const seedItems = [
    ['Juice Counter', 'Cold Coffee', 57.75], ['Juice Counter', 'Oreo Shake', 63], ['Juice Counter', 'Banana Shake', 42],
    ['Juice Counter', 'Chocolate Shake', 63], ['Juice Counter', 'Atom Isolate Lean Whey', 115], ['Juice Counter', 'Atom Isolate Banana Smoothie', 150],
    ['Hot Snacks', 'Nutella Toast', 52.5], ['Hot Snacks', 'Cheese Corn Triangles', 68.25],
    ['Packaged Items', 'TWT Almond Choco Fudge Bar', 85], ['Packaged Items', 'TWT Double Cocoa Mini', 80],
    ['Packaged Items', 'TWT Cocoa Cranberry Fudge Bar', 85], ['Packaged Items', 'TWT Coffee Cocoa Mini', 80],
    ['Packaged Items', 'TWT Cranberry Raisin Mini', 80], ['Packaged Items', 'TWT Peanut Choco Fudge Bar', 85],
  ];
  for (const [c, n, p] of seedItems) await db.query('INSERT INTO items (store_id,category,name,price) VALUES (1,$1,$2,$3) ON CONFLICT DO NOTHING', [c, n, Math.round(p * 100)]);
}
if (!menu.some((m) => m.store_id === 2)) {
  // Sample items for C3, replace with the real list later (Admin -> Menu -> import).
  const c3 = [
    ['Snacks', 'Lays Classic', 20, 1], ['Snacks', 'Kurkure', 20, 1], ['Snacks', 'Oreo Biscuits', 30, 1], ['Snacks', 'Maggi Cup', 45, 1],
    ['Drinks', 'Coca-Cola 300ml', 25, 1], ['Drinks', 'Frooti 200ml', 20, 1], ['Drinks', 'Packaged Water 1L', 20, 1], ['Drinks', 'Cold Coffee Can', 60, 1],
    ['Sweets', 'Dairy Milk', 40, 1], ['Sweets', 'KitKat', 30, 1], ['Daily Needs', 'Notebook', 60, 1], ['Daily Needs', 'Pen', 10, 1],
  ];
  for (const [c, n, p, v] of c3) await db.query('INSERT INTO items (store_id,category,name,price,veg) VALUES (2,$1,$2,$3,$4) ON CONFLICT DO NOTHING', [c, n, Math.round(p * 100), !!v]);
}
await loadMenu();

await app.listen({ port: PORT, host: '0.0.0.0', backlog: 4096 });
console.log(`MessHub running on http://localhost:${PORT}  (db: ${db.kind})`);
