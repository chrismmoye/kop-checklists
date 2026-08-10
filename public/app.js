/* King of Pops · Operations Checklists v3 */
const $app = document.getElementById('app');
let ME = null;
let TAB = null;
let DASH_DATE = null, DASH_TERR = undefined;
let SCHED_DATE = null;
let UNREAD = 0;
let CHAT_CHANNEL = null, CHAT_LAST_ID = 0, CHAT_TIMER = null;
let PREVIEW = null, REAL_LEVEL = null;

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
  if (rank(ME) === 2) return ['dashboard|📊 Dashboard', 'reports|📈 Reports', 'schedule|🗓️ Schedule', 'checklists|📋 Checklists', 'carts|📍 Spots', 'flavors|🍦 Flavors', 'users|👥 Team', 'chat|💬 Chat', 'opps|✨ Opportunities', 'mytasks|✅ My tasks', 'myschedule|🙋 My shifts'];
  if (rank(ME) === 1) return ['dashboard|📊 Dashboard', 'reports|📈 Reports', 'schedule|🗓️ Schedule', 'checklists|📋 Checklists', 'flavors|🍦 Flavors', 'users|👥 Team', 'chat|💬 Chat', 'opps|✨ Opportunities', 'mytasks|✅ My tasks', 'myschedule|🙋 My shifts'];
  return ['home|🍭 My checklists', 'myschedule|🗓️ My shifts', 'chat|💬 Chat', 'opps|✨ Opportunities'];
}
function shell() {
  clearInterval(CHAT_TIMER);
  const tabs = tabsFor();
  if (!TAB || !tabs.some(t => t.startsWith(TAB + '|'))) TAB = tabs[0].split('|')[0];
  const current = tabs.find(t => t.startsWith(TAB + '|'));
  $app.innerHTML = `
  ${PREVIEW ? `<div class="preview-bar">👁️ Viewing as <b>${esc(PREVIEW)}</b> — <button id="exitPreview">back to admin</button></div>` : ''}
  <div class="rainbow"></div>
  <header class="topbar"><div class="topbar-inner">
    <button class="hamburger" id="menuBtn">☰</button>
    <div class="brand"><img src="/logo.png" alt="King of Pops"><div><small>${esc(current ? current.split('|')[1].replace(/^\S+\s/, '') : 'Ops Checklists')}</small></div></div>
    <div class="spacer"></div>
    <button class="bell" id="bellBtn">🔔${UNREAD ? `<span class="dot">${UNREAD}</span>` : ''}</button>
  </div></header>
  <div class="drawer-bg" id="drawerBg" hidden>
    <nav class="drawer">
      <div class="drawer-head">
        <button class="avatar-btn" id="avatarBtn" title="Change photo">
          ${ME.avatar ? `<img src="/api/photos/${ME.avatar}" alt="">` : `<span class="avatar-fallback">${esc((ME.name || '?').trim()[0].toUpperCase())}</span>`}
          <span class="avatar-edit">✎</span>
        </button>
        <input type="file" id="avatarFile" accept="image/*" hidden>
        <div><b>${esc(ME.name)}</b><span>${LEVELS[ME.level] || ''}</span></div>
      </div>
      ${tabs.map(t => { const [k, l] = t.split('|'); return `<button class="drawer-item ${TAB === k ? 'active' : ''}" data-tab="${k}">${l}</button>`; }).join('')}
      <div class="drawer-foot">
        <button class="drawer-item" id="wasteMenuBtn">🗑️ Log wasted pops</button>
        ${REAL_LEVEL === 'admin' ? `<button class="drawer-item" id="viewAsBtn">👁️ View app as…${PREVIEW ? ` <span class="pill yellow">${PREVIEW}</span>` : ''}</button>` : ''}
        <button class="drawer-item" id="pwBtn">🔑 Change my password</button>
        <button class="drawer-item" id="logoutBtn">🚪 Sign out</button>
      </div>
    </nav>
  </div>
  <div class="container">
    <div id="body"></div>
  </div>`;
  const exitBtn = document.getElementById('exitPreview');
  if (exitBtn) exitBtn.onclick = async () => { await api('/api/preview', { method: 'POST', json: { level: null } }); location.reload(); };
  const drawerBg = document.getElementById('drawerBg');
  document.getElementById('menuBtn').onclick = () => { drawerBg.hidden = false; requestAnimationFrame(() => drawerBg.classList.add('open')); };
  const closeDrawer = () => { drawerBg.classList.remove('open'); setTimeout(() => drawerBg.hidden = true, 200); };
  drawerBg.onclick = e => { if (e.target === drawerBg) closeDrawer(); };
  document.getElementById('logoutBtn').onclick = async () => { await api('/api/logout', { method: 'POST' }); ME = null; renderLogin(); };
  document.getElementById('wasteMenuBtn').onclick = () => { closeDrawer(); wasteModal(null); };
  const viewAsEl = document.getElementById('viewAsBtn');
  if (viewAsEl) viewAsEl.onclick = () => {
    const bg = modal(`<h2>👁️ View the app as…</h2>
      <p style="color:var(--ink-soft);font-size:14px">See exactly what your team sees — menus, permissions and all. Your own account stays admin; switch back any time.</p>
      ${[['', '👑 Admin (me)'], ['manager', '🧭 Manager'], ['slinger', '🍭 Slinger']].map(([v, l]) =>
        `<div class="mrow" style="cursor:pointer" data-view="${v}"><div class="info"><b>${l}</b></div>${(PREVIEW || '') === v ? '<span class="pill green">current</span>' : ''}</div>`).join('')}`);
    bg.querySelectorAll('[data-view]').forEach(row => row.onclick = async () => {
      await api('/api/preview', { method: 'POST', json: { level: row.dataset.view || null } });
      bg.remove();
      location.reload();
    });
  };
  const avFile = document.getElementById('avatarFile');
  document.getElementById('avatarBtn').onclick = () => avFile.click();
  avFile.onchange = async () => {
    if (!avFile.files[0]) return;
    try {
      const image = await compressImage(avFile.files[0], 400, 0.85);
      const r = await api('/api/me/avatar', { method: 'POST', json: { image } });
      ME.avatar = r.avatar;
      toast('Photo updated 📸');
      shell();
    } catch (e) { toast(e.message, true); }
  };
  document.getElementById('pwBtn').onclick = () => {
    const bg = modal(`
      <h2>🔑 Change my password</h2>
      <label>Current password</label><input type="password" id="pwCur" autocomplete="current-password">
      <label>New password</label><input type="password" id="pwNew" placeholder="6+ characters" autocomplete="new-password">
      <label>Confirm new password</label><input type="password" id="pwNew2" autocomplete="new-password">
      <button class="btn teal" id="pwGo" style="width:100%;margin-top:16px">Update password</button>`);
    bg.querySelector('#pwGo').onclick = async () => {
      const cur = bg.querySelector('#pwCur').value, n1 = bg.querySelector('#pwNew').value, n2 = bg.querySelector('#pwNew2').value;
      if (n1 !== n2) return toast("New passwords don't match", true);
      try {
        await api('/api/me/password', { method: 'POST', json: { current: cur, next: n1 } });
        bg.remove(); toast('Password updated 🔑');
      } catch (e) { toast(e.message, true); }
    };
  };
  document.getElementById('bellBtn').onclick = openNotifications;
  document.querySelectorAll('.drawer-item[data-tab]').forEach(b => b.onclick = () => { TAB = b.dataset.tab; shell(); });
  refreshBell();
  const body = document.getElementById('body');
  const views = { dashboard: renderDashboard, reports: renderReports, schedule: renderSchedule, checklists: renderChecklistAdmin, carts: renderCarts, flavors: renderFlavors, users: renderUsers, chat: renderChat, opps: renderOpportunities, mytasks: renderMyTasks, home: renderMyTasks, myschedule: renderMySchedule };
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
      <div id="pwWrap"><label>Password</label><input name="password" type="password" autocomplete="current-password" placeholder="••••••••"></div>
      <button class="btn" id="loginBtn">Let's go 🌈</button>
      <button type="button" class="btn ghost" id="modeBtn" style="width:100%;margin-top:10px">✉️ Email me a sign-in link instead</button>
    </form>
  </div></div>`;
  let linkMode = false;
  const pwWrap = document.getElementById('pwWrap');
  const modeBtn = document.getElementById('modeBtn');
  const loginBtn = document.getElementById('loginBtn');
  modeBtn.onclick = () => {
    linkMode = !linkMode;
    pwWrap.style.display = linkMode ? 'none' : '';
    loginBtn.textContent = linkMode ? '✉️ Send me a sign-in link' : "Let's go 🌈";
    modeBtn.textContent = linkMode ? '🔑 Use my password instead' : '✉️ Email me a sign-in link instead';
  };
  document.getElementById('loginForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      if (linkMode) {
        const r = await api('/api/login/link', { method: 'POST', json: { email: f.get('email') } });
        toast(r.note || 'Check your email 📬');
        return;
      }
      const { user } = await api('/api/login', { method: 'POST', json: { email: f.get('email'), password: f.get('password') } });
      ME = user; REAL_LEVEL = user.level; PREVIEW = null; TAB = null;
      shell();
    } catch (err) { toast(err.message, true); }
  };
}

function flavorCard(plan) {
  if (!plan || !plan.flavors || !plan.flavors.length) return '';
  return `<div class="card ann-card" style="border-left-color:var(--pink)">
    <div class="ann-head"><b>🍦 Flavors to pack — ${esc(plan.spot_name || '')}</b>
      <span style="color:var(--ink-soft);font-size:12px;font-weight:700">${plan.flavors.length} flavors</span></div>
    <div class="flavor-list">
      ${plan.flavors.map(f => `<span class="flavor-chip ${f.in_stock ? '' : 'out'}">${f.emoji || '🍦'} ${esc(f.name)}${f.in_stock ? '' : ' (out of stock)'}</span>`).join('')}
    </div>
    ${plan.flavors.some(f => f.note) ? `<div class="ann-body" style="font-size:13px">${plan.flavors.filter(f => f.note).map(f => `<b>${esc(f.name)}:</b> ${esc(f.note)}`).join('<br>')}</div>` : ''}
  </div>`;
}
async function addChecklistModal(refresh) {
  const [avail, spots] = await Promise.all([api('/api/checklists/available'), api('/api/locations')]);
  if (!avail.length) return toast('No checklists are available for your role', true);
  const bg = modal(`
    <h2>➕ Add a checklist</h2>
    <p style="color:var(--ink-soft);font-size:14px;margin:0 0 8px">Didn't get a checklist that you need? Add it here — it'll be due within the hour.</p>
    <label>Checklist</label>
    <select id="acCl">${avail.map(c => `<option value="${c.id}">${c.emoji || '📋'} ${esc(c.name)}${c.job_role ? ' · ' + esc(c.job_role) : ''}</option>`).join('')}</select>
    <label>Spot (optional)</label>
    <select id="acSpot"><option value="">— none —</option>${spots.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    <button class="btn teal" id="acGo" style="width:100%;margin-top:14px">Add to my day</button>
  `);
  bg.querySelector('#acGo').onclick = async () => {
    try {
      await api('/api/instances/self', { method: 'POST', json: {
        checklist_id: Number(bg.querySelector('#acCl').value),
        cart_id: Number(bg.querySelector('#acSpot').value) || null } });
      bg.remove(); toast('Added to your list 📋'); refresh();
    } catch (e) { toast(e.message, true); }
  };
}
async function assignChecklistModal(refresh) {
  const [avail, users, spots] = await Promise.all([api('/api/checklists/available'), api('/api/users'), api('/api/locations')]);
  const bg = modal(`
    <h2>📋 Assign a checklist</h2>
    <label>Teammate</label>
    <select id="asUser">${users.map(u => `<option value="${u.id}">${esc(u.name)}${u.job_role ? ' · ' + esc(u.job_role) : ''}</option>`).join('')}</select>
    <label>Checklist</label>
    <select id="asCl">${avail.map(c => `<option value="${c.id}">${c.emoji || '📋'} ${esc(c.name)}</option>`).join('')}</select>
    <label>Spot (optional)</label>
    <select id="asSpot"><option value="">— none —</option>${spots.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    <button class="btn teal" id="asGo" style="width:100%;margin-top:14px">Assign</button>
  `);
  bg.querySelector('#asGo').onclick = async () => {
    try {
      await api('/api/instances/assign', { method: 'POST', json: {
        checklist_id: Number(bg.querySelector('#asCl').value),
        user_id: Number(bg.querySelector('#asUser').value),
        cart_id: Number(bg.querySelector('#asSpot').value) || null } });
      bg.remove(); toast('Assigned — they were notified 📋'); refresh();
    } catch (e) { toast(e.message, true); }
  };
}

// ================= SHIFT DETAIL =================
async function openShiftDetail(shiftId, refresh) {
  let s;
  try { s = await api('/api/shifts/' + shiftId); } catch (e) { return toast(e.message, true); }
  const canManage = rank(ME) >= 1;
  const carts = canManage ? await api('/api/locations') : [];
  const feed = s.notes_feed.map(n => {
    let fileHtml = '';
    if (n.file) {
      fileHtml = (n.file_type || '').startsWith('image/')
        ? `<a href="/api/photos/${n.file}" target="_blank"><img src="/api/photos/${n.file}" style="max-width:180px;border-radius:10px;display:block;margin-top:4px"></a>`
        : `<a class="chat-file" href="/api/files/${n.file}?name=${encodeURIComponent(n.file_name || 'file')}" target="_blank">📄 ${esc(n.file_name || 'Download')}</a>`;
    }
    return `<div class="notif-row"><b>${esc(n.user_name)} <span style="color:var(--ink-soft);font-weight:700;font-size:12px">· ${ago(n.created_at)}</span></b>
      ${n.text ? `<span>${esc(n.text)}</span>` : ''}${fileHtml}</div>`;
  }).join('');
  const bg = modal(`
    <h2>🗓️ ${esc(s.user_name)}'s shift</h2>
    <p style="color:var(--ink-soft);margin:0 0 10px">${prettyDate(s.date)} · ${fmtTime(s.start_at)} – ${fmtTime(s.end_at)}
      ${s.territory_name ? ' · 🗺️ ' + esc(s.territory_name) : ''}</p>
    ${canManage ? `
      <label>📍 Spot${s.cart_name ? '' : ' <span style="color:var(--red)">(not set — assign one)</span>'}</label>
      <div class="row">
        <div style="flex:3"><select id="sdCart"><option value="">— none —</option>
          ${carts.map(c => `<option value="${c.id}" ${s.cart_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div style="flex:0 0 auto"><button class="btn small" id="sdSaveCart">Save</button></div>
      </div>
      ${(s.keyword_suggestions || []).length ? `
        <div style="background:var(--cream);border-radius:12px;padding:10px 12px;margin-top:8px">
          <div style="font-size:13px;font-weight:800;color:var(--ink-soft);margin-bottom:6px">🧠 Remember this shift note for the spot above (auto-matches future shifts):</div>
          <select id="sdLearn" style="margin-bottom:0"><option value="">— don't remember anything —</option>
            ${s.keyword_suggestions.map(k => `<option value="${esc(k)}">“${esc(k)}”</option>`).join('')}</select>
        </div>` : ''}`
      : `<p><b>📍 ${s.cart_name ? esc(s.cart_name) : 'Spot: see your checklist'}</b></p>`}
    <label>📌 Shift notes & files</label>
    <div class="card" style="max-height:260px;overflow-y:auto">${feed || '<div class="empty" style="padding:12px">Nothing added yet.</div>'}</div>
    <div class="row" style="margin-top:10px">
      <div style="flex:0 0 auto"><button class="btn ghost small" id="sdAttach">📎</button>
        <input type="file" id="sdFile" hidden></div>
      <div style="flex:3"><input id="sdText" placeholder="Add a note for this shift…"></div>
      <div style="flex:0 0 auto"><button class="btn small" id="sdSend">Add</button></div>
    </div>
    <div id="sdPreview" style="display:none;font-size:13px;color:var(--ink-soft);margin-top:4px"></div>
  `);
  let pendingFile = null;
  const fileInput = bg.querySelector('#sdFile'), preview = bg.querySelector('#sdPreview');
  bg.querySelector('#sdAttach').onclick = () => fileInput.click();
  fileInput.onchange = () => {
    pendingFile = fileInput.files[0] || null;
    preview.style.display = pendingFile ? '' : 'none';
    if (pendingFile) preview.textContent = '📎 ' + pendingFile.name;
  };
  bg.querySelector('#sdSend').onclick = async () => {
    const text = bg.querySelector('#sdText').value.trim();
    if (!text && !pendingFile) return;
    const payload = { text };
    try {
      if (pendingFile) {
        payload.file_name = pendingFile.name;
        payload.file = pendingFile.type.startsWith('image/')
          ? await compressImage(pendingFile) : await readFileAsDataURL(pendingFile);
      }
      await api(`/api/shifts/${s.id}/notes`, { method: 'POST', json: payload });
      bg.remove(); toast('Added to shift 📌');
      openShiftDetail(shiftId, refresh);
    } catch (e) { toast(e.message, true); }
  };
  if (canManage) bg.querySelector('#sdSaveCart').onclick = async () => {
    try {
      const learnEl = bg.querySelector('#sdLearn');
      const payload = { cart_id: Number(bg.querySelector('#sdCart').value) || null };
      if (learnEl && learnEl.value) payload.learn_keyword = learnEl.value;
      await api('/api/shifts/' + s.id, { method: 'PUT', json: payload });
      bg.remove();
      toast(payload.learn_keyword ? 'Saved — I\'ll match that note to this spot from now on 🧠' : 'Spot saved — pending checklists updated 📍');
      refresh();
    } catch (e) { toast(e.message, true); }
  };
}

// ================= ANNOUNCEMENTS =================
function annCard(an, canManage) {
  return `<div class="card ann-card ${an.pinned ? 'pinned' : ''}">
    <div class="ann-head"><b>${an.pinned ? '📌 ' : '📣 '}${esc(an.title)}</b>
      <span style="color:var(--ink-soft);font-size:12px;font-weight:700">${esc(an.author_name)} · ${ago(an.created_at)}</span></div>
    ${an.body ? `<div class="ann-body">${esc(an.body)}</div>` : ''}
    ${canManage ? `<div class="row" style="margin-top:8px">
      <button class="btn ghost mini" data-annpin="${an.id}" data-pinned="${an.pinned}">${an.pinned ? 'Unpin' : 'Pin 📌'}</button>
      <button class="btn danger mini" data-anndel="${an.id}">Delete</button></div>` : ''}
  </div>`;
}
function bindAnnouncements(root, refresh) {
  root.querySelectorAll('[data-anndel]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this announcement?')) return;
    await api('/api/announcements/' + b.dataset.anndel, { method: 'DELETE' });
    refresh();
  });
  root.querySelectorAll('[data-annpin]').forEach(b => b.onclick = async () => {
    await api('/api/announcements/' + b.dataset.annpin, { method: 'PUT', json: { pinned: b.dataset.pinned !== '1' } });
    refresh();
  });
}
function postAnnouncement(refresh) {
  const bg = modal(`
    <h2>📣 New announcement</h2>
    <label>Title</label><input id="anTitle" placeholder="e.g. New flavor launch Friday!">
    <label>Details (optional)</label><textarea id="anBody" rows="4" placeholder="Weekly update, reminders, shout-outs…"></textarea>
    <label class="checkline" style="margin-top:10px"><input type="checkbox" id="anPin"> 📌 Pin to top</label>
    <button class="btn teal" id="anGo" style="width:100%;margin-top:14px">Post announcement</button>`);
  bg.querySelector('#anGo').onclick = async () => {
    try {
      await api('/api/announcements', {
        method: 'POST', json: {
          title: bg.querySelector('#anTitle').value,
          body: bg.querySelector('#anBody').value,
          pinned: bg.querySelector('#anPin').checked,
        }
      });
      bg.remove(); toast('Posted 📣'); refresh();
    } catch (e) { toast(e.message, true); }
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
function clockCard(clock) {
  if (clock.clocked_in) {
    const mins = Math.max(0, Math.round((Date.now() - new Date(clock.clock_in_at)) / 60000));
    const dur = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
    return `<div class="card clock-card on">
      <div><b>🟢 Clocked in</b> — ${dur}
        <div style="color:var(--ink-soft);font-size:13px">
          ${clock.shift && clock.shift.cart_name ? '📍 ' + esc(clock.shift.cart_name) + ' · ' : ''}since ${fmtTime(clock.clock_in_at)}
          ${clock.synced_to_square ? ' · ⬛ on the Square clock' : clock.sync_error ? ` · <span style="color:var(--red)">⚠ not synced: ${esc(clock.sync_error)}</span>` : ''}</div></div>
      <button class="btn danger" id="clockBtn">Clock out</button>
    </div>`;
  }
  return `<div class="card clock-card">
    <div><b>⏱️ Not clocked in</b>
      <div style="color:var(--ink-soft);font-size:13px">${clock.shift ? `Shift ${clock.shift.cart_name ? 'at 📍 ' + esc(clock.shift.cart_name) + ' ' : ''}${fmtTime(clock.shift.start_at)} – ${fmtTime(clock.shift.end_at)}` : 'No scheduled shift right now'}</div></div>
    <button class="btn teal" id="clockBtn">Clock in</button>
  </div>`;
}
async function doClockIn(refresh, details) {
  try {
    const r = await api('/api/clock/in', { method: 'POST', json: details || {} });
    if (r.need_details) {
      const carts = await api('/api/locations');
      const bg = modal(`
        <h2>⏱️ Clock in</h2>
        <p style="color:var(--ink-soft);font-size:14px;margin:0 0 8px">No scheduled shift found right now — tell us where you're working and until when.</p>
        <label>Spot</label>
        <select id="ciCart">${carts.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <label>Shift ends at</label>
        <input type="datetime-local" id="ciEnd" value="${localDT(6 * 60)}">
        <button class="btn teal" id="ciGo" style="width:100%;margin-top:16px">Clock in ✓</button>`);
      bg.querySelector('#ciGo').onclick = async () => {
        const cart_id = Number(bg.querySelector('#ciCart').value);
        const end_at = new Date(bg.querySelector('#ciEnd').value).toISOString();
        bg.remove();
        doClockIn(refresh, { cart_id, end_at });
      };
      return;
    }
    toast(r.sync_error ? 'Clocked in (not synced to Square: ' + r.sync_error + ')' : 'Clocked in — opening checklist is ready ⬛✓');
    refresh();
  } catch (e) { toast(e.message, true); }
}
async function doClockOut(refresh) {
  try {
    const r = await api('/api/clock/out', { method: 'POST' });
    toast(r.sync_error ? 'Clocked out (Square sync issue: ' + r.sync_error + ')' : 'Clocked out — see you next shift! 🍭');
    refresh();
  } catch (e) { toast(e.message, true); refresh(); }
}
function bindClock(body, refresh) {
  const btn = body.querySelector('#clockBtn');
  if (!btn) return;
  btn.onclick = () => btn.textContent.includes('out') ? doClockOut(refresh) : doClockIn(refresh);
}

async function renderMyTasks(body) {
  const [{ date, checklists, instances, shift }, clock, anns] = await Promise.all([
    api('/api/today'), api('/api/clock'), api('/api/announcements').catch(() => [])]);
  const spotForFlavors = (clock.shift && clock.shift.cart_id) || (shift && shift.cart_id) || null;
  const flavorPlan = spotForFlavors ? await api('/api/flavors/plan?spot_id=' + spotForFlavors).catch(() => null) : null;
  const all = [...instances, ...checklists];
  const done = instances.filter(i => i.status === 'complete').length + checklists.filter(c => c.submission).length;
  body.innerHTML = `
    <div class="section-head"><h2>${prettyDate(date)}</h2><div class="spacer"></div>
      <button class="btn ghost small" id="addClBtn">➕ Add a checklist</button>
      <button class="btn ghost small" id="pickupBtn">⚡ Pick up a shift</button>
      <span class="pill ${done === all.length && all.length ? 'green' : 'teal'}">${done}/${all.length} complete</span></div>
    ${clockCard(clock)}
    ${flavorCard(flavorPlan)}
    ${anns.slice(0, 2).map(an => annCard(an, false)).join('')}
    ${taskCards(instances, checklists) || `<div class="empty"><div class="big">🏖️</div>Nothing assigned right now. Clock in or wait for your shift — your opening checklist appears automatically.</div>`}
    <button class="btn ghost" id="wasteBtn" style="width:100%;margin-top:16px">🗑️ Log wasted pops</button>
  `;
  bindTaskCards(body, instances, checklists, () => renderMyTasks(body));
  bindClock(body, () => renderMyTasks(body));
  body.querySelector('#pickupBtn').onclick = () => pickupShift(() => renderMyTasks(body));
  body.querySelector('#addClBtn').onclick = () => addChecklistModal(() => renderMyTasks(body));
  body.querySelector('#wasteBtn').onclick = () => wasteModal(spotForFlavors);
}

async function wasteModal(spotId) {
  const spots = await api('/api/locations').catch(() => []);
  const bg = modal(`
    <h2>🗑️ Wasted pops</h2>
    <label>How many pops are you wasting?</label>
    <input type="number" min="1" step="1" id="wCount" placeholder="e.g. 6">
    <label>Why?</label>
    <div class="choice-list" id="wReason">
      ${['Melted', 'Expired', 'Opened'].map(r => `<button type="button" class="choice" data-r="${r}">${r === 'Melted' ? '🫠' : r === 'Expired' ? '📅' : '📦'} ${r}</button>`).join('')}
    </div>
    <label>Spot</label>
    <select id="wSpot"><option value="">— none —</option>
      ${spots.map(s => `<option value="${s.id}" ${spotId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <button class="btn teal" id="wGo" style="width:100%;margin-top:16px">Log it</button>`);
  let reason = null;
  bg.querySelectorAll('#wReason .choice').forEach(b => b.onclick = () => {
    bg.querySelectorAll('#wReason .choice').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel'); reason = b.dataset.r;
  });
  bg.querySelector('#wGo').onclick = async () => {
    try {
      await api('/api/waste', { method: 'POST', json: {
        count: Number(bg.querySelector('#wCount').value), reason,
        spot_id: Number(bg.querySelector('#wSpot').value) || null } });
      bg.remove(); toast('Logged — thanks for tracking it 🗑️');
    } catch (e) { toast(e.message, true); }
  };
}

// ================= MY SHIFTS =================
async function renderMySchedule(body) {
  const { shifts, open_shifts, clock } = await api('/api/myschedule');
  const byDay = {};
  shifts.forEach(s => { (byDay[s.date] = byDay[s.date] || []).push(s); });
  const shiftRows = Object.keys(byDay).sort().map(d => `
    <div class="subhead">${prettyDate(d)}</div>
    ${byDay[d].map(s => `
      <div class="mrow chat-row" data-shift="${s.id}">
        <div style="font-size:22px">${s.source === 'square' ? '⬛' : s.source === 'pickup' ? '⚡' : '✍️'}</div>
        <div class="info"><b>${s.cart_name ? esc(s.cart_name) : s.territory_name ? '🗺️ ' + esc(s.territory_name) : 'Spot TBD'}${s.note_count ? ` <span class="pill teal">📌 ${s.note_count}</span>` : ''}</b>
          <span>${fmtTime(s.start_at)} – ${fmtTime(s.end_at)}${s.notes && s.source === 'square' ? ' · “' + esc(s.notes) + '”' : ''}</span></div>
      </div>`).join('')}`).join('');

  const openRows = open_shifts.map(o => {
    const when = `${prettyDate(o.date)}, ${fmtTime(o.start_at)} – ${fmtTime(o.end_at)}`;
    let action;
    if (o.my_request === 'pending') action = '<span class="pill yellow">Requested ✋</span>';
    else if (o.my_request === 'approved') action = '<span class="pill green">Approved ✓</span>';
    else if (o.my_request === 'declined') action = '<span class="pill gray">Not this time</span>';
    else action = `<button class="btn teal small" data-req="${o.id}">Request 🙋</button>`;
    return `<div class="mrow">
      <div style="font-size:22px">✨</div>
      <div class="info"><b>${o.cart_name ? esc(o.cart_name) : o.territory_name ? '🗺️ ' + esc(o.territory_name) : 'Spot TBD'}</b>
        <span>${when}${o.request_count ? ` · ${o.request_count} request${o.request_count > 1 ? 's' : ''}` : ''}</span></div>
      ${action}
    </div>`;
  }).join('');

  body.innerHTML = `
    ${clockCard(clock)}
    <div class="section-head" style="margin-top:18px"><h2>🗓️ My upcoming shifts</h2></div>
    ${shiftRows || '<div class="empty">No upcoming shifts on your schedule.</div>'}
    <div class="section-head" style="margin-top:24px"><h2>✨ Open shifts up for grabs</h2></div>
    <p style="color:var(--ink-soft);font-size:14px;margin:0 0 8px">These are published in Square without a person assigned — festivals, extra retail shifts, and more. Request one and your manager will confirm.</p>
    ${openRows || '<div class="empty">No open shifts right now — check back later!</div>'}
  `;
  bindClock(body, () => renderMySchedule(body));
  body.querySelectorAll('[data-shift]').forEach(row => row.onclick = () =>
    openShiftDetail(Number(row.dataset.shift), () => renderMySchedule(body)));
  body.querySelectorAll('[data-req]').forEach(b => b.onclick = async () => {
    try {
      await api('/api/requests', { method: 'POST', json: { open_shift_id: Number(b.dataset.req) } });
      toast('Requested — your manager has been notified 🙋');
      renderMySchedule(body);
    } catch (e) { toast(e.message, true); }
  });
}

async function pickupShift(refresh) {
  const carts = await api('/api/locations');
  const bg = modal(`
    <h2>⚡ Pick up a shift</h2>
    <p style="color:var(--ink-soft);font-size:14px;margin:0 0 8px">Working a shift that isn't assigned to you in the schedule? Pick your spot and when your shift ends — your opening checklist appears right away, and the closing checklist 30 minutes before the end.</p>
    <label>Spot</label>
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
    else if (it.type === 'choice') {
      const opts = String(it.options || '').split(',').map(s => s.trim()).filter(Boolean);
      field = `<div class="choice-list" data-item="${it.id}">${opts.map(o =>
        `<button type="button" class="choice" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
    }
    else if (it.type === 'number')
      field = `<input type="number" step="any" data-item="${it.id}" placeholder="${it.unit ? esc(it.unit) : 'Enter a number'}">`;
    else if (it.type === 'text')
      field = `<textarea rows="2" data-item="${it.id}" placeholder="Type here…"></textarea>`;
    else if (it.type === 'photo')
      field = `<button type="button" class="photo-drop" data-item="${it.id}">📷 Tap to add photo</button>
        <input type="file" accept="image/*" capture="environment" hidden data-file="${it.id}">`;
    const labelHtml = it.type === 'checkbox' ? '' : `<div class="item-label">${esc(it.label)} ${req} ${range}</div>`;
    return `<div class="item-row" data-row="${it.id}"${it.cond_item_id ? ` data-cond-item="${it.cond_item_id}" data-cond-op="${esc(it.cond_op || 'eq')}" data-cond-value="${esc(it.cond_value ?? '')}" style="display:none"` : ''}>${labelHtml}${field}</div>`;
  }).join('');

  const bg = modal(`
    <h2>${c.emoji || '📋'} ${esc(c.name)}</h2>
    <p style="color:var(--ink-soft);margin:0 0 8px">${esc(c.description || '')}</p>
    <div class="card">${rows}</div>
    <button class="btn teal" id="submitCl" style="width:100%;margin-top:16px">Submit checklist ✓</button>
  `);

  const answers = {}, photos = {};
  const rowVisible = (row, depth = 0) => {
    if (!row || !row.dataset.condItem || depth > 20) return true;
    const parent = bg.querySelector(`.item-row[data-row="${row.dataset.condItem}"]`);
    if (parent && !rowVisible(parent, depth + 1)) return false;
    const raw = answers[row.dataset.condItem];
    const op = row.dataset.condOp || 'eq';
    if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
      const n = Number(raw), t = Number(row.dataset.condValue);
      if (raw == null || String(raw).trim() === '' || isNaN(n) || isNaN(t)) return false;
      return op === 'gt' ? n > t : op === 'gte' ? n >= t : op === 'lt' ? n < t : n <= t;
    }
    const x = String(raw ?? '').trim(), y = String(row.dataset.condValue ?? '').trim();
    if (op === 'ne') return x !== '' && x !== y;
    return x === y;
  };
  const updateVisibility = () => {
    // repeat so chains settle
    for (let pass = 0; pass < 3; pass++) {
      bg.querySelectorAll('[data-cond-item]').forEach(row => {
        row.style.display = rowVisible(row) ? '' : 'none';
      });
    }
  };
  bg.querySelectorAll('.checkbig').forEach(b => b.onclick = () => {
    b.classList.toggle('on');
    answers[b.dataset.item] = b.classList.contains('on') ? 'yes' : '';
    updateVisibility();
  });
  bg.querySelectorAll('.choice-row').forEach(row => row.querySelectorAll('.choice').forEach(b => b.onclick = () => {
    row.querySelectorAll('.choice').forEach(x => x.classList.remove('sel-yes', 'sel-no'));
    b.classList.add(b.dataset.v === 'yes' ? 'sel-yes' : 'sel-no');
    answers[row.dataset.item] = b.dataset.v;
    updateVisibility();
  }));
  bg.querySelectorAll('.choice-list').forEach(list => list.querySelectorAll('.choice').forEach(b => b.onclick = () => {
    list.querySelectorAll('.choice').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    answers[list.dataset.item] = b.dataset.v;
    updateVisibility();
  }));
  bg.querySelectorAll('input[type=number],textarea').forEach(el =>
    el.oninput = () => { answers[el.dataset.item] = el.value; updateVisibility(); });
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
  if (DASH_TERR === undefined) DASH_TERR = rank(ME) === 1 && (ME.territory_ids || [])[0] ? ME.territory_ids[0] : '';
  const terrs = await api('/api/territories');
  const params = new URLSearchParams();
  if (DASH_DATE) params.set('date', DASH_DATE);
  if (DASH_TERR) params.set('territory_id', DASH_TERR);
  const trendParams = DASH_TERR ? '&territory_id=' + DASH_TERR : '';
  const [dash, trend, anns, flavorBoard] = await Promise.all([
    api('/api/dashboard?' + params), api('/api/trend?days=7' + trendParams),
    api('/api/announcements').catch(() => []), api('/api/flavors/board').catch(() => null)]);
  DASH_DATE = dash.date;
  const s = dash.summary;

  const stateInfo = {
    live: ['live', 'Open now'], closed_ok: ['ok', 'Closed · all done'], incomplete: ['warn', 'Missing checklists'],
    never_opened: ['bad', 'Never opened'], scheduled: ['sched', 'Scheduled'], idle: ['idle', 'No shift today'],
  };
  const spotRows = dash.board.map(b => {
    const [cls, label] = stateInfo[b.state] || ['idle', '—'];
    const bits = [];
    if (b.workers.length) bits.push(b.workers.map(esc).join(', '));
    if (b.opened_at) bits.push('opened ' + fmtTime(b.opened_at));
    if (b.closed_at) bits.push('closed ' + fmtTime(b.closed_at));
    if (b.photo_count) bits.push('📷 ' + b.photo_count);
    if (b.flags) bits.push('⚑ ' + b.flags);
    return `<div class="spot-line" data-spot="${b.cart_id ?? 'none'}">
      <span class="light ${cls}"></span>
      <div class="spot-name"><b>${esc(b.cart_name)}</b>
        <span>${bits.join(' · ') || label}</span></div>
      <div class="spot-meta">${b.total ? `${b.done}/${b.total}` : ''}</div>
    </div>`;
  }).join('');

  const instPills = { complete: '<span class="pill green">✓ Complete</span>', pending: '<span class="pill yellow">Pending</span>', overdue: '<span class="pill red">Overdue</span>' };
  const instRows = dash.instances.map(i => {
    const flag = i.flags ? ` <span class="pill red">⚑ ${i.flags}</span>` : '';
    return `<tr class="${i.submission_id ? 'clickable' : ''}" data-sub="${i.submission_id || ''}">
      <td>${i.emoji} <b>${esc(i.checklist_name)}</b> <span class="pill ${i.type === 'opening' ? 'teal' : 'purple'}">${i.type}</span></td>
      <td>${esc(i.cart_name || (i.territory_name ? '🗺️ ' + i.territory_name : '—'))}</td>
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
      <button class="btn ghost small" id="assignClBtn">📋 Assign checklist</button>
      <select id="terrSel" style="width:auto">
        <option value="">🗺️ All territories</option>
        ${terrs.map(t => `<option value="${t.id}" ${DASH_TERR == t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="stats">
      <div class="card stat c-teal"><div class="num">${s.pct}%</div><div class="lbl">Completion</div></div>
      <div class="card stat c-pink"><div class="num">${s.complete}/${s.total}</div><div class="lbl">Done</div></div>
      <div class="card stat c-red"><div class="num">${s.missed}</div><div class="lbl">Missed / overdue</div></div>
      <div class="card stat c-orange" id="flagStat" style="cursor:pointer"><div class="num">${s.flagged}</div><div class="lbl">Flagged answers ›</div></div>
    </div>
    <div class="section-head" style="margin-top:4px"><div class="subhead" style="margin:0">📣 Announcements</div><div class="spacer"></div>
      <button class="btn small" id="newAnn">+ Post</button></div>
    ${anns.length ? anns.slice(0, 3).map(an => annCard(an, true)).join('') : '<div class="empty" style="padding:14px">Nothing posted yet — share weekly updates here.</div>'}
    <div class="subhead">🍦 Flavor strategy</div>
    ${flavorBoardHtml(flavorBoard)}
    <div class="subhead">📍 Spots — tap for the day's details</div>
    <div class="card spots-box">
      <div class="legend">
        <span><span class="light live"></span>Open now</span>
        <span><span class="light ok"></span>Closed · complete</span>
        <span><span class="light warn"></span>Missing lists</span>
        <span><span class="light bad"></span>Never opened</span>
      </div>
      ${spotRows || '<div class="empty">No spots yet — add them in the Spots menu.</div>'}
    </div>
    <div class="card" style="margin-top:20px"><b style="font-size:13px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:1px">Last 7 days</b>
      <div class="trend">${bars}</div></div>
  `;
  const setDate = d => { DASH_DATE = d; renderDashboard(body); };
  body.querySelector('#dashDate').onchange = e => setDate(e.target.value);
  body.querySelector('#prevDay').onclick = () => shiftDay(DASH_DATE, -1, setDate);
  body.querySelector('#nextDay').onclick = () => shiftDay(DASH_DATE, 1, setDate);
  body.querySelector('#terrSel').onchange = e => { DASH_TERR = e.target.value; renderDashboard(body); };
  body.querySelector('#newAnn').onclick = () => postAnnouncement(() => renderDashboard(body));
  body.querySelector('#assignClBtn').onclick = () => assignChecklistModal(() => renderDashboard(body));
  bindAnnouncements(body, () => renderDashboard(body));
  body.querySelectorAll('.spot-line').forEach(row => row.onclick = () => openSpotDay(row.dataset.spot, dash.date));
  body.querySelector('#flagStat').onclick = () => openFlagged(dash.date, dash.date);
}

function flavorBoardHtml(board) {
  if (!board) return '';
  const cats = board.categories.filter(c => c.flavors.length);
  if (!cats.length) return '<div class="empty" style="padding:14px">No flavors assigned yet — set them up in the Flavors menu.</div>';
  return `<div class="card" style="margin-bottom:14px">
    ${cats.map(c => `<div class="flavor-cat">
      <div class="flavor-cat-name">${esc(c.name)} <span>· ${c.spot_count} spots</span></div>
      <div class="flavor-list">${c.flavors.map(f =>
        `<span class="flavor-chip ${f.in_stock ? '' : 'out'}">${f.emoji || '🍦'} ${esc(f.name)}${f.pricing === 'Extra-Special' ? ' <b>$5</b>' : f.pricing === 'Everyday' ? ' <b>$4</b>' : ''}</span>`).join('')}</div>
    </div>`).join('')}
  </div>`;
}

async function openFlagged(from, to) {
  const q = new URLSearchParams({ from, to });
  if (DASH_TERR) q.set('territory_id', DASH_TERR);
  const rows = await api('/api/flagged?' + q).catch(() => []);
  const list = rows.map(r => `
    <div class="mrow chat-row" data-sub="${r.submission_id}">
      <div style="font-size:20px">⚑</div>
      <div class="info"><b>${esc(r.question)} → ${esc(r.answer ?? '—')}${r.unit ? ' ' + esc(r.unit) : ''}</b>
        <span>${r.emoji || ''} ${esc(r.checklist_name)} · ${esc(r.user_name)}${r.spot_name ? ' · 📍 ' + esc(r.spot_name) : ''}
        ${r.shift_time ? ' · 🕒 ' + esc(r.shift_time) : ''} · ${fmtTime(r.completed_at)}${r.expected ? ' · ' + esc(r.expected) : ''}</span></div>
    </div>`).join('');
  const bg = modal(`
    <h2>⚑ Flagged answers</h2>
    <p style="color:var(--ink-soft);font-size:14px;margin:0 0 10px">Answers that need a look — numbers outside their OK range, "No" answers, or any answer you marked as a concern in the checklist builder. ${prettyDate(from)}${from !== to ? ' → ' + prettyDate(to) : ''}</p>
    ${list || '<div class="empty">Nothing flagged 🎉</div>'}`);
  bg.querySelectorAll('[data-sub]').forEach(r => r.onclick = () => openSubmission(r.dataset.sub));
}

// ---- spot day detail ----
async function openSpotDay(spotId, date) {
  const q = new URLSearchParams({ date });
  if (DASH_TERR) q.set('territory_id', DASH_TERR);
  let d;
  try { d = await api(`/api/spots/${spotId}/day?${q}`); } catch (e) { return toast(e.message, true); }

  const shiftRows = d.shifts.map(s => `
    <div class="notif-row"><b>🧍 ${esc(s.user_name)}</b>
      <span>${fmtTime(s.start_at)} – ${fmtTime(s.end_at)}${s.clock_in_at ? ` · ⏱️ clocked in ${fmtTime(s.clock_in_at)}` : ''}${s.clock_out_at ? ` → out ${fmtTime(s.clock_out_at)}` : ''}${s.note_count ? ` · 📌 ${s.note_count}` : ''}</span></div>`).join('')
    || '<div class="empty" style="padding:12px">No shifts scheduled here today.</div>';

  const pill = st => st === 'complete' ? '<span class="pill green">✓ Done</span>'
    : st === 'overdue' || st === 'missed' ? '<span class="pill red">Overdue</span>' : '<span class="pill yellow">Pending</span>';
  const clRows = [
    ...d.instances.map(i => ({ id: i.submission_id, emoji: i.emoji, name: i.checklist_name, who: i.user_name, status: i.status, at: i.completed_at, flags: i.flags, answers: i.answers })),
    ...d.daily.map(r => ({ id: r.submission ? r.submission.id : null, emoji: r.emoji, name: r.checklist_name, who: r.submission ? r.submission.user_name : '—', status: r.status, at: r.submission ? r.submission.completed_at : null, flags: r.flags })),
  ].map(c => `
    <div class="mrow ${c.id ? 'chat-row' : ''}" ${c.id ? `data-sub="${c.id}"` : ''}>
      <div style="font-size:20px">${c.emoji || '📋'}</div>
      <div class="info"><b>${esc(c.name)}</b>
        <span>${esc(c.who || '—')}${c.at ? ' · ' + fmtTime(c.at) : ''}${c.flags ? ' · ⚑ ' + c.flags : ''}${c.id ? ' · tap to see answers' : ''}</span></div>
      ${pill(c.status)}
    </div>`).join('') || '<div class="empty" style="padding:12px">No checklists for this spot today.</div>';

  const photoGrid = d.photos.length ? `<div class="photo-grid">
    ${d.photos.map(p => `<a href="/api/photos/${p.photo}" target="_blank" class="photo-cell">
      <img src="/api/photos/${p.photo}" alt="${esc(p.label)}">
      <span>${esc(p.label)}<br><b>${esc(p.by)} · ${fmtTime(p.at)}</b></span></a>`).join('')}
  </div>` : '<div class="empty" style="padding:12px">No photos submitted yet today.</div>';

  const bg = modal(`
    <h2>📍 ${esc(d.spot_name)}</h2>
    <p style="color:var(--ink-soft);margin:0 0 12px">${d.territory_name ? esc(d.territory_name) + ' · ' : ''}${prettyDate(d.date)}</p>
    ${d.flavors && d.flavors.length ? `<div class="flavor-list" style="margin-bottom:12px">${d.flavors.map(f => `<span class="flavor-chip ${f.in_stock ? '' : 'out'}">${f.emoji || '🍦'} ${esc(f.name)}</span>`).join('')}</div>` : ''}
    <div class="subhead" style="margin-top:0">🧍 Working today</div>
    <div class="card">${shiftRows}</div>
    <div class="subhead">📋 Checklists</div>
    ${clRows}
    <div class="subhead">📷 Setup photos</div>
    ${photoGrid}
  `);
  bg.querySelectorAll('[data-sub]').forEach(r => r.onclick = () => openSubmission(r.dataset.sub));
}

function shiftDay(from, n, cb) {
  const d = new Date(from + 'T12:00:00'); d.setDate(d.getDate() + n);
  cb(d.toISOString().slice(0, 10));
}

async function openSubmission(id) {
  const s = await api('/api/submissions/' + id);
  const rows = s.responses.filter(r => !r.skipped).map(r => {
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

// ================= OPPORTUNITIES =================
let OPP_KIND = 'event';
const KIND_META = {
  event: ['🎪', 'Events & Festivals', 'Big shifts up for grabs — festivals, races, markets.'],
  flagship: ['⭐', 'Flagship Spots', 'Our recurring, high-volume locations.'],
  role: ['💼', 'Open Roles', 'Positions we\'re hiring for right now.'],
};
async function renderOpportunities(body) {
  const d = await api('/api/opportunities');
  const isLeader = rank(ME) >= 1;
  const posts = d.postings.filter(p => p.kind === OPP_KIND);

  const cards = posts.map(p => {
    let action;
    if (p.my_application === 'pending') action = '<span class="pill yellow">Applied ✋</span>';
    else if (p.my_application === 'accepted') action = '<span class="pill green">Accepted 🎉</span>';
    else if (p.my_application === 'declined') action = '<span class="pill gray">Not this time</span>';
    else if (p.status === 'open') action = `<button class="btn teal small" data-apply="${p.id}">Apply 🙋</button>`;
    else action = '<span class="pill gray">Closed</span>';
    return `<div class="card ann-card" style="border-left-color:var(--teal)">
      <div class="ann-head"><b>${KIND_META[p.kind][0]} ${esc(p.title)}${p.status === 'closed' ? ' <span class="pill gray">closed</span>' : ''}</b>
        <span style="color:var(--ink-soft);font-size:12px;font-weight:700">${p.when_text ? esc(p.when_text) : ago(p.created_at)}</span></div>
      ${p.where_text ? `<div style="font-size:13px;color:var(--ink-soft);font-weight:700">📍 ${esc(p.where_text)}</div>` : ''}
      ${p.description ? `<div class="ann-body">${esc(p.description)}</div>` : ''}
      ${p.requirements ? `<div class="ann-body" style="font-size:13px"><b>Requirements:</b> ${esc(p.requirements)}</div>` : ''}
      <div class="row" style="margin-top:10px;align-items:center">
        ${action}
        <button class="btn ghost small" data-refer="${p.id}">🤝 Refer a friend</button>
        ${isLeader ? `<div class="spacer"></div>
          ${p.applicant_count ? `<span class="pill teal">${p.applicant_count} pending</span>` : ''}
          <button class="btn ghost mini" data-editopp="${p.id}">Edit</button>
          <button class="btn ghost mini" data-toggleopp="${p.id}" data-status="${p.status}">${p.status === 'open' ? 'Close' : 'Reopen'}</button>
          <button class="btn danger mini" data-delopp="${p.id}">✕</button>` : ''}
      </div>
    </div>`;
  }).join('');

  const inbox = isLeader ? `
    <div class="subhead">📥 Applications (${(d.applications || []).length})</div>
    ${(d.applications || []).map(ap => `
      <div class="mrow"><div style="font-size:22px">🙋</div>
        <div class="info"><b>${esc(ap.user_name)} → ${esc(ap.posting_title)}</b>
          <span>${ap.note ? esc(ap.note) + ' · ' : ''}${ago(ap.created_at)}</span></div>
        <button class="btn teal small" data-acc="${ap.id}">Accept</button>
        <button class="btn ghost small" data-dec="${ap.id}">Decline</button>
      </div>`).join('') || '<div class="empty" style="padding:12px">No applications waiting.</div>'}
    <div class="subhead">🤝 Referrals (${(d.referrals || []).length})</div>
    ${(d.referrals || []).map(r => `
      <div class="mrow"><div style="font-size:22px">🤝</div>
        <div class="info"><b>${esc(r.friend_name)}${r.friend_contact ? ' · ' + esc(r.friend_contact) : ''}</b>
          <span>from ${esc(r.user_name)}${r.posting_title ? ' for ' + esc(r.posting_title) : ''}${r.note ? ' · ' + esc(r.note) : ''} · ${ago(r.created_at)}</span></div>
        <button class="btn ghost small" data-refdone="${r.id}">Mark contacted</button>
      </div>`).join('') || '<div class="empty" style="padding:12px">No referrals waiting.</div>'}
    <div class="subhead">💡 Spot suggestions (${(d.suggestions || []).length})</div>
    ${(d.suggestions || []).map(s => `
      <div class="mrow"><div style="font-size:22px">💡</div>
        <div class="info"><b>${esc(s.title)}</b>
          <span>from ${esc(s.user_name)}${s.details ? ' · ' + esc(s.details) : ''} · ${ago(s.created_at)}</span></div>
        <button class="btn ghost small" data-sugdone="${s.id}">Mark reviewed</button>
      </div>`).join('') || '<div class="empty" style="padding:12px">No suggestions waiting.</div>'}` : '';

  body.innerHTML = `
    <div class="section-head"><h2>✨ Opportunities</h2><div class="spacer"></div>
      <button class="btn ghost small" id="suggestBtn">💡 Suggest a spot</button>
      ${isLeader ? '<button class="btn" id="newOpp">+ Post</button>' : ''}</div>
    <div class="chat-chips" style="margin-bottom:14px">
      ${Object.entries(KIND_META).map(([k, m]) => `<button class="chip ${OPP_KIND === k ? 'active' : ''}" data-kind="${k}">${m[0]} ${m[1]}</button>`).join('')}
    </div>
    <p style="color:var(--ink-soft);font-size:14px;margin:0 0 10px">${KIND_META[OPP_KIND][2]}</p>
    ${cards || '<div class="empty"><div class="big">✨</div>Nothing posted here yet — check back soon!</div>'}
    ${inbox}
  `;
  const refresh = () => renderOpportunities(body);
  body.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { OPP_KIND = b.dataset.kind; refresh(); });
  body.querySelector('#suggestBtn').onclick = () => {
    const bg = modal(`<h2>💡 Suggest a spot</h2>
      <p style="color:var(--ink-soft);font-size:14px">Know a park, market, or event where we'd crush it? Tell us!</p>
      <label>Where?</label><input id="sgTitle" placeholder="e.g. Grant Park Farmers Market">
      <label>Why it'd work (optional)</label><textarea id="sgDetails" rows="3" placeholder="Foot traffic, timing, contacts…"></textarea>
      <button class="btn teal" id="sgGo" style="width:100%;margin-top:14px">Send suggestion</button>`);
    bg.querySelector('#sgGo').onclick = async () => {
      try {
        await api('/api/suggestions', { method: 'POST', json: { title: bg.querySelector('#sgTitle').value, details: bg.querySelector('#sgDetails').value } });
        bg.remove(); toast('Thanks — leadership got your suggestion 💡'); refresh();
      } catch (e) { toast(e.message, true); }
    };
  };
  body.querySelectorAll('[data-apply]').forEach(b => b.onclick = () => {
    const bg = modal(`<h2>🙋 Apply</h2>
      <label>Anything to add? (optional)</label><textarea id="apNote" rows="3" placeholder="Availability, experience, why you're a fit…"></textarea>
      <button class="btn teal" id="apGo" style="width:100%;margin-top:14px">Submit application</button>`);
    bg.querySelector('#apGo').onclick = async () => {
      try {
        await api(`/api/opportunities/${b.dataset.apply}/apply`, { method: 'POST', json: { note: bg.querySelector('#apNote').value } });
        bg.remove(); toast('Applied — leadership was notified 🙋'); refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
  body.querySelectorAll('[data-refer]').forEach(b => b.onclick = () => {
    const bg = modal(`<h2>🤝 Refer a friend</h2>
      <label>Their name</label><input id="rfName">
      <label>How do we reach them?</label><input id="rfContact" placeholder="Phone or email">
      <label>Note (optional)</label><textarea id="rfNote" rows="2" placeholder="Why they'd be great…"></textarea>
      <button class="btn teal" id="rfGo" style="width:100%;margin-top:14px">Send referral</button>`);
    bg.querySelector('#rfGo').onclick = async () => {
      try {
        await api('/api/referrals', { method: 'POST', json: {
          posting_id: Number(b.dataset.refer), friend_name: bg.querySelector('#rfName').value,
          friend_contact: bg.querySelector('#rfContact').value, note: bg.querySelector('#rfNote').value } });
        bg.remove(); toast('Referral sent 🤝'); refresh();
      } catch (e) { toast(e.message, true); }
    };
  });
  const oppForm = (p) => {
    const bg = modal(`<h2>${p ? 'Edit' : 'New'} opportunity</h2>
      <label>Type</label><select id="opKind">
        ${Object.entries(KIND_META).map(([k, m]) => `<option value="${k}" ${(p ? p.kind : OPP_KIND) === k ? 'selected' : ''}>${m[0]} ${m[1]}</option>`).join('')}</select>
      <label>Title</label><input id="opTitle" value="${esc(p?.title || '')}" placeholder="e.g. Music Midtown — 3 day festival">
      <label>When</label><input id="opWhen" value="${esc(p?.when_text || '')}" placeholder="e.g. Sept 12–14, 11am–9pm">
      <label>Where</label><input id="opWhere" value="${esc(p?.where_text || '')}" placeholder="e.g. Piedmont Park">
      <label>Details</label><textarea id="opDesc" rows="3">${esc(p?.description || '')}</textarea>
      <label>Requirements</label><textarea id="opReq" rows="2" placeholder="e.g. Must be able to lift 50 lbs, 6 months experience">${esc(p?.requirements || '')}</textarea>
      <button class="btn teal" id="opGo" style="width:100%;margin-top:14px">${p ? 'Save' : 'Post'} opportunity</button>`);
    bg.querySelector('#opGo').onclick = async () => {
      const payload = {
        kind: bg.querySelector('#opKind').value, title: bg.querySelector('#opTitle').value,
        when_text: bg.querySelector('#opWhen').value, where_text: bg.querySelector('#opWhere').value,
        description: bg.querySelector('#opDesc').value, requirements: bg.querySelector('#opReq').value,
      };
      try {
        await api(p ? '/api/opportunities/' + p.id : '/api/opportunities', { method: p ? 'PUT' : 'POST', json: payload });
        bg.remove(); toast('Saved ✨'); OPP_KIND = payload.kind; refresh();
      } catch (e) { toast(e.message, true); }
    };
  };
  const newOppBtn = body.querySelector('#newOpp');
  if (newOppBtn) newOppBtn.onclick = () => oppForm(null);
  body.querySelectorAll('[data-editopp]').forEach(b => b.onclick = () => oppForm(d.postings.find(p => p.id == b.dataset.editopp)));
  body.querySelectorAll('[data-toggleopp]').forEach(b => b.onclick = async () => {
    await api('/api/opportunities/' + b.dataset.toggleopp, { method: 'PUT', json: { status: b.dataset.status === 'open' ? 'closed' : 'open' } });
    refresh();
  });
  body.querySelectorAll('[data-delopp]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this posting?')) return;
    await api('/api/opportunities/' + b.dataset.delopp, { method: 'DELETE' });
    refresh();
  });
  body.querySelectorAll('[data-acc]').forEach(b => b.onclick = async () => {
    await api('/api/applications/' + b.dataset.acc + '/decide', { method: 'POST', json: { accept: true } });
    toast('Accepted — they were notified 🎉'); refresh();
  });
  body.querySelectorAll('[data-dec]').forEach(b => b.onclick = async () => {
    await api('/api/applications/' + b.dataset.dec + '/decide', { method: 'POST', json: { accept: false } });
    toast('Declined'); refresh();
  });
  body.querySelectorAll('[data-refdone]').forEach(b => b.onclick = async () => {
    await api('/api/referrals/' + b.dataset.refdone + '/handled', { method: 'POST' }); refresh();
  });
  body.querySelectorAll('[data-sugdone]').forEach(b => b.onclick = async () => {
    await api('/api/suggestions/' + b.dataset.sugdone + '/handled', { method: 'POST' }); refresh();
  });
}

// ================= REPORTS =================
let REP_FROM = null, REP_TO = null, REP_CL = '', REP_TERR = '', REP_PRESET = 'week', REP_VIEW = 'all';
function presetRange(p) {
  const now = new Date();
  const iso = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
  if (p === 'today') return [iso(now), iso(now)];
  if (p === 'week') { const s = new Date(now); s.setDate(s.getDate() - s.getDay()); return [iso(s), iso(now)]; }
  if (p === 'month') { const s = new Date(now.getFullYear(), now.getMonth(), 1); return [iso(s), iso(now)]; }
  return [REP_FROM, REP_TO];
}
async function renderReports(body) {
  if (REP_PRESET !== 'custom') { const [f, t] = presetRange(REP_PRESET); REP_FROM = f; REP_TO = t; }
  if (!REP_TO) REP_TO = new Date().toISOString().slice(0, 10);
  if (!REP_FROM) REP_FROM = REP_TO;
  const params = new URLSearchParams({ from: REP_FROM, to: REP_TO });
  if (REP_CL) params.set('checklist_id', REP_CL);
  if (REP_TERR) params.set('territory_id', REP_TERR);
  const [rep, lists, terrs] = await Promise.all([
    api('/api/reports?' + params), api('/api/checklists'), api('/api/territories')]);
  const waste = (REP_VIEW === 'waste' && rank(ME) === 2)
    ? await api(`/api/waste?from=${REP_FROM}&to=${REP_TO}`).catch(() => null) : null;
  const t = rep.totals;

  const clRows = rep.checklists.map(c => `
    <tr><td>${c.emoji} <b>${esc(c.name)}</b></td>
      <td>${c.complete}/${c.expected}</td>
      <td><span class="pill ${c.pct >= 90 ? 'green' : c.pct >= 60 ? 'yellow' : 'red'}">${c.pct}%</span></td>
      <td>${c.missed}</td>
      <td>${c.flags ? `<span class="pill red">⚑ ${c.flags}</span>` : '—'}</td></tr>`).join('');

  const peopleRows = rep.people.map(p => `
    <tr><td><b>${esc(p.name)}</b></td>
      <td>${p.expected ? `${p.complete}/${p.expected}` : p.submissions}</td>
      <td>${p.pct == null ? '—' : `<span class="pill ${p.pct >= 90 ? 'green' : p.pct >= 60 ? 'yellow' : 'red'}">${p.pct}%</span>`}</td>
      <td>${p.missed || 0}</td>
      <td>${p.flags ? `<span class="pill red">⚑ ${p.flags}</span>` : '—'}</td></tr>`).join('');
  const terrRows = (rep.territories || []).map(t => `
    <tr><td><b>${esc(t.name)}</b></td><td>${t.complete}/${t.expected}</td>
      <td><span class="pill ${t.pct >= 90 ? 'green' : t.pct >= 60 ? 'yellow' : 'red'}">${t.pct}%</span></td>
      <td>${t.missed}</td>
      <td>${t.flags ? `<span class="pill red">⚑ ${t.flags}</span>` : '—'}</td></tr>`).join('');

  const flaggedRows = rep.flagged.map(f => `
    <div class="mrow chat-row" data-sub="${f.submission_id}">
      <div style="font-size:22px">⚑</div>
      <div class="info"><b>${f.emoji} ${esc(f.checklist_name)} — ${esc(f.user_name)}</b>
        <span>${prettyDate(f.date)}${f.location_name ? ' · ' + esc(f.location_name) : ''} ·
        ${f.items.map(i => esc(i.label) + ': ' + esc(i.value ?? '—') + (i.unit ? ' ' + esc(i.unit) : '')).join(' · ')}</span></div>
    </div>`).join('');

  body.innerHTML = `
    <div class="section-head"><h2>📈 Reports</h2><div class="spacer"></div>
      <a class="btn teal small" style="text-decoration:none" href="/api/reports/export.csv?${params}" download>⬇️ Export CSV</a></div>
    <div class="chat-chips" style="margin-bottom:10px">
      ${[['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']].map(([k, l]) =>
        `<button class="chip ${REP_PRESET === k ? 'active' : ''}" data-preset="${k}">${l}</button>`).join('')}
    </div>
    <div class="datebar" ${REP_PRESET === 'custom' ? '' : 'style="display:none"'}>
      <input type="date" id="repFrom" value="${REP_FROM}"> <span style="font-weight:800;color:var(--ink-soft)">→</span>
      <input type="date" id="repTo" value="${REP_TO}">
    </div>
    <div class="datebar">
      <select id="repCl" style="width:auto"><option value="">All checklists</option>
        ${lists.map(c => `<option value="${c.id}" ${REP_CL == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select id="repTerr" style="width:auto"><option value="">All territories</option>
        ${terrs.map(x => `<option value="${x.id}" ${REP_TERR == x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <span style="font-size:13px;font-weight:800;color:var(--ink-soft)">${prettyDate(REP_FROM)} → ${prettyDate(REP_TO)}</span>
    </div>
    <div class="stats">
      <div class="card stat c-teal"><div class="num">${t.pct}%</div><div class="lbl">Completion</div></div>
      <div class="card stat c-pink"><div class="num">${t.complete}/${t.expected}</div><div class="lbl">Done</div></div>
      <div class="card stat c-red"><div class="num">${t.missed}</div><div class="lbl">Missed</div></div>
      <div class="card stat c-orange"><div class="num">${t.flags}</div><div class="lbl">Flagged</div></div>
    </div>
    <div class="chat-chips" style="margin:14px 0 10px">
      ${[['all', '📋 By checklist'], ['people', '🧑‍🍳 By team member'], ['terr', '🗺️ By territory'], ...(rank(ME) === 2 ? [['waste', '🗑️ Waste Log']] : [])].map(([k, l]) =>
        `<button class="chip ${REP_VIEW === k ? 'active' : ''}" data-view="${k}">${l}</button>`).join('')}
    </div>
    ${REP_VIEW === 'waste' ? wasteHtml(waste) : ''}
    ${REP_VIEW === 'all' ? (clRows ? `<div class="table-wrap"><table class="grid"><tr><th>Checklist</th><th>Done</th><th>Rate</th><th>Missed</th><th>Flags</th></tr>${clRows}</table></div>` : '<div class="empty">No activity in this range.</div>') : ''}
    ${REP_VIEW === 'people' ? (peopleRows ? `<div class="table-wrap"><table class="grid"><tr><th>Person</th><th>Done</th><th>Rate</th><th>Missed</th><th>Flags</th></tr>${peopleRows}</table></div>` : '<div class="empty">No activity in this range.</div>') : ''}
    ${REP_VIEW === 'terr' ? (terrRows ? `<div class="table-wrap"><table class="grid"><tr><th>Territory</th><th>Done</th><th>Rate</th><th>Missed</th><th>Flags</th></tr>${terrRows}</table></div>` : '<div class="empty">No activity in this range.</div>') : ''}
    <div class="subhead">⚑ Flagged answers (tap for full checklist)</div>
    ${flaggedRows || '<div class="empty">Nothing flagged — clean range 🎉</div>'}
  `;
  const rerun = () => renderReports(body);
  body.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { REP_PRESET = b.dataset.preset; rerun(); });
  body.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { REP_VIEW = b.dataset.view; rerun(); });
  const fromEl = body.querySelector('#repFrom'), toEl = body.querySelector('#repTo');
  if (fromEl) fromEl.onchange = e => { REP_PRESET = 'custom'; REP_FROM = e.target.value; rerun(); };
  if (toEl) toEl.onchange = e => { REP_PRESET = 'custom'; REP_TO = e.target.value; rerun(); };
  body.querySelector('#repCl').onchange = e => { REP_CL = e.target.value; rerun(); };
  body.querySelector('#repTerr').onchange = e => { REP_TERR = e.target.value; rerun(); };
  body.querySelectorAll('[data-sub]').forEach(r => r.onclick = () => openSubmission(r.dataset.sub));
}

function wasteHtml(w) {
  if (!w) return '<div class="empty">Loading…</div>';
  const rows = w.entries.map(e => `
    <tr><td>${prettyDate(e.date)} · ${fmtTime(e.created_at)}</td>
      <td><b>${esc(e.user_name)}</b></td>
      <td>${e.count}</td>
      <td>${esc(e.reason)}</td>
      <td>${esc(e.spot_name || '—')}</td></tr>`).join('');
  return `
    <div class="stats">
      <div class="card stat c-red"><div class="num">${w.total}</div><div class="lbl">Pops wasted</div></div>
      <div class="card stat c-orange"><div class="num" style="font-size:19px;font-family:Nunito">${w.top_waster ? esc(w.top_waster.name) : '—'}</div><div class="lbl">Top waster${w.top_waster ? ' · ' + w.top_waster.count : ''}</div></div>
      <div class="card stat c-pink"><div class="num" style="font-size:19px;font-family:Nunito">${w.top_reason ? esc(w.top_reason.reason) : '—'}</div><div class="lbl">Top reason${w.top_reason ? ' · ' + w.top_reason.count : ''}</div></div>
    </div>
    ${w.by_reason.length ? `<div class="subhead">By reason</div>
      <div class="card"><div class="flavor-list">${w.by_reason.map(r => `<span class="flavor-chip">${esc(r.reason)} · ${r.count}</span>`).join('')}</div></div>` : ''}
    ${w.by_spot.length ? `<div class="subhead">By spot</div>
      <div class="card"><div class="flavor-list">${w.by_spot.map(r => `<span class="flavor-chip">${esc(r.name)} · ${r.count}</span>`).join('')}</div></div>` : ''}
    <div class="subhead">Every entry</div>
    ${rows ? `<div class="table-wrap"><table class="grid"><tr><th>When</th><th>Who</th><th>Pops</th><th>Why</th><th>Spot</th></tr>${rows}</table></div>`
      : '<div class="empty">No waste logged in this range 🎉</div>'}`;
}

// ================= SCHEDULE =================
async function renderSchedule(body) {
  const q = SCHED_DATE ? '?date=' + SCHED_DATE : '';
  const [{ date, shifts }, sq, users, carts, requests] = await Promise.all([
    api('/api/shifts' + q), api('/api/square'), api('/api/users'), api('/api/locations'),
    api('/api/requests').catch(() => [])]);
  SCHED_DATE = date;
  const isAdmin = rank(ME) === 2;

  const reqRows = requests.map(r => `
    <div class="mrow">
      <div style="font-size:22px">🙋</div>
      <div class="info"><b>${esc(r.user_name)} → ${r.shift.cart_name ? esc(r.shift.cart_name) : 'Spot TBD'}</b>
        <span>${prettyDate(r.shift.date)}, ${fmtTime(r.shift.start_at)} – ${fmtTime(r.shift.end_at)} · asked ${ago(r.created_at)}</span></div>
      <button class="btn teal small" data-approve="${r.id}">Approve ✓</button>
      <button class="btn ghost small" data-decline="${r.id}">Decline</button>
    </div>`).join('');

  const rows = shifts.map(s => `
    <div class="mrow chat-row" data-shift="${s.id}">
      <div style="font-size:22px">${s.source === 'square' ? '⬛' : s.source === 'pickup' ? '⚡' : '✍️'}</div>
      <div class="info"><b>${esc(s.user_name)} — ${s.cart_name ? esc(s.cart_name) : s.territory_name ? '🗺️ ' + esc(s.territory_name) : '<span style="color:var(--red)">❓ no spot or territory</span>'}${s.note_count ? ` <span class="pill teal">📌 ${s.note_count}</span>` : ''}</b>
        <span>${fmtTime(s.start_at)} – ${fmtTime(s.end_at)} · ${s.source === 'square' ? 'From Square' : s.source === 'pickup' ? 'Picked up in app' : 'Manual'}${s.notes && s.source === 'square' ? ' · “' + esc(s.notes) + '”' : ''} · tap for details</span></div>
      ${s.source !== 'square' ? `<button class="btn danger small" data-del="${s.id}">Remove</button>` : ''}
    </div>`).join('');

  body.innerHTML = `
    <div class="settings-box">
      <h3>⬛ Square connection</h3>
      <p style="margin:4px 0 10px;font-size:14px;color:var(--ink-soft)">
        Shifts sync automatically every 10 minutes from Square Shifts.
        <b>Put the spot name (or a learned keyword) in each shift's notes</b> so the right location gets matched. Team members match by email.</p>
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
        <div style="flex:0 0 auto"><button class="btn ghost small" id="emailCfg">✉️ Email sign-in setup</button></div>
        <div style="flex:0 0 auto"><button class="btn ghost small" id="pickLoc">🏦 Payroll location: ${sq.location_id ? 'set ✓' : '<span style="color:var(--red)">not set (needed for clock-in)</span>'}</button></div>
        <div style="flex:0 0 auto"><a class="btn ghost small" href="/api/backup" download style="text-decoration:none;display:inline-block">⬇️ Download backup</a></div>
        <div style="flex:0 0 auto"><button class="btn ghost small" id="restoreBtn">⬆️ Restore backup</button>
          <input type="file" id="restoreFile" accept=".json" hidden></div>
        <div style="flex:0 0 auto"><button class="btn danger small" id="resetHist">🧹 Clear checklist history</button></div>
      </div>` : ''}
    </div>
    ${reqRows ? `<div class="section-head"><h2>🙋 Shift requests</h2></div>
      <p style="color:var(--ink-soft);font-size:14px;margin:0 0 8px">Approving notifies the person — then <b>assign them the shift in Square scheduling</b> so it lands on their schedule.</p>
      ${reqRows}` : ''}
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
  body.querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => {
    try {
      const r = await api('/api/requests/' + b.dataset.approve + '/decide', { method: 'POST', json: { approve: true } });
      toast(r.reminder || 'Approved');
      renderSchedule(body);
    } catch (e) { toast(e.message, true); }
  });
  body.querySelectorAll('[data-decline]').forEach(b => b.onclick = async () => {
    await api('/api/requests/' + b.dataset.decline + '/decide', { method: 'POST', json: { approve: false } });
    toast('Declined'); renderSchedule(body);
  });
  if (isAdmin) {
    body.querySelector('#resetHist').onclick = async () => {
      if (!confirm('Clear ALL checklist submissions and populated checklists so completion rates start fresh today?\n\nUsers, checklists, spots, shifts, and chat are NOT touched. This cannot be undone.')) return;
      if (!confirm('Last check — really wipe checklist history?')) return;
      try {
        const r = await api('/api/admin/reset-history', { method: 'POST' });
        toast(`Cleared ${r.cleared.submissions} submissions and ${r.cleared.instances} checklists 🧹`);
      } catch (e) { toast(e.message, true); }
    };
    body.querySelector('#emailCfg').onclick = async () => {
      const cfg = await api('/api/emailcfg');
      const bg = modal(`<h2>✉️ Email sign-in setup</h2>
        <p style="color:var(--ink-soft);font-size:14px">Lets the team sign in with a link instead of a password. Create a free account at <b>resend.com</b>, verify your kingofpops.com domain, then paste an API key here.</p>
        <div style="font-size:14px;margin-bottom:6px">Status: ${cfg.configured ? `<span class="status-ok">Configured (${esc(cfg.key_preview)})</span>` : '<span class="status-bad">Not set up</span>'}</div>
        <label>Resend API key</label><input id="emKey" type="password" placeholder="re_...">
        <label>From address</label><input id="emFrom" value="${esc(cfg.from || 'King of Pops <ops@kingofpops.com>')}">
        <button class="btn teal" id="emGo" style="width:100%;margin-top:14px">Save email settings</button>`);
      bg.querySelector('#emGo').onclick = async () => {
        const payload = { from: bg.querySelector('#emFrom').value };
        const k = bg.querySelector('#emKey').value.trim();
        if (k) payload.resend_key = k;
        await api('/api/emailcfg', { method: 'PUT', json: payload });
        bg.remove(); toast('Email settings saved ✉️');
      };
    };
    body.querySelector('#pickLoc').onclick = async () => {
      try {
        const locs = await api('/api/square/locations');
        const bg = modal(`<h2>🏦 Payroll location</h2>
          <p style="color:var(--ink-soft);font-size:14px">Clock-ins are recorded as Square timecards at this location. Pick your main Square location:</p>
          ${locs.map(l => `<div class="mrow" style="cursor:pointer" data-loc="${esc(l.id)}"><div style="font-size:20px">🏦</div><div class="info"><b>${esc(l.name)}</b></div>${sq.location_id === l.id ? '<span class="pill green">current ✓</span>' : ''}</div>`).join('')}`);
        bg.querySelectorAll('[data-loc]').forEach(row => row.onclick = async () => {
          await api('/api/square', { method: 'PUT', json: { location_id: row.dataset.loc } });
          bg.remove(); toast('Payroll location saved'); renderSchedule(body);
        });
      } catch (e) { toast(e.message, true); }
    };
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
      <label>Spot</label><select id="shCart"><option value="">— none —</option>${carts.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
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
  body.querySelectorAll('[data-shift]').forEach(row => row.onclick = e => {
    if (e.target.closest('[data-del]')) return;
    openShiftDetail(Number(row.dataset.shift), () => renderSchedule(body));
  });
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    if (!confirm('Remove this shift (and its pending checklists)?')) return;
    await api('/api/shifts/' + b.dataset.del, { method: 'DELETE' });
    toast('Shift removed'); renderSchedule(body);
  });
}

// ================= CHECKLISTS (admin) =================
let USERS_CACHE = [];
async function renderChecklistAdmin(body) {
  const [lists, carts, cats, users] = await Promise.all([
    api('/api/checklists'), api('/api/locations'), api('/api/categories'), api('/api/users').catch(() => [])]);
  USERS_CACHE = users;
  const trigLabel = { opening: '☀️ Opening (start of shift)', closing: '🌙 Closing (30 min before end)', daily: '📅 Daily schedule' };
  const isAdminCl = rank(ME) === 2;
  body.innerHTML = `
    <div class="section-head"><h2>Checklists</h2><div class="spacer"></div>
      <a class="btn ghost small" style="text-decoration:none" href="/api/checklists/export.md" download>⬇️ Export (readable)</a>
      <a class="btn ghost small" style="text-decoration:none" href="/api/checklists/export.json" download>⬇️ Export (JSON)</a>
      ${isAdminCl ? '<button class="btn" id="newCl">+ New checklist</button>' : '<span class="pill teal">Managers can edit — admins add/delete</span>'}</div>
    ${lists.map(c => `
      <div class="mrow">
        <div style="font-size:26px">${c.emoji}</div>
        <div class="info"><b>${esc(c.name)}</b>
          <span>${trigLabel[c.trigger] || c.trigger} ·
          ${c.location_id ? esc(c.location_name) : c.category_id ? esc(c.category_name) + ' (category)' : 'All spots'} ·
          ${(c.user_ids || []).length ? '👥 ' + c.user_ids.length + ' assigned' : c.job_role ? esc(c.job_role) : 'All roles'}${c.trigger === 'daily' ? ' · ' + (c.days.split(',').length === 7 ? 'Daily' : c.days.split(',').map(d => DAY_NAMES[d]).join(', ')) + (c.due_time ? ' · due ' + c.due_time : '') : ''} · ${c.items.length} items</span></div>
        <a class="btn ghost small" style="text-decoration:none" href="/api/checklists/export.md?id=${c.id}" download title="Export this checklist with its logic tree">⬇️</a>
        <button class="btn ghost small" data-edit="${c.id}">Edit</button>
        ${isAdminCl ? `<button class="btn danger small" data-del="${c.id}">Delete</button>` : ''}
      </div>`).join('') || '<div class="empty"><div class="big">📋</div>No checklists yet — create your first!</div>'}
  `;
  const newClBtn = body.querySelector('#newCl');
  if (newClBtn) newClBtn.onclick = () => checklistBuilder(null, carts, cats, () => renderChecklistAdmin(body));
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
  // convert stored cond_item_id -> positional cond_index for editing
  items.forEach(it => {
    if (it.cond_item_id != null) {
      const idx = items.findIndex(x => x.id === it.cond_item_id);
      it.cond_index = idx >= 0 ? idx : null;
    }
  });
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
      <div><label>Spot (specific)</label><select id="clLoc"><option value="">Any spot</option>
        ${carts.map(l => `<option value="${l.id}" ${cl?.location_id === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
      <div><label>…or category</label><select id="clCat"><option value="">Any category</option>
        ${cats.map(c => `<option value="${c.id}" ${cl?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div><label>Role (blank = everyone)</label><input id="clRole" value="${esc(cl?.job_role || '')}" placeholder="e.g. Cart Operator"></div>
    </div>
    <label>👥 Or assign to specific people (e.g. HQ ops leads) — overrides role/spot</label>
    <div class="card" style="padding:10px 14px;max-height:170px;overflow-y:auto">
      ${USERS_CACHE.map(u => `<label class="checkline"><input type="checkbox" data-cluser="${u.id}" ${(cl?.user_ids || []).includes(u.id) ? 'checked' : ''}> ${esc(u.name)}${u.job_role ? ' · ' + esc(u.job_role) : ''}</label>`).join('')}
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
            ${['checkbox|Checkbox', 'yesno|Yes / No', 'choice|Multiple choice', 'number|Number', 'text|Text', 'photo|Photo'].map(o => {
              const [v, l] = o.split('|'); return `<option value="${v}" ${it.type === v ? 'selected' : ''}>${l}</option>`;
            }).join('')}
          </select>
          <input class="wide" data-f="label" data-i="${i}" value="${esc(it.label)}" placeholder="Task / question">
          ${it.type === 'number' ? `
            <input data-f="unit" data-i="${i}" value="${esc(it.unit || '')}" placeholder="Unit (°F, ppm…)">
            <input type="number" step="any" data-f="min" data-i="${i}" value="${it.min ?? ''}" placeholder="Min OK">
            <input type="number" step="any" data-f="max" data-i="${i}" value="${it.max ?? ''}" placeholder="Max OK">` : ''}
          ${it.type === 'choice' ? `
            <input class="wide" data-f="options" data-i="${i}" value="${esc(it.options || '')}" placeholder="Options, separated by commas (e.g. Full, Half, Empty)">` : ''}
          ${['number', 'yesno', 'checkbox', 'choice', 'text'].includes(it.type) ? `
            <select data-flagmode="${i}" style="flex:1;min-width:150px" title="When should this answer be flagged for review?">
              <option value="never" ${(it.flag_mode || 'never') === 'never' ? 'selected' : ''}>⚑ never flag</option>
              ${it.type === 'number' ? `<option value="auto" ${it.flag_mode === 'auto' ? 'selected' : ''}>⚑ outside OK range</option>` : ''}
              ${it.type === 'yesno' ? `<option value="auto" ${it.flag_mode === 'auto' ? 'selected' : ''}>⚑ when answer is No</option>` : ''}
              ${it.type === 'checkbox' ? `<option value="auto" ${it.flag_mode === 'auto' ? 'selected' : ''}>⚑ when left unchecked</option>` : ''}
              <option value="values" ${it.flag_mode === 'values' ? 'selected' : ''}>⚑ specific answers…</option>
            </select>
            ${it.flag_mode === 'values' ? `<input data-flagvals="${i}" value="${esc(it.flag_values || '')}" placeholder="flag these answers (comma separated)" style="flex:2;min-width:160px">` : ''}` : ''}
          <button type="button" class="btn ghost mini" data-req="${i}">${it.required ? 'Required ✓' : 'Optional'}</button>
          <button type="button" class="btn ghost mini" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn ghost mini" data-down="${i}" ${i === items.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="btn danger mini" data-rm="${i}">✕</button>
          ${(() => {
            // controlling items must be ABOVE this one and answerable
            const CTRL_TYPES = ['choice', 'yesno', 'number', 'checkbox'];
            const ctrls = items.map((x, xi) => ({ x, xi })).filter(({ x, xi }) => xi < i && CTRL_TYPES.includes(x.type) && x.label);
            if (!ctrls.length) return '';
            const ctrlSel = `<select data-condi="${i}" style="flex:2;min-width:150px">
              <option value="">Always shown</option>
              ${ctrls.map(({ x, xi }) => `<option value="${xi}" ${it.cond_index === xi ? 'selected' : ''}>If “${esc(x.label.slice(0, 30))}”…</option>`).join('')}</select>`;
            let rest = '';
            if (it.cond_index != null && items[it.cond_index]) {
              const ctrl = items[it.cond_index];
              const isNum = ctrl.type === 'number';
              const ops = isNum
                ? [['lt', 'is below'], ['lte', 'is at most'], ['gt', 'is above'], ['gte', 'is at least'], ['eq', 'equals'], ['ne', 'is not']]
                : [['eq', 'is'], ['ne', 'is not']];
              const opSel = `<select data-condop="${i}" style="flex:1;min-width:110px">
                ${ops.map(([v, l]) => `<option value="${v}" ${(it.cond_op || 'eq') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
              let valInput;
              if (isNum) {
                valInput = `<input type="number" step="any" data-condv="${i}" value="${esc(it.cond_value ?? '')}" placeholder="value${ctrl.unit ? ' (' + esc(ctrl.unit) + ')' : ''}" style="flex:1;min-width:90px">`;
              } else {
                const opts = ctrl.type === 'yesno' ? ['yes', 'no']
                  : ctrl.type === 'checkbox' ? ['yes', '']
                    : String(ctrl.options || '').split(',').map(s => s.trim()).filter(Boolean);
                valInput = `<select data-condv="${i}" style="flex:1;min-width:100px">
                  ${opts.map(o => `<option value="${esc(o)}" ${String(it.cond_value ?? '') === o ? 'selected' : ''}>${ctrl.type === 'checkbox' ? (o === 'yes' ? 'checked' : 'unchecked') : esc(o)}</option>`).join('')}</select>`;
              }
              rest = opSel + valInput;
            }
            return `<div class="wide" style="display:flex;gap:6px;align-items:center;background:var(--cream);border-radius:10px;padding:6px 8px;flex-wrap:wrap">
              <span style="font-size:12px;font-weight:800;color:var(--ink-soft)">🔀 Show this</span>${ctrlSel}${rest}</div>`;
          })()}
        </div>
      </div>`).join('');
    itemsEl.querySelectorAll('[data-f]').forEach(el => el.onchange = () => {
      const it = items[el.dataset.i];
      it[el.dataset.f] = el.value === '' ? null : (el.dataset.f === 'min' || el.dataset.f === 'max' ? Number(el.value) : el.value);
      if (el.dataset.f === 'type') drawItems();
    });
    itemsEl.querySelectorAll('[data-condi]').forEach(el => el.onchange = () => {
      const it = items[el.dataset.condi];
      it.cond_index = el.value === '' ? null : Number(el.value);
      if (it.cond_index != null) {
        const ctrl = items[it.cond_index];
        if (ctrl.type === 'number') { it.cond_op = 'gt'; it.cond_value = ''; }
        else {
          it.cond_op = 'eq';
          const opts = ctrl.type === 'yesno' ? ['yes', 'no'] : ctrl.type === 'checkbox' ? ['yes', ''] :
            String(ctrl.options || '').split(',').map(s => s.trim()).filter(Boolean);
          it.cond_value = opts[0] ?? null;
        }
      } else { it.cond_value = null; it.cond_op = 'eq'; }
      drawItems();
    });
    itemsEl.querySelectorAll('[data-flagmode]').forEach(el => el.onchange = () => {
      items[el.dataset.flagmode].flag_mode = el.value;
      if (el.value !== 'values') items[el.dataset.flagmode].flag_values = null;
      drawItems();
    });
    itemsEl.querySelectorAll('[data-flagvals]').forEach(el => {
      const set = () => items[el.dataset.flagvals].flag_values = el.value;
      el.onchange = set; el.oninput = set;
    });
    itemsEl.querySelectorAll('[data-condop]').forEach(el => el.onchange = () => { items[el.dataset.condop].cond_op = el.value; });
    itemsEl.querySelectorAll('[data-condv]').forEach(el => {
      const set = () => items[el.dataset.condv].cond_value = el.value;
      el.onchange = set; el.oninput = set;
    });
    itemsEl.querySelectorAll('[data-req]').forEach(el => el.onclick = () => { const it = items[el.dataset.req]; it.required = it.required ? 0 : 1; drawItems(); });
    const fixConds = () => items.forEach(x => {
      const ok = x.cond_index != null && items[x.cond_index] && x.cond_index < items.indexOf(x) &&
        ['choice', 'yesno', 'number', 'checkbox'].includes(items[x.cond_index].type);
      if (x.cond_index != null && !ok) { x.cond_index = null; x.cond_value = null; x.cond_op = 'eq'; }
    });
    itemsEl.querySelectorAll('[data-rm]').forEach(el => el.onclick = () => { items.splice(el.dataset.rm, 1); items.forEach(x => { if (x.cond_index != null && x.cond_index >= items.length) { x.cond_index = null; x.cond_value = null; } }); fixConds(); drawItems(); });
    itemsEl.querySelectorAll('[data-up]').forEach(el => el.onclick = () => { const i = +el.dataset.up; [items[i - 1], items[i]] = [items[i], items[i - 1]]; fixConds(); drawItems(); });
    itemsEl.querySelectorAll('[data-down]').forEach(el => el.onclick = () => { const i = +el.dataset.down; [items[i + 1], items[i]] = [items[i], items[i + 1]]; fixConds(); drawItems(); });
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
      user_ids: [...bg.querySelectorAll('[data-cluser]:checked')].map(el => Number(el.dataset.cluser)),
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
  const [carts, cats, users, terrs, flavors] = await Promise.all([
    api('/api/locations'), api('/api/categories'), api('/api/users'), api('/api/territories'), api('/api/flavors').catch(() => [])]);
  FLAVOR_CACHE = flavors;
  function cartRow(c) {
    return `<div class="mrow">
      <div style="font-size:22px">🛒</div>
      <div class="info"><b>${esc(c.name)}</b>
        <span>${c.territory_name ? '🗺️ ' + esc(c.territory_name) + ' · ' : '<span style="color:var(--red)">🗺️ no territory · </span>'}${(c.keywords || []).length ? '🧠 ' + c.keywords.slice(0, 3).map(esc).join(', ') + ' · ' : ''}${(c.flavor_ids || []).length ? '🍦 ' + c.flavor_ids.length + ' flavors · ' : ''}🔔 ${c.notifier_names.length ? c.notifier_names.map(esc).join(', ') : 'territory manager only'}</span></div>
      <button class="btn ghost small" data-edit="${c.id}">Edit</button>
      <button class="btn danger small" data-del="${c.id}">Remove</button>
    </div>`;
  }
  const groups = cats.map(cat => {
    const rows = carts.filter(c => c.category_id === cat.id).map(cartRow).join('');
    return `<div class="cat-head"><h3>${esc(cat.name)}</h3>
      <button class="btn ghost mini" data-rencat="${cat.id}" data-name="${esc(cat.name)}">rename</button>
      <button class="btn ghost mini" data-delcat="${cat.id}">✕</button></div>${rows || '<div class="empty" style="padding:10px">Nothing here yet</div>'}`;
  }).join('');
  const uncat = carts.filter(c => !c.category_id).map(cartRow).join('');
  const terrRows = terrs.map(t => `
    <div class="mrow">
      <div style="font-size:22px">🗺️</div>
      <div class="info"><b>${esc(t.name)}</b>
        <span>${t.cart_count} spots · Managers: ${t.manager_names.length ? t.manager_names.map(esc).join(', ') : '<span style="color:var(--red)">none assigned</span>'} ·
        ⬛ ${t.square_location_name ? esc(t.square_location_name) : '<span style="color:var(--red)">no Square location linked</span>'}</span></div>
      <button class="btn teal small" data-sqterr="${t.id}">⬛ Link Square</button>
      <button class="btn ghost small" data-renterr="${t.id}" data-name="${esc(t.name)}">Rename</button>
      <button class="btn danger small" data-delterr="${t.id}">Remove</button>
    </div>`).join('');

  body.innerHTML = `
    <div class="section-head"><h2>Territories</h2><div class="spacer"></div>
      <button class="btn" id="newTerr">+ Add territory</button></div>
    <p style="color:var(--ink-soft);font-size:14px;margin:0 0 6px">Assign managers to territories in the Team menu. Managers are automatically alerted when checklists in their territories go overdue, and each territory gets its own chat channel.</p>
    ${terrRows || '<div class="empty">No territories yet.</div>'}
    <div class="section-head" style="margin-top:26px"><h2>Spots</h2><div class="spacer"></div>
      <button class="btn ghost small" id="rematchBtn">🧠 Re-match shifts</button>
      <button class="btn ghost small" id="newCat">+ Category</button>
      <button class="btn" id="newCart">+ Add spot</button></div>
    <p style="color:var(--ink-soft);font-size:14px;margin:0 0 6px">Spot names (or their keywords) should match what you write in Square shift notes. Extra notifiers can be set per spot.</p>
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
  body.querySelectorAll('[data-sqterr]').forEach(b => b.onclick = async () => {
    try {
      const locs = await api('/api/square/locations');
      const bg = modal(`<h2>⬛ Link Square location</h2>
        <p style="color:var(--ink-soft);font-size:14px">Shifts published at this Square location will automatically belong to this territory — no notes needed.</p>
        ${locs.map(l => `<div class="mrow" style="cursor:pointer" data-loc="${esc(l.id)}" data-locname="${esc(l.name)}"><div style="font-size:20px">⬛</div><div class="info"><b>${esc(l.name)}</b></div></div>`).join('')}
        <button class="btn ghost small" id="unlink" style="margin-top:8px">Unlink</button>`);
      const doLink = async (locId, locName) => {
        await api('/api/territories/' + b.dataset.sqterr, { method: 'PUT', json: { square_location_id: locId, square_location_name: locName } });
        bg.remove(); toast(locId ? 'Linked — shifts at that Square location now map here' : 'Unlinked'); refresh();
      };
      bg.querySelectorAll('[data-loc]').forEach(row => row.onclick = () => doLink(row.dataset.loc, row.dataset.locname));
      bg.querySelector('#unlink').onclick = () => doLink(null, null);
    } catch (e) { toast(e.message, true); }
  });
  body.querySelectorAll('[data-renterr]').forEach(b => b.onclick = async () => {
    const name = prompt('Rename territory', b.dataset.name);
    if (!name) return;
    await api('/api/territories/' + b.dataset.renterr, { method: 'PUT', json: { name } });
    refresh();
  });
  body.querySelectorAll('[data-delterr]').forEach(b => b.onclick = async () => {
    if (!confirm('Remove this territory? Its spots stay but lose the territory; its chat channel is deleted.')) return;
    await api('/api/territories/' + b.dataset.delterr, { method: 'DELETE' });
    toast('Territory removed'); refresh();
  });
  body.querySelector('#rematchBtn').onclick = async () => {
    const r = await api('/api/locations/rematch', { method: 'POST' });
    toast(r.fixed ? `Matched ${r.fixed} shift${r.fixed > 1 ? 's' : ''} to spots 🧠` : 'No unmatched shifts to fix');
    refresh();
  };
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
    if (!confirm('Remove this spot?')) return;
    await api('/api/locations/' + b.dataset.del, { method: 'DELETE' });
    toast('Spot removed'); refresh();
  });
}

let FLAVOR_CACHE = [];
function cartForm(cart, cats, users, terrs, onSave) {
  const notifiers = new Set(cart ? cart.notifier_ids : []);
  const bg = modal(`
    <h2>${cart ? 'Edit' : 'Add'} spot</h2>
    <label>Spot name</label><input id="ctName" value="${esc(cart?.name || '')}" placeholder="e.g. Piedmont Park">
    <div class="row">
      <div><label>Category</label><select id="ctCat"><option value="">— none —</option>
        ${cats.map(c => `<option value="${c.id}" ${cart?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div><label>Territory</label><select id="ctTerr"><option value="">— none —</option>
        ${terrs.map(t => `<option value="${t.id}" ${cart?.territory_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
    </div>
    <label>🧠 Shift-note keywords (comma separated — e.g. “12th St, 12th Street gate”)</label>
    <input id="ctKeywords" value="${esc((cart?.keywords || []).join(', '))}" placeholder="Words in Square shift notes that mean this spot">
    <label>🍦 Flavors to pack here</label>
    <div class="card" style="padding:10px 14px;max-height:200px;overflow-y:auto" id="ctFlavors">
      ${FLAVOR_CACHE.length ? FLAVOR_CACHE.map(f => `<label class="checkline"><input type="checkbox" data-fl="${f.id}" ${(cart?.flavor_ids || []).includes(f.id) ? 'checked' : ''}> ${f.emoji || '🍦'} ${esc(f.name)}${f.in_stock ? '' : ' <span style="color:var(--red)">(out)</span>'}</label>`).join('')
        : '<span style="color:var(--ink-soft);font-size:13px">No flavors yet — add them in the Flavors menu.</span>'}
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
      keywords: bg.querySelector('#ctKeywords').value.split(',').map(s => s.trim()).filter(Boolean),
      flavor_ids: [...bg.querySelectorAll('[data-fl]:checked')].map(el => Number(el.dataset.fl)),
    };
    if (!payload.name) return toast('Give it a name', true);
    try {
      await api(cart ? '/api/locations/' + cart.id : '/api/locations', { method: cart ? 'PUT' : 'POST', json: payload });
      bg.remove(); toast('Spot saved 🍭'); onSave();
    } catch (e) { toast(e.message, true); }
  };
}

// ================= FLAVORS =================
let CATS_CACHE = [];
async function renderFlavors(body) {
  const [flavors, spots, cats] = await Promise.all([api('/api/flavors'), api('/api/locations'), api('/api/categories')]);
  CATS_CACHE = cats;
  const rows = flavors.map(f => {
    const spotsWith = spots.filter(s => (s.flavor_ids || []).includes(f.id));
    return `<div class="mrow">
      <div style="font-size:24px">${f.emoji || '🍦'}</div>
      <div class="info"><b>${esc(f.name)} ${f.in_stock ? '' : '<span class="pill red">out of stock</span>'}</b>
        <span>${[f.profile, f.commitment, f.pricing === 'Everyday' ? 'Everyday $4' : f.pricing === 'Extra-Special' ? 'Extra-Special $5' : null].filter(Boolean).map(esc).join(' · ')}${f.note ? ' · ' + esc(f.note) : ''}<br>
        ${(f.category_ids || []).length ? '🏷️ ' + f.category_ids.map(id => esc((cats.find(c => c.id === id) || {}).name || '')).filter(Boolean).join(', ') : ''}${spotsWith.length ? ' · 📍 ' + spotsWith.map(s => esc(s.name)).join(', ') : ''}${!(f.category_ids || []).length && !spotsWith.length ? 'not assigned yet' : ''}</span></div>
      <button class="btn ghost small" data-stock="${f.id}" data-in="${f.in_stock}">${f.in_stock ? 'Mark out' : 'Back in stock'}</button>
      <button class="btn ghost small" data-editfl="${f.id}">Edit</button>
      <button class="btn danger small" data-delfl="${f.id}">✕</button>
    </div>`;
  }).join('');
  body.innerHTML = `
    <div class="section-head"><h2>🍦 Flavor Strategy</h2><div class="spacer"></div>
      <button class="btn" id="newFl">+ Add flavor</button></div>
    <p style="color:var(--ink-soft);font-size:14px;margin:0 0 10px">Add what's in stock, then assign flavors to each spot (Spots menu → edit a spot). Slingers see their pack list on their home screen when they're on a shift there.</p>
    ${rows || '<div class="empty"><div class="big">🍦</div>No flavors yet — add your first!</div>'}
  `;
  const refresh = () => renderFlavors(body);
  const flForm = (f) => {
    const bg = modal(`<h2>${f ? 'Edit' : 'Add'} flavor</h2>
      <div class="row">
        <div style="flex:0 0 70px"><label>Emoji</label><input id="flEmoji" value="${esc(f?.emoji || '🍦')}" maxlength="4"></div>
        <div style="flex:3"><label>Name</label><input id="flName" value="${esc(f?.name || '')}" placeholder="e.g. Chocolate Sea Salt"></div>
      </div>
      <div class="row">
        <div><label>Flavor profile</label><select id="flProfile">
          <option value="">—</option>
          <option value="Fruity" ${f?.profile === 'Fruity' ? 'selected' : ''}>🍓 Fruity</option>
          <option value="Creamy" ${f?.profile === 'Creamy' ? 'selected' : ''}>🥛 Creamy</option></select></div>
        <div><label>Availability</label><select id="flCommit">
          <option value="">—</option>
          <option value="Full-time" ${f?.commitment === 'Full-time' ? 'selected' : ''}>Full-time</option>
          <option value="Part-time" ${f?.commitment === 'Part-time' ? 'selected' : ''}>Part-time</option></select></div>
        <div><label>Pricing</label><select id="flPricing">
          <option value="">—</option>
          <option value="Everyday" ${f?.pricing === 'Everyday' ? 'selected' : ''}>Everyday — $4</option>
          <option value="Extra-Special" ${f?.pricing === 'Extra-Special' ? 'selected' : ''}>Extra-Special — $5</option></select></div>
      </div>
      <label>📍 Goes to these spot categories</label>
      <div class="card" style="padding:10px 14px">
        ${CATS_CACHE.map(c => `<label class="checkline"><input type="checkbox" data-fcat="${c.id}" ${(f?.category_ids || []).includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}
      </div>
      <label>Note (optional)</label><input id="flNote" value="${esc(f?.note || '')}" placeholder="e.g. vegan · pack 2 cases">
      <label class="checkline" style="margin-top:10px"><input type="checkbox" id="flStock" ${f ? (f.in_stock ? 'checked' : '') : 'checked'}> In stock</label>
      <button class="btn teal" id="flGo" style="width:100%;margin-top:14px">Save flavor</button>`);
    bg.querySelector('#flGo').onclick = async () => {
      const payload = {
        name: bg.querySelector('#flName').value, emoji: bg.querySelector('#flEmoji').value,
        note: bg.querySelector('#flNote').value, in_stock: bg.querySelector('#flStock').checked,
        profile: bg.querySelector('#flProfile').value || null,
        commitment: bg.querySelector('#flCommit').value || null,
        pricing: bg.querySelector('#flPricing').value || null,
        category_ids: [...bg.querySelectorAll('[data-fcat]:checked')].map(el => Number(el.dataset.fcat)),
      };
      try {
        await api(f ? '/api/flavors/' + f.id : '/api/flavors', { method: f ? 'PUT' : 'POST', json: payload });
        bg.remove(); toast('Flavor saved 🍦'); refresh();
      } catch (e) { toast(e.message, true); }
    };
  };
  body.querySelector('#newFl').onclick = () => flForm(null);
  body.querySelectorAll('[data-editfl]').forEach(b => b.onclick = () => flForm(flavors.find(f => f.id == b.dataset.editfl)));
  body.querySelectorAll('[data-stock]').forEach(b => b.onclick = async () => {
    await api('/api/flavors/' + b.dataset.stock, { method: 'PUT', json: { in_stock: b.dataset.in !== '1' } });
    refresh();
  });
  body.querySelectorAll('[data-delfl]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this flavor? It will be removed from all spots.')) return;
    await api('/api/flavors/' + b.dataset.delfl, { method: 'DELETE' });
    refresh();
  });
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
        <div>${u.avatar ? `<img class="avatar-sm" src="/api/photos/${u.avatar}" alt="">` : `<span style="font-size:24px">${u.level === 'admin' ? '👑' : u.level === 'manager' ? '🧭' : '🍭'}</span>`}</div>
        <div class="info"><b>${esc(u.name)}</b>
          <span>${esc(u.email)} · ${LEVELS[u.level]}${u.job_role ? ' · ' + esc(u.job_role) : ''}${(u.territory_names || []).length ? ' · 🗺️ ' + u.territory_names.map(esc).join(', ') : ''}${u.location_name ? ' · ' + esc(u.location_name) : ''}${u.square_team_member_id ? ' · ⬛' : ''}</span></div>
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
      <label>🗺️ Responsible for territories (pick any number)</label>
      <div class="card" style="padding:10px 14px">
        ${terrs.map(t => `<label class="checkline"><input type="checkbox" data-terr="${t.id}" ${(u?.territory_ids || []).includes(t.id) ? 'checked' : ''}> ${esc(t.name)}</label>`).join('') || '<span style="color:var(--ink-soft);font-size:13px">No territories yet — create them in the Spots section.</span>'}
      </div>
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
      territory_ids: levelSel.value === 'manager' ? [...bg.querySelectorAll('[data-terr]:checked')].map(el => Number(el.dataset.terr)) : [],
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
  clearInterval(CHAT_TIMER);
  if (!CHAT_CHANNEL) return renderChatList(body);
  renderConversation(body);
}

async function renderChatList(body) {
  const channels = await api('/api/chat/channels');
  const rows = channels.map(c => `
    <div class="mrow chat-row" data-ch="${c.id}">
      <div style="font-size:24px">${c.type === 'dm' ? '👤' : c.type === 'territory' ? '🗺️' : '📣'}</div>
      <div class="info">
        <b>${c.type === 'dm' ? esc(c.name) : '#' + esc(c.name)}${c.min_level === 'manager' ? ' 🔒' : ''}</b>
        <span>${c.last_preview ? `${c.last_from ? esc(c.last_from) + ': ' : ''}${esc(c.last_preview)}` : 'No messages yet'}</span>
      </div>
      <div style="text-align:right;flex-shrink:0">
        ${c.unread ? `<span class="chip-dot" style="margin-bottom:4px;display:inline-flex">${c.unread}</span><br>` : ''}
        <span style="font-size:12px;color:var(--ink-soft);font-weight:700">${c.last_at ? ago(c.last_at) : ''}</span>
      </div>
    </div>`).join('');
  body.innerHTML = `
    <div class="section-head"><h2>💬 Chat</h2><div class="spacer"></div>
      ${rank(ME) === 2 ? '<button class="btn ghost small" id="newCh">+ Channel</button>' : ''}
      <button class="btn" id="newDm">+ New message</button></div>
    ${rows || '<div class="empty"><div class="big">💬</div>No conversations yet.</div>'}`;
  body.querySelectorAll('[data-ch]').forEach(row => row.onclick = () => {
    CHAT_CHANNEL = Number(row.dataset.ch); CHAT_LAST_ID = 0;
    renderChat(body);
  });
  const newChBtn = body.querySelector('#newCh');
  if (newChBtn) newChBtn.onclick = () => {
    const bg = modal(`<h2># New channel</h2>
      <label>Channel name</label><input id="chName" placeholder="e.g. Wholesale Ops">
      <label class="checkline" style="margin-top:10px"><input type="checkbox" id="chLead"> 🔒 Leadership only (managers + admins)</label>
      <button class="btn teal" id="chGo" style="width:100%;margin-top:14px">Create channel</button>`);
    bg.querySelector('#chGo').onclick = async () => {
      try {
        await api('/api/chat/channels', { method: 'POST', json: { name: bg.querySelector('#chName').value, min_level: bg.querySelector('#chLead').checked ? 'manager' : 'slinger' } });
        bg.remove(); toast('Channel created'); renderChatList(body);
      } catch (e) { toast(e.message, true); }
    };
  };
  body.querySelector('#newDm').onclick = async () => {
    const list = await api('/api/chat/people');
    const bg = modal(`<h2>New direct message</h2>
      ${list.map(x => `<div class="mrow" style="cursor:pointer" data-u="${x.id}"><div>${x.avatar ? `<img class="avatar-sm" src="/api/photos/${x.avatar}" alt="">` : `<span style="font-size:20px">${x.level === 'admin' ? '👑' : x.level === 'manager' ? '🧭' : '🍭'}</span>`}</div><div class="info"><b>${esc(x.name)}</b></div></div>`).join('')}`);
    bg.querySelectorAll('[data-u]').forEach(row => row.onclick = async () => {
      const ch = await api('/api/chat/dm', { method: 'POST', json: { user_id: Number(row.dataset.u) } });
      bg.remove(); CHAT_CHANNEL = ch.id; CHAT_LAST_ID = 0; renderChat(body);
    });
  };
  // keep previews fresh while on the list
  CHAT_TIMER = setInterval(() => { if (TAB === 'chat' && !CHAT_CHANNEL) renderChatList(body); }, 15000);
}

async function renderConversation(body) {
  const { channel } = await api(`/api/chat/messages?channel_id=${CHAT_CHANNEL}&after=999999999`).catch(() => ({ channel: null }));
  body.innerHTML = `
    <div class="chat-wrap">
      <div class="conv-head">
        <button class="btn ghost small" id="backBtn">← All chats</button>
        <h2 style="margin:0;font-size:18px">${channel ? (channel.type === 'dm' ? '👤 ' : '#') + esc(channel.name) : ''}</h2>
      </div>
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
  body.querySelector('#backBtn').onclick = () => { CHAT_CHANNEL = null; CHAT_LAST_ID = 0; renderChat(body); };
  const msgsEl = body.querySelector('#chatMsgs');
  let pendingFile = null;
  CHAT_LAST_ID = 0;

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
  const params = new URLSearchParams(location.search);
  const linkToken = params.get('link');
  if (linkToken) {
    try {
      const { user } = await api('/api/login/verify', { method: 'POST', json: { token: linkToken } });
      ME = user; REAL_LEVEL = user.level;
      history.replaceState({}, '', '/');
      shell();
      toast('Signed in 🍭');
      setInterval(refreshBell, 60000);
      return;
    } catch (e) { history.replaceState({}, '', '/'); setTimeout(() => toast(e.message, true), 400); }
  }
  try {
    const me = await api('/api/me');
    ME = me.user; PREVIEW = me.preview; REAL_LEVEL = me.real_level;
  } catch { }
  if (ME) shell(); else renderLogin();
  setInterval(refreshBell, 60000);
})();
