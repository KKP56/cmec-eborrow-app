/**
 * CMEC E-Borrow App — Google Apps Script backend
 * Data lives in this spreadsheet (one sheet per table). The web app calls api(req)
 * through google.script.run; routes mirror the old Node.js REST API.
 *
 * Borrowers do not log in: bookings and repair reports carry name / department / phone,
 * and "my bookings" is looked up by phone number. Only admins log in.
 */

const APP_TITLE = 'CMEC E-Borrow App';
const TZ = 'Asia/Bangkok';
const IMAGE_FOLDER_NAME = 'CMEC E-Borrow รูปหุ่น';
const SESSION_SECONDS = 6 * 3600;

const SCHEMA = {
  Items: ['id', 'code', 'name', 'category', 'description', 'image', 'status', 'created_at'],
  Bookings: ['id', 'item_id', 'borrower_name', 'department', 'phone', 'start_date', 'end_date', 'start_time', 'end_time', 'purpose', 'status', 'created_by', 'created_at'],
  Reports: ['id', 'item_id', 'reporter_name', 'department', 'phone', 'detail', 'status', 'admin_note', 'created_at'],
  Usage: ['month', 'item_id', 'count'],
  Admins: ['id', 'username', 'name', 'password_hash', 'salt', 'created_at'],
};
const NUMERIC = { id: 1, item_id: 1, count: 1 };

const CATEGORY_BY_PREFIX = {
  A: 'ทางเดินหายใจ',
  C: 'หลอดเลือด',
  'G.U': 'สูติกรรม / ทางเดินปัสสาวะ',
  E: 'ตา หู คอ จมูก',
  SX: 'ศัลยกรรม / เย็บแผล',
  CPR: 'CPR / ช่วยชีวิตพื้นฐาน',
  SIM: 'High-fidelity Simulation',
  N: 'กายวิภาค / หัตถการ',
  M: 'เครื่องมือแพทย์',
};
const CATEGORIES = Object.values(CATEGORY_BY_PREFIX).filter((v, i, a) => a.indexOf(v) === i).concat(['อื่นๆ']);
const ITEM_STATUSES = ['normal', 'repair', 'broken'];
const ACTIVE = ['pending', 'approved', 'borrowed'];

// ======================= Web app entry =======================
function doGet() {
  const t = HtmlService.createTemplateFromFile('Index');
  t.logoUrl = props_().getProperty('LOGO_URL') || '';
  return t.evaluate()
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Single entry point for the front end. Returns a JSON string {ok, data} or {ok:false, status, error}. */
function api(req) {
  try {
    return JSON.stringify({ ok: true, data: route_(req || {}) });
  } catch (e) {
    if (e && e.httpStatus) return JSON.stringify({ ok: false, status: e.httpStatus, error: e.message });
    console.error(e && e.stack || e);
    return JSON.stringify({ ok: false, status: 500, error: 'เกิดข้อผิดพลาดในระบบ: ' + (e && e.message || e) });
  }
}

// ======================= helpers =======================
function props_() { return PropertiesService.getScriptProperties(); }
function fail_(msg, status) { const e = new Error(msg); e.httpStatus = status || 400; throw e; }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowTime_() { return Utilities.formatDate(new Date(), TZ, 'HH:mm'); }
function nowStamp_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function thisMonth_() { return today_().slice(0, 7); }
function isDate_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }
function isTime_(t) { return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }
function str_(v) { return String(v == null ? '' : v).trim(); }
function digits_(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
function itemStatus_(s, fallback) { return ITEM_STATUSES.indexOf(s) >= 0 ? s : (fallback || 'normal'); }
function categoryOf_(code) {
  const prefix = ((code.match(/^[A-Z.]+/) || [''])[0]).replace(/\.$/, '');
  return CATEGORY_BY_PREFIX[prefix] || 'อื่นๆ';
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('ระบบกำลังทำงานหนัก กรุณาลองใหม่อีกครั้ง', 503);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ======================= data layer =======================
let CACHE_ = {};
function ss_() {
  const id = props_().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function sheet_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const cols = SCHEMA[name];
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); // keep dates/phones as text
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function cellOut_(col, v) {
  if (v instanceof Date) {
    if (col === 'start_time' || col === 'end_time') return Utilities.formatDate(v, TZ, 'HH:mm');
    if (col === 'month') return Utilities.formatDate(v, TZ, 'yyyy-MM');
    if (col === 'created_at') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  if (NUMERIC[col]) return v === '' ? 0 : Number(v);
  return v === null || v === undefined ? '' : String(v);
}
/** All rows of a sheet as objects ({_row} = sheet row number). Cached for the current request. */
function rows_(name) {
  if (CACHE_[name]) return CACHE_[name];
  const values = sheet_(name).getDataRange().getValues();
  const head = values.shift() || [];
  const out = values.filter((r) => r.some((c) => c !== '')).map((r, i) => {
    const o = { _row: i + 2 };
    head.forEach((h, j) => { if (h) o[h] = cellOut_(h, r[j]); });
    return o;
  });
  CACHE_[name] = out;
  return out;
}
function toRow_(name, o) { return SCHEMA[name].map((c) => (o[c] === undefined || o[c] === null ? '' : String(o[c]))); }
function insert_(name, o) {
  const list = rows_(name);
  if (SCHEMA[name].indexOf('id') >= 0 && !o.id) o.id = list.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
  if (SCHEMA[name].indexOf('created_at') >= 0 && !o.created_at) o.created_at = nowStamp_();
  const sh = sheet_(name);
  const row = sh.getLastRow() + 1;
  const range = sh.getRange(row, 1, 1, SCHEMA[name].length);
  range.setNumberFormat('@');
  range.setValues([toRow_(name, o)]);
  o._row = row;
  list.push(o);
  return o;
}
function update_(name, o) {
  const range = sheet_(name).getRange(o._row, 1, 1, SCHEMA[name].length);
  range.setNumberFormat('@');
  range.setValues([toRow_(name, o)]);
  return o;
}
function remove_(name, predicate) {
  const sh = sheet_(name);
  const doomed = rows_(name).filter(predicate).map((r) => r._row).sort((a, b) => b - a);
  doomed.forEach((r) => sh.deleteRow(r));
  delete CACHE_[name];
  return doomed.length;
}
function findById_(name, id) { return rows_(name).filter((r) => r.id === Number(id))[0]; }

// ======================= auth (admins only) =======================
function hash_(password, salt) {
  let h = salt + ':' + password;
  for (let i = 0; i < 300; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8)
      .map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  }
  return h;
}
function currentAdmin_(token) {
  if (!token) return null;
  const id = CacheService.getScriptCache().get('adm_' + token);
  return id ? findById_('Admins', id) || null : null;
}
function requireAdmin_(req) {
  const a = currentAdmin_(req.token);
  if (!a) fail_('กรุณาเข้าสู่ระบบ Admin', 401);
  return a;
}
function publicAdmin_(a) { return { id: a.id, username: a.username, name: a.name, role: 'admin' }; }

// ======================= router =======================
function route_(req) {
  CACHE_ = {};
  const method = String(req.method || 'GET').toUpperCase();
  const path = String(req.path || '');
  const q = req.query || {};
  const b = req.body || {};
  const m = (re) => path.match(re);
  let p;

  // ---- session ----
  if (method === 'GET' && path === '/api/categories') return CATEGORIES;
  if (method === 'GET' && path === '/api/me') {
    const a = currentAdmin_(req.token);
    return { admin: a ? publicAdmin_(a) : null };
  }
  if (method === 'POST' && path === '/api/admin/login') {
    const a = rows_('Admins').filter((x) => x.username === str_(b.username))[0];
    if (!a || hash_(String(b.password || ''), a.salt) !== a.password_hash) fail_('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 401);
    const token = Utilities.getUuid() + Utilities.getUuid();
    CacheService.getScriptCache().put('adm_' + token, String(a.id), SESSION_SECONDS);
    return { token: token, admin: publicAdmin_(a) };
  }
  if (method === 'POST' && path === '/api/admin/logout') {
    if (req.token) CacheService.getScriptCache().remove('adm_' + req.token);
    return { ok: true };
  }
  if (method === 'POST' && path === '/api/admin/password') {
    const a = requireAdmin_(req);
    if (hash_(String(b.oldPassword || ''), a.salt) !== a.password_hash) fail_('รหัสผ่านเดิมไม่ถูกต้อง');
    if (String(b.newPassword || '').length < 8) fail_('รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร');
    return withLock_(() => { a.salt = Utilities.getUuid(); a.password_hash = hash_(String(b.newPassword), a.salt); update_('Admins', a); return { ok: true }; });
  }

  // ---- items ----
  if (method === 'GET' && path === '/api/items') return listItems_(q);
  if (method === 'GET' && (p = m(/^\/api\/items\/(\d+)\/bookings$/))) {
    const t = today_();
    return rows_('Bookings')
      .filter((x) => x.item_id === Number(p[1]) && ACTIVE.indexOf(x.status) >= 0 && x.end_date >= t)
      .sort((x, y) => (x.start_date + x.start_time < y.start_date + y.start_time ? -1 : 1))
      .map((x) => ({ start_date: x.start_date, end_date: x.end_date, start_time: x.start_time, end_time: x.end_time, status: x.status }));
  }
  if (method === 'POST' && path === '/api/items') { requireAdmin_(req); return withLock_(() => saveItem_(null, b)); }
  if (method === 'PUT' && (p = m(/^\/api\/items\/(\d+)$/))) { requireAdmin_(req); return withLock_(() => saveItem_(Number(p[1]), b)); }
  if (method === 'PATCH' && (p = m(/^\/api\/items\/(\d+)\/status$/))) {
    requireAdmin_(req);
    if (ITEM_STATUSES.indexOf(b.status) < 0) fail_('สถานะไม่ถูกต้อง');
    return withLock_(() => {
      const it = findById_('Items', p[1]);
      if (!it) fail_('ไม่พบรายการ', 404);
      it.status = b.status; update_('Items', it); return { ok: true };
    });
  }
  if (method === 'DELETE' && (p = m(/^\/api\/items\/(\d+)$/))) {
    requireAdmin_(req);
    return withLock_(() => {
      const id = Number(p[1]);
      remove_('Bookings', (x) => x.item_id === id);
      remove_('Reports', (x) => x.item_id === id);
      remove_('Usage', (x) => x.item_id === id);
      remove_('Items', (x) => x.id === id);
      return { ok: true };
    });
  }

  // ---- bookings ----
  if (method === 'GET' && path === '/api/bookings/mine') {
    const ph = digits_(q.phone);
    if (ph.length < 9) return [];
    return withItems_(rows_('Bookings').filter((x) => digits_(x.phone) === ph))
      .sort((x, y) => (x.start_date < y.start_date ? 1 : x.start_date > y.start_date ? -1 : y.id - x.id));
  }
  if (method === 'POST' && path === '/api/bookings') {
    return withLock_(() => createBooking_(b, '', true));
  }
  if (method === 'POST' && (p = m(/^\/api\/bookings\/(\d+)\/cancel$/))) {
    const admin = currentAdmin_(req.token);
    return withLock_(() => {
      const bk = findById_('Bookings', p[1]);
      const ph = digits_(b.phone);
      if (!bk || (!admin && (!ph || digits_(bk.phone) !== ph))) fail_('ไม่พบการจอง', 404);
      if (['pending', 'approved'].indexOf(bk.status) < 0) fail_('ยกเลิกไม่ได้ในสถานะนี้');
      bk.status = 'cancelled'; update_('Bookings', bk);
      return { ok: true };
    });
  }
  if (method === 'GET' && path === '/api/admin/bookings') {
    requireAdmin_(req);
    const st = q.status;
    let list = rows_('Bookings');
    if (st && st !== 'all') list = list.filter((x) => x.status === st).sort((x, y) => (x.start_date < y.start_date ? -1 : x.start_date > y.start_date ? 1 : x.id - y.id));
    else list = list.slice().sort((x, y) => y.id - x.id).slice(0, 500);
    return withItems_(list);
  }
  if (method === 'POST' && path === '/api/admin/bookings') {
    const a = requireAdmin_(req);
    return withLock_(() => createBooking_(b, a.name, false));
  }
  if (method === 'PATCH' && (p = m(/^\/api\/admin\/bookings\/(\d+)$/))) {
    requireAdmin_(req);
    return withLock_(() => {
      const bk = findById_('Bookings', p[1]);
      if (!bk) fail_('ไม่พบการจอง', 404);
      const allowed = { pending: ['approved', 'rejected', 'cancelled'], approved: ['borrowed', 'cancelled'], borrowed: ['returned'] };
      if ((allowed[bk.status] || []).indexOf(b.status) < 0) fail_('เปลี่ยนสถานะไม่ได้');
      bk.status = b.status; update_('Bookings', bk);
      if (b.status === 'borrowed') {
        const month = thisMonth_();
        const u = rows_('Usage').filter((x) => x.month === month && x.item_id === bk.item_id)[0];
        if (u) { u.count += 1; update_('Usage', u); } else insert_('Usage', { month: month, item_id: bk.item_id, count: 1 });
      }
      return { ok: true };
    });
  }

  // ---- repair reports ----
  if (method === 'POST' && path === '/api/reports') {
    return withLock_(() => {
      const who = borrower_(b, true);
      if (!findById_('Items', b.item_id) || !str_(b.detail)) fail_('กรุณาเลือกหุ่นและระบุอาการ');
      const r = insert_('Reports', { item_id: Number(b.item_id), reporter_name: who.name, department: who.department, phone: who.phone, detail: str_(b.detail), status: 'open', admin_note: '' });
      return { id: r.id };
    });
  }
  if (method === 'GET' && path === '/api/reports/mine') {
    const ph = digits_(q.phone);
    if (ph.length < 9) return [];
    return withItems_(rows_('Reports').filter((x) => digits_(x.phone) === ph)).sort((x, y) => y.id - x.id);
  }
  if (method === 'GET' && path === '/api/admin/reports') {
    requireAdmin_(req);
    const order = { open: 0, in_progress: 1, done: 2 };
    return withItems_(rows_('Reports')).sort((x, y) => (order[x.status] - order[y.status]) || y.id - x.id);
  }
  if (method === 'PATCH' && (p = m(/^\/api\/admin\/reports\/(\d+)$/))) {
    requireAdmin_(req);
    if (['open', 'in_progress', 'done'].indexOf(b.status) < 0) fail_('สถานะไม่ถูกต้อง');
    return withLock_(() => {
      const r = findById_('Reports', p[1]);
      if (!r) fail_('ไม่พบเรื่องแจ้งซ่อม', 404);
      r.status = b.status; r.admin_note = str_(b.admin_note); update_('Reports', r);
      return { ok: true };
    });
  }

  // ---- stats ----
  if (method === 'GET' && path === '/api/admin/stats') { requireAdmin_(req); return stats_(q.month); }

  // ---- admin accounts ----
  if (method === 'GET' && path === '/api/admin/admins') {
    requireAdmin_(req);
    return rows_('Admins').map((a) => ({ id: a.id, username: a.username, name: a.name, created_at: a.created_at }));
  }
  if (method === 'POST' && path === '/api/admin/admins') {
    requireAdmin_(req);
    const username = str_(b.username), name = str_(b.name);
    if (!username || !name || String(b.password || '').length < 8) fail_('กรอกชื่อผู้ใช้ ชื่อ และรหัสผ่าน (อย่างน้อย 8 ตัว)');
    return withLock_(() => {
      if (rows_('Admins').some((a) => a.username === username)) fail_('ชื่อผู้ใช้นี้มีอยู่แล้ว');
      const salt = Utilities.getUuid();
      insert_('Admins', { username: username, name: name, salt: salt, password_hash: hash_(String(b.password), salt) });
      return { ok: true };
    });
  }
  if (method === 'PATCH' && (p = m(/^\/api\/admin\/admins\/(\d+)$/))) {
    requireAdmin_(req);
    if (String(b.password || '').length < 8) fail_('รหัสผ่านอย่างน้อย 8 ตัวอักษร');
    return withLock_(() => {
      const a = findById_('Admins', p[1]);
      if (!a) fail_('ไม่พบบัญชีนี้', 404);
      a.salt = Utilities.getUuid(); a.password_hash = hash_(String(b.password), a.salt); update_('Admins', a);
      return { ok: true };
    });
  }
  if (method === 'DELETE' && (p = m(/^\/api\/admin\/admins\/(\d+)$/))) {
    const me = requireAdmin_(req);
    const id = Number(p[1]);
    if (id === me.id) fail_('ลบบัญชีตัวเองไม่ได้');
    return withLock_(() => {
      if (!findById_('Admins', id)) fail_('ไม่พบบัญชีนี้', 404);
      if (rows_('Admins').length <= 1) fail_('ต้องมี Admin อย่างน้อย 1 บัญชี');
      remove_('Admins', (a) => a.id === id);
      return { ok: true };
    });
  }

  fail_('ไม่พบ API: ' + method + ' ' + path, 404);
}

// ======================= route handlers =======================
function listItems_(q) {
  const start = isDate_(q.start) ? q.start : today_();
  const end = isDate_(q.end) && q.end >= start ? q.end : start;
  const startAt = start + ' ' + (isTime_(q.startTime) ? q.startTime : '00:00');
  const endAt = end + ' ' + (isTime_(q.endTime) ? q.endTime : '23:59');
  const bookings = rows_('Bookings').filter((x) => ACTIVE.indexOf(x.status) >= 0);
  return rows_('Items').slice().sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)).map((it) => {
    const mine = bookings.filter((x) => x.item_id === it.id);
    const conflicts = mine.filter((x) => (x.start_date + ' ' + x.start_time) < endAt && (x.end_date + ' ' + x.end_time) > startAt).length;
    const o = clean_(it);
    o.conflicts = conflicts;
    o.borrowed = mine.filter((x) => x.status === 'borrowed').length;
    o.available = it.status === 'normal' && conflicts === 0;
    return o;
  });
}

function borrower_(b, requirePhone) {
  const who = { name: str_(b.borrower_name || b.reporter_name), department: str_(b.department), phone: str_(b.phone) };
  if (!who.name) fail_('กรุณากรอกชื่อ-นามสกุล');
  if (requirePhone && digits_(who.phone).length < 9) fail_('กรุณากรอกเบอร์โทรศัพท์มือถือให้ถูกต้อง (ใช้ค้นหาการจองของคุณ)');
  return who;
}

function createBooking_(b, createdBy, requirePhone) {
  const who = borrower_(b, requirePhone);
  const sd = b.start_date, ed = b.end_date || b.start_date;
  const st = b.start_time || '08:00', et = b.end_time || '16:30';
  if (!isDate_(sd) || !isDate_(ed)) fail_('กรุณาเลือกวันที่');
  if (!isTime_(st) || !isTime_(et)) fail_('กรุณาเลือกเวลา');
  const startAt = sd + ' ' + st, endAt = ed + ' ' + et;
  if (endAt <= startAt) fail_('เวลาคืนต้องหลังเวลายืม');
  if (startAt < today_() + ' ' + nowTime_()) fail_('ไม่สามารถจองย้อนหลังได้');
  const it = findById_('Items', b.item_id);
  if (!it) fail_('ไม่พบหุ่น/อุปกรณ์', 404);
  if (it.status === 'repair') fail_('หุ่นนี้อยู่ระหว่างการซ่อม');
  if (it.status === 'broken') fail_('หุ่นนี้เสีย ไม่สามารถให้ยืมได้');
  const clash = rows_('Bookings').filter((x) => x.item_id === it.id && ACTIVE.indexOf(x.status) >= 0
    && (x.start_date + ' ' + x.start_time) < endAt && (x.end_date + ' ' + x.end_time) > startAt)[0];
  if (clash) fail_('ช่วงเวลาชนกับการจองอื่น (' + clash.start_date + ' ' + clash.start_time + ' ถึง ' + clash.end_date + ' ' + clash.end_time + ')', 409);
  const r = insert_('Bookings', {
    item_id: it.id, borrower_name: who.name, department: who.department, phone: who.phone,
    start_date: sd, end_date: ed, start_time: st, end_time: et, purpose: str_(b.purpose),
    status: 'approved', created_by: createdBy || '',
  });
  return { id: r.id };
}

function saveItem_(id, b) {
  const code = str_(b.code), name = str_(b.name);
  let it = id ? findById_('Items', id) : null;
  if (id && !it) fail_('ไม่พบรายการ', 404);
  if (!id && (!code || !name)) fail_('กรุณากรอกรหัสและชื่อ');
  const newCode = code || it.code;
  if (rows_('Items').some((x) => x.code === newCode && (!it || x.id !== it.id))) fail_('รหัสนี้มีอยู่แล้ว');
  const image = b.image && b.image.data ? saveImage_(b.image, newCode) : null;
  if (!it) {
    it = insert_('Items', { code: newCode, name: name, category: str_(b.category) || 'อื่นๆ', description: str_(b.description), status: itemStatus_(b.status), image: image || '' });
    return { id: it.id };
  }
  it.code = newCode;
  it.name = name || it.name;
  it.category = str_(b.category) || it.category;
  if (b.description !== undefined) it.description = str_(b.description);
  it.status = itemStatus_(b.status, it.status);
  if (image) it.image = image;
  update_('Items', it);
  return { ok: true };
}

function imageFolder_() {
  const id = props_().getProperty('IMAGE_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreated below */ } }
  const f = DriveApp.createFolder(IMAGE_FOLDER_NAME);
  props_().setProperty('IMAGE_FOLDER_ID', f.getId());
  return f;
}
function publicUrl_(file) {
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {
    console.warn('setSharing failed for ' + file.getName() + ': ' + e.message);
  }
  return 'https://lh3.googleusercontent.com/d/' + file.getId();
}
function saveImage_(img, code) {
  if (!/^image\/(jpeg|png|webp)$/.test(img.mime || '')) fail_('รองรับเฉพาะรูป JPG, PNG, WEBP');
  const bytes = Utilities.base64Decode(img.data);
  if (bytes.length > 5 * 1024 * 1024) fail_('รูปต้องไม่เกิน 5 MB');
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[img.mime];
  const file = imageFolder_().createFile(Utilities.newBlob(bytes, img.mime, code + '-' + Date.now() + ext));
  return publicUrl_(file);
}

function withItems_(list) {
  const items = {};
  rows_('Items').forEach((i) => { items[i.id] = i; });
  return list.map((x) => {
    const o = clean_(x), it = items[x.item_id] || {};
    o.item_code = it.code || '(ลบแล้ว)'; o.item_name = it.name || ''; o.item_image = it.image || ''; o.item_status = it.status || 'normal';
    return o;
  });
}
function clean_(o) { const c = {}; Object.keys(o).forEach((k) => { if (k !== '_row') c[k] = o[k]; }); return c; }

function stats_(monthIn) {
  const month = /^\d{4}-\d{2}$/.test(monthIn || '') ? monthIn : thisMonth_();
  const items = {};
  rows_('Items').forEach((i) => { items[i.id] = i; });
  const usage = rows_('Usage').filter((u) => u.month === month && items[u.item_id]);
  const top = usage.map((u) => ({ code: items[u.item_id].code, name: items[u.item_id].name, count: u.count }))
    .sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1)).slice(0, 10);
  const cat = {};
  usage.forEach((u) => { const c = items[u.item_id].category; cat[c] = (cat[c] || 0) + u.count; });
  const months = rows_('Usage').map((u) => u.month).filter((v, i, a) => v && a.indexOf(v) === i).sort().reverse();
  if (months.indexOf(thisMonth_()) < 0) months.unshift(thisMonth_());
  const bk = rows_('Bookings'), it = rows_('Items');
  return {
    month: month, months: months, total: usage.reduce((s, u) => s + u.count, 0), top: top,
    byCategory: Object.keys(cat).map((k) => ({ category: k, count: cat[k] })).sort((a, b) => b.count - a.count),
    items: it.length,
    repair: it.filter((i) => i.status === 'repair').length,
    broken: it.filter((i) => i.status === 'broken').length,
    borrowedNow: bk.filter((b) => b.status === 'borrowed').length,
    pending: bk.filter((b) => b.status === 'pending').length,
    openReports: rows_('Reports').filter((r) => r.status !== 'done').length,
  };
}

// ======================= one-time setup (run from the editor) =======================
/**
 * Run once: creates the sheets, the image folder and the first admin account.
 * The admin password is printed in the execution log — change it after the first login.
 */
function setup() {
  props_().setProperty('SPREADSHEET_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  Object.keys(SCHEMA).forEach(sheet_);
  const blank = ss_().getSheetByName('Sheet1') || ss_().getSheetByName('แผ่น1') || ss_().getSheetByName('ชีต1');
  if (blank && blank.getLastRow() === 0 && ss_().getSheets().length > 1) ss_().deleteSheet(blank);
  const folder = imageFolder_();
  CACHE_ = {};
  if (rows_('Admins').length === 0) {
    const pw = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    const salt = Utilities.getUuid();
    insert_('Admins', { username: 'admin', name: 'ผู้ดูแลระบบ CMEC', salt: salt, password_hash: hash_(pw, salt) });
    console.log('สร้างบัญชี Admin แล้ว — ชื่อผู้ใช้: admin  รหัสผ่าน: ' + pw + '  (เปลี่ยนรหัสหลังเข้าระบบครั้งแรก)');
  } else {
    console.log('มีบัญชี Admin อยู่แล้ว ไม่ได้สร้างใหม่');
  }
  console.log('โฟลเดอร์รูปหุ่นใน Google Drive: ' + folder.getUrl());
}

/**
 * Run after uploading the item photos (files named "<code>-<name>.jpg", e.g. the old pic/ folder)
 * into the image folder. Links photos to existing items by code and creates items that do not exist yet.
 * A file named "Logo.*" becomes the app logo.
 */
function syncImagesFromFolder() {
  CACHE_ = {};
  const files = imageFolder_().getFiles();
  let linked = 0, created = 0, skipped = 0;
  withLock_(() => {
    while (files.hasNext()) {
      const f = files.next();
      const name = f.getName();
      if (/^logo\./i.test(name)) { props_().setProperty('LOGO_URL', publicUrl_(f)); continue; }
      const mt = name.match(/^([A-Z.]+\d+(?:-\d+)?)\s*-?\s*(.+)\.(jpe?g|png|webp)$/i);
      if (!mt) { skipped++; continue; }
      const code = mt[1].toUpperCase();
      const it = rows_('Items').filter((x) => x.code === code)[0];
      if (it) {
        if (it.image && it.image.indexOf('googleusercontent') >= 0) continue;
        it.image = publicUrl_(f); update_('Items', it); linked++;
      } else {
        insert_('Items', { code: code, name: mt[2].replace(/\s+/g, ' ').trim(), category: categoryOf_(code), description: '', status: 'normal', image: publicUrl_(f) });
        created++;
      }
    }
  });
  console.log('ผูกรูปกับหุ่นเดิม ' + linked + ' รายการ, สร้างหุ่นใหม่ ' + created + ' รายการ, ข้ามไฟล์ที่ชื่อไม่ตรงรูปแบบ ' + skipped + ' ไฟล์');
}

/** Run once after adding the SeedData.gs file produced by build.js: imports the old app's data. */
function importSeedData() {
  if (typeof SEED_DATA === 'undefined') throw new Error('ไม่พบ SEED_DATA — เพิ่มไฟล์ SeedData.gs ก่อน');
  CACHE_ = {};
  withLock_(() => {
    ['Items', 'Bookings', 'Reports', 'Usage'].forEach((name) => {
      if (rows_(name).length) throw new Error('ชีต ' + name + ' มีข้อมูลอยู่แล้ว — นำเข้าซ้ำไม่ได้');
    });
    ['Items', 'Bookings', 'Reports', 'Usage'].forEach((name) => {
      const list = SEED_DATA[name] || [];
      if (!list.length) return;
      const sh = sheet_(name);
      const range = sh.getRange(2, 1, list.length, SCHEMA[name].length);
      range.setNumberFormat('@');
      range.setValues(list.map((o) => toRow_(name, o)));
      console.log('นำเข้า ' + name + ': ' + list.length + ' แถว');
    });
  });
}
