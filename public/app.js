/* King of Pops · Operations Checklists v3 */
const $app = document.getElementById('app');
let ME = null;
let TAB = null;
let DASH_DATE = null, DASH_TERR = undefined;
let SCHED_DATE = null;
let UNREAD = 0;
let CHAT_CHANNEL = null, CHAT_LAST_ID = 0, CHAT_TIMER = null;

// ---------- utils ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEVELS = { admin: '👑 Admin', manager: '🧭 Manager', slinger: '🍭 Slinger' };
const rank = u => ({ slinger: 0, manager: 1, admin: 2 }[u.level] ?? 0);

function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.className = '', 3200);
}
async function api(path, opts = {}) {
  if (opts.json !== undefined) {
    opts.body = JSON.stringify(opts.json);
    opts.headers = { 'Content-Type': 'application/json' };
    delete opts.json;
  }
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
function modal(html) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal"><button class="close">✕</button>${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg || e.target.classList.contains('close')) bg.remove(); });
  document.body.appendChild(bg);
  return bg;
}
function compressImage(file, maxDim = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
const readFileAsDataURL = f => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
});
const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const prettyDate = d => new Date(d + 'T12:00:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  if (m < 1440) return Math.round(m / 60) + 'h ago';
  return Math.round(m / 1440) + 'd ago';
}
function dueLabel(inst) {
  const ms = new Date(inst.due_at) - Date.now();
  if (inst.status === 'complete') return `<span class="pill green">✓ Done ${fmtTime(inst.completed_at)}</span>`;
  if (inst.status === 'overdue' || ms < 0) return `<span class="pill red">Overdue!</span>`;
  const m = Math.round(ms / 60000);
  return `<span class="pill ${m <= 15 ? 'red' : 'yellow'}">Due in ${m} min</span>`;
}
function localDT(offsetMin = 0) {
  const d = new Date(Date.now() + offsetMin * 60000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// ---------- push ----------
async function registerSW() {
  if ('serviceWorker' in navigator) try { await navigator.serviceWorker.register('/sw.js'); } catch { }
}
function urlB64ToUint8(base64) {
  const pad = '='.repeat((4 - base64.length % 4) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
async function enablePush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window))
      return toast('Push not supported here. On iPhone: add this app to your Home Screen first, then try again.', true);
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('Notifications were blocked. Enable them in your browser settings.', true);
    const reg = await navigator.serviceWorker.ready;
    const { key } = await api('/api/push/key');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) });
    await api('/api/push/subscribe', { method: 'POST', json: { subscription: sub.toJSON() } });
    await api('/api/push/test', { method: 'POST' });
    toast('Push enabled — you should get a test notification 🍭');
  } catch (e) { toast('Could not enable push: ' + e.message, true); }
}

// ---------- notifications ----------
async function refreshBell() {
  try {
    const { unread } = await api('/api/notifications');
    UNREAD = unread;
    const dot = document.querySelector('.bell .dot');
    const bell = document.querySelector('.bell');
    if (!bell) return;
    if (unread > 0) {
      if (dot) dot.textContent = unread;
      else bell.insertAdjacentHTML('beforeend', `<span class="dot">${unread}</span>`);
    } else if (dot) dot.remove();
  } catch { }
}
async function openNotifications() {
  const { notifications } = await api('/api/notifications');
  const rows = notifications.map(n => `
    <div class="notif-row ${n.read ? '' : 'unread'}">
      <b>${esc(n.title)}</b><span>${esc(n.body)} · ${ago(n.created_at)}</span>
    </div>`).join('');
  const bg = modal(`
    <h2>🔔 Alerts</h2>
    <p style="color:var(--ink-soft);margin:0 0 10px;font-size:14px">Overdue checklists and direct messages show up here — and as push notifications on your phone.</p>
    <button class="btn teal small" id="pushBtn">📲 Enable push on this device</button>
    <div class="card" style="margin-top:14px">${rows || '<div class="empty">No alerts yet 🎉</div>'}</div>`);
  bg.querySelector('#pushBtn').onclick = enablePush;
  await api('/api/notifications/read', { method: 'POST' });
  refreshBell();
}

// ---------- shell ----------
function tabsFor() {
  if (rank(ME) === 2) return ['dashboard|📊 Dashboard', 'schedule|🗓️ Schedule', 'checklists|📋 Checklists', 'carts|🛒 Carts', 'users|👥 Team', 'chat|💬 Chat', 'mytasks|✅ My tasks'];
  if (rank(ME) === 1) return ['dashboard|📊 Dashboard', 'schedule|🗓️ Schedule', 'users|👥 Team', 'chat|💬 Chat', 'mytasks|✅ My tasks'];
  return ['home|🍭 My checklists', 'chat|💬 Chat'];
}
function shell() {
  clearInterval(CHAT_TIMER);
  const tabs = tabsFor();
  if (!TAB || !tabs.some(t => t.startsWith(TAB + '|'))) TAB = tabs[0].split('|')[0];
  $app.innerHTML = `
  <div class="rainbow"></div>
  <header class="topbar"><div class="topbar-inner">
    <div class="brand"><img src="/logo.png" alt="King of Pops"><div><small>Ops Checklists</small></div></div>
    <div class="spacer"></div>
    <button class="bell" id="bellBtn">🔔${UNREAD ? `<span class="dot">${UNREAD}</span>` : ''}</button>
    <div class="userchip"><b>${esc(ME.name)}</b><span>${LEVELS[ME.level] || ''}</span></div>
    <button class="btn ghost small" id="logoutBtn">Sign out</button>
  </div></header>
  <div class="container">
    <div class="tabs">${tabs.map(t => { const [k, l] = t.split('|'); return `<button class="tab ${TAB === k ? 'active' : ''}" data-tab="${k}">${l}</button>`; }).join('')}</div>
    <div id="body"></div>
  </div>`;
  document.getElementById('logoutBtn').onclick = async () => { await api('/api/logout', { method: 'POST' }); ME = null; renderLogin(); };
  document.getElementById('bellBtn').onclick = openNotifications;
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => { TAB = b.dataset.tab; shell(); });
  refreshBell();
  const body = document.getElementById('body');
  const views = { dashboard: renderDashboard, schedule: renderSchedule, checklists: renderChecklistAdmin, carts: renderCarts, users: renderUsers, chat: renderChat, mytasks: renderMyTasks, home: renderMyTasks };
  views[TAB](body);
}

// ---------- login ----------
function renderLogin() {
  clearInterval(CHAT_TIMER);
  $app.innerHTML = `
  <div class="login-wrap"><div class="login-card">
    <div class="rainbow"></div>
    <img class="login-logo" src="/logo.png" alt="King of Pops">
    <div class="sub">Operations Checklists</div>
    <form id="loginForm">
      <label>Email</label><input name="email" type="email" required autocomplete="username" placeholder="you@kingofpops.com">
      <label>Password</label><input name="password" type="password" required autocomplete="current-password" placeholder="••••••••">
      <button class="btn">Let's go 🌈</button>
    </form>
  </div></div>`;
  document.getElementById('loginForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const { user } = await api('/api/login', { method: 'POST', json: { email: f.get('email'), password: f.get('password') } });
      ME = user; TAB = null;
      shell();
    } catch (err) { toast(err.message, true); }
  };
}

// ================= MY TASKS (all levels) =================
function taskCards(instances, daily) {
  const instCards = instances.map(i => `
    <div class="card cl-card ${i.status === 'complete' ? 'done' : i.status === 'overdue' ? 'overdue' : ''}" data-inst="${i.id}">
      <div class="cl-emoji">${i.emoji}</div>
      <div><h3>${esc(i.checklist_name)}</h3>
        <p>${i.cart_name ? '📍 ' + esc(i.cart_name) + ' · ' : ''}${i.type === 'opening' ? 'Start of shift' : 'End of shift'} · ${i.items.length} items</p></div>
      <div class="cl-meta">${dueLabel(i)}</div>
    </div>`).join('');
  const dailyCards = daily.map(c => {
    const status = c.submission
      ? `<span class="pill green">✓ Done ${fmtTime(c.submission.completed_at)}</span>`
      : c.overdue ? `<span class="pill red">Overdue${c.due_time ? ' · was due ' + c.due_time : ''}</span>`
        : `<span class="pill yellow">${c.due_time ? 'Due by ' + c.due_time : 'To do'}</span>`;
    return `<div class="card cl-card ${c.submission ? 'done' : c.overdue ? 'overdue' : ''}" data-daily="${c.id}">
      <div class="cl-emoji">${c.emoji || '📋'}</div>
      <div><h3>${esc(c.name)}</h3><p>${esc(c.description || '')} · ${c.items.length} items</p></div>
      <div class="cl-meta">${status}</div>
    </div>`;
  }).join('');
  return instCards + dailyCards;
}
function bindTaskCards(root, instances, daily, refresh) {
  root.querySelectorAll('[data-inst]').forEach(el => {
    const i = instances.find(x => x.id == el.dataset.inst);
    if (i.status !== 'complete') el.onclick = () => openChecklist({ id: i.checklist_id, name: i.checklist_name, emoji: i.emoji, description: i.description, items: i.items }, i.id, refresh);
  });
  root.querySelectorAll('[data-daily]').forEach(el => {
    const c = daily.find(x => x.id == el.dataset.daily);
    if (!c.submission) el.onclick = () => openChecklist(c, null, refresh);
  });
}
async function renderMyTasks(body) {
  const { date, checklists, instances, shift } = await api('/api/today');
  const all = [...instances, ...checklists];
  const done = instances.filter(i => i.status === 'complete').length + checklists.filter(c => c.submission).length;
  const shiftBanner = shift ? `
    <div class="card" style="margin-bottom:14px;display:flex;gap:12px;align-items:center">
      <div style="font-size:26px">🗓️</div>
      <div><b>Your shift</b><div style="color:var(--ink-soft);font-size:13px">
        ${shift.cart_name ? '📍 ' + esc(shift.cart_name) + ' · ' : ''}${fmtTime(shift.start_at)} – ${fmtTime(shift.end_at)}</div></div>
    </div>` : '';
  body.innerHTML = `
    <div class="section-head"><h2>${prettyDate(date)}</h2><div class="spacer"></div>
      <button class="btn ghost small" id="pickupBtn">⚡ Pick up a shift</button>
      <span class="pill ${done === all.length && all.length ? 'green' : 'teal'}">${done}/${all.length} complete</span></div>
    ${shiftBanner}
    ${taskCards(instances, checklists) || `<div class="empty"><div class="big">🏖️</div>Nothing assigned right now. Your opening checklist appears when your shift starts.<br><br>Picked up a shift that's not in the schedule? Use <b>⚡ Pick up a shift</b> above.</div>`}
  `;
  bindTaskCards(body, instances, checklists, () => renderMyTasks(body));
  body.querySelector('#pickupBtn').onclick = () => pickupShift(() => renderMyTasks(body));
}

async function pickupShift(refresh) {
  const carts = await api('/api/locations');
  const bg = modal(`
    <h2>⚡ Pick up a shift</h2>
    <p style="color:var(--ink-soft);font-size:14px;margin:0 0 8px">Working a shift that isn't assigned to you in the schedule? Pick your cart and when your shift ends — your opening checklist appears right away, and the closing checklist 30 minutes before the end.</p>
    <label>Cart</label>
    <select id="puCart">${carts.map(c => `<option value="${c.id}">${esc(c.name)}${c.category_name ? ' · ' + esc(c.category_name) : ''}</option>`).join('')}</select>
    <label>Shift ends at</label>
    <input type="datetime-local" id="puEnd" value="${localDT(6 * 60)}">
    <button class="btn teal" id="puGo" style="width:100%;margin-top:16px">Start my shift ✓</button>
  `);
  bg.querySelector('#puGo').onclick = async () => {
    try {
      await api('/api/shifts/pickup', {
        method: 'POST', json: {
          cart_id: Number(bg.querySelector('#puCart').value),
          end_at: new Date(bg.querySelector('#puEnd').value).toISOString(),
        }
      });
      bg.remove(); toast('Shift started — your opening checklist is ready 🍭');
      refresh();
    } catch (e) { toast(e.message, true); }
  };
}

function openChecklist(c, instanceId, refresh) {
  const rows = c.items.map(it => {
    const req = it.required ? '<span class="req">*</span>' : '';
    const range = it.type === 'number' && (it.min != null || it.max != null)
      ? `<span class="range">(ok: ${it.min ?? '−∞'}–${it.max ?? '∞'}${it.unit ? ' ' + esc(it.unit) : ''})</span>` : '';
    let field = '';
    if (it.type === 'checkbox')
      field = `<button type="button" class="checkbig" data-item="${it.id}"><span class="box">✓</span>${esc(it.label)}</button>`;
    else if (it.type === 'yesno')
      field = `<div class="choice-row" data-item="${it.id}">
        <button type="button" class="choice" data-v="yes">Yes 👍</button>
        <button type="button" class="choice" data-v="no">No 👎</button></div>`;
    else if (it.type === 'number')
      field = `<input type="number" step="any" data-item="${it.id}" placeholder="${it.unit ? esc(it.unit) : 'Enter a number'}">`;
    else if (it.type === 'text')
      field = `<textarea rows="2" data-item="${it.id}" placeholder="Type here…"></textarea>`;
    else if (it.type === 'photo')
      field = `<button type="button" class="photo-drop" data-item="${it.id}">📷 Tap to add photo</button>
        <input type="file" accept="image/*" capture="environment" hidden data-file="${it.id}">`;
    const labelHtml = it.type === 'checkbox' ? '' : `<div class="item-label">${esc(it.label)} ${req} ${range}</div>`;
    return `<div class="item-row">${labelHtml}${field}</div>`;
  }).join('');

  const bg = modal(`
    <h2>${c.emoji || '📋'} ${esc(c.name)}</h2>
    <p style="color:var(--ink-soft);margin:0 0 8px">${esc(c.description || '')}</p>
    <div class="card">${rows}</div>
    <button class="btn teal" id="submitCl" style="width:100%;margin-top:16px">Submit checklist ✓</button>
  `);

  const answers = {}, photos = {};
  bg.querySelectorAll('.checkbig').forEach(b => b.onclick = () => {
    b.classList.toggle('on');
    answers[b.dataset.item] = b.classList.contains('on') ? 'yes' : '';
  });
  bg.querySelectorAll('.choice-row').forEach(row => row.querySelectorAll('.choice').forEach(b => b.onclick = () => {
    row.querySelectorAll('.choice').forEach(x => x.classList.remove('sel-yes', 'sel-no'));
    b.classList.add(b.dataset.v === 'yes' ? 'sel-yes' : 'sel-no');
    answers[row.dataset.item] = b.dataset.v;
  }));
  bg.querySelectorAll('input[type=number],textarea').forEach(el =>
    el.oninput = () => answers[el.dataset.item] = el.value);
  bg.querySelectorAll('.photo-drop').forEach(btn => {
    const file = bg.querySelector(`input[data-file="${btn.dataset.item}"]`);
    btn.onclick = () => file.click();
    file.onchange = () => {
      if (!file.files[0]) return;
      photos[btn.dataset.item] = file.files[0];
      const url = URL.createObjectURL(file.files[0]);
      btn.innerHTML = `<img src="${url}"><span>📷 Tap to retake</span>`;
    };
  });

  bg.querySelector('#submitCl').onclick = async () => {
    const btn = bg.querySelector('#submitCl');
    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
      const photoData = {};
      for (const [id, f] of Object.entries(photos)) photoData[id] = await compressImage(f);
      await api(`/api/checklists/${c.id}/submit`, { method: 'POST', json: { responses: answers, photos: photoData, instance_id: instanceId } });
      bg.remove();
      toast('Checklist complete — nice work! 🍭');
      refresh();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false; btn.textContent = 'Submit checklist ✓';
    }
  };
}

// ================= DASHBOARD =================
async function renderDashboard(body) {
  if (DASH_TERR === undefined) DASH_TERR = rank(ME) === 1 && ME.territory_id ? ME.territory_id : '';
  const terrs = await api('/api/territories');
  const params = new URLSearchParams();
  if (DASH_DATE) params.set('date', DASH_DATE);
  if (DASH_TERR) params.set('territory_id', DASH_TERR);
  const trendParams = DASH_TERR ? '&territory_id=' + DASH_TERR : '';
  const [dash, trend] = await Promise.all([
    api('/api/dashboard?' + params), api('/api/trend?days=7' + trendParams)]);
  DASH_DATE = dash.date;
  const s = dash.summary;

  const stateInfo = {
    open: '🟢 Open', closed: '⚫ Closed', overdue: '🔴 Overdue',
    not_opened: '🟡 Not opened yet', scheduled: '🕒 Shift scheduled',
  };
  const tiles = dash.board.map(b => {
    const lines = [];
    if (b.opened_at) lines.push(`Opened ${fmtTime(b.opened_at)} by ${esc(b.opened_by)}`);
    if (b.closed_at) lines.push(`Closed ${fmtTime(b.closed_at)} by ${esc(b.closed_by)}`);
    if (!lines.length && b.workers.length) lines.push('Scheduled: ' + b.workers.map(esc).join(', '));
    return `<div class="cart-tile s-${b.state}">
      <div class="cat">${esc([b.territory_name, b.category_name].filter(Boolean).join(' · '))}</div>
      <h4>${esc(b.cart_name)}</h4>
      <div><b style="font-size:13px">${stateInfo[b.state] || '?'}</b></div>
      <div class="who">${lines.join('<br>')}</div>
    </div>`;
  }).join('');

  const instPills = { complete: '<span class="pill green">✓ Complete</span>', pending: '<span class="pill yellow">Pending</span>', overdue: '<span class="pill red">Overdue</span>' };
  const instRows = dash.instances.map(i => {
    const flag = i.flags ? ` <span class="pill red">⚑ ${i.flags}</span>` : '';
    return `<tr class="${i.submission_id ? 'clickable' : ''}" data-sub="${i.submission_id || ''}">
      <td>${i.emoji} <b>${esc(i.checklist_name)}</b> <span class="pill ${i.type === 'opening' ? 'teal' : 'purple'}">${i.type}</span></td>
      <td>${esc(i.cart_name || '—')}</td>
      <td>${esc(i.user_name)}</td>
      <td>${fmtTime(i.populate_at)} → ${fmtTime(i.due_at)}</td>
      <td>${instPills[i.status] || i.status}${flag}</td></tr>`;
  }).join('');

  const dailyPills = { complete: '<span class="pill green">✓ Complete</span>', pending: '<span class="pill yellow">Pending</span>', missed: '<span class="pill red">Missed</span>' };
  const rows = dash.rows.map(r => {
    const who = r.submission ? `${esc(r.submission.user_name || '—')} · ${fmtTime(r.submission.completed_at)}` : '—';
    const flag = r.flags ? ` <span class="pill red">⚑ ${r.flags}</span>` : '';
    return `<tr class="${r.submission ? 'clickable' : ''}" data-sub="${r.submission ? r.submission.id : ''}">
      <td>${r.emoji} <b>${esc(r.checklist_name)}</b></td>
      <td>${esc(r.location_name)}</td>
      <td>${r.due_time || '—'}</td>
      <td>${who}</td>
      <td>${dailyPills[r.status]}${flag}</td></tr>`;
  }).join('');

  const bars = trend.map(d => {
    const cls = d.pct >= 90 ? '' : d.pct >= 60 ? 'low' : 'bad';
    const label = new Date(d.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short' });
    return `<div class="bar-wrap" title="${d.complete}/${d.total} complete">
      <div class="bar ${cls}" style="height:${Math.max(d.pct, 3)}%"></div>${label}<br>${d.pct}%</div>`;
  }).join('');

  body.innerHTML = `
    <div class="datebar">
      <button class="btn ghost small" id="prevDay">◀</button>
      <input type="date" id="dashDate" value="${dash.date}">
      <button class="btn ghost small" id="nextDay">▶</button>
      <h2>${prettyDate(dash.date)}</h2>
      <div class="spacer"></div>
      <select id="terrSel" style="width:auto">
        <option value="">🗺️ All territories</option>
        ${terrs.map(t => `<option value="${t.id}" ${DASH_TERR == t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="stats">
      <div class="card stat c-teal"><div class="num">${s.pct}%</div><div class="lbl">Completion</div></div>
      <div class="card stat c-pink"><div class="num">${s.complete}/${s.total}</div><div class="lbl">Done</div></div>
      <div class="card stat c-red"><div class="num">${s.missed}</div><div class="lbl">Missed / overdue</div></div>
      <div class="card stat c-orange"><div class="num">${s.flagged}</div><div class="lbl">Flagged answers</div></div>
    </div>
    <div class="subhead">🛒 Cart status</div>
    ${tiles ? `<div class="board">${tiles}</div>` : '<div class="empty">No shifts scheduled this day — carts appear here once shifts exist.</div>'}
    <div class="subhead">☀️🌙 Shift checklists</div>
    ${instRows ? `<table class="grid"><tr><th>Checklist</th><th>Cart</th><th>Who</th><th>Window</th><th>Status</th></tr>${instRows}</table>`
      : '<div class="empty">No shift checklists populated this day.</div>'}
    <div class="subhead">📋 Daily checklists</div>
    ${rows ? `<table class="grid"><tr><th>Checklist</th><th>Location</th><th>Due</th><th>Completed by</th><th>Status</th></tr>${rows}</table>`
      : '<div class="empty">No daily checklists scheduled this day.</div>'}
    <div class="card" style="margin-top:20px"><b style="font-size:13px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:1px">Last 7 days</b>
      <div class="trend">${bars}</div></div>
  `;
  const setDate = d => { DASH_DATE = d; renderDashboard(body); };
  body.querySelector('#dashDate').onchange = e => setDate(e.target.value);
  body.querySelector('#prevDay').onclick = () => shiftDay(DASH_DATE, -1, setDate);
  body.querySelector('#nextDay').onclick = () => shiftDay(DASH_DATE, 1, setDate);
  body.querySelector('#terrSel').onchange = e => { DASH_TERR = e.target.value; renderDashboard(body); };
  body.querySelectorAll('tr.clickable').forEach(tr => tr.onclick = () => tr.dataset.sub && openSubmission(tr.dataset.sub));
}
function shiftDay(from, n, cb) {
  const d = new Date(from + 'T12:00:00'); d.setDate(d.getDate() + n);
  cb(d.toISOString().slice(0, 10));
}

async function openSubmission(id) {
  const s = await api('/api/submissions/' + id);
  const rows = s.responses.map(r => {
    let a = '—';
    if (r.photo) a = `<img src="/api/photos/${r.photo}" alt="photo">`;
    else if (r.type === 'checkbox') a = r.value === 'yes' ? '✅ Done' : '⬜ Not done';
    else if (r.type === 'yesno') a = r.value === 'yes' ? '👍 Yes' : r.value === 'no' ? '👎 No' : '—';
    else if (r.value) a = esc(r.value) + (r.unit ? ' ' + esc(r.unit) : '');
    const flag = r.flagged ? ' ⚑' : '';
    return `<div class="resp-row ${r.flagged ? 'flagged' : ''}"><div class="q">${esc(r.label)}</div><div class="a">${a}${flag}</div></div>`;
  }).join('');
  modal(`
    <h2>${s.emoji} ${esc(s.checklist_name)}</h2>
    <p style="color:var(--ink-soft);margin:0 0 12px">${esc(s.location_name || '')} · ${esc(s.user_name || 'Unknown')} · ${prettyDate(s.date)}, ${fmtTime(s.completed_at)}</p>
    <div class="card">${rows}</div>`);
}

// ================= SCHEDULE =================
async function renderSchedule(body) {
  const q = SCHED_DATE ? '?date=' + SCHED_DATE : '';
  const [{ date, shifts }, sq, users, carts] = await Promise.all([
    api('/api/shifts' + q), api('/api/square'), api('/api/users'), api('/api/locations')]);
  SCHED_DATE = date;
  const isAdmin = rank(ME) === 2;

  const rows = shifts.map(s => `
    <div class="mrow">
      <div style="font-size:22px">${s.source === 'square' ? '⬛' : s.source === 'pickup' ? '⚡' : '✍️'}</div>
      <div class="info"><b>${esc(s.user_name)} — ${s.cart_name ? esc(s.cart_name) : '<span style="color:var(--red)">❓ no cart matched</span>'}</b>
        <span>${fmtTime(s.start_at)} – ${fmtTime(s.end_at)} · ${s.source === 'square' ? 'From Square' : s.source === 'pickup' ? 'Picked up in app' : 'Manual'}${s.notes && s.source === 'square' ? ' · “' + esc(s.notes) + '”' : ''}</span></div>
      ${s.source !== 'square' ? `<button class="btn danger small" data-del="${s.id}">Remove</button>` : ''}
    </div>`).join('');

  body.innerHTML = `
    <div class="settings-box">
      <h3>⬛ Square connection</h3>
      <p style="margin:4px 0 10px;font-size:14px;color:var(--ink-soft)">
        Shifts sync automatically every 10 minutes from Square Shifts.
        <b>Put the cart name in each shift's notes</b> so the right cart gets matched. Team members match by email.</p>
      <div style="font-size:14px;margin-bottom:10px">
        Status: ${sq.connected ? `<span class="status-ok">Connected (${sq.token_preview})</span>` : '<span class="status-bad">Not connected</span>'}
        ${sq.last_sync ? ` · Last sync ${ago(sq.last_sync)}` : ''}
        ${sq.last_error ? ` · <span class="status-bad">Error: ${esc(sq.last_error)}</span>` : ''}
        ${sq.connected ? ` · ${sq.matched_users} users matched` : ''}
      </div>
      <div class="row">
        ${isAdmin ? `
        <div style="flex:3"><input id="sqToken" type="password" placeholder="Paste Square access token"></div>
        <div style="flex:0 0 auto"><button class="btn small" id="saveToken">Save token</button></div>` : ''}
        <div style="flex:0 0 auto"><button class="btn teal small" id="syncNow">🔄 Sync now</button></div>
        ${isAdmin ? `<div style="flex:0 0 auto"><button class="btn small" id="importTeam">👥 Import team from Square</button></div>` : ''}
      </div>
      ${isAdmin ? `<div class="row" style="margin-top:8px">
        <div style="flex:0 0 auto"><a class="btn ghost small" href="/api/backup" download style="text-decoration:none;display:inline-block">⬇️ Download backup</a></div>
        <div style="flex:0 0 auto"><button class="btn ghost small" id="restoreBtn">⬆️ Restore backup</button>
          <input type="file" id="restoreFile" accept=".json" hidden></div>
      </div>` : ''}
    </div>
    <div class="datebar">
      <button class="btn ghost small" id="prevDay">◀</button>
      <input type="date" id="schedDate" value="${date}">
      <button class="btn ghost small" id="nextDay">▶</button>
      <h2>${prettyDate(date)}</h2>
      <div class="spacer"></div>
      <button class="btn" id="addShift">+ Add shift manually</button>
    </div>
    ${rows || '<div class="empty"><div class="big">🗓️</div>No shifts this day. Sync Square or add one manually.</div>'}
  `;
  const setDate = d => { SCHED_DATE = d; renderSchedule(body); };
  body.querySelector('#schedDate').onchange = e => setDate(e.target.value);
  body.querySelector('#prevDay').onclick = () => shiftDay(SCHED_DATE, -1, setDate);
  body.querySelector('#nextDay').onclick = () => shiftDay(SCHED_DATE, 1, setDate);
  if (isAdmin) {
    const rBtn = body.querySelector('#restoreBtn'), rFile = body.querySelector('#restoreFile');
    rBtn.onclick = () => rFile.click();
    rFile.onchange = async () => {
      if (!rFile.files[0]) return;
      if (!confirm('Restore this backup? It REPLACES all current data (users, checklists, history). Photos are not included in backups.')) { rFile.value = ''; return; }
      try {
        const text = await rFile.files[0].text();
        await api('/api/restore', { method: 'POST', body: text, headers: { 'Content-Type': 'application/json' } });
        toast('Backup restored 🍭');
        setTimeout(() => location.reload(), 800);
      } catch (e) { toast(e.message, true); }
      rFile.value = '';
    };
    body.querySelector('#saveToken').onclick = async () => {
      const token = body.querySelector('#sqToken').value.trim();
      if (!token) return toast('Paste a token first', true);
      await api('/api/square', { method: 'PUT', json: { token } });
      toast('Token saved'); renderSchedule(body);
    };
    body.querySelector('#importTeam').onclick = async () => {
      if (!confirm('Import all active Square team members? New accounts get temp passwords shown once — save them!')) return;
      toast('Importing…');
      try {
        const r = await api('/api/square/import-team', { method: 'POST' });
        const createdRows = r.created.map(u => `
          <tr><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td>${esc(u.job_role || '—')}</td>
          <td><code style="background:#fff3d1;padding:2px 8px;border-radius:6px;font-weight:800">${esc(u.temp_password)}</code></td></tr>`).join('');
        const skippedRows = r.skipped.map(s => `<li>${esc(s.name)} — ${esc(s.reason)}</li>`).join('');
        modal(`
          <h2>👥 Square team import</h2>
          <p style="font-size:14px;color:var(--ink-soft)">${r.created.length} created · ${r.linked.length} already had accounts (linked) · ${r.skipped.length} skipped</p>
          ${r.created.length ? `
            <p style="font-weight:800;color:var(--red)">⚠️ Temp passwords are shown ONCE — copy them now and share with each person.</p>
            <table class="grid"><tr><th>Name</th><th>Email</th><th>Role</th><th>Temp password</th></tr>${createdRows}</table>` : ''}
          ${skippedRows ? `<p style="font-weight:700;margin-bottom:4px">Skipped (fix in Square, then re-import):</p><ul style="font-size:14px;color:var(--ink-soft)">${skippedRows}</ul>` : ''}
        `);
        renderSchedule(body);
      } catch (e) { toast(e.message, true); }
    };
  }
  body.querySelector('#syncNow').onclick = async () => {
    toast('Syncing…');
    try { const r = await api('/api/square/sync', { method: 'POST' }); toast(`Synced ✓ (${r.matched} team members matched)`); }
    catch (e) { toast(e.message, true); }
    renderSchedule(body);
  };
  body.querySelector('#addShift').onclick = () => {
    const bg = modal(`
      <h2>Add shift</h2>
      <label>Teammate</label><select id="shUser">${users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
      <label>Cart</label><select id="shCart"><option value="">— none —</option>${carts.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <div class="row">
        <div><label>Starts</label><input type="datetime-local" id="shStart" value="${date}T12:00"></div>
        <div><label>Ends</label><input type="datetime-local" id="shEnd" value="${date}T20:00"></div>
      </div>
      <button class="btn teal" id="saveShift" style="width:100%;margin-top:16px">Add shift</button>`);
    bg.querySelector('#saveShift').onclick = async () => {
      try {
        await api('/api/shifts', {
          method: 'POST', json: {
            user_id: Number(bg.querySelector('#shUser').value),
            cart_id: Number(bg.querySelector('#shCart').value) || null,
            start_at: new Date(bg.querySelector('#shStart').value).toISOString(),
            end_at: new Date(bg.querySelector('#shEnd').value).toISOString(),
          }
        });
        bg.remove(); toast('Shift added 🍭'); renderSchedule(body);
      } catch (e) { toast(e.message, true); }
    };
  };
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this shift (and its pending checklists)?')) return;
    await api('/api/shifts/' + b.dataset.del, { method: 'DELETE' });
    toast('Shift removed'); renderSchedule(body);
  });
}

// ================= CHECKLISTS (admin) =================
async function renderChecklistAdmin(body) {
  const [lists, carts, cats] = await Promise.all([api('/api/checklists'), api('/api/locations'), api('/api/categories')]);
  const trigLabel = { opening: '☀️ Opening (start of shift)', closing: '🌙 Closing (30 min before end)', daily: '📅 Daily schedule' };
  body.innerHTML = `
    <div class="section-head"><h2>Checklists</h2><div class="spacer"></div>
      <button class="btn" id="newCl">+ New checklist</button></div>
    ${lists.map(c => `
      <div class="mrow">
        <div style="font-size:26px">${c.emoji}</div>
        <div class="info"><b>${esc(c.name)}</b>
          <span>${trigLabel[c.trigger] || c.trigger} ·
          ${c.location_id ? esc(c.location_name) : c.category_id ? esc(c.category_name) + ' (category)' : 'All carts'} ·
          ${c.job_role ? esc(c.job_role) : 'All roles'}${c.trigger === 'daily' ? ' · ' + (c.days.split(',').length === 7 ? 'Daily' : c.days.split(',').map(d => DAY_NAMES[d]).join(', ')) + (c.due_time ? ' · due ' + c.due_time : '') : ''} · ${c.items.length} items</span></div>
        <button class="btn ghost small" data-edit="${c.id}">Edit</button>
        <button class="btn danger small" data-del="${c.id}">Delete</button>
      </div>`).join('') || '<div class="empty"><div class="big">📋</div>No checklists yet — create your first!</div>'}
  `;
  body.querySelector('#newCl').onclick = () => checklistBuilder(null, carts, cats, () => renderChecklistAdmin(body));
  body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
    checklistBuilder(lists.find(c => c.id == b.dataset.edit), carts, cats, () => renderChecklistAdmin(body)));
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this checklist? Past submissions are kept.')) return;
    await api('/api/checklists/' + b.dataset.del, { method: 'DELETE' });
    toast('Checklist deleted'); renderChecklistAdmin(body);
  });
}

function checklistBuilder(cl, carts, cats, onSave) {
  const items = cl ? cl.items.map(i => ({ ...i })) : [{ type: 'checkbox', label: '', required: 1 }];
  let days = (cl ? cl.days : '0,1,2,3,4,5,6').split(',');
  let trigger = cl ? cl.trigger : 'opening';

  const bg = modal(`
    <h2>${cl ? 'Edit' : 'New'} checklist</h2>
    <div class="row">
      <div style="flex:0 0 70px"><label>Emoji</label><input id="clEmoji" value="${esc(cl?.emoji || '📋')}" maxlength="4"></div>
      <div style="flex:3"><label>Name</label><input id="clName" value="${esc(cl?.name || '')}" placeholder="e.g. Cart Opening Checklist"></div>
    </div>
    <label>Description</label><input id="clDesc" value="${esc(cl?.description || '')}" placeholder="Shown to the team under the title">
    <label>When does it pop up?</label>
    <select id="clTrigger">
      <option value="opening" ${trigger === 'opening' ? 'selected' : ''}>☀️ Opening — at the start of each shift</option>
      <option value="closing" ${trigger === 'closing' ? 'selected' : ''}>🌙 Closing — 30 minutes before shift ends</option>
      <option value="daily" ${trigger === 'daily' ? 'selected' : ''}>📅 Daily — on a fixed schedule</option>
    </select>
    <div class="row">
      <div><label>Cart (specific)</label><select id="clLoc"><option value="">Any cart</option>
        ${carts.map(l => `<option value="${l.id}" ${cl?.location_id === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
      <div><label>…or category</label><select id="clCat"><option value="">Any category</option>
        ${cats.map(c => `<option value="${c.id}" ${cl?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div><label>Role (blank = everyone)</label><input id="clRole" value="${esc(cl?.job_role || '')}" placeholder="e.g. Cart Operator"></div>
    </div>
    <div id="dailyOpts" style="${trigger === 'daily' ? '' : 'display:none'}">
      <div class="row"><div><label>Due by</label><input type="time" id="clDue" value="${cl?.due_time || ''}"></div><div></div></div>
      <label>Days</label>
      <div class="daypick" id="clDays">${DAY_NAMES.map((d, i) =>
        `<button type="button" data-d="${i}" class="${days.includes(String(i)) ? 'on' : ''}">${d}</button>`).join('')}</div>
    </div>
    <label>Items</label>
    <div id="clItems"></div>
    <button class="btn ghost small" id="addItem">+ Add item</button>
    <button class="btn teal" id="saveCl" style="width:100%;margin-top:16px">Save checklist</button>
  `);

  bg.querySelector('#clTrigger').onchange = e => {
    trigger = e.target.value;
    bg.querySelector('#dailyOpts').style.display = trigger === 'daily' ? '' : 'none';
  };

  const itemsEl = bg.querySelector('#clItems');
  function drawItems() {
    itemsEl.innerHTML = items.map((it, i) => `
      <div class="builder-item">
        <div class="drag">≡</div>
        <div class="builder-fields">
          <select data-f="type" data-i="${i}">
            ${['checkbox|Checkbox', 'yesno|Yes / No', 'number|Number', 'text|Text', 'photo|Photo'].map(o => {
              const [v, l] = o.split('|'); return `<option value="${v}" ${it.type === v ? 'selected' : ''}>${l}</option>`;
            }).join('')}
          </select>
          <input class="wide" data-f="label" data-i="${i}" value="${esc(it.label)}" placeholder="Task / question">
          ${it.type === 'number' ? `
            <input data-f="unit" data-i="${i}" value="${esc(it.unit || '')}" placeholder="Unit (°F, ppm…)">
            <input type="number" step="any" data-f="min" data-i="${i}" value="${it.min ?? ''}" placeholder="Min OK">
            <input type="number" step="any" data-f="max" data-i="${i}" value="${it.max ?? ''}" placeholder="Max OK">` : ''}
          <button type="button" class="btn ghost mini" data-req="${i}">${it.required ? 'Required ✓' : 'Optional'}</button>
          <button type="button" class="btn ghost mini" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn ghost mini" data-down="${i}" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="btn danger mini" data-rm="${i}">✕</button>
        </div>
      </div>`).join('');
    itemsEl.querySelectorAll('[data-f]').forEach(el => el.onchange = () => {
      const it = items[el.dataset.i];
      it[el.dataset.f] = el.value === '' ? null : (el.dataset.f === 'min' || el.dataset.f === 'max' ? Number(el.value) : el.value);
      if (el.dataset.f === 'type') drawItems();
    });
    itemsEl.querySelectorAll('[data-req]').forEach(el => el.onclick = () => { const it = items[el.dataset.req]; it.required = it.required ? 0 : 1; drawItems(); });
    itemsEl.querySelectorAll('[data-rm]').forEach(el => el.onclick = () => { items.splice(el.dataset.rm, 1); drawItems(); });
    itemsEl.querySelectorAll('[data-up]').forEach(el => el.onclick = () => { const i = +el.dataset.up; [items[i - 1], items[i]] = [items[i], items[i - 1]]; drawItems(); });
    itemsEl.querySelectorAll('[data-down]').forEach(el => el.onclick = () => { const i = +el.dataset.down; [items[i + 1], items[i]] = [items[i], items[i + 1]]; drawItems(); });
  }
  drawItems();
  bg.querySelector('#addItem').onclick = () => { items.push({ type: 'checkbox', label: '', required: 1 }); drawItems(); };
  bg.querySelector('#clDays').querySelectorAll('button').forEach(b => b.onclick = () => {
    b.classList.toggle('on');
    days = [...bg.querySelectorAll('#clDays .on')].map(x => x.dataset.d);
  });

  bg.querySelector('#saveCl').onclick = async () => {
    const payload = {
      name: bg.querySelector('#clName').value.trim(),
      emoji: bg.querySelector('#clEmoji').value.trim() || '📋',
      description: bg.querySelector('#clDesc').value.trim() || null,
      trigger,
      location_id: Number(bg.querySelector('#clLoc').value) || null,
      category_id: Number(bg.querySelector('#clCat').value) || null,
      job_role: bg.querySelector('#clRole').value.trim() || null,
      due_time: trigger === 'daily' ? (bg.querySelector('#clDue').value || null) : null,
      days: trigger === 'daily' ? days.sort().join(',') : '0,1,2,3,4,5,6',
      items: items.filter(i => i.label && String(i.label).trim()),
    };
    if (!payload.name) return toast('Give it a name', true);
    if (!payload.items.length) return toast('Add at least one item', true);
    if (trigger === 'daily' && !days.length) return toast('Pick at least one day', true);
    try {
      await api(cl ? '/api/checklists/' + cl.id : '/api/checklists', { method: cl ? 'PUT' : 'POST', json: payload });
      bg.remove(); toast('Checklist saved 🍭'); onSave();
    } catch (e) { toast(e.message, true); }
  };
}

// ================= CARTS & TERRITORIES (admin) =================
async function renderCarts(body) {
  const [carts, cats, users, terrs] = await Promise.all([
    api('/api/locations'), api('/api/categories'), api('/api/users'), api('/api/territories')]);
  function cartRow(c) {
    return `<div class="mrow">
      <div style="font-size:22px">🛒</div>
      <div class="info"><b>${esc(c.name)}</b>
        <span>${c.territory_name ? '🗺️ ' + esc(c.territory_name) + ' · ' : '<span style="color:var(--red)">🗺️ no territory · </span>'}🔔 ${c.notifier_names.length ? c.notifier_names.map(esc).join(', ') : 'territory manager only'}</span></div>
      <button class="btn ghost small" data-edit="${c.id}">Edit</button>
      <button class="btn danger small" data-del="${c.id}">Remove</button>
    </div>`;
  }
  const groups = cats.map(cat => {
    const rows = carts.filter(c => c.category_id === cat.id).map(cartRow).join('');
    return `<div class="cat-head"><h3>${esc(cat.name)}</h3>
      <button class="btn ghost mini" data-rencat="${cat.id}" data-name="${esc(cat.name)}">rename</button>
      <button class="btn ghost mini" data-delcat="${cat.id}">✕</button></div>${rows || '<div class="empty" style="padding:10px">No carts here yet</div>'}`;
  }).join('');
  const uncat = carts.filter(c => !c.category_id).map(cartRow).join('');
  const terrRows = terrs.map(t => `
    <div class="mrow">
      <div style="font-size:22px">🗺️</div>
      <div class="info"><b>${esc(t.name)}</b>
        <span>${t.cart_count} carts · Managers: ${t.manager_names.length ? t.manager_names.map(esc).join(', ') : '<span style="color:var(--red)">none assigned</span>'}</span></div>
      <button class="btn ghost small" data-renterr="${t.id}" data-name="${esc(t.name)}">Rename</button>
      <button class="btn danger small" data-delterr="${t.id}">Remove</button>
    </div>`).join('');

  body.innerHTML = `
    <div class="section-head"><h2>Territories</h2><div class="spacer"></div>
      <button class="btn" id="newTerr">+ Add territory</button></div>
    <p style="color:var(--ink-soft);font-size:14px;margin:0 0 6px">Assign managers to territories in the Team tab. Managers are automatically alerted when checklists in their territory go overdue, and each territory gets its own chat channel.</p>
    ${terrRows || '<div class="empty">No territories yet.</div>'}
    <div class="section-head" style="margin-top:26px"><h2>Carts & Spots</h2><div class="spacer"></div>
      <button class="btn ghost small" id="newCat">+ Category</button>
      <button class="btn" id="newCart">+ Add cart</button></div>
    <p style="color:var(--ink-soft);font-size:14px;margin:0 0 6px">Cart names should match what you write in Square shift notes. Extra notifiers (beyond the territory manager) can be set per cart.</p>
    ${groups}
    ${uncat ? `<div class="cat-head"><h3>Uncategorized</h3></div>${uncat}` : ''}
  `;
  const refresh = () => renderCarts(body);
  body.querySelector('#newTerr').onclick = async () => {
    const name = prompt('New territory name (e.g. "Atlanta — East")');
    if (!name) return;
    await api('/api/territories', { method: 'POST', json: { name } });
    toast('Territory added (chat channel created too)'); refresh();
  };
  body.querySelectorAll('[data-renterr]').forEach(b => b.onclick = async () => {
    const name = prompt('Rename territory', b.dataset.name);
    if (!name) return;
    await api('/api/territories/' + b.dataset.renterr, { method: 'PUT', json: { name } });
    refresh();
  });
  body.querySelectorAll('[data-delterr]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this territory? Its carts stay but lose the territory; its chat channel is deleted.')) return;
    await api('/api/territories/' + b.dataset.delterr, { method: 'DELETE' });
    toast('Territory removed'); refresh();
  });
  body.querySelector('#newCart').onclick = () => cartForm(null, cats, users, terrs, refresh);
  body.querySelector('#newCat').onclick = async () => {
    const name = prompt('New category name');
    if (!name) return;
    await api('/api/categories', { method: 'POST', json: { name } });
    toast('Category added'); refresh();
  };
  body.querySelectorAll('[data-rencat]').forEach(b => b.onclick = async () => {
    const name = prompt('Rename category', b.dataset.name);
    if (!name) return;
    await api('/api/categories/' + b.dataset.rencat, { method: 'PUT', json: { name } });
    refresh();
  });
  body.querySelectorAll('[data-delcat]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this category?')) return;
    try { await api('/api/categories/' + b.dataset.delcat, { method: 'DELETE' }); refresh(); }
    catch (e) { toast(e.message, true); }
  });
  body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
    cartForm(carts.find(c => c.id == b.dataset.edit), cats, users, terrs, refresh));
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this cart?')) return;
    await api('/api/locations/' + b.dataset.del, { method: 'DELETE' });
    toast('Cart removed'); refresh();
  });
}

function cartForm(cart, cats, users, terrs, onSave) {
  const notifiers = new Set(cart ? cart.notifier_ids : []);
  const bg = modal(`
    <h2>${cart ? 'Edit' : 'Add'} cart</h2>
    <label>Name (must match Square shift notes)</label><input id="ctName" value="${esc(cart?.name || '')}" placeholder="e.g. Piedmont Park">
    <div class="row">
      <div><label>Category</label><select id="ctCat"><option value="">— none —</option>
        ${cats.map(c => `<option value="${c.id}" ${cart?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div><label>Territory</label><select id="ctTerr"><option value="">— none —</option>
        ${terrs.map(t => `<option value="${t.id}" ${cart?.territory_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
    </div>
    <label>🔔 Extra notifiers (territory managers are alerted automatically)</label>
    <div class="card" style="padding:10px 14px;max-height:220px;overflow-y:auto">
      ${users.map(u => `<label class="checkline"><input type="checkbox" data-notif="${u.id}" ${notifiers.has(u.id) ? 'checked' : ''}> ${esc(u.name)} ${u.level === 'admin' ? '👑' : u.level === 'manager' ? '🧭' : ''}</label>`).join('')}
    </div>
    <button class="btn teal" id="saveCart" style="width:100%;margin-top:16px">Save cart</button>
  `);
  bg.querySelector('#saveCart').onclick = async () => {
    const payload = {
      name: bg.querySelector('#ctName').value.trim(),
      category_id: Number(bg.querySelector('#ctCat').value) || null,
      territory_id: Number(bg.querySelector('#ctTerr').value) || null,
      notifier_ids: [...bg.querySelectorAll('[data-notif]:checked')].map(el => Number(el.dataset.notif)),
    };
    if (!payload.name) return toast('Give it a name', true);
    try {
      await api(cart ? '/api/locations/' + cart.id : '/api/locations', { method: cart ? 'PUT' : 'POST', json: payload });
      bg.remove(); toast('Cart saved 🍭'); onSave();
    } catch (e) { toast(e.message, true); }
  };
}

// ================= TEAM =================
async function renderUsers(body) {
  const [users, carts, terrs] = await Promise.all([api('/api/users'), api('/api/locations'), api('/api/territories')]);
  const canEdit = u => rank(ME) === 2 || (u.id === ME.id) || rank(u) < rank(ME);
  body.innerHTML = `
    <div class="section-head"><h2>Team</h2><div class="spacer"></div>
      <button class="btn" id="newUser">+ Add teammate</button></div>
    <p style="color:var(--ink-soft);font-size:14px;margin:0 0 6px">Use each person's <b>Square email</b> so their shifts sync automatically.${rank(ME) === 1 ? ' As a manager you can add and manage Slingers.' : ''}</p>
    ${users.map(u => `
      <div class="mrow">
        <div style="font-size:24px">${u.level === 'admin' ? '👑' : u.level === 'manager' ? '🧭' : '🍭'}</div>
        <div class="info"><b>${esc(u.name)}</b>
          <span>${esc(u.email)} · ${LEVELS[u.level]}${u.job_role ? ' · ' + esc(u.job_role) : ''}${u.territory_name ? ' · 🗺️ ' + esc(u.territory_name) : ''}${u.location_name ? ' · ' + esc(u.location_name) : ''}${u.square_team_member_id ? ' · ⬛' : ''}</span></div>
        ${canEdit(u) ? `<button class="btn ghost small" data-edit="${u.id}">Edit</button>` : ''}
        ${u.id !== ME.id && canEdit(u) ? `<button class="btn danger small" data-del="${u.id}">Remove</button>` : ''}
      </div>`).join('')}
  `;
  body.querySelector('#newUser').onclick = () => userForm(null, carts, terrs, () => renderUsers(body));
  body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
    userForm(users.find(u => u.id == b.dataset.edit), carts, terrs, () => renderUsers(body)));
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this teammate? Their history is kept.')) return;
    try {
      await api('/api/users/' + b.dataset.del, { method: 'DELETE' });
      toast('Teammate removed'); renderUsers(body);
    } catch (e) { toast(e.message, true); }
  });
}

function userForm(u, carts, terrs, onSave) {
  const isAdmin = rank(ME) === 2;
  const levelField = isAdmin ? `
    <label>Level</label>
    <select id="uLevel">
      <option value="slinger" ${(!u || u.level === 'slinger') ? 'selected' : ''}>🍭 Slinger — completes checklists</option>
      <option value="manager" ${u?.level === 'manager' ? 'selected' : ''}>🧭 Manager — runs a territory, manages Slingers</option>
      <option value="admin" ${u?.level === 'admin' ? 'selected' : ''}>👑 Admin — full control</option>
    </select>` : `<input type="hidden" id="uLevel" value="slinger">`;
  const bg = modal(`
    <h2>${u ? 'Edit' : 'Add'} teammate</h2>
    <label>Name</label><input id="uName" value="${esc(u?.name || '')}">
    <label>Email (used to sign in + match Square)</label><input id="uEmail" type="email" value="${esc(u?.email || '')}">
    <label>${u ? 'New password (leave blank to keep)' : 'Password'}</label>
    <input id="uPass" type="text" placeholder="6+ characters">
    ${levelField}
    <div id="terrWrap" style="display:none">
      <label>🗺️ Responsible for territory</label>
      <select id="uTerr"><option value="">— none —</option>
        ${terrs.map(t => `<option value="${t.id}" ${u?.territory_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
    </div>
    <div class="row">
      <div><label>Job role (matches checklist role filters)</label><input id="uRole" value="${esc(u?.job_role || '')}" placeholder="e.g. Cart Operator"></div>
      <div><label>Home spot (for daily checklists)</label><select id="uLoc"><option value="">None</option>
        ${carts.map(l => `<option value="${l.id}" ${u?.location_id === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
    </div>
    <button class="btn teal" id="saveUser" style="width:100%;margin-top:16px">Save teammate</button>
  `);
  const levelSel = bg.querySelector('#uLevel');
  const syncTerr = () => bg.querySelector('#terrWrap').style.display = levelSel.value === 'manager' ? '' : 'none';
  if (isAdmin) { levelSel.onchange = syncTerr; syncTerr(); }
  bg.querySelector('#saveUser').onclick = async () => {
    const payload = {
      name: bg.querySelector('#uName').value.trim(),
      email: bg.querySelector('#uEmail').value.trim(),
      level: levelSel.value,
      job_role: bg.querySelector('#uRole').value.trim() || null,
      location_id: Number(bg.querySelector('#uLoc').value) || null,
      territory_id: levelSel.value === 'manager' ? (Number(bg.querySelector('#uTerr').value) || null) : null,
    };
    const pass = bg.querySelector('#uPass').value;
    if (pass) payload.password = pass;
    try {
      await api(u ? '/api/users/' + u.id : '/api/users', { method: u ? 'PUT' : 'POST', json: payload });
      bg.remove(); toast('Teammate saved 🍭'); onSave();
    } catch (e) { toast(e.message, true); }
  };
}

// ================= CHAT =================
async function renderChat(body) {
  const channels = await api('/api/chat/channels');
  if (!CHAT_CHANNEL || !channels.some(c => c.id === CHAT_CHANNEL)) CHAT_CHANNEL = channels[0] ? channels[0].id : null;
  body.innerHTML = `
    <div class="chat-wrap">
      <div class="chat-chips" id="chatChips"></div>
      <div class="chat-box card">
        <div class="chat-msgs" id="chatMsgs"><div class="empty">Loading…</div></div>
        <div class="chat-input">
          <button class="btn ghost small" id="attachBtn" title="Attach a file">📎</button>
          <input type="file" id="attachFile" hidden>
          <input id="msgText" placeholder="Message…" autocomplete="off">
          <button class="btn small" id="sendBtn">Send</button>
        </div>
        <div id="attachPreview" style="display:none;padding:6px 12px;font-size:13px;color:var(--ink-soft)"></div>
      </div>
    </div>`;

  const chipsEl = body.querySelector('#chatChips');
  const msgsEl = body.querySelector('#chatMsgs');
  let pendingFile = null;

  function drawChips(chans) {
    chipsEl.innerHTML = chans.map(c => `
      <button class="chip ${c.id === CHAT_CHANNEL ? 'active' : ''}" data-ch="${c.id}">
        ${c.type === 'dm' ? '👤' : '#'} ${esc(c.name)}${c.unread ? ` <span class="chip-dot">${c.unread}</span>` : ''}
      </button>`).join('') + `<button class="chip" id="newDm">+ DM</button>`;
    chipsEl.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => {
      CHAT_CHANNEL = Number(b.dataset.ch); CHAT_LAST_ID = 0;
      msgsEl.innerHTML = '<div class="empty">Loading…</div>';
      drawChips(chans); loadMessages(true);
    });
    chipsEl.querySelector('#newDm').onclick = async () => {
      const list = await api('/api/chat/people');
      const bg = modal(`<h2>New direct message</h2>
        ${list.map(x => `<div class="mrow" style="cursor:pointer" data-u="${x.id}"><div style="font-size:20px">${x.level === 'admin' ? '👑' : x.level === 'manager' ? '🧭' : '🍭'}</div><div class="info"><b>${esc(x.name)}</b></div></div>`).join('')}`);
      bg.querySelectorAll('[data-u]').forEach(row => row.onclick = async () => {
        const ch = await api('/api/chat/dm', { method: 'POST', json: { user_id: Number(row.dataset.u) } });
        bg.remove(); CHAT_CHANNEL = ch.id; CHAT_LAST_ID = 0; renderChat(body);
      });
    };
  }
  drawChips(channels);

  function msgHtml(m) {
    let fileHtml = '';
    if (m.file) {
      if ((m.file_type || '').startsWith('image/'))
        fileHtml = `<a href="/api/photos/${m.file}" target="_blank"><img class="chat-img" src="/api/photos/${m.file}"></a>`;
      else
        fileHtml = `<a class="chat-file" href="/api/files/${m.file}?name=${encodeURIComponent(m.file_name || 'file')}" target="_blank">📄 ${esc(m.file_name || 'Download file')}</a>`;
    }
    return `<div class="chat-msg ${m.mine ? 'mine' : ''}">
      <div class="chat-meta">${esc(m.user_name)} · ${fmtTime(m.created_at)}</div>
      ${m.text ? `<div class="chat-text">${esc(m.text)}</div>` : ''}${fileHtml}
    </div>`;
  }
  async function loadMessages(scroll) {
    if (!CHAT_CHANNEL) return;
    try {
      const { messages } = await api(`/api/chat/messages?channel_id=${CHAT_CHANNEL}&after=${CHAT_LAST_ID}`);
      if (!CHAT_LAST_ID) msgsEl.innerHTML = '';
      if (messages.length) {
        msgsEl.querySelector('.empty')?.remove();
        msgsEl.insertAdjacentHTML('beforeend', messages.map(msgHtml).join(''));
        CHAT_LAST_ID = messages[messages.length - 1].id;
        msgsEl.scrollTop = msgsEl.scrollHeight;
      } else if (!msgsEl.children.length) {
        msgsEl.innerHTML = '<div class="empty">No messages yet — say hi! 👋</div>';
      }
      if (scroll) msgsEl.scrollTop = msgsEl.scrollHeight;
    } catch { }
  }
  await loadMessages(true);
  clearInterval(CHAT_TIMER);
  CHAT_TIMER = setInterval(() => { if (TAB === 'chat') loadMessages(); }, 4000);

  const fileInput = body.querySelector('#attachFile');
  const preview = body.querySelector('#attachPreview');
  body.querySelector('#attachBtn').onclick = () => fileInput.click();
  fileInput.onchange = () => {
    pendingFile = fileInput.files[0] || null;
    preview.style.display = pendingFile ? '' : 'none';
    if (pendingFile) preview.innerHTML = `📎 ${esc(pendingFile.name)} <button class="btn ghost mini" id="clearFile">✕</button>`;
    const cf = preview.querySelector('#clearFile');
    if (cf) cf.onclick = () => { pendingFile = null; fileInput.value = ''; preview.style.display = 'none'; };
  };
  async function sendMsg() {
    const input = body.querySelector('#msgText');
    const text = input.value.trim();
    if (!text && !pendingFile) return;
    const payload = { channel_id: CHAT_CHANNEL, text };
    try {
      if (pendingFile) {
        payload.file_name = pendingFile.name;
        payload.file = pendingFile.type.startsWith('image/')
          ? await compressImage(pendingFile) : await readFileAsDataURL(pendingFile);
      }
      input.value = ''; pendingFile = null; fileInput.value = ''; preview.style.display = 'none';
      await api('/api/chat/messages', { method: 'POST', json: payload });
      loadMessages(true);
    } catch (e) { toast(e.message, true); }
  }
  body.querySelector('#sendBtn').onclick = sendMsg;
  body.querySelector('#msgText').onkeydown = e => { if (e.key === 'Enter') sendMsg(); };
}

// ---------- boot ----------
(async () => {
  registerSW();
  try {
    const { user } = await api('/api/me');
    ME = user;
  } catch { }
  if (ME) shell(); else renderLogin();
  setInterval(refreshBell, 60000);
})();
