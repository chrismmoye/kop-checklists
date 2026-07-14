// King of Pops · Operations Checklists v3 — zero-dependency Node.js server (Node 18+)
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { data, save, nextId, hashPassword, verifyPassword, DATA_DIR } = require('./store');
const engine = require('./engine');
const push = require('./push');

const PORT = process.env.PORT || 3000;
const TZ = process.env.TZ_NAME || 'America/New_York';

// persist a session secret across restarts
const secretFile = path.join(DATA_DIR, '.secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
const SECRET = process.env.SESSION_SECRET || fs.readFileSync(secretFile, 'utf8').trim();

// ---------- helpers ----------
const RANK = { slinger: 0, manager: 1, admin: 2 };
const rank = u => RANK[u.level] ?? 0;
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function signSession(uid) {
  const body = b64u(JSON.stringify({ uid, exp: Date.now() + 30 * 24 * 3600 * 1000 }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function readSession(req) {
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('kop_session='));
  if (!cookie) return null;
  const [body, sig] = cookie.slice('kop_session='.length).split('.');
  if (!body || !sig) return null;
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const s = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (s.exp < Date.now()) return null;
    return s;
  } catch { return null; }
}
const businessDate = engine.businessDate;
function nowTime() { return new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }); }
function dayOfWeek(dateStr) { return new Date(dateStr + 'T12:00:00Z').getUTCDay(); }

const cartById = id => data.locations.find(l => l.id === id);
const userById = id => data.users.find(u => u.id === id);
const catById = id => data.categories.find(c => c.id === id);
const terrById = id => (data.territories || []).find(t => t.id === id);
const activeCarts = () => data.locations.filter(l => l.active).sort((a, b) => a.name.localeCompare(b.name));
function publicUser(u) {
  const { password_hash, ...rest } = u;
  rest.is_admin = u.level === 'admin' ? 1 : 0;
  return rest;
}
function checklistOut(c) {
  return {
    ...c, items: [...c.items].sort((a, b) => a.position - b.position),
    location_name: c.location_id ? (cartById(c.location_id) || {}).name : null,
    category_name: c.category_id ? (catById(c.category_id) || {}).name : null,
  };
}
function cartOut(l) {
  return {
    ...l, category_name: l.category_id ? (catById(l.category_id) || {}).name : null,
    territory_name: l.territory_id ? (terrById(l.territory_id) || {}).name : null,
    notifier_names: (l.notifier_ids || []).map(id => (userById(id) || {}).name).filter(Boolean),
  };
}
function shiftOut(s) {
  const u = userById(s.user_id), c = s.cart_id ? cartById(s.cart_id) : null;
  return { ...s, user_name: u ? u.name : '—', cart_name: c ? c.name : null };
}
function instanceOut(i) {
  const tpl = data.checklists.find(c => c.id === i.checklist_id);
  const cart = i.cart_id ? cartById(i.cart_id) : null;
  const u = userById(i.user_id);
  const sub = i.submission_id ? data.submissions.find(s => s.id === i.submission_id) : null;
  return {
    ...i, checklist_name: tpl ? tpl.name : '?', emoji: tpl ? tpl.emoji : '📋',
    items: tpl ? [...tpl.items].sort((a, b) => a.position - b.position) : [],
    description: tpl ? tpl.description : '',
    cart_name: cart ? cart.name : null, user_name: u ? u.name : '—',
    completed_at: sub ? sub.completed_at : null,
    flags: sub ? sub.responses.filter(r => r.flagged).length : 0,
  };
}
function subSummary(s) {
  if (!s) return null;
  const u = s.user_id ? userById(s.user_id) : null;
  return { id: s.id, completed_at: s.completed_at, user_name: u ? u.name : null };
}
function findDailySubmission(checklistId, date, locId) {
  return data.submissions.find(s => s.checklist_id === checklistId && s.date === date &&
    !s.instance_id && (s.location_id ?? null) === (locId ?? null));
}

// ---------- micro framework ----------
const routes = [];
function on(method, pattern, handler, opts = {}) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, handler, ...opts });
}
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.mp4': 'video/mp4' };
function serveFile(res, full, downloadName) {
  const ext = path.extname(full).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (downloadName && !MIME[ext]) headers['Content-Disposition'] = `attachment; filename="${downloadName.replace(/[^\w. -]/g, '_')}"`;
  res.writeHead(200, headers);
  fs.createReadStream(full).pipe(res);
}
function saveDataUrl(dataUrl, origName) {
  const m = /^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/.exec(String(dataUrl));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 15 * 1024 * 1024) throw new Error('File too large (15 MB max)');
  let ext = (path.extname(origName || '') || '').toLowerCase().slice(0, 8);
  if (!/^\.[a-z0-9]+$/.test(ext)) ext = '';
  const fname = crypto.randomBytes(12).toString('hex') + ext;
  fs.writeFileSync(path.join(DATA_DIR, 'uploads', fname), buf);
  return { fname, mime: m[1], size: buf.length };
}

// ---------- auth ----------
on('POST', '/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = data.users.find(x => x.active && x.email.toLowerCase() === String(email || '').trim().toLowerCase());
  if (!u || !verifyPassword(password || '', u.password_hash)) return send(res, 401, { error: 'Wrong email or password' });
  res.setHeader('Set-Cookie', `kop_session=${signSession(u.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
  send(res, 200, { user: publicUser(u) });
});
on('POST', '/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'kop_session=; Path=/; HttpOnly; Max-Age=0');
  send(res, 200, { ok: true });
});
on('GET', '/api/me', (req, res) => send(res, 200, { user: req.user ? publicUser(req.user) : null }));
on('POST', '/api/me/password', (req, res) => {
  const { current, next } = req.body || {};
  if (!verifyPassword(current || '', req.user.password_hash)) return send(res, 400, { error: 'Current password is wrong' });
  if (!next || String(next).length < 6) return send(res, 400, { error: 'New password must be 6+ characters' });
  req.user.password_hash = hashPassword(next); save();
  send(res, 200, { ok: true });
}, { auth: true });

// ---------- worker: today ----------
on('GET', '/api/today', (req, res) => {
  engine.generateInstances();
  engine.markOverdue();
  const date = businessDate();
  const dow = String(dayOfWeek(date));
  const u = req.user;

  const daily = data.checklists.filter(c => {
    if (!c.active || c.trigger !== 'daily' || !c.days.split(',').includes(dow)) return false;
    if (c.location_id && u.location_id && c.location_id !== u.location_id) return false;
    if (c.job_role && u.job_role && rank(u) === 0 && c.job_role !== u.job_role) return false;
    return true;
  }).map(c => {
    const out = checklistOut(c);
    const locId = u.location_id || c.location_id || null;
    const sub = findDailySubmission(c.id, date, locId);
    out.submission = subSummary(sub);
    out.overdue = !sub && c.due_time ? nowTime() > c.due_time : false;
    return out;
  });

  const instances = data.instances
    .filter(i => i.user_id === u.id && (i.date === date || i.status !== 'complete'))
    .filter(i => new Date(i.populate_at).getTime() > Date.now() - 36 * 3600000)
    .sort((a, b) => new Date(a.populate_at) - new Date(b.populate_at))
    .map(instanceOut);

  const now = Date.now();
  const myShift = data.shifts
    .filter(s => s.user_id === u.id && new Date(s.end_at).getTime() > now - 2 * 3600000)
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))[0] || null;

  send(res, 200, { date, checklists: daily, instances, shift: myShift ? shiftOut(myShift) : null });
}, { auth: true });

// ---------- clock in / out (feeds Square timecards) ----------
function openTimecard(userId) {
  return data.timecards.find(t => t.user_id === userId && !t.clock_out_at);
}
function activeShiftFor(user) {
  const now = Date.now();
  return data.shifts
    .filter(s => s.user_id === user.id &&
      now >= new Date(s.start_at).getTime() - 45 * 60000 &&
      now <= new Date(s.end_at).getTime() + 60 * 60000)
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))[0] || null;
}
function clockState(user) {
  const tc = openTimecard(user.id);
  const shift = tc ? data.shifts.find(s => s.id === tc.shift_id) : activeShiftFor(user);
  return {
    clocked_in: !!tc,
    clock_in_at: tc ? tc.clock_in_at : null,
    synced_to_square: tc ? !!tc.square_timecard_id : null,
    sync_error: tc ? tc.sync_error : null,
    shift: shift ? shiftOut(shift) : null,
  };
}
on('GET', '/api/clock', (req, res) => send(res, 200, clockState(req.user)), { auth: true });
on('POST', '/api/clock/in', async (req, res) => {
  const u = req.user;
  if (openTimecard(u.id)) return send(res, 409, { error: "You're already clocked in" });
  let shift = activeShiftFor(u);
  if (!shift) {
    // no scheduled shift right now -> need cart + end time (pickup)
    const b = req.body || {};
    if (!b.cart_id || !b.end_at) return send(res, 200, { need_details: true });
    const cart = cartById(Number(b.cart_id));
    const end = new Date(b.end_at);
    if (!cart) return send(res, 400, { error: 'Pick a location' });
    if (isNaN(end) || end <= new Date()) return send(res, 400, { error: 'Enter a valid shift end time' });
    shift = {
      id: nextId('shift'), square_id: null, source: 'pickup',
      user_id: u.id, cart_id: cart.id,
      start_at: new Date().toISOString(), end_at: end.toISOString(),
      date: businessDate(), notes: 'Clocked in via app',
    };
    data.shifts.push(shift); save();
  }
  const sq = await engine.clockInSquare(u);
  const tc = {
    id: nextId('timecard'), user_id: u.id, shift_id: shift.id, cart_id: shift.cart_id,
    square_timecard_id: sq.id || null, sync_error: sq.error || null,
    clock_in_at: new Date().toISOString(), clock_out_at: null,
  };
  data.timecards.push(tc); save();
  engine.populateNow(shift, 'opening'); // opening checklist is required at clock-in
  send(res, 200, { ok: true, ...clockState(u) });
}, { auth: true });
on('POST', '/api/clock/out', async (req, res) => {
  const u = req.user;
  const tc = openTimecard(u.id);
  if (!tc) return send(res, 409, { error: "You're not clocked in" });
  const shift = data.shifts.find(s => s.id === tc.shift_id);
  // slingers must finish their checklists before clocking out
  if (u.level === 'slinger' && shift) {
    engine.populateNow(shift, 'closing');
    const blocking = data.instances
      .filter(i => i.shift_id === shift.id && i.user_id === u.id && i.status !== 'complete')
      .map(i => (data.checklists.find(c => c.id === i.checklist_id) || {}).name || 'Checklist');
    if (blocking.length)
      return send(res, 409, { error: 'Finish your checklists before clocking out: ' + blocking.join(', '), blocking });
  }
  const sq = await engine.clockOutSquare(tc.square_timecard_id);
  tc.clock_out_at = new Date().toISOString();
  if (sq.error && tc.square_timecard_id) tc.sync_error = sq.error;
  save();
  send(res, 200, { ok: true, ...clockState(u), sync_error: sq.error || null });
}, { auth: true });

// ---------- my schedule + open shifts + requests ----------
function openShiftOut(o, userId) {
  const cart = o.cart_id ? cartById(o.cart_id) : null;
  const reqs = data.shift_requests.filter(r => r.open_shift_id === o.id);
  const mine = reqs.find(r => r.user_id === userId);
  return {
    ...o, cart_name: cart ? cart.name : null,
    my_request: mine ? mine.status : null,
    request_count: reqs.filter(r => r.status === 'pending').length,
  };
}
on('GET', '/api/myschedule', (req, res) => {
  const today = businessDate();
  const shifts = data.shifts
    .filter(s => s.user_id === req.user.id && s.date >= today)
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
    .slice(0, 30).map(shiftOut);
  const open = data.open_shifts
    .filter(o => new Date(o.end_at).getTime() > Date.now())
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
    .map(o => openShiftOut(o, req.user.id));
  send(res, 200, { today, shifts, open_shifts: open, clock: clockState(req.user) });
}, { auth: true });
on('POST', '/api/requests', (req, res) => {
  const o = data.open_shifts.find(x => x.id === Number((req.body || {}).open_shift_id));
  if (!o) return send(res, 404, { error: 'Open shift not found (it may have been assigned)' });
  if (data.shift_requests.some(r => r.open_shift_id === o.id && r.user_id === req.user.id))
    return send(res, 409, { error: 'You already requested this shift' });
  data.shift_requests.push({
    id: nextId('request'), open_shift_id: o.id, user_id: req.user.id,
    status: 'pending', created_at: new Date().toISOString(), decided_by: null,
  });
  save();
  // notify managers of the cart's territory (or admins)
  const cart = o.cart_id ? cartById(o.cart_id) : null;
  const when = new Date(o.start_at).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const recipients = new Set();
  if (cart && cart.territory_id)
    data.users.filter(x => x.active && x.level === 'manager' && (x.territory_ids || []).includes(cart.territory_id)).forEach(x => recipients.add(x.id));
  if (!recipients.size) data.users.filter(x => x.active && x.level === 'admin').forEach(x => recipients.add(x.id));
  recipients.forEach(id => engine.notify(id, `🙋 Shift request`, `${req.user.name} wants ${cart ? cart.name : 'an open shift'} — ${when}`));
  send(res, 200, { ok: true });
}, { auth: true });
on('GET', '/api/requests', (req, res) => {
  const rows = data.shift_requests
    .filter(r => r.status === 'pending')
    .map(r => {
      const o = data.open_shifts.find(x => x.id === r.open_shift_id);
      const u = userById(r.user_id);
      return o && u ? { ...r, user_name: u.name, shift: openShiftOut(o, req.user.id) } : null;
    }).filter(Boolean)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  send(res, 200, rows);
}, { level: 'manager' });
on('POST', '/api/requests/:id/decide', (req, res) => {
  const r = data.shift_requests.find(x => x.id === Number(req.params.id));
  if (!r || r.status !== 'pending') return send(res, 404, { error: 'Request not found or already decided' });
  const approve = !!(req.body || {}).approve;
  const o = data.open_shifts.find(x => x.id === r.open_shift_id);
  const cart = o && o.cart_id ? cartById(o.cart_id) : null;
  const when = o ? new Date(o.start_at).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  r.status = approve ? 'approved' : 'declined';
  r.decided_by = req.user.id;
  if (approve) {
    engine.notify(r.user_id, '✅ Shift request approved!', `${cart ? cart.name : 'Open shift'} — ${when}. You'll see it in My Shifts once it's assigned in Square.`);
    // decline other pending requests for the same shift
    data.shift_requests.filter(x => x.open_shift_id === r.open_shift_id && x.status === 'pending').forEach(x => {
      x.status = 'declined'; x.decided_by = req.user.id;
      engine.notify(x.user_id, 'Shift request update', `${cart ? cart.name : 'The open shift'} on ${when} went to someone else this time.`);
    });
  } else {
    engine.notify(r.user_id, 'Shift request update', `Your request for ${cart ? cart.name : 'the open shift'} (${when}) was declined.`);
  }
  save();
  send(res, 200, { ok: true, reminder: approve ? 'Now assign this shift in Square scheduling so it syncs to their schedule.' : null });
}, { level: 'manager' });

// ---------- pickup shift (any level): self-populate checklists ----------
on('POST', '/api/shifts/pickup', (req, res) => {
  const b = req.body || {};
  const cart = cartById(Number(b.cart_id));
  if (!cart) return send(res, 400, { error: 'Pick a location' });
  const end = new Date(b.end_at);
  if (isNaN(end) || end <= new Date()) return send(res, 400, { error: 'Enter a valid shift end time (in the future)' });
  const start = new Date();
  const shift = {
    id: nextId('shift'), square_id: null, source: 'pickup',
    user_id: req.user.id, cart_id: cart.id,
    start_at: start.toISOString(), end_at: end.toISOString(),
    date: start.toLocaleDateString('en-CA', { timeZone: TZ }), notes: 'Picked up in app',
  };
  data.shifts.push(shift); save();
  engine.generateInstances();
  send(res, 200, shiftOut(shift));
}, { auth: true });

// ---------- submit (daily or instance) ----------
on('POST', '/api/checklists/:id/submit', (req, res) => {
  const c = data.checklists.find(x => x.id === Number(req.params.id) && x.active);
  if (!c) return send(res, 404, { error: 'Checklist not found' });
  const answers = (req.body && req.body.responses) || {};
  const photos = (req.body && req.body.photos) || {};
  const instanceId = req.body.instance_id ? Number(req.body.instance_id) : null;

  let instance = null;
  if (instanceId) {
    instance = data.instances.find(i => i.id === instanceId);
    if (!instance) return send(res, 404, { error: 'Task not found' });
    if (instance.user_id !== req.user.id && rank(req.user) < 2) return send(res, 403, { error: 'Not your task' });
    if (instance.status === 'complete') return send(res, 409, { error: 'Already completed' });
  }

  for (const it of c.items) {
    const v = answers[it.id];
    if (it.type === 'photo') {
      if (it.required && !photos[it.id]) return send(res, 400, { error: `Photo required: "${it.label}"` });
    } else if (it.required && (v === undefined || v === null || String(v).trim() === '')) {
      return send(res, 400, { error: `Required: "${it.label}"` });
    }
    if (it.type === 'number' && v !== undefined && v !== '' && v !== null && isNaN(Number(v)))
      return send(res, 400, { error: `"${it.label}" must be a number` });
    if (it.type === 'choice' && v && it.options) {
      const opts = it.options.split(',').map(x => x.trim()).filter(Boolean);
      if (!opts.includes(String(v))) return send(res, 400, { error: `Pick one of the options for "${it.label}"` });
    }
  }

  const date = businessDate();
  const locId = instance ? instance.cart_id
    : (req.user.location_id || c.location_id || (req.body.location_id ? Number(req.body.location_id) : null));
  if (!instance && findDailySubmission(c.id, date, locId))
    return send(res, 409, { error: 'Already completed today for this location' });

  const photoFiles = {};
  for (const [itemId, dataUrl] of Object.entries(photos)) {
    if (!/^data:image\//.test(String(dataUrl))) continue;
    try {
      const saved = saveDataUrl(dataUrl, 'photo.jpg');
      if (saved) photoFiles[itemId] = saved.fname;
    } catch (e) { return send(res, 400, { error: e.message }); }
  }

  const sortedItems = [...c.items].sort((a, b) => a.position - b.position);
  const sub = {
    id: nextId('submission'), checklist_id: c.id, location_id: locId, user_id: req.user.id,
    instance_id: instanceId, date, completed_at: new Date().toISOString(),
    responses: sortedItems.map(it => {
      const raw = answers[it.id];
      const value = raw != null ? String(raw) : null;
      let flagged = 0;
      if (it.type === 'number' && value) {
        const n = Number(value);
        if ((it.min != null && n < it.min) || (it.max != null && n > it.max)) flagged = 1;
      }
      if (it.type === 'yesno' && value === 'no') flagged = 1;
      return { item_id: it.id, value, photo: photoFiles[it.id] || null, flagged };
    }),
  };
  data.submissions.push(sub);
  if (instance) { instance.status = 'complete'; instance.submission_id = sub.id; }
  save();
  send(res, 200, { ok: true, submission_id: sub.id });
}, { auth: true, bigBody: true });

// ---------- photos / files ----------
on('GET', '/api/photos/:file', (req, res) => {
  const full = path.join(DATA_DIR, 'uploads', path.basename(req.params.file));
  if (!fs.existsSync(full)) return send(res, 404, { error: 'Not found' });
  serveFile(res, full);
}, { auth: true });
on('GET', '/api/files/:file', (req, res) => {
  const full = path.join(DATA_DIR, 'uploads', path.basename(req.params.file));
  if (!fs.existsSync(full)) return send(res, 404, { error: 'Not found' });
  serveFile(res, full, req.query.name || 'download');
}, { auth: true });

// ---------- territories ----------
on('GET', '/api/territories', (req, res) => {
  const out = (data.territories || []).map(t => ({
    ...t,
    manager_names: data.users.filter(u => u.active && u.level === 'manager' && (u.territory_ids || []).includes(t.id)).map(u => u.name),
    cart_count: data.locations.filter(l => l.active && l.territory_id === t.id).length,
  }));
  send(res, 200, out);
}, { auth: true });
on('POST', '/api/territories', (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return send(res, 400, { error: 'Name required' });
  const t = { id: nextId('territory'), name };
  data.territories.push(t);
  data.channels.push({ id: nextId('channel'), name, type: 'territory', territory_id: t.id, member_ids: null });
  save();
  send(res, 200, t);
}, { level: 'admin' });
on('PUT', '/api/territories/:id', (req, res) => {
  const t = terrById(Number(req.params.id));
  if (!t) return send(res, 404, { error: 'Not found' });
  t.name = String((req.body || {}).name || t.name).trim();
  const ch = data.channels.find(c => c.type === 'territory' && c.territory_id === t.id);
  if (ch) ch.name = t.name;
  save();
  send(res, 200, { ok: true });
}, { level: 'admin' });
on('DELETE', '/api/territories/:id', (req, res) => {
  const id = Number(req.params.id);
  data.locations.forEach(l => { if (l.territory_id === id) l.territory_id = null; });
  data.users.forEach(u => { if (u.territory_ids) u.territory_ids = u.territory_ids.filter(x => x !== id); });
  const ch = data.channels.find(c => c.type === 'territory' && c.territory_id === id);
  if (ch) { data.messages = data.messages.filter(m => m.channel_id !== ch.id); data.channels = data.channels.filter(c => c.id !== ch.id); }
  data.territories = data.territories.filter(t => t.id !== id);
  save();
  send(res, 200, { ok: true });
}, { level: 'admin' });

// ---------- categories ----------
on('GET', '/api/categories', (req, res) => send(res, 200, data.categories), { auth: true });
on('POST', '/api/categories', (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return send(res, 400, { error: 'Name required' });
  const cat = { id: nextId('category'), name };
  data.categories.push(cat); save();
  send(res, 200, cat);
}, { level: 'admin' });
on('PUT', '/api/categories/:id', (req, res) => {
  const cat = catById(Number(req.params.id));
  if (!cat) return send(res, 404, { error: 'Not found' });
  cat.name = String((req.body || {}).name || cat.name).trim(); save();
  send(res, 200, { ok: true });
}, { level: 'admin' });
on('DELETE', '/api/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  if (data.locations.some(l => l.active && l.category_id === id))
    return send(res, 400, { error: 'Move its locations to another category first' });
  data.categories = data.categories.filter(c => c.id !== id); save();
  send(res, 200, { ok: true });
}, { level: 'admin' });

// ---------- carts ----------
on('GET', '/api/locations', (req, res) => send(res, 200, activeCarts().map(cartOut)), { auth: true });
on('POST', '/api/locations', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return send(res, 400, { error: 'Name required' });
  if (data.locations.some(l => l.active && l.name.toLowerCase() === name.toLowerCase()))
    return send(res, 400, { error: 'That location already exists' });
  const loc = {
    id: nextId('location'), name, category_id: b.category_id || null, territory_id: b.territory_id || null,
    notifier_ids: (b.notifier_ids || []).map(Number), active: 1,
  };
  data.locations.push(loc); save();
  send(res, 200, cartOut(loc));
}, { level: 'admin' });
on('PUT', '/api/locations/:id', (req, res) => {
  const l = cartById(Number(req.params.id));
  if (!l) return send(res, 404, { error: 'Not found' });
  const b = req.body || {};
  if (b.name != null) l.name = String(b.name).trim();
  if (b.category_id !== undefined) l.category_id = b.category_id || null;
  if (b.territory_id !== undefined) l.territory_id = b.territory_id || null;
  if (b.notifier_ids !== undefined) l.notifier_ids = (b.notifier_ids || []).map(Number);
  save();
  send(res, 200, cartOut(l));
}, { level: 'admin' });
on('DELETE', '/api/locations/:id', (req, res) => {
  const l = cartById(Number(req.params.id));
  if (l) { l.active = 0; save(); }
  send(res, 200, { ok: true });
}, { level: 'admin' });

// ---------- users ----------
on('GET', '/api/users', (req, res) => {
  const rows = data.users.filter(u => u.active).sort((a, b) => a.name.localeCompare(b.name))
    .map(u => ({
      ...publicUser(u),
      location_name: u.location_id ? (cartById(u.location_id) || {}).name : null,
      territory_names: (u.territory_ids || []).map(id => (terrById(id) || {}).name).filter(Boolean),
    }));
  send(res, 200, rows);
}, { level: 'manager' });
on('POST', '/api/users', (req, res) => {
  const { name, email, password, level, job_role, location_id, territory_ids } = req.body || {};
  if (!name || !email || !password) return send(res, 400, { error: 'Name, email, and password are required' });
  if (String(password).length < 6) return send(res, 400, { error: 'Password must be 6+ characters' });
  if (data.users.some(u => u.active && u.email.toLowerCase() === String(email).trim().toLowerCase()))
    return send(res, 400, { error: 'That email is already in use' });
  let newLevel = ['admin', 'manager', 'slinger'].includes(level) ? level : 'slinger';
  if (RANK[newLevel] >= rank(req.user) && req.user.level !== 'admin')
    return send(res, 403, { error: 'Managers can only add Slingers' });
  const u = {
    id: nextId('user'), name: String(name).trim(), email: String(email).trim(),
    password_hash: hashPassword(password), level: newLevel, is_admin: newLevel === 'admin' ? 1 : 0,
    job_role: job_role || null, location_id: location_id || null,
    territory_ids: (territory_ids || []).map(Number), square_team_member_id: null, active: 1,
  };
  data.users.push(u); save();
  send(res, 200, publicUser(u));
}, { level: 'manager' });
on('PUT', '/api/users/:id', (req, res) => {
  const u = userById(Number(req.params.id));
  if (!u) return send(res, 404, { error: 'User not found' });
  // managers can only edit users below their level
  if (rank(req.user) < 2 && u.id !== req.user.id && rank(u) >= rank(req.user))
    return send(res, 403, { error: "You can't edit someone at your level or above" });
  const b = req.body || {};
  if (b.email && data.users.some(x => x.id !== u.id && x.active && x.email.toLowerCase() === String(b.email).trim().toLowerCase()))
    return send(res, 400, { error: 'That email is already in use' });
  if (b.password) {
    if (String(b.password).length < 6) return send(res, 400, { error: 'Password must be 6+ characters' });
    u.password_hash = hashPassword(b.password);
  }
  if (b.level && ['admin', 'manager', 'slinger'].includes(b.level) && b.level !== u.level) {
    if (u.id === req.user.id) return send(res, 400, { error: "You can't change your own level" });
    if (rank(req.user) < 2) return send(res, 403, { error: 'Only admins can change levels' });
    u.level = b.level; u.is_admin = b.level === 'admin' ? 1 : 0;
  }
  if (b.name != null) u.name = String(b.name).trim();
  if (b.email != null) { u.email = String(b.email).trim(); u.square_team_member_id = null; }
  if (b.job_role !== undefined) u.job_role = b.job_role || null;
  if (b.location_id !== undefined) u.location_id = b.location_id || null;
  if (b.territory_ids !== undefined) u.territory_ids = (b.territory_ids || []).map(Number);
  save();
  send(res, 200, { ok: true });
}, { level: 'manager' });
on('DELETE', '/api/users/:id', (req, res) => {
  if (Number(req.params.id) === req.user.id) return send(res, 400, { error: "You can't remove yourself" });
  const u = userById(Number(req.params.id));
  if (u && rank(req.user) < 2 && rank(u) >= rank(req.user))
    return send(res, 403, { error: "You can't remove someone at your level or above" });
  if (u) { u.active = 0; save(); }
  send(res, 200, { ok: true });
}, { level: 'manager' });

// ---------- checklists (admin only edits) ----------
on('GET', '/api/checklists', (req, res) => {
  send(res, 200, data.checklists.filter(c => c.active).sort((a, b) => a.name.localeCompare(b.name)).map(checklistOut));
}, { level: 'manager' });
function normalizeItems(items) {
  return (items || []).filter(i => i && i.label && String(i.label).trim()).map((it, i) => ({
    id: it.id || null, position: i, type: it.type, label: String(it.label).trim(),
    required: it.required ? 1 : 0, unit: it.unit || null,
    options: it.options ? String(it.options).trim() : null,
    min: it.min === '' || it.min == null ? null : Number(it.min),
    max: it.max === '' || it.max == null ? null : Number(it.max),
  }));
}
on('POST', '/api/checklists', (req, res) => {
  const b = req.body || {};
  const items = normalizeItems(b.items);
  if (!b.name || !String(b.name).trim()) return send(res, 400, { error: 'Name required' });
  if (!items.length) return send(res, 400, { error: 'Add at least one item' });
  const c = {
    id: nextId('checklist'), name: String(b.name).trim(), description: b.description || null,
    emoji: b.emoji || '📋', trigger: ['opening', 'closing', 'daily'].includes(b.trigger) ? b.trigger : 'daily',
    location_id: b.location_id || null, category_id: b.category_id || null, job_role: b.job_role || null,
    days: b.days || '0,1,2,3,4,5,6', due_time: b.due_time || null, active: 1,
    items: items.map(it => ({ ...it, id: nextId('item') })),
  };
  data.checklists.push(c); save();
  send(res, 200, checklistOut(c));
}, { level: 'admin' });
on('PUT', '/api/checklists/:id', (req, res) => {
  const c = data.checklists.find(x => x.id === Number(req.params.id));
  if (!c) return send(res, 404, { error: 'Checklist not found' });
  const b = req.body || {};
  if (b.name != null) c.name = String(b.name).trim();
  if (b.description !== undefined) c.description = b.description || null;
  if (b.emoji != null) c.emoji = b.emoji;
  if (b.trigger && ['opening', 'closing', 'daily'].includes(b.trigger)) c.trigger = b.trigger;
  if (b.location_id !== undefined) c.location_id = b.location_id || null;
  if (b.category_id !== undefined) c.category_id = b.category_id || null;
  if (b.job_role !== undefined) c.job_role = b.job_role || null;
  if (b.days != null) c.days = b.days;
  if (b.due_time !== undefined) c.due_time = b.due_time || null;
  if (b.items) {
    const existing = new Set(c.items.map(i => i.id));
    c.items = normalizeItems(b.items).map(it =>
      it.id && existing.has(it.id) ? it : { ...it, id: nextId('item') });
  }
  save();
  send(res, 200, checklistOut(c));
}, { level: 'admin' });
on('DELETE', '/api/checklists/:id', (req, res) => {
  const c = data.checklists.find(x => x.id === Number(req.params.id));
  if (c) { c.active = 0; save(); }
  send(res, 200, { ok: true });
}, { level: 'admin' });

// ---------- shifts / schedule ----------
on('GET', '/api/shifts', (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : businessDate();
  const rows = data.shifts.filter(s => s.date === date)
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at)).map(shiftOut);
  send(res, 200, { date, shifts: rows });
}, { level: 'manager' });
on('POST', '/api/shifts', (req, res) => {
  const b = req.body || {};
  const user = userById(Number(b.user_id));
  if (!user) return send(res, 400, { error: 'Pick a teammate' });
  const start = new Date(b.start_at), end = new Date(b.end_at);
  if (isNaN(start) || isNaN(end) || end <= start) return send(res, 400, { error: 'Enter a valid start and end time' });
  const shift = {
    id: nextId('shift'), square_id: null, source: 'manual',
    user_id: user.id, cart_id: b.cart_id ? Number(b.cart_id) : null,
    start_at: start.toISOString(), end_at: end.toISOString(),
    date: start.toLocaleDateString('en-CA', { timeZone: TZ }), notes: b.notes || '',
  };
  data.shifts.push(shift); save();
  engine.generateInstances();
  send(res, 200, shiftOut(shift));
}, { level: 'manager' });
on('DELETE', '/api/shifts/:id', (req, res) => {
  const id = Number(req.params.id);
  data.instances = data.instances.filter(i => !(i.shift_id === id && i.status !== 'complete'));
  data.shifts = data.shifts.filter(s => s.id !== id);
  save();
  send(res, 200, { ok: true });
}, { level: 'manager' });

// ---------- Square settings ----------
on('GET', '/api/square', (req, res) => {
  const s = data.settings;
  send(res, 200, {
    connected: !!s.square_token,
    token_preview: s.square_token ? '••••' + s.square_token.slice(-4) : null,
    env: s.square_env || 'production',
    last_sync: s.square_last_sync || null,
    last_error: s.square_last_error || null,
    location_id: s.square_location_id || null,
    matched_users: data.users.filter(u => u.active && u.square_team_member_id).length,
  });
}, { level: 'manager' });
on('PUT', '/api/square', (req, res) => {
  const b = req.body || {};
  if (b.token !== undefined) data.settings.square_token = String(b.token || '').trim() || null;
  if (b.env) data.settings.square_env = b.env === 'sandbox' ? 'sandbox' : 'production';
  if (b.location_id !== undefined) data.settings.square_location_id = b.location_id || null;
  save();
  send(res, 200, { ok: true });
}, { level: 'admin' });
on('GET', '/api/square/locations', async (req, res) => {
  try { send(res, 200, await engine.listSquareLocations()); }
  catch (e) { send(res, 400, { error: e.message }); }
}, { level: 'admin' });
on('POST', '/api/square/sync', async (req, res) => {
  const result = await engine.syncSquare();
  engine.generateInstances();
  send(res, result.ok ? 200 : 400, result);
}, { level: 'manager' });
on('POST', '/api/square/import-team', async (req, res) => {
  try {
    const result = await engine.importTeam();
    send(res, 200, result);
  } catch (e) { send(res, 400, { error: e.message }); }
}, { level: 'admin' });

// ---------- backup / restore (for moving between computers or to a server) ----------
on('GET', '/api/backup', (req, res) => {
  const body = JSON.stringify(data, null, 1);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="kop-backup-${businessDate()}.json"`,
  });
  res.end(body);
}, { level: 'admin' });
on('POST', '/api/restore', (req, res) => {
  const b = req.body;
  if (!b || !b.users || !b.checklists || !b.seq) return send(res, 400, { error: 'That does not look like a KOP backup file' });
  // keep the restoring admin able to log in: ensure their account exists in the backup
  const me = b.users.find(x => x.active && x.email.toLowerCase() === req.user.email.toLowerCase());
  if (!me) return send(res, 400, { error: 'Backup does not contain your admin account — restore aborted' });
  Object.keys(data).forEach(k => delete data[k]);
  Object.assign(data, b);
  save();
  send(res, 200, { ok: true, note: 'Data restored. Photos/files are not part of the backup file.' });
}, { level: 'admin', bigBody: true });

// ---------- notifications ----------
on('GET', '/api/notifications', (req, res) => {
  const mine = data.notifications.filter(n => n.user_id === req.user.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 50);
  send(res, 200, { notifications: mine, unread: mine.filter(n => !n.read).length });
}, { auth: true });
on('POST', '/api/notifications/read', (req, res) => {
  data.notifications.forEach(n => { if (n.user_id === req.user.id) n.read = 1; });
  save();
  send(res, 200, { ok: true });
}, { auth: true });

// ---------- push ----------
on('GET', '/api/push/key', (req, res) => send(res, 200, { key: push.getPublicKey() }), { auth: true });
on('POST', '/api/push/subscribe', (req, res) => {
  const sub = (req.body || {}).subscription;
  if (!sub || !sub.endpoint || !sub.keys) return send(res, 400, { error: 'Bad subscription' });
  if (!data.push_subs.some(s => s.sub.endpoint === sub.endpoint)) {
    data.push_subs.push({ id: nextId('push'), user_id: req.user.id, sub, created_at: new Date().toISOString() });
    save();
  }
  send(res, 200, { ok: true });
}, { auth: true });
on('POST', '/api/push/test', async (req, res) => {
  await push.pushToUser(req.user.id, { title: '🍭 King of Pops', body: 'Push notifications are working on this device!' });
  send(res, 200, { ok: true });
}, { auth: true });

// ---------- chat ----------
function lastReadId(userId, channelId) {
  const r = data.reads.find(x => x.user_id === userId && x.channel_id === channelId);
  return r ? r.last_read_id : 0;
}
function setRead(userId, channelId, msgId) {
  let r = data.reads.find(x => x.user_id === userId && x.channel_id === channelId);
  if (!r) { r = { user_id: userId, channel_id: channelId, last_read_id: 0 }; data.reads.push(r); }
  if (msgId > r.last_read_id) { r.last_read_id = msgId; save(); }
}
function visibleChannels(u) {
  return data.channels.filter(c => c.type !== 'dm' || (c.member_ids || []).includes(u.id));
}
function channelOut(c, u) {
  const last = [...data.messages].reverse().find(m => m.channel_id === c.id);
  let name = c.name;
  if (c.type === 'dm') {
    const otherId = (c.member_ids || []).find(id => id !== u.id);
    name = otherId ? (userById(otherId) || {}).name || 'Direct message' : 'Direct message';
  }
  return {
    id: c.id, name, type: c.type,
    unread: data.messages.filter(m => m.channel_id === c.id && m.id > lastReadId(u.id, c.id) && m.user_id !== u.id).length,
    last_at: last ? last.created_at : null,
    last_preview: last ? (last.text ? last.text.slice(0, 70) : '📎 ' + (last.file_name || 'File')) : null,
    last_from: last ? (((userById(last.user_id) || {}).name || '').split(' ')[0] || null) : null,
  };
}
// lightweight people list so anyone (incl. slingers) can start a DM
on('GET', '/api/chat/people', (req, res) => {
  send(res, 200, data.users.filter(u => u.active && u.id !== req.user.id)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(u => ({ id: u.id, name: u.name, level: u.level })));
}, { auth: true });
on('GET', '/api/chat/channels', (req, res) => {
  const chans = visibleChannels(req.user).map(c => channelOut(c, req.user));
  chans.sort((a, b) => (a.type === 'general' ? -1 : b.type === 'general' ? 1 : String(b.last_at || '').localeCompare(String(a.last_at || ''))));
  send(res, 200, chans);
}, { auth: true });
on('POST', '/api/chat/dm', (req, res) => {
  const other = userById(Number((req.body || {}).user_id));
  if (!other || !other.active) return send(res, 404, { error: 'User not found' });
  if (other.id === req.user.id) return send(res, 400, { error: "That's you!" });
  let ch = data.channels.find(c => c.type === 'dm' && c.member_ids &&
    c.member_ids.includes(req.user.id) && c.member_ids.includes(other.id));
  if (!ch) {
    ch = { id: nextId('channel'), name: 'dm', type: 'dm', territory_id: null, member_ids: [req.user.id, other.id] };
    data.channels.push(ch); save();
  }
  send(res, 200, channelOut(ch, req.user));
}, { auth: true });
on('GET', '/api/chat/messages', (req, res) => {
  const ch = data.channels.find(c => c.id === Number(req.query.channel_id));
  if (!ch) return send(res, 404, { error: 'Channel not found' });
  if (ch.type === 'dm' && !(ch.member_ids || []).includes(req.user.id)) return send(res, 403, { error: 'Not your conversation' });
  const after = Number(req.query.after) || 0;
  let msgs = data.messages.filter(m => m.channel_id === ch.id && m.id > after);
  if (!after) msgs = msgs.slice(-100);
  const out = msgs.map(m => ({
    ...m, user_name: (userById(m.user_id) || {}).name || '—',
    mine: m.user_id === req.user.id,
  }));
  if (out.length) setRead(req.user.id, ch.id, out[out.length - 1].id);
  send(res, 200, { channel: channelOut(ch, req.user), messages: out });
}, { auth: true });
on('POST', '/api/chat/messages', (req, res) => {
  const b = req.body || {};
  const ch = data.channels.find(c => c.id === Number(b.channel_id));
  if (!ch) return send(res, 404, { error: 'Channel not found' });
  if (ch.type === 'dm' && !(ch.member_ids || []).includes(req.user.id)) return send(res, 403, { error: 'Not your conversation' });
  const text = String(b.text || '').trim().slice(0, 4000);
  let file = null, fileName = null, fileType = null;
  if (b.file) {
    try {
      const saved = saveDataUrl(b.file, b.file_name);
      if (saved) { file = saved.fname; fileName = String(b.file_name || 'file').slice(0, 120); fileType = saved.mime; }
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  if (!text && !file) return send(res, 400, { error: 'Say something or attach a file' });
  const msg = {
    id: nextId('message'), channel_id: ch.id, user_id: req.user.id,
    text, file, file_name: fileName, file_type: fileType,
    created_at: new Date().toISOString(),
  };
  data.messages.push(msg);
  setRead(req.user.id, ch.id, msg.id);
  save();
  // push-notify DM recipient
  if (ch.type === 'dm') {
    const otherId = (ch.member_ids || []).find(id => id !== req.user.id);
    if (otherId) engine.notify(otherId, `💬 ${req.user.name}`, text ? text.slice(0, 120) : `Sent a file: ${fileName}`);
  }
  send(res, 200, { ok: true, id: msg.id });
}, { auth: true, bigBody: true });

// ---------- dashboard ----------
function territoryCartIds(territoryId) {
  return new Set(data.locations.filter(l => l.territory_id === territoryId).map(l => l.id));
}
function dailyRows(date, terrFilter) {
  const today = businessDate();
  const dow = String(dayOfWeek(date));
  const rows = [];
  for (const c of data.checklists.filter(c => c.active && c.trigger === 'daily' && c.days.split(',').includes(dow))) {
    let targets;
    if (c.location_id) { const l = cartById(c.location_id); targets = l ? [l] : []; }
    else if (c.category_id) targets = activeCarts().filter(l => l.category_id === c.category_id);
    else targets = activeCarts();
    if (terrFilter) targets = targets.filter(l => terrFilter.has(l.id));
    if (!targets.length && !terrFilter) targets = [{ id: null, name: '—' }];
    for (const l of targets) {
      const sub = findDailySubmission(c.id, date, l.id);
      let status = 'pending';
      if (sub) status = 'complete';
      else if (date < today || (date === today && c.due_time && nowTime() > c.due_time)) status = 'missed';
      rows.push({
        kind: 'daily', checklist_id: c.id, checklist_name: c.name, emoji: c.emoji,
        due_time: c.due_time, location_id: l.id, location_name: l.name, status,
        submission: subSummary(sub),
        flags: sub ? sub.responses.filter(r => r.flagged).length : 0,
      });
    }
  }
  return rows;
}
on('GET', '/api/dashboard', (req, res) => {
  engine.generateInstances(); engine.markOverdue();
  const q = req.query.date;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : businessDate();
  const terrId = Number(req.query.territory_id) || null;
  const terrFilter = terrId ? territoryCartIds(terrId) : null;

  const daily = dailyRows(date, terrFilter);
  let instances = data.instances.filter(i => i.date === date);
  if (terrFilter) instances = instances.filter(i => i.cart_id && terrFilter.has(i.cart_id));
  instances = instances.map(instanceOut);

  const board = [];
  let cartsWithShifts = [...new Set(data.shifts.filter(s => s.date === date).map(s => s.cart_id))];
  if (terrFilter) cartsWithShifts = cartsWithShifts.filter(id => id && terrFilter.has(id));
  for (const cartId of cartsWithShifts) {
    const cart = cartId ? cartById(cartId) : null;
    const cartInstances = instances.filter(i => i.cart_id === cartId);
    const opening = cartInstances.filter(i => i.type === 'opening');
    const closing = cartInstances.filter(i => i.type === 'closing');
    const shifts = data.shifts.filter(s => s.date === date && s.cart_id === cartId).map(shiftOut);
    const openDone = opening.find(i => i.status === 'complete');
    const closeDone = closing.find(i => i.status === 'complete');
    let state = 'scheduled';
    if (closeDone) state = 'closed';
    else if (opening.some(i => i.status === 'overdue') || closing.some(i => i.status === 'overdue')) state = 'overdue';
    else if (openDone) state = 'open';
    else if (opening.length) state = 'not_opened';
    board.push({
      cart_id: cartId, cart_name: cart ? cart.name : '❓ No location matched in shift notes',
      category_name: cart && cart.category_id ? (catById(cart.category_id) || {}).name : '',
      territory_name: cart && cart.territory_id ? (terrById(cart.territory_id) || {}).name : '',
      state,
      opened_at: openDone ? openDone.completed_at : null,
      opened_by: openDone ? openDone.user_name : null,
      closed_at: closeDone ? closeDone.completed_at : null,
      closed_by: closeDone ? closeDone.user_name : null,
      workers: [...new Set(shifts.map(s => s.user_name))],
    });
  }
  board.sort((a, b) => String(a.territory_name).localeCompare(String(b.territory_name)) || String(a.cart_name).localeCompare(String(b.cart_name)));

  const all = [...daily, ...instances.map(i => ({ status: i.status === 'overdue' ? 'missed' : i.status, flags: i.flags }))];
  const done = all.filter(r => r.status === 'complete').length;
  send(res, 200, {
    date, territory_id: terrId, rows: daily, instances, board,
    summary: {
      total: all.length, complete: done,
      missed: all.filter(r => r.status === 'missed').length,
      flagged: all.reduce((a, r) => a + (r.flags || 0), 0),
      pct: all.length ? Math.round(100 * done / all.length) : 0,
    },
  });
}, { level: 'manager' });

on('GET', '/api/trend', (req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 30);
  const terrId = Number(req.query.territory_id) || null;
  const terrFilter = terrId ? territoryCartIds(terrId) : null;
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const date = businessDate(d);
    const daily = dailyRows(date, terrFilter);
    let insts = data.instances.filter(x => x.date === date);
    if (terrFilter) insts = insts.filter(x => x.cart_id && terrFilter.has(x.cart_id));
    const total = daily.length + insts.length;
    const complete = daily.filter(r => r.status === 'complete').length + insts.filter(x => x.status === 'complete').length;
    out.push({ date, total, complete, pct: total ? Math.round(100 * complete / total) : 0 });
  }
  send(res, 200, out);
}, { level: 'manager' });

on('GET', '/api/submissions/:id', (req, res) => {
  const s = data.submissions.find(x => x.id === Number(req.params.id));
  if (!s) return send(res, 404, { error: 'Not found' });
  const c = data.checklists.find(x => x.id === s.checklist_id);
  const itemById = id => c.items.find(i => i.id === id) || {};
  send(res, 200, {
    id: s.id, date: s.date, completed_at: s.completed_at,
    user_name: s.user_id ? (userById(s.user_id) || {}).name : null,
    checklist_name: c.name, emoji: c.emoji,
    location_name: s.location_id ? (cartById(s.location_id) || {}).name : null,
    responses: s.responses.map(r => {
      const it = itemById(r.item_id);
      return { ...r, label: it.label, type: it.type, unit: it.unit, min: it.min, max: it.max, position: it.position };
    }).sort((a, b) => (a.position || 0) - (b.position || 0)),
  });
}, { level: 'manager' });

// ---------- server ----------
const PUBLIC_DIR = path.join(__dirname, 'public');
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const pathname = u.pathname;
  req.query = Object.fromEntries(u.searchParams);

  if (req.method === 'GET' && !pathname.startsWith('/api/')) {
    let file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
      file = path.join(PUBLIC_DIR, 'index.html');
    return serveFile(res, file);
  }

  const route = routes.find(r => r.method === req.method && r.rx.test(pathname));
  if (!route) return send(res, 404, { error: 'Not found' });
  const m = route.rx.exec(pathname);
  req.params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));

  const sess = readSession(req);
  req.user = sess ? data.users.find(x => x.id === sess.uid && x.active) || null : null;
  const needsAuth = route.auth || route.level;
  if (needsAuth && !req.user) return send(res, 401, { error: 'Not signed in' });
  if (route.level && rank(req.user) < RANK[route.level])
    return send(res, 403, { error: route.level === 'admin' ? 'Admins only' : 'Managers and admins only' });

  const limit = route.bigBody ? 40 * 1024 * 1024 : 1 * 1024 * 1024;
  const chunks = [];
  let size = 0, aborted = false;
  req.on('data', ch => {
    size += ch.length;
    if (size > limit) { aborted = true; send(res, 413, { error: 'Upload too large' }); req.destroy(); return; }
    chunks.push(ch);
  });
  req.on('end', () => {
    if (aborted) return;
    if (chunks.length) {
      try { req.body = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { return send(res, 400, { error: 'Bad request body' }); }
    }
    Promise.resolve(route.handler(req, res)).catch(e => {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: 'Server error' });
    });
  });
});

engine.start();
server.listen(PORT, () => console.log(`🍭 King of Pops Checklists v3 running on http://localhost:${PORT}`));
