// Backend tests against the in-memory mock:  node apps-script/test/backend.test.js
const path = require('path');
const assert = require('assert/strict');
const { createGas } = require('./mock-gas');

const gas = createGas();
gas.load(path.join(__dirname, '..', 'src', 'Code.gs'));
const { context, call, logs, sheets } = gas;

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const err = (r, status) => { assert.equal(r.ok, false, 'expected error, got ' + JSON.stringify(r)); if (status) assert.equal(r.status, status, r.error); return r.error; };
const day = (n) => { const d = new Date(Date.now() + 7 * 3600e3 + n * 864e5); return d.toISOString().slice(0, 10); }; // Bangkok date

context.setup();
const pw = (logs.join('\n').match(/รหัสผ่าน: (\S+)/) || [])[1];

t('setup creates sheets, folder and first admin', () => {
  for (const n of ['Items', 'Bookings', 'Reports', 'Usage', 'Admins']) assert.ok(sheets[n], n);
  assert.equal(sheets.Admins._data.length, 2);
  assert.ok(pw && pw.length >= 8);
});

t('importSeedData loads old data once', () => {
  context.SEED_DATA_TEST = true;
  require('vm').runInContext(`var SEED_DATA = {
    Items: [{id:1,code:'A001',name:'หุ่นทารก',category:'ทางเดินหายใจ',description:'',status:'normal',created_at:'2026-11-01 10:00:00',image:''},
            {id:2,code:'C001',name:'แขนฝึกเจาะเลือด',category:'หลอดเลือด',description:'',status:'repair',created_at:'2026-11-01 10:00:00',image:''}],
    Bookings: [{id:1,item_id:1,borrower_name:'คนเก่า',department:'ER',phone:'081-111-2222',start_date:'${day(2)}',end_date:'${day(2)}',start_time:'09:00',end_time:'12:00',purpose:'',status:'approved',created_by:'',created_at:'2026-11-01 10:00:00'}],
    Reports: [], Usage: [{month:'2026-10',item_id:1,count:3}] };`, context);
  context.importSeedData();
  assert.throws(() => context.importSeedData(), /มีข้อมูลอยู่แล้ว/);
  assert.equal(sheets.Items._data.length, 3);
});

t('items list: time-range availability', () => {
  const all = ok(call({ path: '/api/items', query: { start: day(2), end: day(2), startTime: '13:00', endTime: '16:30' } }));
  assert.equal(all.length, 2);
  assert.equal(all.find((i) => i.code === 'A001').available, true);
  assert.equal(all.find((i) => i.code === 'C001').available, false, 'repair item is never available');
  const morning = ok(call({ path: '/api/items', query: { start: day(2), end: day(2), startTime: '11:00', endTime: '13:00' } }));
  assert.equal(morning.find((i) => i.code === 'A001').available, false);
});

const borrower = { borrower_name: 'สมหญิง ใจดี', department: 'ICU', phone: '0812345678' };
let bookingId;
t('guest booking needs name and phone', () => {
  err(call({ method: 'POST', path: '/api/bookings', body: { item_id: 1, start_date: day(3), start_time: '09:00', end_time: '10:00' } }));
  err(call({ method: 'POST', path: '/api/bookings', body: { ...borrower, phone: '12', item_id: 1, start_date: day(3), start_time: '09:00', end_time: '10:00' } }));
  bookingId = ok(call({ method: 'POST', path: '/api/bookings', body: { ...borrower, item_id: 1, start_date: day(3), start_time: '09:00', end_time: '12:00' } })).id;
  assert.ok(bookingId > 1);
});

t('booking rules: clash, past, repair, end before start', () => {
  err(call({ method: 'POST', path: '/api/bookings', body: { ...borrower, item_id: 1, start_date: day(3), start_time: '11:00', end_time: '13:00' } }), 409);
  ok(call({ method: 'POST', path: '/api/bookings', body: { ...borrower, item_id: 1, start_date: day(3), start_time: '12:00', end_time: '13:00' } }));
  err(call({ method: 'POST', path: '/api/bookings', body: { ...borrower, item_id: 1, start_date: day(-1), start_time: '09:00', end_time: '10:00' } }));
  err(call({ method: 'POST', path: '/api/bookings', body: { ...borrower, item_id: 2, start_date: day(4), start_time: '09:00', end_time: '10:00' } }));
  err(call({ method: 'POST', path: '/api/bookings', body: { ...borrower, item_id: 1, start_date: day(4), start_time: '10:00', end_time: '09:00' } }));
});

t('my bookings by phone (any format) and item schedule hides names', () => {
  const mine = ok(call({ path: '/api/bookings/mine', query: { phone: '081-234-5678' } }));
  assert.equal(mine.length, 2);
  assert.equal(mine[0].item_code, 'A001');
  assert.deepEqual(ok(call({ path: '/api/bookings/mine', query: { phone: '123' } })), []);
  const sched = ok(call({ path: '/api/items/1/bookings' }));
  assert.ok(sched.length >= 3);
  assert.equal(sched[0].phone, undefined);
  assert.equal(sched[0].borrower_name, undefined);
});

t('cancel requires the same phone', () => {
  err(call({ method: 'POST', path: `/api/bookings/${bookingId}/cancel`, body: { phone: '0899999999' } }), 404);
  ok(call({ method: 'POST', path: `/api/bookings/${bookingId}/cancel`, body: { phone: '081 234 5678' } }));
  err(call({ method: 'POST', path: `/api/bookings/${bookingId}/cancel`, body: { phone: '0812345678' } }));
});

t('sheet cells stay text (dates, times, leading-zero phones)', () => {
  const row = sheets.Bookings._data.find((r) => r[2] === 'สมหญิง ใจดี');
  assert.equal(row[4], '0812345678');
  assert.match(row[5], /^\d{4}-\d{2}-\d{2}$/);
  assert.match(row[7], /^\d{2}:\d{2}$/);
});

let token;
t('admin routes need login; wrong password rejected', () => {
  err(call({ path: '/api/admin/stats' }), 401);
  err(call({ method: 'POST', path: '/api/admin/login', body: { username: 'admin', password: 'nope' } }), 401);
  const r = ok(call({ method: 'POST', path: '/api/admin/login', body: { username: 'admin', password: pw } }));
  token = r.token;
  assert.equal(ok(call({ path: '/api/me', token })).admin.username, 'admin');
  assert.equal(ok(call({ path: '/api/me' })).admin, null);
});

t('admin booking on behalf (phone optional), status flow and monthly usage', () => {
  const id = ok(call({ method: 'POST', path: '/api/admin/bookings', token, body: { borrower_name: 'walk-in', item_id: 1, start_date: day(5), start_time: '09:00', end_time: '10:00' } })).id;
  const list = ok(call({ path: '/api/admin/bookings', token, query: { status: 'approved' } }));
  const b = list.find((x) => x.id === id);
  assert.equal(b.created_by, 'ผู้ดูแลระบบ CMEC');
  err(call({ method: 'PATCH', path: `/api/admin/bookings/${id}`, token, body: { status: 'returned' } }));
  ok(call({ method: 'PATCH', path: `/api/admin/bookings/${id}`, token, body: { status: 'borrowed' } }));
  ok(call({ method: 'PATCH', path: `/api/admin/bookings/${id}`, token, body: { status: 'returned' } }));
  const s = ok(call({ path: '/api/admin/stats', token }));
  assert.equal(s.total, 1);
  assert.equal(s.top[0].code, 'A001');
  assert.ok(s.months.includes('2026-10'));
  const old = ok(call({ path: '/api/admin/stats', token, query: { month: '2026-10' } }));
  assert.equal(old.total, 3);
});

t('repair reports: guest create, mine by phone, admin update', () => {
  err(call({ method: 'POST', path: '/api/reports', body: { item_id: 1, detail: 'ปอดไม่ขยาย', reporter_name: 'ก', phone: '1' } }));
  const id = ok(call({ method: 'POST', path: '/api/reports', body: { item_id: 1, detail: 'ปอดไม่ขยาย', reporter_name: 'สมหญิง', phone: '0812345678' } })).id;
  assert.equal(ok(call({ path: '/api/reports/mine', query: { phone: '0812345678' } })).length, 1);
  ok(call({ method: 'PATCH', path: `/api/admin/reports/${id}`, token, body: { status: 'in_progress', admin_note: 'ส่งซ่อมแล้ว' } }));
  const r = ok(call({ path: '/api/admin/reports', token }))[0];
  assert.equal(r.admin_note, 'ส่งซ่อมแล้ว');
  assert.equal(ok(call({ path: '/api/admin/stats', token })).openReports, 1);
});

t('items: create with image, duplicate code, edit, status, delete cascades', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  const id = ok(call({ method: 'POST', path: '/api/items', token, body: { code: 'M001', name: 'เครื่อง AED', category: 'เครื่องมือแพทย์', status: 'normal', image: { name: 'a.png', mime: 'image/png', data: png } } })).id;
  err(call({ method: 'POST', path: '/api/items', token, body: { code: 'M001', name: 'ซ้ำ' } }));
  err(call({ method: 'POST', path: '/api/items', body: { code: 'X1', name: 'no token' } }), 401);
  let it = ok(call({ path: '/api/items' })).find((i) => i.id === id);
  assert.match(it.image, /^https:\/\/lh3\.googleusercontent\.com\/d\//);
  ok(call({ method: 'PUT', path: `/api/items/${id}`, token, body: { code: 'M001', name: 'เครื่อง AED ฝึก', category: 'เครื่องมือแพทย์', description: 'ใหม่', status: 'normal' } }));
  ok(call({ method: 'PATCH', path: `/api/items/${id}/status`, token, body: { status: 'broken' } }));
  it = ok(call({ path: '/api/items' })).find((i) => i.id === id);
  assert.equal(it.name, 'เครื่อง AED ฝึก'); assert.equal(it.status, 'broken'); assert.ok(it.image);
  ok(call({ method: 'DELETE', path: '/api/items/1', token }));
  assert.equal(ok(call({ path: '/api/bookings/mine', query: { phone: '0812345678' } })).length, 0);
  assert.equal(ok(call({ path: '/api/admin/reports', token })).length, 0);
});

t('admin accounts: add, login, reset, cannot delete self or last', () => {
  err(call({ method: 'POST', path: '/api/admin/admins', token, body: { username: 'staff', name: 'เจ้าหน้าที่', password: 'short' } }));
  ok(call({ method: 'POST', path: '/api/admin/admins', token, body: { username: 'staff', name: 'เจ้าหน้าที่', password: 'longpassword' } }));
  const admins = ok(call({ path: '/api/admin/admins', token }));
  assert.equal(admins.length, 2);
  assert.equal(admins[0].password_hash, undefined);
  const t2 = ok(call({ method: 'POST', path: '/api/admin/login', body: { username: 'staff', password: 'longpassword' } })).token;
  const me = admins.find((a) => a.username === 'admin');
  err(call({ method: 'DELETE', path: `/api/admin/admins/${me.id}`, token }));
  ok(call({ method: 'DELETE', path: `/api/admin/admins/${me.id}`, token: t2 }));
  const staff = admins.find((a) => a.username === 'staff');
  err(call({ method: 'DELETE', path: `/api/admin/admins/${staff.id}`, token: t2 }));
  ok(call({ method: 'POST', path: '/api/admin/password', token: t2, body: { oldPassword: 'longpassword', newPassword: 'evenlonger1' } }));
  err(call({ method: 'POST', path: '/api/admin/login', body: { username: 'staff', password: 'longpassword' } }), 401);
  ok(call({ method: 'POST', path: '/api/admin/logout', token: t2 }));
  err(call({ path: '/api/admin/stats', token: t2 }), 401);
});

t('unknown route gives 404', () => { err(call({ path: '/api/nope' }), 404); });

console.log(`\n${passed} tests passed`);
