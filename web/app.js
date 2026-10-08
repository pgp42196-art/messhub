'use strict';
const $ = (s, r = document) => r.querySelector(s);
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (p) => '₹' + (p / 100).toFixed(p % 100 ? 2 : 0);
const ls = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

const st = {
  token: ls.get('token', null), me: null, view: null, data: {}, menu: [],
  cart: ls.get('cart', {}), cat: 'All', q: '', sheet: null, stores: [], store: ls.get('store', null),
  co: { type: 'dine_in', room: '', note: '' },
  pos: { student: null, cart: {}, type: 'dine_in', results: [] },
  es: null,
};

const NAVS = {
  student: [['menu', '🍔', 'Menu'], ['orders', '📦', 'Orders'], ['tab', '💳', 'My Tab']],
  pos: [['queue', '🔥', 'Queue'], ['counter', '🧾', 'Counter'], ['stock', '📋', 'Stock']],
  runner: [['runs', '🛵', 'Deliveries']],
  admin: [['stats', '📊', 'Overview'], ['queue', '🔥', 'Queue'], ['items', '🍕', 'Menu'], ['students', '🎓', 'People'], ['money', '💸', 'Money']],
};

function emo(name, cat) {
  const s = (name + ' ' + cat).toLowerCase();
  const map = [['coffee', '☕'], ['shake', '🥤'], ['smoothie', '🥤'], ['whey', '💪'], ['juice', '🧃'], ['toast', '🍞'], ['sandwich', '🥪'], ['corn', '🌽'], ['bar', '🍫'], ['choco', '🍫'], ['maggi', '🍜'], ['noodle', '🍜'], ['pizza', '🍕'], ['burger', '🍔'], ['fries', '🍟'], ['egg', '🍳'], ['chips', '🥔'], ['biscuit', '🍪'], ['cookie', '🍪'], ['water', '💧'], ['tea', '🍵'], ['paratha', '🫓'], ['rice', '🍚'], ['paneer', '🧀'], ['cheese', '🧀'], ['ice', '🍨'], ['lays', '🍟'], ['kurkure', '🥨'], ['cola', '🥤'], ['frooti', '🧃'], ['dairy', '🍫'], ['kitkat', '🍫'], ['notebook', '📓'], ['pen ', '🖊️'], ['snack', '🥨'], ['packaged', '📦']];
  return (map.find(([k]) => s.includes(k)) || [0, '🍽️'])[1];
}

const TINTS = ['#ffe4d6', '#e5defd', '#d9f5e5', '#ffe1ee', '#dff1ff', '#fff3c4', '#e9f7c9'];
function tint(cat) { let n = 0; for (const c of String(cat)) n = (n * 31 + c.charCodeAt(0)) >>> 0; return TINTS[n % TINTS.length]; }

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3500);
}

async function api(path, opt = {}) {
  const r = await fetch('/api' + path, {
    method: opt.method || (opt.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(st.token ? { authorization: 'Bearer ' + st.token } : {}) },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
  });
  if (r.status === 401 && st.token && path !== '/login') { logout(); throw new Error('Please log in again'); }
  const ct = r.headers.get('content-type') || '';
  const d = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(d.error || 'Something broke');
  return d;
}
const act = async (fn) => { try { return await fn(); } catch (e) { toast(e.message, true); } };

// ---------- session ----------
function logout() {
  ls.del('token'); st.token = null; st.me = null; st.view = null;
  if (st.es) { st.es.close(); st.es = null; }
  paintLogin();
}

function connectLive() {
  if (st.es) st.es.close();
  st.es = new EventSource('/api/events?token=' + encodeURIComponent(st.token));
  st.es.addEventListener('order', (e) => {
    const d = JSON.parse(e.data);
    if (st.me.role === 'student' && d.status !== 'placed') {
      const msg = { preparing: '👨‍🍳 Being cooked', ready: '✅ Ready!', out_for_delivery: '🛵 On the way', delivered: '🎉 Delivered', completed: '🎉 Done', rejected: '😕 Order rejected' }[d.status];
      if (msg) toast(`Order #${d.id}: ${msg}`);
    }
    if (st.me.role !== 'student' && d.status === 'placed') toast(`🔔 New order #${d.id}`);
    if (!['menu', 'counter', 'items', 'students', 'money'].includes(st.view) || st.me.role === 'student') softRefresh();
  });
  st.es.addEventListener('menu', () => { if (['menu', 'counter', 'stock', 'items'].includes(st.view)) softRefresh(); });
}
function softRefresh() {
  const a = document.activeElement;
  if (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName)) return;
  if (st.sheet) return;
  go(st.view, true);
}

// ---------- shell ----------
function shell(content) {
  const me = st.me;
  const nav = NAVS[me.role].map(([v, i, l]) => `<button class="${st.view === v ? 'on' : ''}" data-act="nav" data-v="${v}"><span>${i}</span>${l}</button>`).join('');
  const cartN = Object.values(st.cart).reduce((a, b) => a + b, 0);
  $('#app').innerHTML = `
    <div class="wrap">
      <div class="top">
        <div class="logo">mess<b>hub</b> <span class="mute sm">· IIM L</span></div>
        <div class="row"><span class="pill"><span class="uname">${h(me.name)}</span><b>${h(me.role)}</b></span><button class="btn ghost sm" data-act="logout">Log out</button></div>
      </div>
      ${content}
    </div>
    ${me.role === 'student' && cartN && st.view === 'menu' ? `<div class="cartbar" data-act="openCart"><span>🛒 ${cartN} item${cartN > 1 ? 's' : ''}</span><span>${money(cartTotal(st.cart))} →</span></div>` : ''}
    <div class="nav">${nav}</div>
    ${st.sheet ? sheetHtml() : ''}`;
}
const cartTotal = (cart) => Object.entries(cart).reduce((a, [id, q]) => a + (st.menu.find((m) => m.id == id)?.price || 0) * q, 0);

function paintLogin(msg = '') {
  $('#app').innerHTML = `
    <div class="login">
      <div class="floaty" aria-hidden="true"><span>🍕</span><span>🥤</span><span>🍫</span><span>🍜</span><span>☕</span></div>
      <h1>mess<b>hub</b></h1>
      <p class="mute">Night mess, snacks & your tab.<br>IIM Lucknow 🌙</p>
      <form data-form="login" class="card" style="margin-top:22px">
        <label>Roll no / username</label><input name="login" autocomplete="username" autocapitalize="none" required>
        <label>Password</label><input name="password" type="password" autocomplete="current-password" required>
        <button class="btn" style="width:100%;margin-top:16px">Let me in ✨</button>
        <p class="mute sm" id="lmsg" style="color:var(--red)">${h(msg)}</p>
      </form>
    </div>`;
}

// ---------- routing ----------
async function go(view, silent) {
  const role = st.me.role;
  st.view = view || NAVS[role][0][0];
  try {
    const v = views[st.view];
    if (v.load) await v.load();
    shell(v.html());
    v.after && v.after();
  } catch (e) { if (!silent) toast(e.message, true); }
}

const STEP = { dine_in: ['placed', 'preparing', 'ready', 'completed'], delivery: ['placed', 'preparing', 'ready', 'out_for_delivery', 'delivered'] };
const label = (s) => s.replace(/_/g, ' ');
const ago = (t) => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
const itemsLine = (o) => o.items.map((i) => `${i.qty}× ${h(i.name)}`).join(', ');

async function loadMenu() {
  [st.menu, st.stores] = await Promise.all([api('/menu'), api('/stores')]);
  // staff tied to one store always work in it; everyone else remembers their last pick
  if (st.me.store_id) st.store = st.me.store_id;
  else if (!st.stores.some((s) => s.id === st.store)) st.store = st.stores[0]?.id ?? 1;
}
const storeMenu = () => st.menu.filter((m) => m.store_id === st.store);
const storeOf = (id) => st.stores.find((s) => s.id === id);
// Big store cards for students, small chips for staff who can see more than one store.
function storeBar(big) {
  if (st.me.store_id || st.stores.length < 2) return '';
  const btn = (s) => big
    ? `<button class="${s.id === st.store ? 'on' : ''}" data-act="store" data-id="${s.id}">${s.emoji} ${h(s.name)}</button>`
    : `<button class="chip ${s.id === st.store ? 'on' : ''}" data-act="store" data-id="${s.id}">${s.emoji} ${h(s.name)}</button>`;
  return `<div class="${big ? 'seg' : 'chips'}">${st.stores.map(btn).join('')}</div>`;
}

// ---------- views ----------
const views = {
  // ===== student =====
  menu: {
    async load() { await Promise.all([loadMenu(), api('/me').then((m) => (st.me = { ...st.me, ...m }))]); },
    html() {
      const cats = ['All', ...new Set(storeMenu().map((m) => m.category))];
      return `
        <div class="hero">
          <div><div class="hi">Hey ${h(st.me.name.split(' ')[0])} 👋</div><h2>What are you craving tonight?</h2></div>
          <div class="tabpill"><span>On your tab</span><b>${money(st.me.owed)}</b><i>pay at term end</i></div>
        </div>
        ${storeBar(true)}
        <input id="search" class="search" placeholder="Search ${h(storeOf(st.store)?.name || 'the menu')}…" value="${h(st.q)}">
        <div class="chips">${cats.map((c) => `<button class="chip ${st.cat === c ? 'on' : ''}" data-act="cat" data-c="${h(c)}">${h(c)}</button>`).join('')}</div>
        <div class="grid menu-grid" id="grid">${gridHtml(storeMenu(), st.cart, 'cart')}</div>`;
    },
    after() { $('#search').oninput = (e) => { st.q = e.target.value; $('#grid').innerHTML = gridHtml(storeMenu(), st.cart, 'cart'); }; },
  },
  orders: {
    async load() { st.data.orders = await api('/orders/mine'); },
    html() {
      const os = st.data.orders;
      if (!os.length) return `<div class="empty"><div class="emo">🍽️</div>No orders yet. Go order something!</div>`;
      return `<div class="grid">${os.map((o) => orderCard(o)).join('')}</div>`;
    },
  },
  tab: {
    async load() { st.data.tab = await api('/tab'); st.data.orders = await api('/orders/mine'); },
    html() {
      const t = st.data.tab;
      const pct = t.credit_limit > 0 ? Math.min(100, Math.round((t.owed / t.credit_limit) * 100)) : 0;
      return `
        <div class="card tabcard"><div class="mute sm">You owe this term</div><div class="big">${money(t.owed)}</div>
          ${t.credit_limit > 0 ? `<div class="meter"><div style="width:${pct}%"></div></div><div class="mute sm">${pct}% of your ${money(t.credit_limit)} limit</div>` : ''}
          <div class="mute sm" style="margin-top:6px">Eat now, pay at the end of term 🎓</div></div>
        <h3 style="margin:18px 0 8px">Recent spends</h3>
        <div class="card"><table>${st.data.orders.filter((o) => !['rejected', 'cancelled'].includes(o.status)).slice(0, 25).map((o) =>
          `<tr><td>#${o.id}<br><span class="mute sm">${new Date(o.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span></td><td class="sm">${itemsLine(o)}</td><td><b>${money(o.total)}</b></td></tr>`).join('') || '<tr><td class="mute">Nothing yet</td></tr>'}</table></div>
        ${t.payments.length ? `<h3 style="margin:18px 0 8px">Payments made</h3><div class="card"><table>${t.payments.map((p) => `<tr><td>${new Date(p.created_at).toLocaleDateString()}</td><td>${h(p.note || '')}</td><td style="color:var(--lime)">−${money(p.amount)}</td></tr>`).join('')}</table></div>` : ''}
        <h3 style="margin:18px 0 8px">Change password</h3>
        <form class="card" data-form="pw"><input name="current" type="password" placeholder="Current password"><div style="height:8px"></div><input name="next" type="password" placeholder="New password (6+ chars)"><button class="btn sm" style="margin-top:10px">Update</button></form>`;
    },
  },

  // ===== staff =====
  queue: {
    async load() { st.data.q = await api('/staff/orders'); },
    html() {
      const { active, recent } = st.data.q;
      const col = (title, list) => `<div class="col"><h3>${title} (${list.length})</h3>${list.map(ticket).join('') || '<div class="mute sm">—</div>'}</div>`;
      const by = (s) => active.filter((o) => o.status === s);
      return `<div class="cols">${col('🆕 New', by('placed'))}${col('👨‍🍳 Cooking', by('preparing'))}${col('✅ Ready', by('ready'))}${col('🛵 Out', by('out_for_delivery'))}</div>
        <h3 style="margin:22px 0 8px">Last 12 hours</h3><div class="card"><table>${recent.map((o) => `<tr><td>#${o.id}</td><td>${h(o.student)}</td><td class="sm">${itemsLine(o)}</td><td>${money(o.total)}</td><td><span class="status s-${o.status}">${label(o.status)}</span></td></tr>`).join('') || '<tr><td class="mute">Nothing yet</td></tr>'}</table></div>`;
    },
  },
  runs: {
    async load() { st.data.q = await api('/staff/orders'); },
    html() {
      const list = st.data.q.active.filter((o) => o.type === 'delivery' && ['ready', 'out_for_delivery'].includes(o.status));
      if (!list.length) return `<div class="empty"><div class="emo">😴</div>No deliveries waiting.</div>`;
      return `<div class="grid">${list.map((o) => `<div class="card">
        <div class="row between"><div class="big">Room ${h(o.room)}</div><span class="status s-${o.status}">${label(o.status)}</span></div>
        <div>${h(o.student)} · #${o.id}</div><div class="mute sm" style="margin:6px 0 12px">${itemsLine(o)}${o.note ? '<br>📝 ' + h(o.note) : ''}</div>
        ${o.status === 'ready' ? `<button class="btn" data-act="status" data-id="${o.id}" data-s="out_for_delivery">Picked up 🛵</button>`
          : `<form data-form="deliver" data-id="${o.id}" class="row"><input name="otp" inputmode="numeric" maxlength="4" placeholder="Student's 4-digit OTP" required><button class="btn lime">Delivered</button></form>`}
      </div>`).join('')}</div>`;
    },
  },
  counter: {
    async load() { await loadMenu(); },
    html() {
      const p = st.pos;
      const total = cartTotal(p.cart);
      return `<div class="card"><label style="margin-top:0">Student (roll no / name / room)</label>
        <input id="stq" placeholder="Search student…" autocomplete="off" value="${h(p.student ? p.student.login + ' · ' + p.student.name : '')}">
        <div id="stres"></div>
        ${p.student ? `<div class="pill" style="margin-top:8px">Room <b>${h(p.student.room || '—')}</b> · owed <b>${money(p.student.owed)}</b>${p.student.credit_limit > 0 ? ' / ' + money(p.student.credit_limit) : ''}</div>` : ''}
        <div class="chips" style="margin-top:8px"><button class="chip ${p.type === 'dine_in' ? 'on' : ''}" data-act="ptype" data-t="dine_in">🍽️ Counter / dine in</button><button class="chip ${p.type === 'delivery' ? 'on' : ''}" data-act="ptype" data-t="delivery">🛵 Room delivery</button></div></div>
        ${storeBar(false)}
        <div class="grid menu-grid" style="margin-top:12px" id="grid">${gridHtml(storeMenu(), p.cart, 'pcart')}</div>
        ${total ? `<div class="cartbar" data-act="posPlace"><span>Charge to tab</span><span>${money(total)} ✓</span></div>` : ''}`;
    },
    after() {
      const inp = $('#stq');
      inp.onfocus = () => inp.select();
      inp.oninput = async () => {
        if (inp.value.length < 2) { $('#stres').innerHTML = ''; return; }
        const rs = await act(() => api('/staff/students?q=' + encodeURIComponent(inp.value)));
        st.pos.results = rs || [];
        $('#stres').innerHTML = st.pos.results.map((s) => `<div class="pill" style="margin:6px 6px 0 0;cursor:pointer" data-act="pickStudent" data-id="${s.id}">${h(s.login)} · ${h(s.name)}</div>`).join('');
      };
    },
  },
  stock: {
    async load() { await loadMenu(); },
    html() {
      return `${storeBar(false)}<div class="card"><table>${storeMenu().map((m) => `<tr><td>${emo(m.name, m.category)} ${h(m.name)}<br><span class="mute sm">${h(m.category)} · ${money(m.price)}</span></td>
        <td style="text-align:right"><button class="btn sm ${m.available ? 'lime' : 'red'}" data-act="avail" data-id="${m.id}" data-a="${m.available ? 0 : 1}">${m.available ? 'In stock' : 'Sold out'}</button></td></tr>`).join('')}</table></div>`;
    },
  },

  // ===== admin =====
  stats: {
    async load() { st.data.stats = await api('/admin/stats'); },
    html() {
      const s = st.data.stats;
      const hrs = Array.from({ length: 24 }, (_, i) => s.hours.find((x) => x.hour === i)?.orders || 0);
      const mx = Math.max(1, ...hrs);
      return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <div class="card"><div class="mute sm">Orders today</div><div class="big">${s.today.orders}</div></div>
        <div class="card"><div class="mute sm">Sales today</div><div class="big">${money(s.today.revenue)}</div></div>
        <div class="card"><div class="mute sm">Total owed by students</div><div class="big">${money(s.owed.owed)}</div></div>
        <div class="card"><div class="mute sm">Online now</div><div class="big">${s.online}</div></div></div>
        <h3 style="margin:18px 0 8px">Orders by hour (last 7 days)</h3>
        <div class="card"><div class="bar">${hrs.map((n, i) => `<div style="height:${(n / mx) * 100}%" title="${i}:00 — ${n}"></div>`).join('')}</div>
        <div class="row between mute sm"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div></div>
        <h3 style="margin:18px 0 8px">Top items this week</h3>
        <div class="card"><table>${s.top.map((t) => `<tr><td>${h(t.name)}</td><td><b>${t.qty}</b></td></tr>`).join('') || '<tr><td class="mute">No data yet</td></tr>'}</table></div>`;
    },
  },
  items: {
    async load() { await loadMenu(); },
    html() {
      return `${storeBar(false)}<div class="card"><h3>Add / update item in ${h(storeOf(st.store)?.name || '')}</h3>
        <form data-form="item" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));margin-top:8px">
          <input name="category" placeholder="Category" required list="cats"><datalist id="cats">${[...new Set(storeMenu().map((m) => m.category))].map((c) => `<option>${h(c)}`).join('')}</datalist>
          <input name="name" placeholder="Name" required><input name="price" placeholder="Price ₹" inputmode="decimal" required>
          <select name="veg"><option value="1">Veg</option><option value="">Non-veg</option></select><button class="btn sm">Save</button></form></div>
        <div class="card" style="margin-top:12px"><h3>Bulk import (CSV)</h3><p class="mute sm">Columns: category,name,price[,veg]. Same name + category updates the price.</p>
          <form data-form="itemcsv"><textarea name="csv" rows="4" placeholder="Packaged Items,Maggi Cup,45&#10;Juice Counter,Mango Shake,70"></textarea>
          <input type="file" id="itemfile" accept=".csv,text/csv" style="margin-top:8px"><button class="btn sm" style="margin-top:8px">Import</button></form></div>
        <div class="card" style="margin-top:12px"><table>${storeMenu().map((m) => `<tr><td>${emo(m.name, m.category)} ${h(m.name)}<br><span class="mute sm">${h(m.category)}${m.available ? '' : ' · sold out'}</span></td>
          <td><input style="width:90px" value="${(m.price / 100).toString()}" data-act-change="price" data-id="${m.id}"></td>
          <td><button class="btn ghost sm" data-act="delItem" data-id="${m.id}">🗑</button></td></tr>`).join('')}</table></div>`;
    },
    after() { const f = $('#itemfile'); if (f) f.onchange = async () => { $('[name=csv]').value = await f.files[0].text(); }; },
  },
  students: {
    async load() { [st.data.users, st.stores] = await Promise.all([api('/admin/users?q=' + encodeURIComponent(st.data.uq || '')), api('/stores')]); },
    html() {
      return `<div class="card"><h3>Add person</h3><form data-form="user" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr));margin-top:8px">
        <select name="role"><option>student</option><option>pos</option><option>runner</option><option>admin</option></select>
        <select name="store_id" title="Staff only: which store they work in"><option value="">All stores</option>${st.stores.map((s) => `<option value="${s.id}">${h(s.name)} staff</option>`).join('')}</select>
        <input name="login" placeholder="Roll no / username" required><input name="name" placeholder="Name" required><input name="room" placeholder="Room">
        <input name="credit_limit" placeholder="Limit ₹ (blank = no limit)" inputmode="decimal"><input name="password" placeholder="Password (default = roll no)"><button class="btn sm">Save</button></form></div>
        <div class="card" style="margin-top:12px"><h3>Bulk import students (CSV)</h3><p class="mute sm">Columns: login,name,room[,credit_limit][,password]</p>
          <form data-form="usercsv"><textarea name="csv" rows="3" placeholder="PGP25001,Aarav Shah,17001,5000"></textarea><input type="file" id="userfile" accept=".csv,text/csv" style="margin-top:8px"><button class="btn sm" style="margin-top:8px">Import</button></form></div>
        <input id="uq" style="margin:12px 0" placeholder="Search people…" value="${h(st.data.uq || '')}">
        <div class="card" style="overflow:auto"><table><tr><th>Login</th><th>Name</th><th>Room</th><th>Owed</th><th>Limit ₹ (0 = none)</th><th></th></tr>${st.data.users.map((u) => `<tr>
          <td>${h(u.login)}<br><span class="mute sm">${u.role}</span></td><td>${h(u.name)}</td><td>${h(u.room || '')}</td><td>${money(u.owed)}</td>
          <td><input style="width:84px" value="${u.credit_limit / 100}" data-act-change="limit" data-id="${u.id}"></td>
          <td style="white-space:nowrap"><button class="btn ghost sm" data-act="resetpw" data-id="${u.id}" title="Reset password">🔑</button> <button class="btn ghost sm" data-act="toggleUser" data-id="${u.id}" data-a="${u.active ? 0 : 1}">${u.active ? 'Disable' : 'Enable'}</button></td></tr>`).join('')}</table></div>`;
    },
    after() {
      const f = $('#userfile'); if (f) f.onchange = async () => { $('[name=csv]', f.form).value = await f.files[0].text(); };
      let t; $('#uq').oninput = (e) => { clearTimeout(t); t = setTimeout(async () => { st.data.uq = e.target.value; st.data.users = await api('/admin/users?q=' + encodeURIComponent(st.data.uq)); const pos = e.target.selectionStart; shell(views.students.html()); views.students.after(); const n = $('#uq'); n.focus(); n.setSelectionRange(pos, pos); }, 300); };
    },
  },
  money: {
    async load() { st.data.users = (await api('/admin/users?q=')).filter((u) => u.role === 'student' && u.owed > 0).sort((a, b) => b.owed - a.owed); },
    html() {
      return `<div class="card"><h3>Record a payment</h3><form data-form="pay" class="grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-top:8px">
        <input name="login" placeholder="Roll no" required><input name="amount" placeholder="Amount ₹" inputmode="decimal" required><input name="note" placeholder="Note (UPI ref…)"><button class="btn sm">Record</button></form></div>
        <div class="row between" style="margin:18px 0 8px"><h3>Outstanding (${st.data.users.length})</h3><button class="btn sm" data-act="bills">⬇ Term bills CSV</button></div>
        <div class="card"><table>${st.data.users.map((u) => `<tr><td>${h(u.login)}</td><td>${h(u.name)}</td><td>${h(u.room || '')}</td><td><b>${money(u.owed)}</b></td></tr>`).join('') || '<tr><td class="mute">Nobody owes anything 🎉</td></tr>'}</table></div>`;
    },
  },
};

// ---------- fragments ----------
function gridHtml(menu, cart, kind) {
  const q = st.q.toLowerCase();
  const list = menu.filter((m) => (st.cat === 'All' || m.category === st.cat) && (!q || m.name.toLowerCase().includes(q)));
  if (!list.length) return '<div class="empty" style="grid-column:1/-1"><div class="emo">🫥</div>Nothing found</div>';
  return list.map((m) => {
    const n = cart[m.id] || 0;
    return `<div class="item ${m.available ? '' : 'out'}" style="--tint:${tint(m.category)}"><i class="veg ${m.veg ? '' : 'nv'}"></i><div class="emo">${emo(m.name, m.category)}</div><div class="nm">${h(m.name)}</div><div class="pr">${money(m.price)}</div>
      ${!m.available ? '<div class="mute sm">Sold out</div>' : n ? `<div class="stepper"><button data-act="dec" data-k="${kind}" data-id="${m.id}">−</button><b>${n}</b><button data-act="inc" data-k="${kind}" data-id="${m.id}">+</button></div>`
        : `<button class="btn sm" data-act="inc" data-k="${kind}" data-id="${m.id}">Add +</button>`}</div>`;
  }).join('');
}

function orderCard(o) {
  const steps = STEP[o.type];
  const idx = steps.indexOf(o.status);
  const dead = ['rejected', 'cancelled'].includes(o.status);
  return `<div class="card"><div class="row between"><b>#${o.id} · ${o.type === 'delivery' ? '🛵 Room ' + h(o.room) : '🍽️ Dine in'} <span class="tag">${o.store_emoji || ''} ${h(o.store || '')}</span></b><span class="status s-${o.status}">${label(o.status)}</span></div>
    <div class="mute sm">${ago(o.created_at)}</div>
    ${dead ? '' : `<div class="steps">${steps.map((_, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</div>`}
    <div style="margin:8px 0">${itemsLine(o)}</div><div class="row between"><b>${money(o.total)}</b>
    <span>${o.status === 'placed' ? `<button class="btn red sm" data-act="cancel" data-id="${o.id}">Cancel</button> ` : ''}<button class="btn ghost sm" data-act="reorder" data-id="${o.id}">Order again</button></span></div>
    ${o.otp && ['ready', 'out_for_delivery', 'preparing', 'placed'].includes(o.status) ? `<div style="margin-top:10px"><div class="mute sm">Show this OTP to the runner</div><div class="otp">${h(o.otp)}</div></div>` : ''}</div>`;
}

function ticket(o) {
  const late = o.status === 'placed' && Date.now() - new Date(o.created_at) > 15 * 60000;
  const next = { placed: ['preparing', 'Start cooking'], preparing: ['ready', 'Mark ready'], ready: o.type === 'delivery' ? null : ['completed', 'Handed over'] }[o.status];
  return `<div class="ticket ${late ? 'late' : ''}"><div class="row between"><b>#${o.id} ${h(o.student)}${st.me.store_id ? '' : ` <span class="tag">${o.store_emoji || ''} ${h(o.store || '')}</span>`}</b><span class="mute sm">${ago(o.created_at)}</span></div>
    <div class="sm mute">${o.type === 'delivery' ? '🛵 Room ' + h(o.room) : '🍽️ Dine in'}${o.source === 'pos' ? ' · counter' : ''}</div>
    <div style="margin:6px 0">${itemsLine(o)}</div>${o.note ? `<div class="sm">📝 ${h(o.note)}</div>` : ''}
    <div class="row between"><b>${money(o.total)}</b><span>
    ${['placed', 'preparing', 'ready'].includes(o.status) ? `<button class="btn red sm" data-act="status" data-id="${o.id}" data-s="rejected">✕</button> ` : ''}
    ${next ? `<button class="btn sm" data-act="status" data-id="${o.id}" data-s="${next[0]}">${next[1]}</button>` : o.status === 'ready' ? '<span class="mute sm">waiting for runner</span>' : ''}
    </span></div></div>`;
}

function sheetHtml() {
  if (st.sheet !== 'cart') return '';
  const lines = Object.entries(st.cart).map(([id, q]) => ({ m: st.menu.find((m) => m.id == id), q })).filter((l) => l.m);
  const total = cartTotal(st.cart);
  const limited = st.me.credit_limit > 0;
  const free = limited ? st.me.credit_limit - st.me.owed : Infinity;
  return `<div class="sheet-bg"><div class="sheet">
    <div class="row between"><h2>Your cart 🛒</h2><button class="btn ghost sm" data-act="closeSheet">✕</button></div>
    <table style="margin:10px 0">${lines.map((l) => `<tr><td>${h(l.m.name)}</td><td><div class="stepper" style="width:110px"><button data-act="dec" data-k="cart" data-id="${l.m.id}">−</button><b>${l.q}</b><button data-act="inc" data-k="cart" data-id="${l.m.id}">+</button></div></td><td><b>${money(l.m.price * l.q)}</b></td></tr>`).join('')}</table>
    <div class="chips"><button class="chip ${st.co.type === 'dine_in' ? 'on' : ''}" data-act="ctype" data-t="dine_in">🍽️ Dine in</button><button class="chip ${st.co.type === 'delivery' ? 'on' : ''}" data-act="ctype" data-t="delivery">🛵 Deliver to room</button></div>
    ${st.co.type === 'delivery' ? `<label>Room</label><input id="coroom" value="${h(st.co.room || st.me.room || '')}" placeholder="e.g. 17001">` : ''}
    <label>Note for the kitchen (optional)</label><input id="conote" value="${h(st.co.note)}" placeholder="less spicy pls 🌶️" maxlength="200">
    <div class="row between" style="margin:16px 0 4px"><span class="mute">Total · charged to tab</span><span class="big">${money(total)}</span></div>
    ${limited ? `<div class="mute sm">Credit left after this: ${money(free - total)}</div>` : ''}
    <button class="btn" style="width:100%;margin-top:14px" data-act="place" ${total > free ? 'disabled' : ''}>${total > free ? 'Over credit limit 😬' : 'Place order 🚀'}</button></div></div>`;
}

// ---------- events ----------
const A = {
  nav: (d) => go(d.v),
  logout: () => logout(),
  cat: (d) => { st.cat = d.c; go(st.view, true); },
  inc: (d) => { const c = d.k === 'cart' ? st.cart : st.pos.cart; c[d.id] = (c[d.id] || 0) + 1; cartChanged(d.k); },
  dec: (d) => { const c = d.k === 'cart' ? st.cart : st.pos.cart; if ((c[d.id] = (c[d.id] || 0) - 1) <= 0) delete c[d.id]; cartChanged(d.k); },
  store: (d) => {
    const id = Number(d.id); if (id === st.store) return;
    const student = st.me.role === 'student';
    const cart = student ? st.cart : st.pos.cart;
    if (Object.keys(cart).length && !confirm('Switching store clears your cart. Continue?')) return;
    for (const k of Object.keys(cart)) delete cart[k];
    if (student) ls.set('cart', {});
    st.store = id; ls.set('store', id); st.cat = 'All'; st.q = '';
    go(st.view, true);
  },
  openCart: () => { st.sheet = 'cart'; go(st.view, true); },
  closeSheet: () => { st.sheet = null; go(st.view, true); },
  ctype: (d) => { st.co.type = d.t; go(st.view, true); },
  place: () => act(async () => {
    st.co.note = $('#conote')?.value || ''; if ($('#coroom')) st.co.room = $('#coroom').value;
    const items = Object.entries(st.cart).map(([id, qty]) => ({ id: Number(id), qty }));
    await api('/orders', { body: { items, type: st.co.type, room: st.co.room, note: st.co.note } });
    st.cart = {}; ls.set('cart', {}); st.sheet = null; st.co.note = '';
    toast('Order placed! 🎉'); go('orders');
  }),
  cancel: (d) => act(async () => { await api(`/orders/${d.id}/cancel`, { method: 'POST', body: {} }); toast('Cancelled'); go(st.view, true); }),
  reorder: (d) => {
    const o = st.data.orders.find((x) => x.id == d.id); st.cart = {};
    o.items.forEach((i) => { const m = st.menu.find((m) => m.name === i.name && m.store_id === o.store_id); if (m) st.cart[m.id] = i.qty; });
    st.store = o.store_id; ls.set('store', o.store_id); st.cat = 'All';
    ls.set('cart', st.cart);
    loadMenu().then(() => { go('menu'); }); toast('Cart filled 🛒');
  },
  status: (d) => act(async () => { await api(`/staff/orders/${d.id}/status`, { body: { status: d.s } }); go(st.view, true); }),
  ptype: (d) => { st.pos.type = d.t; go(st.view, true); },
  pickStudent: (d) => { st.pos.student = st.pos.results.find((s) => s.id == d.id); st.pos.results = []; go(st.view, true); },
  posPlace: () => act(async () => {
    if (!st.pos.student) return toast('Pick a student first', true);
    const items = Object.entries(st.pos.cart).map(([id, qty]) => ({ id: Number(id), qty }));
    const o = await api('/staff/pos-order', { body: { student_id: st.pos.student.id, items, type: st.pos.type } });
    toast(`Charged ${money(o.total)} to ${st.pos.student.name}${o.otp ? ' · OTP ' + o.otp : ''} ✅`);
    st.pos = { student: null, cart: {}, type: 'dine_in', results: [] }; go('counter');
  }),
  avail: (d) => act(async () => { await api(`/staff/items/${d.id}/available`, { body: { available: d.a === '1' } }); go(st.view, true); }),
  delItem: (d) => confirm('Delete this item?') && act(async () => { await api(`/admin/items/${d.id}`, { method: 'DELETE' }); go(st.view, true); }),
  toggleUser: (d) => act(async () => { await api(`/admin/users/${d.id}`, { method: 'PATCH', body: { active: d.a === '1' } }); go(st.view, true); }),
  resetpw: (d) => { const p = prompt('New password for this person (6+ chars):'); if (p) act(async () => { await api(`/admin/users/${d.id}`, { method: 'PATCH', body: { password: p } }); toast('Password reset'); }); },
  bills: () => act(async () => {
    const r = await fetch('/api/admin/bills.csv', { headers: { authorization: 'Bearer ' + st.token } });
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'term-bills.csv'; a.click();
  }),
};
function cartChanged(kind) {
  if (kind === 'cart') ls.set('cart', st.cart);
  go(st.view, true);
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('sheet-bg')) return A.closeSheet();
  const b = e.target.closest('[data-act]');
  if (b && A[b.dataset.act]) { e.stopPropagation(); A[b.dataset.act](b.dataset, b); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.actChange === 'price') act(async () => { await api(`/admin/items/${t.dataset.id}`, { method: 'PATCH', body: { price: t.value } }); toast('Price updated'); });
  if (t.dataset.actChange === 'limit') act(async () => { await api(`/admin/users/${t.dataset.id}`, { method: 'PATCH', body: { credit_limit: t.value } }); toast('Limit updated'); });
});

const FORMS = {
  login: async (f) => {
    try {
      const r = await api('/login', { body: { login: f.login.value, password: f.password.value } });
      st.token = r.token; ls.set('token', r.token); st.me = r.me; boot2();
    } catch (e) { $('#lmsg').textContent = e.message; }
  },
  pw: (f) => act(async () => { await api('/password', { body: { current: f.current.value, next: f.next.value } }); toast('Password updated 🔐'); f.reset(); }),
  deliver: (f) => act(async () => { await api(`/staff/orders/${f.dataset.id}/status`, { body: { status: 'delivered', otp: f.otp.value } }); toast('Delivered ✅'); go(st.view, true); }),
  item: (f) => act(async () => { await api('/admin/items', { body: { store_id: st.store, category: f.category.value, name: f.name.value, price: f.price.value, veg: !!f.veg.value } }); toast('Saved'); go(st.view, true); }),
  itemcsv: (f) => act(async () => { const r = await api('/admin/items/import', { body: { store_id: st.store, csv: f.csv.value } }); toast(`Imported ${r.imported}, skipped ${r.skipped}`); go(st.view, true); }),
  user: (f) => act(async () => { await api('/admin/users', { body: Object.fromEntries(new FormData(f)) }); toast('Saved'); go(st.view, true); }),
  usercsv: (f) => act(async () => { const r = await api('/admin/users/import', { body: { csv: f.csv.value } }); toast(`Imported ${r.imported} students`); go(st.view, true); }),
  pay: (f) => act(async () => { const r = await api('/admin/payments', { body: Object.fromEntries(new FormData(f)) }); toast(`Recorded. Now owes ${money(r.owed)}`); go(st.view, true); }),
};
document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-form]');
  if (f && FORMS[f.dataset.form]) { e.preventDefault(); FORMS[f.dataset.form](f); }
});

// ---------- boot ----------
function boot2() { connectLive(); go(); }
(async function boot() {
  if (!st.token) return paintLogin();
  try { st.me = await api('/me'); boot2(); } catch { paintLogin(); }
})();
