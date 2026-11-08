const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { db, CATEGORIES } = require('./db');
const { sign, makeAuth, COOKIE } = require('./auth');

const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const { requireUser, requireAdmin } = makeAuth(db);
app.use(express.json());
app.use(cookieParser());

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, f, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(f.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)),
});

const ACTIVE = "('pending','approved','borrowed')";
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { username, password, portal } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
  if (!u || !u.active || !bcrypt.compareSync(String(password || ''), u.password_hash))
    return bad(res, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 401);
  if (portal === 'admin' && u.role !== 'admin') return bad(res, 'บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ', 403);
  res.cookie(COOKIE, sign(u), { httpOnly: true, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: 12 * 3600e3 });
  res.json({ ok: true, role: u.role });
});
app.post('/api/logout', (req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });

app.get('/api/me', requireUser, (req, res) => {
  const active = db.prepare(`SELECT COUNT(*) c FROM bookings WHERE user_id=? AND status IN ${ACTIVE}`).get(req.user.id).c;
  const borrowed = db.prepare(`SELECT COUNT(*) c FROM bookings WHERE user_id=? AND status='borrowed'`).get(req.user.id).c;
  res.json({ ...req.user, activeBookings: active, borrowedNow: borrowed });
});
app.post('/api/me/password', requireUser, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(oldPassword || ''), u.password_hash)) return bad(res, 'รหัสผ่านเดิมไม่ถูกต้อง');
  if (String(newPassword || '').length < 6) return bad(res, 'รหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ ok: true });
});

// ---------- Items ----------
app.get('/api/categories', requireUser, (req, res) => res.json(CATEGORIES));

app.get('/api/items', requireUser, (req, res) => {
  const start = isDate(req.query.start) ? req.query.start : today();
  const end = isDate(req.query.end) ? req.query.end : start;
  const rows = db.prepare(`
    SELECT i.*,
      (SELECT COUNT(*) FROM bookings b WHERE b.item_id=i.id AND b.status IN ${ACTIVE}
         AND b.start_date<=? AND b.end_date>=?) AS conflicts,
      (SELECT COUNT(*) FROM bookings b WHERE b.item_id=i.id AND b.status='borrowed') AS borrowed
    FROM items i ORDER BY i.code`).all(end, start);
  res.json(rows.map((r) => ({ ...r, available: r.status === 'normal' && r.conflicts === 0 })));
});

app.get('/api/items/:id/bookings', requireUser, (req, res) => {
  res.json(db.prepare(`SELECT start_date,end_date,status FROM bookings WHERE item_id=? AND status IN ${ACTIVE}
    AND end_date>=? ORDER BY start_date`).all(req.params.id, today()));
});

app.post('/api/items', requireAdmin, upload.single('image'), (req, res) => {
  const { code, name, category, description, status } = req.body;
  if (!code || !name) return bad(res, 'กรุณากรอกรหัสและชื่อ');
  try {
    const r = db.prepare('INSERT INTO items (code,name,category,description,status,image) VALUES (?,?,?,?,?,?)')
      .run(code.trim(), name.trim(), category || 'อื่นๆ', description || '', status === 'repair' ? 'repair' : 'normal',
        req.file ? '/uploads/' + req.file.filename : '');
    res.json({ id: Number(r.lastInsertRowid) });
  } catch { bad(res, 'รหัสนี้มีอยู่แล้ว'); }
});

app.put('/api/items/:id', requireAdmin, upload.single('image'), (req, res) => {
  const it = db.prepare('SELECT * FROM items WHERE id=?').get(req.params.id);
  if (!it) return bad(res, 'ไม่พบรายการ', 404);
  const b = req.body;
  try {
    db.prepare('UPDATE items SET code=?,name=?,category=?,description=?,status=?,image=? WHERE id=?').run(
      (b.code || it.code).trim(), (b.name || it.name).trim(), b.category || it.category,
      b.description ?? it.description, b.status === 'repair' ? 'repair' : b.status === 'normal' ? 'normal' : it.status,
      req.file ? '/uploads/' + req.file.filename : it.image, it.id);
    res.json({ ok: true });
  } catch { bad(res, 'รหัสนี้มีอยู่แล้ว'); }
});

app.patch('/api/items/:id/status', requireAdmin, (req, res) => {
  const s = req.body.status === 'repair' ? 'repair' : 'normal';
  db.prepare('UPDATE items SET status=? WHERE id=?').run(s, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/items/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM items WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Bookings ----------
function createBooking(res, { item_id, user_id, start_date, end_date, purpose, created_by, status = 'pending' }) {
  if (!isDate(start_date) || !isDate(end_date)) return bad(res, 'กรุณาเลือกวันที่');
  if (end_date < start_date) return bad(res, 'วันคืนต้องไม่ก่อนวันยืม');
  if (start_date < today()) return bad(res, 'ไม่สามารถจองย้อนหลังได้');
  const it = db.prepare('SELECT * FROM items WHERE id=?').get(item_id);
  if (!it) return bad(res, 'ไม่พบหุ่น/อุปกรณ์', 404);
  if (it.status === 'repair') return bad(res, 'หุ่นนี้อยู่ระหว่างการซ่อม');
  const clash = db.prepare(`SELECT start_date,end_date FROM bookings WHERE item_id=? AND status IN ${ACTIVE}
    AND start_date<=? AND end_date>=?`).get(item_id, end_date, start_date);
  if (clash) return bad(res, `ช่วงวันที่ชนกับการจองอื่น (${clash.start_date} ถึง ${clash.end_date})`, 409);
  const r = db.prepare('INSERT INTO bookings (item_id,user_id,start_date,end_date,purpose,status,created_by) VALUES (?,?,?,?,?,?,?)')
    .run(item_id, user_id, start_date, end_date, purpose || '', status, created_by);
  res.json({ id: Number(r.lastInsertRowid) });
}

const BOOKING_SELECT = `SELECT b.*, i.code item_code, i.name item_name, i.image item_image,
  u.name user_name, u.department user_department, u.phone user_phone, c.name created_by_name
  FROM bookings b JOIN items i ON i.id=b.item_id JOIN users u ON u.id=b.user_id LEFT JOIN users c ON c.id=b.created_by`;

app.get('/api/bookings/mine', requireUser, (req, res) => {
  res.json(db.prepare(`${BOOKING_SELECT} WHERE b.user_id=? ORDER BY b.start_date DESC, b.id DESC`).all(req.user.id));
});

app.post('/api/bookings', requireUser, (req, res) => {
  const b = req.body || {};
  createBooking(res, { ...b, user_id: req.user.id, created_by: req.user.id, status: 'approved' });
});

app.post('/api/bookings/:id/cancel', requireUser, (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id);
  if (!b || (b.user_id !== req.user.id && req.user.role !== 'admin')) return bad(res, 'ไม่พบการจอง', 404);
  if (!['pending', 'approved'].includes(b.status)) return bad(res, 'ยกเลิกไม่ได้ในสถานะนี้');
  db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id);
  res.json({ ok: true });
});

// Admin booking management
app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const st = req.query.status;
  const rows = st && st !== 'all'
    ? db.prepare(`${BOOKING_SELECT} WHERE b.status=? ORDER BY b.start_date, b.id`).all(st)
    : db.prepare(`${BOOKING_SELECT} ORDER BY b.id DESC LIMIT 500`).all();
  res.json(rows);
});

app.post('/api/admin/bookings', requireAdmin, (req, res) => {
  const b = req.body || {};
  let userId = Number(b.user_id);
  if (!userId) {
    // walk-in borrower: create a user account on the fly
    const nb = b.new_user || {};
    if (!nb.name || !nb.username) return bad(res, 'กรุณาเลือกผู้ใช้ หรือกรอกข้อมูลผู้ยืมใหม่');
    if (db.prepare('SELECT 1 FROM users WHERE username=?').get(nb.username)) return bad(res, 'ชื่อผู้ใช้นี้มีอยู่แล้ว');
    const pw = nb.password || Math.random().toString(36).slice(2, 10);
    userId = Number(db.prepare('INSERT INTO users (username,password_hash,name,department,phone) VALUES (?,?,?,?,?)')
      .run(nb.username, bcrypt.hashSync(pw, 10), nb.name, nb.department || '', nb.phone || '').lastInsertRowid);
  }
  createBooking(res, { ...b, user_id: userId, created_by: req.user.id, status: 'approved' });
});

app.patch('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id);
  if (!b) return bad(res, 'ไม่พบการจอง', 404);
  const next = req.body.status;
  const allowed = {
    pending: ['approved', 'rejected', 'cancelled'],
    approved: ['borrowed', 'cancelled'],
    borrowed: ['returned'],
  };
  if (!(allowed[b.status] || []).includes(next)) return bad(res, 'เปลี่ยนสถานะไม่ได้');
  db.prepare('UPDATE bookings SET status=? WHERE id=?').run(next, b.id);
  if (next === 'borrowed') {
    db.prepare(`INSERT INTO usage_monthly (month,item_id,count) VALUES (?,?,1)
      ON CONFLICT(month,item_id) DO UPDATE SET count=count+1`).run(thisMonth(), b.item_id);
  }
  res.json({ ok: true });
});

// ---------- Repair reports ----------
app.post('/api/reports', requireUser, (req, res) => {
  const { item_id, detail } = req.body || {};
  if (!item_id || !String(detail || '').trim()) return bad(res, 'กรุณาเลือกหุ่นและระบุอาการ');
  const r = db.prepare('INSERT INTO reports (item_id,user_id,detail) VALUES (?,?,?)').run(item_id, req.user.id, detail.trim());
  res.json({ id: Number(r.lastInsertRowid) });
});
const REPORT_SELECT = `SELECT r.*, i.code item_code, i.name item_name, i.status item_status, u.name user_name, u.department user_department
  FROM reports r JOIN items i ON i.id=r.item_id JOIN users u ON u.id=r.user_id`;
app.get('/api/reports/mine', requireUser, (req, res) =>
  res.json(db.prepare(`${REPORT_SELECT} WHERE r.user_id=? ORDER BY r.id DESC`).all(req.user.id)));
app.get('/api/admin/reports', requireAdmin, (req, res) =>
  res.json(db.prepare(`${REPORT_SELECT} ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, r.id DESC`).all()));
app.patch('/api/admin/reports/:id', requireAdmin, (req, res) => {
  const { status, admin_note } = req.body || {};
  if (!['open', 'in_progress', 'done'].includes(status)) return bad(res, 'สถานะไม่ถูกต้อง');
  db.prepare('UPDATE reports SET status=?, admin_note=? WHERE id=?').run(status, admin_note || '', req.params.id);
  res.json({ ok: true });
});

// ---------- Stats (per month; current month starts from zero automatically) ----------
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : thisMonth();
  const top = db.prepare(`SELECT i.code, i.name, u.count FROM usage_monthly u JOIN items i ON i.id=u.item_id
    WHERE u.month=? ORDER BY u.count DESC, i.code LIMIT 10`).all(month);
  const total = db.prepare('SELECT COALESCE(SUM(count),0) t FROM usage_monthly WHERE month=?').get(month).t;
  const byCategory = db.prepare(`SELECT i.category, SUM(u.count) count FROM usage_monthly u JOIN items i ON i.id=u.item_id
    WHERE u.month=? GROUP BY i.category ORDER BY count DESC`).all(month);
  const months = db.prepare('SELECT DISTINCT month FROM usage_monthly ORDER BY month DESC').all().map((r) => r.month);
  if (!months.includes(thisMonth())) months.unshift(thisMonth());
  res.json({
    month, months, total, top, byCategory,
    items: db.prepare('SELECT COUNT(*) c FROM items').get().c,
    repair: db.prepare("SELECT COUNT(*) c FROM items WHERE status='repair'").get().c,
    borrowedNow: db.prepare("SELECT COUNT(*) c FROM bookings WHERE status='borrowed'").get().c,
    pending: db.prepare("SELECT COUNT(*) c FROM bookings WHERE status='pending'").get().c,
    openReports: db.prepare("SELECT COUNT(*) c FROM reports WHERE status!='done'").get().c,
  });
});

// ---------- Users ----------
app.get('/api/admin/users', requireAdmin, (req, res) =>
  res.json(db.prepare('SELECT id,username,name,department,phone,role,active,created_at FROM users ORDER BY role, name').all()));
app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, name, department, phone, role } = req.body || {};
  if (!username || !name || String(password || '').length < 6) return bad(res, 'กรอกชื่อผู้ใช้ ชื่อ และรหัสผ่าน (อย่างน้อย 6 ตัว)');
  try {
    db.prepare('INSERT INTO users (username,password_hash,name,department,phone,role) VALUES (?,?,?,?,?,?)')
      .run(username.trim(), bcrypt.hashSync(password, 10), name, department || '', phone || '', role === 'admin' ? 'admin' : 'user');
    res.json({ ok: true });
  } catch { bad(res, 'ชื่อผู้ใช้นี้มีอยู่แล้ว'); }
});
app.patch('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id && req.body.active === false) return bad(res, 'ปิดบัญชีตัวเองไม่ได้');
  if (typeof req.body.active === 'boolean') db.prepare('UPDATE users SET active=? WHERE id=?').run(req.body.active ? 1 : 0, id);
  if (req.body.password) {
    if (String(req.body.password).length < 6) return bad(res, 'รหัสผ่านอย่างน้อย 6 ตัวอักษร');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(req.body.password, 10), id);
  }
  res.json({ ok: true });
});

// ---------- Static ----------
app.use('/pic', express.static(path.join(ROOT, 'pic')));
app.use('/logo', express.static(path.join(ROOT, 'logo')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(ROOT, 'public')));
app.get('/', (req, res) => res.redirect('/login.html'));
app.get('/admin', (req, res) => res.redirect('/admin-login.html'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`CMEC E-Borrow App running at http://localhost:${PORT}`));
