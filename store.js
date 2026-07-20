// Simple JSON-file data store — zero dependencies.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');

// ---- password hashing (scrypt, built-in) ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const check = crypto.scryptSync(String(pw), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch { return false; }
}

// ---- load / save ----
let data;
if (fs.existsSync(DB_FILE)) {
  data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  migrate(data);
} else {
  data = seed();
  console.log('Seeded database with sample data.');
}

function persist() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, DB_FILE); // atomic swap — no partial writes
}
const save = persist; // write-through: every mutation lands on disk immediately

function nextId(kind) {
  data.seq[kind] = (data.seq[kind] || 0) + 1;
  return data.seq[kind];
}

// ---- migrations ----
function migrate(d) {
  let changed = false;
  if (!d.version || d.version < 2) {
    d.version = 2;
    d.categories = d.categories || [
      { id: 1, name: 'Everyday Carts' }, { id: 2, name: 'Extra Special Carts' },
      { id: 3, name: 'Catering Carts' }, { id: 4, name: 'Brick & Mortar' },
    ];
    d.seq.category = Math.max(4, d.seq.category || 0);
    (d.locations || []).forEach(l => { if (l.category_id === undefined) l.category_id = 1; if (!l.notifier_ids) l.notifier_ids = []; });
    (d.users || []).forEach(u => { if (u.square_team_member_id === undefined) u.square_team_member_id = null; });
    (d.checklists || []).forEach(c => { if (!c.trigger) c.trigger = 'daily'; if (c.category_id === undefined) c.category_id = null; });
    d.shifts = d.shifts || []; d.instances = d.instances || []; d.notifications = d.notifications || [];
    d.push_subs = d.push_subs || []; d.settings = d.settings || {};
    (d.submissions || []).forEach(s => { if (s.instance_id === undefined) s.instance_id = null; });
    changed = true;
  }
  if (d.version < 3) {
    d.version = 3;
    // user levels: admin | manager | slinger
    (d.users || []).forEach(u => {
      if (!u.level) u.level = u.is_admin ? 'admin' : 'slinger';
      if (u.territory_id === undefined) u.territory_id = null;
    });
    d.territories = d.territories || [];
    (d.locations || []).forEach(l => { if (l.territory_id === undefined) l.territory_id = null; });
    // chat
    d.channels = d.channels || [];
    if (!d.channels.some(c => c.type === 'general')) {
      d.seq.channel = (d.seq.channel || 0) + 1;
      d.channels.push({ id: d.seq.channel, name: 'general', type: 'general', territory_id: null, member_ids: null });
    }
    d.messages = d.messages || [];
    d.reads = d.reads || []; // { user_id, channel_id, last_read_id }
    (d.shifts || []).forEach(s => { if (!s.source) s.source = 'manual'; });
    changed = true;
  }
  if (d.version < 4) {
    d.version = 4;
    d.timecards = d.timecards || [];       // { id, user_id, shift_id, cart_id, square_timecard_id, clock_in_at, clock_out_at, sync_error }
    d.open_shifts = d.open_shifts || [];   // unassigned published Square shifts: { id, square_id, cart_id, start_at, end_at, date, notes }
    d.shift_requests = d.shift_requests || []; // { id, open_shift_id, user_id, status: 'pending'|'approved'|'declined', created_at, decided_by }
    changed = true;
  }
  if (d.version < 5) {
    d.version = 5;
    // managers can cover multiple territories
    (d.users || []).forEach(u => {
      if (!u.territory_ids) u.territory_ids = u.territory_id ? [u.territory_id] : [];
      delete u.territory_id;
    });
    changed = true;
  }
  if (d.version < 6) {
    d.version = 6;
    // territories can be linked to Square locations; shifts/instances carry a territory
    (d.territories || []).forEach(t => {
      if (t.square_location_id === undefined) { t.square_location_id = null; t.square_location_name = null; }
    });
    const cartTerr = id => { const c = (d.locations || []).find(l => l.id === id); return c ? c.territory_id : null; };
    (d.shifts || []).forEach(x => { if (x.territory_id === undefined) x.territory_id = x.cart_id ? cartTerr(x.cart_id) : null; });
    (d.open_shifts || []).forEach(x => { if (x.territory_id === undefined) x.territory_id = x.cart_id ? cartTerr(x.cart_id) : null; });
    (d.instances || []).forEach(x => { if (x.territory_id === undefined) x.territory_id = x.cart_id ? cartTerr(x.cart_id) : null; });
    changed = true;
  }
  if (d.version < 7) {
    d.version = 7;
    d.announcements = d.announcements || []; // { id, title, body, author_id, pinned, created_at }
    (d.shifts || []).forEach(x => { if (!x.notes_feed) x.notes_feed = []; }); // { id, user_id, text, file, file_name, file_type, created_at }
    changed = true;
  }
  if (changed) setTimeout(() => persist(), 0);
}

// ---- seed data (fresh installs) ----
function seed() {
  const d = {
    version: 3,
    seq: {
      category: 4, territory: 2, location: 6, user: 5, checklist: 3, item: 16,
      submission: 0, shift: 0, instance: 0, notification: 0, push: 0, channel: 3, message: 0,
    },
    categories: [
      { id: 1, name: 'Everyday Carts' }, { id: 2, name: 'Extra Special Carts' },
      { id: 3, name: 'Catering Carts' }, { id: 4, name: 'Brick & Mortar' },
    ],
    territories: [
      { id: 1, name: 'Atlanta — East', square_location_id: null, square_location_name: null },
      { id: 2, name: 'Atlanta — West', square_location_id: null, square_location_name: null },
    ],
    locations: [
      { id: 1, name: 'Ponce City Market Bar', category_id: 4, territory_id: 1, notifier_ids: [1], active: 1 },
      { id: 2, name: 'Westside Kitchen', category_id: 4, territory_id: 2, notifier_ids: [1], active: 1 },
      { id: 3, name: 'Piedmont Park', category_id: 1, territory_id: 1, notifier_ids: [], active: 1 },
      { id: 4, name: 'Decatur Square', category_id: 1, territory_id: 1, notifier_ids: [], active: 1 },
      { id: 5, name: 'Freedom Park Festival', category_id: 2, territory_id: 1, notifier_ids: [], active: 1 },
      { id: 6, name: 'Catering Cart 1', category_id: 3, territory_id: 2, notifier_ids: [], active: 1 },
    ],
    users: [
      { id: 1, name: 'Chris Moye', email: 'chris.moye@kingofpops.com', password_hash: hashPassword('popsicle1'), level: 'admin', is_admin: 1, job_role: 'Admin', location_id: null, territory_ids: [], square_team_member_id: null, active: 1 },
      { id: 2, name: 'Morgan Hall', email: 'morgan@kingofpops.com', password_hash: hashPassword('pops1234'), level: 'manager', is_admin: 0, job_role: 'Territory Manager', location_id: null, territory_ids: [1], square_team_member_id: null, active: 1 },
      { id: 3, name: 'Maya Rivera', email: 'maya@kingofpops.com', password_hash: hashPassword('pops1234'), level: 'slinger', is_admin: 0, job_role: 'Cart Operator', location_id: null, territory_ids: [], square_team_member_id: null, active: 1 },
      { id: 4, name: 'Jordan Lee', email: 'jordan@kingofpops.com', password_hash: hashPassword('pops1234'), level: 'slinger', is_admin: 0, job_role: 'Cart Operator', location_id: null, territory_ids: [], square_team_member_id: null, active: 1 },
      { id: 5, name: 'Sam Patel', email: 'sam@kingofpops.com', password_hash: hashPassword('pops1234'), level: 'slinger', is_admin: 0, job_role: 'Kitchen Staff', location_id: 2, territory_ids: [], square_team_member_id: null, active: 1 },
    ],
    checklists: [
      {
        id: 1, name: 'Cart Opening Checklist', description: 'Pops up at the start of your shift. Complete within one hour.', emoji: '☀️',
        trigger: 'opening', location_id: null, category_id: null, job_role: null, days: '0,1,2,3,4,5,6', due_time: null, active: 1,
        items: [
          { id: 1, position: 0, type: 'checkbox', label: 'Rainbow umbrella up and secured', required: 1, unit: null, min: null, max: null },
          { id: 2, position: 1, type: 'checkbox', label: 'Cart wiped down and sanitized', required: 1, unit: null, min: null, max: null },
          { id: 3, position: 2, type: 'number', label: 'Starting pop count', required: 1, unit: 'pops', min: 0, max: null },
          { id: 4, position: 3, type: 'number', label: 'Cooler temperature', required: 1, unit: '°F', min: -20, max: 10 },
          { id: 5, position: 4, type: 'yesno', label: 'Signage and menu board displayed?', required: 1, unit: null, min: null, max: null },
          { id: 6, position: 5, type: 'photo', label: 'Photo of your cart setup', required: 1, unit: null, min: null, max: null },
          { id: 7, position: 6, type: 'text', label: 'Anything to report?', required: 0, unit: null, min: null, max: null },
        ],
      },
      {
        id: 2, name: 'Cart Closing Checklist', description: 'Pops up 30 minutes before the end of your shift.', emoji: '🌙',
        trigger: 'closing', location_id: null, category_id: null, job_role: null, days: '0,1,2,3,4,5,6', due_time: null, active: 1,
        items: [
          { id: 8, position: 0, type: 'number', label: 'Ending pop count', required: 1, unit: 'pops', min: 0, max: null },
          { id: 9, position: 1, type: 'checkbox', label: 'Cash counted and secured', required: 1, unit: null, min: null, max: null },
          { id: 10, position: 2, type: 'yesno', label: 'Trash cleared from your area?', required: 1, unit: null, min: null, max: null },
          { id: 11, position: 3, type: 'checkbox', label: 'Umbrella down, cart locked', required: 1, unit: null, min: null, max: null },
          { id: 12, position: 4, type: 'text', label: 'Issues or customer feedback', required: 0, unit: null, min: null, max: null },
        ],
      },
      {
        id: 3, name: 'Kitchen Daily Sanitation', description: 'Health-code critical — every day, no exceptions.', emoji: '🧼',
        trigger: 'daily', location_id: 2, category_id: null, job_role: 'Kitchen Staff', days: '0,1,2,3,4,5,6', due_time: '09:00', active: 1,
        items: [
          { id: 13, position: 0, type: 'number', label: 'Sanitizer concentration', required: 1, unit: 'ppm', min: 200, max: 400 },
          { id: 14, position: 1, type: 'number', label: 'Walk-in freezer temperature', required: 1, unit: '°F', min: -10, max: 0 },
          { id: 15, position: 2, type: 'checkbox', label: 'Floors swept and mopped', required: 1, unit: null, min: null, max: null },
          { id: 16, position: 3, type: 'yesno', label: 'Handwash stations fully stocked?', required: 1, unit: null, min: null, max: null },
        ],
      },
    ],
    shifts: [],       // { id, square_id|null, user_id, cart_id|null, start_at, end_at, date, notes, source: 'square'|'manual'|'pickup' }
    instances: [],    // { id, type, checklist_id, shift_id, user_id, cart_id, date, populate_at, due_at, status, submission_id, alerted }
    notifications: [],
    push_subs: [],
    settings: {},
    submissions: [],
    channels: [       // { id, name, type: 'general'|'territory'|'dm', territory_id, member_ids }
      { id: 1, name: 'general', type: 'general', territory_id: null, member_ids: null },
      { id: 2, name: 'Atlanta — East', type: 'territory', territory_id: 1, member_ids: null },
      { id: 3, name: 'Atlanta — West', type: 'territory', territory_id: 2, member_ids: null },
    ],
    messages: [],     // { id, channel_id, user_id, text, file, file_name, file_type, created_at }
    reads: [],        // { user_id, channel_id, last_read_id }
    timecards: [],
    open_shifts: [],
    shift_requests: [],
    announcements: [],
  };
  d.version = 7;
  setTimeout(() => persist(), 0);
  return d;
}

module.exports = { data, save, persist, nextId, hashPassword, verifyPassword, DATA_DIR };
