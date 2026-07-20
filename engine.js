// Scheduling engine: Square shift sync, checklist auto-population, overdue alerts.
const { data, save, nextId } = require('./store');
const { pushToUser } = require('./push');

const TZ = process.env.TZ_NAME || 'America/New_York';
const DUE_MINUTES = 60;          // complete within 1 hour of population
const CLOSING_LEAD_MINUTES = 30; // closing checklist appears 30 min before shift end

const businessDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const cartById = id => data.locations.find(l => l.id === id);
const userById = id => data.users.find(u => u.id === id);

// ---------- Square sync ----------
function squareBase() {
  return data.settings.square_env === 'sandbox'
    ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
}
async function squareFetch(pathname, body, method) {
  const res = await fetch(squareBase() + pathname, {
    method: method || (body ? 'POST' : 'GET'),
    headers: {
      Authorization: `Bearer ${data.settings.square_token}`,
      'Square-Version': '2025-05-21',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json.errors && json.errors[0] && (json.errors[0].detail || json.errors[0].code)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

// Map Square team members to app users by email
async function syncTeamMembers() {
  let cursor, matched = 0;
  do {
    const res = await squareFetch('/v2/team-members/search', {
      query: { filter: { status: 'ACTIVE' } }, limit: 200, cursor,
    });
    for (const tm of res.team_members || []) {
      if (!tm.email_address) continue;
      const u = data.users.find(x => x.active && x.email.toLowerCase() === tm.email_address.toLowerCase());
      if (u && u.square_team_member_id !== tm.id) { u.square_team_member_id = tm.id; matched++; }
      else if (u) matched++;
    }
    cursor = res.cursor;
  } while (cursor);
  return matched;
}

// Import Square team members as app users (creates accounts with temp passwords)
async function importTeam() {
  if (!data.settings.square_token) throw new Error('No Square access token configured');
  const { hashPassword } = require('./store');
  const created = [], linked = [], skipped = [];
  let cursor;
  const members = [];
  do {
    const res = await squareFetch('/v2/team-members/search', {
      query: { filter: { status: 'ACTIVE' } }, limit: 200, cursor,
    });
    members.push(...(res.team_members || []));
    cursor = res.cursor;
  } while (cursor);

  for (const tm of members) {
    const name = [tm.given_name, tm.family_name].filter(Boolean).join(' ').trim() || 'Team member';
    if (!tm.email_address) { skipped.push({ name, reason: 'no email in Square' }); continue; }
    const email = tm.email_address.trim();
    const existing = data.users.find(x => x.active && x.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      if (existing.square_team_member_id !== tm.id) { existing.square_team_member_id = tm.id; save(); }
      linked.push({ name: existing.name, email: existing.email });
      continue;
    }
    // best-effort job title from wage settings
    let jobRole = null;
    try {
      const ws = await squareFetch(`/v2/team-members/${tm.id}/wage-setting`);
      const ja = ws.wage_setting && ws.wage_setting.job_assignments;
      if (ja && ja[0] && ja[0].job_title) jobRole = ja[0].job_title;
    } catch { /* wage setting may not exist */ }
    const tempPass = 'pops-' + Math.random().toString(36).slice(2, 6);
    data.users.push({
      id: nextId('user'), name, email, password_hash: hashPassword(tempPass),
      level: 'slinger', is_admin: 0, job_role: jobRole, location_id: null, territory_ids: [],
      square_team_member_id: tm.id, active: 1,
    });
    save();
    created.push({ name, email, job_role: jobRole, temp_password: tempPass });
  }
  return { created, linked, skipped, total: members.length };
}

// Territory linked to a Square location (shifts are published per-territory in Square)
function terrBySquareLoc(locId) {
  if (!locId) return null;
  return (data.territories || []).find(t => t.square_location_id === locId) || null;
}

// Find the cart whose name appears in the shift notes (longest match wins)
function matchCart(notes) {
  if (!notes) return null;
  const hay = notes.toLowerCase();
  let best = null;
  for (const cart of data.locations.filter(l => l.active)) {
    if (hay.includes(cart.name.toLowerCase())) {
      if (!best || cart.name.length > best.name.length) best = cart;
    }
  }
  return best;
}

async function syncShifts() {
  const start = new Date(); start.setDate(start.getDate() - 1);
  const end = new Date(); end.setDate(end.getDate() + 14);
  let cursor;
  const seen = new Set();
  const seenOpen = new Set();
  do {
    const res = await squareFetch('/v2/labor/scheduled-shifts/search', {
      query: {
        filter: {
          scheduled_shift_statuses: ['PUBLISHED'],
          workday: {
            match_shifts_by: 'START_AT',
            default_timezone: TZ,
            date_range: { start_date: businessDate(start), end_date: businessDate(end) },
          },
        },
        sort: { field: 'START_AT', order: 'ASC' },
      },
      limit: 50, cursor,
    });
    for (const ss of res.scheduled_shifts || []) {
      const det = ss.published_shift_details || ss.draft_shift_details;
      if (!det || det.is_deleted || !det.start_at || !det.end_at) continue;
      const cart = matchCart(det.notes);
      const dateStr = new Date(det.start_at).toLocaleDateString('en-CA', { timeZone: TZ });

      if (!det.team_member_id) {
        // unassigned published shift -> requestable open shift
        seenOpen.add(ss.id);
        let os = data.open_shifts.find(o => o.square_id === ss.id);
        if (!os) { os = { id: nextId('open_shift'), square_id: ss.id }; data.open_shifts.push(os); }
        const terrO = terrBySquareLoc(det.location_id);
        Object.assign(os, {
          cart_id: cart ? cart.id : null,
          territory_id: (cart && cart.territory_id) || (terrO ? terrO.id : null),
          start_at: new Date(det.start_at).toISOString(), end_at: new Date(det.end_at).toISOString(),
          date: dateStr, notes: det.notes || '',
        });
        continue;
      }

      const user = data.users.find(u => u.active && u.square_team_member_id === det.team_member_id);
      if (!user) continue; // no matching app user (email mismatch)
      seen.add(ss.id);
      let shift = data.shifts.find(s => s.square_id === ss.id);
      if (!shift) {
        shift = { id: nextId('shift'), square_id: ss.id, source: 'square' };
        data.shifts.push(shift);
      }
      const terrS = terrBySquareLoc(det.location_id);
      Object.assign(shift, {
        user_id: user.id, cart_id: cart ? cart.id : null,
        territory_id: (cart && cart.territory_id) || (terrS ? terrS.id : null),
        start_at: new Date(det.start_at).toISOString(), end_at: new Date(det.end_at).toISOString(),
        date: dateStr,
        notes: det.notes || '',
      });
    }
    cursor = res.cursor;
  } while (cursor);
  // drop open shifts that were assigned/removed in Square or are in the past
  data.open_shifts = data.open_shifts.filter(o =>
    seenOpen.has(o.square_id) && new Date(o.end_at).getTime() > Date.now());
  // remove square shifts that disappeared from the schedule (future only, no instances yet)
  const now = Date.now();
  data.shifts = data.shifts.filter(s => {
    if (s.source !== 'square' || seen.has(s.square_id)) return true;
    if (new Date(s.start_at).getTime() < now) return true;
    return data.instances.some(i => i.shift_id === s.id);
  });
  save();
}

async function syncSquare() {
  if (!data.settings.square_token) return { ok: false, error: 'No Square access token configured' };
  try {
    const matched = await syncTeamMembers();
    await syncShifts();
    data.settings.square_last_sync = new Date().toISOString();
    data.settings.square_last_error = null;
    save();
    return { ok: true, matched };
  } catch (e) {
    data.settings.square_last_error = e.message;
    save();
    return { ok: false, error: e.message };
  }
}

// ---------- instance generation ----------
function templatesFor(type, shift) {
  const user = userById(shift.user_id);
  return data.checklists.filter(c => {
    if (!c.active || c.trigger !== type) return false;
    if (c.job_role && user && user.job_role && c.job_role !== user.job_role) return false;
    if (c.location_id && shift.cart_id && c.location_id !== shift.cart_id) return false;
    if (c.category_id) {
      const cart = shift.cart_id ? cartById(shift.cart_id) : null;
      if (!cart || cart.category_id !== c.category_id) return false;
    }
    return true;
  });
}

function notify(userId, title, body) {
  data.notifications.push({
    id: nextId('notification'), user_id: userId, title, body,
    created_at: new Date().toISOString(), read: 0,
  });
  save();
  pushToUser(userId, { title, body }); // fire and forget
}

function generateInstances() {
  const now = Date.now();
  for (const shift of data.shifts) {
    const start = new Date(shift.start_at).getTime();
    const end = new Date(shift.end_at).getTime();
    const plans = [
      { type: 'opening', at: start },
      { type: 'closing', at: end - CLOSING_LEAD_MINUTES * 60000 },
    ];
    for (const plan of plans) {
      if (now < plan.at) continue;
      if (now - plan.at > 24 * 3600000) continue; // don't backfill ancient shifts
      for (const tpl of templatesFor(plan.type, shift)) {
        const exists = data.instances.some(i => i.shift_id === shift.id && i.type === plan.type && i.checklist_id === tpl.id);
        if (exists) continue;
        data.instances.push({
          id: nextId('instance'), type: plan.type, checklist_id: tpl.id, shift_id: shift.id,
          user_id: shift.user_id, cart_id: shift.cart_id,
          territory_id: (shift.cart_id && (cartById(shift.cart_id) || {}).territory_id) || shift.territory_id || null,
          date: shift.date,
          populate_at: new Date(plan.at).toISOString(),
          due_at: new Date(plan.at + DUE_MINUTES * 60000).toISOString(),
          status: 'pending', submission_id: null, alerted: 0,
        });
        save();
      }
    }
  }
}

function markOverdue() {
  const now = Date.now();
  for (const inst of data.instances) {
    if (inst.status !== 'pending' || now <= new Date(inst.due_at).getTime()) continue;
    inst.status = 'overdue';
    if (!inst.alerted) {
      inst.alerted = 1;
      const cart = inst.cart_id ? cartById(inst.cart_id) : null;
      const tpl = data.checklists.find(c => c.id === inst.checklist_id);
      const worker = userById(inst.user_id);
      const title = `⚠️ Overdue: ${tpl ? tpl.name : 'Checklist'}`;
      const terrForMsg = inst.territory_id ? (data.territories || []).find(t => t.id === inst.territory_id) : null;
      const body = `${worker ? worker.name : 'Unknown'} at ${cart ? cart.name : terrForMsg ? terrForMsg.name + ' (territory)' : 'unassigned location'} — due ${new Date(inst.due_at).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })}`;
      // recipients: the cart's notifiers + managers responsible for the cart's territory;
      // fall back to admins if nobody would be alerted
      const notifierIds = new Set(cart ? cart.notifier_ids : []);
      const terrId = (cart && cart.territory_id) || inst.territory_id || null;
      if (terrId) {
        data.users.filter(u => u.active && u.level === 'manager' && (u.territory_ids || []).includes(terrId))
          .forEach(u => notifierIds.add(u.id));
      }
      if (!notifierIds.size) {
        data.users.filter(u => u.active && u.level === 'admin').forEach(u => notifierIds.add(u.id));
      }
      notifierIds.forEach(id => notify(id, title, body));
    }
    save();
  }
}

// populate instances immediately (clock-in / clock-out time, not schedule time)
function populateNow(shift, type) {
  const now = new Date();
  const created = [];
  for (const tpl of templatesFor(type, shift)) {
    const exists = data.instances.find(i => i.shift_id === shift.id && i.type === type && i.checklist_id === tpl.id);
    if (exists) { created.push(exists); continue; }
    const inst = {
      id: nextId('instance'), type, checklist_id: tpl.id, shift_id: shift.id,
      user_id: shift.user_id, cart_id: shift.cart_id,
      territory_id: (shift.cart_id && (cartById(shift.cart_id) || {}).territory_id) || shift.territory_id || null,
      date: shift.date,
      populate_at: now.toISOString(),
      due_at: new Date(now.getTime() + DUE_MINUTES * 60000).toISOString(),
      status: 'pending', submission_id: null, alerted: 0,
    };
    data.instances.push(inst);
    created.push(inst);
  }
  if (created.length) save();
  return created;
}

// ---------- Square timecards (clock in/out) ----------
async function listSquareLocations() {
  if (!data.settings.square_token) throw new Error('No Square access token configured');
  const res = await squareFetch('/v2/locations');
  return (res.locations || []).filter(l => l.status === 'ACTIVE')
    .map(l => ({ id: l.id, name: l.name }));
}
async function getWage(teamMemberId) {
  try {
    const res = await squareFetch(`/v2/labor/team-member-wages?team_member_id=${encodeURIComponent(teamMemberId)}`);
    const w = (res.team_member_wages || [])[0];
    if (!w) return null;
    return { title: w.title || null, hourly_rate: w.hourly_rate || null, tip_eligible: w.tip_eligible !== false };
  } catch { return null; }
}
async function clockInSquare(user) {
  if (!data.settings.square_token) return { error: 'Square not connected' };
  if (!data.settings.square_location_id) return { error: 'No payroll location chosen (Schedule tab → Square connection)' };
  if (!user.square_team_member_id) return { error: 'Your account is not linked to Square (email mismatch)' };
  try {
    const wage = await getWage(user.square_team_member_id);
    const timecard = {
      location_id: data.settings.square_location_id,
      team_member_id: user.square_team_member_id,
      start_at: new Date().toISOString(),
    };
    if (wage && wage.hourly_rate) timecard.wage = wage;
    const res = await squareFetch('/v2/labor/timecards', {
      idempotency_key: require('crypto').randomBytes(16).toString('hex'),
      timecard,
    });
    return { id: res.timecard && res.timecard.id };
  } catch (e) { return { error: e.message }; }
}
async function clockOutSquare(squareTimecardId) {
  if (!data.settings.square_token || !squareTimecardId) return { error: 'Not synced to Square' };
  try {
    const cur = await squareFetch(`/v2/labor/timecards/${encodeURIComponent(squareTimecardId)}`);
    const tc = cur.timecard;
    if (!tc) return { error: 'Timecard not found in Square' };
    tc.end_at = new Date().toISOString();
    const res = await squareFetch(`/v2/labor/timecards/${encodeURIComponent(squareTimecardId)}`, { timecard: tc }, 'PUT');
    return { id: res.timecard && res.timecard.id };
  } catch (e) { return { error: e.message }; }
}

// ---------- ticker ----------
let lastSquareSync = 0;
function tick() {
  try {
    generateInstances();
    markOverdue();
    if (data.settings.square_token && Date.now() - lastSquareSync > 10 * 60000) {
      lastSquareSync = Date.now();
      syncSquare();
    }
  } catch (e) { console.error('engine tick error:', e); }
}
function start() {
  tick();
  setInterval(tick, 60000);
}

module.exports = {
  start, tick, syncSquare, importTeam, generateInstances, markOverdue, notify, businessDate,
  populateNow, listSquareLocations, clockInSquare, clockOutSquare,
  DUE_MINUTES, CLOSING_LEAD_MINUTES,
};
