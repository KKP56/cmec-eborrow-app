/* CMEC E-Borrow App — front-end SPA (hash router, no build step) */
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
let ME = null;
let CATS = [];

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(url, opt = {}) {
  const o = { ...opt, headers: { ...(opt.headers || {}) } };
  if (o.body && !(o.body instanceof FormData)) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); }
  const r = await fetch(url, o);
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = '/login.html'; throw new Error(d.error); }
  if (!r.ok) throw new Error(d.error || 'เกิดข้อผิดพลาด');
  return d;
}
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg;
  $('#toast').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
const run = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg, 'ok'); return true; } catch (e) { toast(e.message, 'err'); return false; } };

const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const TH_MONTH_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const fmtD = (s) => { if (!s) return '-'; const [y, m, d] = s.slice(0, 10).split('-'); return `${+d} ${TH_MONTH[m - 1]} ${+y + 543}`; };
const fmtMonth = (s) => { const [y, m] = s.split('-'); return `${TH_MONTH_FULL[m - 1]} ${+y + 543}`; };
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const TODAY = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T00:00'); d.setDate(d.getDate() + n); return iso(d); };

const BK = {
  pending: ['รออนุมัติ', 'busy'], approved: ['อนุมัติแล้ว', 'info'], borrowed: ['กำลังยืม', 'ok'],
  returned: ['คืนแล้ว', 'gray'], cancelled: ['ยกเลิก', 'gray'], rejected: ['ไม่อนุมัติ', 'repair'],
};
const RP = { open: ['รอดำเนินการ', 'repair'], in_progress: ['กำลังซ่อม', 'busy'], done: ['เสร็จสิ้น', 'ok'] };
const pill = (map, k) => `<span class="pill ${map[k][1]}">${map[k][0]}</span>`;
const IST = { normal: ['ปกติ', 'ok', 'var(--green)'], repair: ['อยู่ระหว่างซ่อม', 'repair', 'var(--amber)'], broken: ['หุ่นเสีย', 'broken', 'var(--red)'] };
const statusOptions = (cur, labels = {}) => Object.entries(IST).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${labels[k] || v[0]}</option>`).join('');
const itemPill = (it) => it.status === 'broken' ? '<span class="pill broken">หุ่นเสีย</span>'
  : it.status === 'repair' ? '<span class="pill repair">อยู่ระหว่างซ่อม</span>'
  : it.available ? '<span class="pill ok">ว่าง พร้อมให้ยืม</span>' : '<span class="pill busy">ถูกจอง/ยืมอยู่</span>';
const img = (src, cls = '') => src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy">` : `<span class="noimg ${cls}">${ic('items')}</span>`;

function modal(title, bodyHtml, footHtml = '') {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog"><div class="modal-head"><h2>${title}</h2><button class="x" data-close>×</button></div>
    <div class="modal-body">${bodyHtml}</div>${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) bg.remove(); });
  document.body.appendChild(bg);
  return bg;
}
const confirmBox = (msg) => new Promise((res) => {
  const m = modal('ยืนยัน', `<p>${msg}</p>`, '<button class="btn ghost" data-close>ยกเลิก</button><button class="btn danger" id="cOk">ยืนยัน</button>');
  $('#cOk', m).onclick = () => { m.remove(); res(true); };
  m.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === m) res(false); });
});

// ---------- top bar ----------
const svgI = (p) => `<svg class="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICONS = {
  items: svgI('<circle cx="12" cy="4.5" r="2.2"/><path d="M8 21v-6l-1.5-1V9.5A2.5 2.5 0 0 1 9 7h6a2.5 2.5 0 0 1 2.5 2.5V14L16 15v6"/><path d="M12 13v8"/>'),
  bookings: svgI('<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M8.5 14.5l2.3 2.2 4.7-4.5"/>'),
  report: svgI('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M12 10.5v6M9 13.5h6"/>'),
  guide: svgI('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/><path d="M6.5 8h2M6.5 11h2M15.5 8h2M15.5 11h2"/>'),
  dashboard: svgI('<path d="M3.5 20.5h17"/><rect x="5" y="12" width="3" height="6" rx=".5"/><rect x="10.5" y="7" width="3" height="11" rx=".5"/><rect x="16" y="4" width="3" height="14" rx=".5"/>'),
  manage: svgI('<path d="M8 4H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><rect x="8" y="2.5" width="8" height="3.5" rx="1"/><path d="M8 11h8M8 14.5h8M8 18h5"/>'),
  itemsAdmin: svgI('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
  repair: svgI('<path d="M14.5 6.5a4 4 0 0 0 5 5L13 18a2.1 2.1 0 0 1-3-3l6.5-6.5"/><path d="M14.5 6.5L17 4l3 3-2.5 2.5"/><path d="M5 5l4 4M3.5 8.5l3-3"/>'),
  users: svgI('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.6.2 4.5 2 4.5 4.9"/>'),
  check: svgI('<circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.3l2.5 2.4 5-5"/>'),
  x: svgI('<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  search: svgI('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  send: svgI('<path d="M21 3L10 14"/><path d="M21 3l-6.5 18-4.5-7-7-4.5z"/>'),
  chat: svgI('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"/><path d="M8.5 10h.01M12 10h.01M15.5 10h.01"/>'),
  box: svgI('<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9M7.8 5.3l8.5 4.5"/>'),
  user: svgI('<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>'),
  shield: svgI('<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z"/><path d="M9 12l2.2 2.2 4-4"/>'),
  trend: svgI('<path d="M3.5 17l5.5-5.5 4 4 7.5-8"/><path d="M15 7.5h5.5V13"/>'),
  clock: svgI('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  bell: svgI('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
  inbox: svgI('<path d="M3.5 13.5l2.8-8A1.5 1.5 0 0 1 7.7 4.5h8.6a1.5 1.5 0 0 1 1.4 1l2.8 8V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z"/><path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5"/>'),
  party: svgI('<path d="M4 20l4.5-12 7.5 7.5z"/><path d="M14 4.5c.5 1.5 0 3-1 4M19.5 10c-1.5-.5-3 0-4 1M17 3.5v1.5M20.5 7H19M18.5 14.5l1 1"/>'),
  warn: svgI('<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17.2h.01"/>'),
};
const ic = (k) => ICONS[k].replace('class="nav-ico"', 'class="ico-svg"');
const NAV_USER = [
  ['#/items', ICONS.items, 'หุ่นและอุปกรณ์'],
  ['#/my-bookings', ICONS.bookings, 'การจองของฉัน'],
  ['#/report', ICONS.report, 'แจ้งซ่อม'],
  ['#/guide', ICONS.guide, 'คู่มือการใช้งาน'],
];
const NAV_ADMIN = [
  ['#/admin/dashboard', ICONS.dashboard, 'สถิติ'],
  ['#/admin/bookings', ICONS.manage, 'จัดการการจอง', 'pending'],
  ['#/admin/items', ICONS.itemsAdmin, 'จัดการหุ่น'],
  ['#/admin/reports', ICONS.repair, 'รายการแจ้งซ่อม', 'openReports'],
  ['#/admin/users', ICONS.users, 'ผู้ใช้'],
];
let BADGES = {};
function renderNav() {
  const link = ([h, i, t, b]) => `<a href="${h}" class="${location.hash.startsWith(h) ? 'active' : ''}">${i}<span>${t}</span>${b && BADGES[b] ? ` <span class="badge-n">${BADGES[b]}</span>` : ''}</a>`;
  $('#nav').innerHTML = '<div class="nav-label">เมนู</div>' + NAV_USER.map(link).join('')
    + (ME.role === 'admin' ? '<div class="nav-label">ผู้ดูแลระบบ</div>' + NAV_ADMIN.map(link).join('') : '');
}
async function refreshMe() {
  ME = await api('/api/me');
  if (ME.role === 'admin') { try { const s = await api('/api/admin/stats'); BADGES = { pending: s.pending, openReports: s.openReports }; } catch {} }
  $('#accAvatar').textContent = ME.name.trim().charAt(0) || '?';
  $('#accName').textContent = ME.name;
  $('#accRole').textContent = ME.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน';
  $('#accMenu').innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
      <span class="avatar" style="width:44px;height:44px;font-size:1.1rem">${esc(ME.name.charAt(0))}</span>
      <div><b>${esc(ME.name)}</b><div style="color:var(--muted);font-size:.82rem">@${esc(ME.username)}</div></div>
    </div>
    <div class="row"><span>สถานะบัญชี</span><span class="pill ok">ใช้งานได้</span></div>
    <div class="row"><span>สิทธิ์</span><span>${ME.role === 'admin' ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน'}</span></div>
    <div class="row"><span>หน่วยงาน</span><span>${esc(ME.department || '-')}</span></div>
    <div class="row"><span>การจองที่ใช้งานอยู่</span><b>${ME.activeBookings} รายการ</b></div>
    <div class="row"><span>กำลังยืมอยู่</span><b>${ME.borrowedNow} ชิ้น</b></div>
    <div style="display:grid;gap:8px;margin-top:12px">
      <button class="btn ghost sm" id="chPw">เปลี่ยนรหัสผ่าน</button>
      <button class="btn danger sm" id="logout">ออกจากระบบ</button>
    </div>`;
  $('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.href = ME.role === 'admin' ? '/admin-login.html' : '/login.html'; };
  $('#chPw').onclick = changePassword;
  renderNav();
}
$('#accBtn').onclick = (e) => { e.stopPropagation(); $('#accMenu').classList.toggle('open'); };
document.addEventListener('click', (e) => { if (!e.target.closest('.account')) $('#accMenu').classList.remove('open'); });
const setSidebar = (open) => document.body.classList.toggle('sidebar-open', open);
$('#menuToggle').onclick = () => setSidebar(!document.body.classList.contains('sidebar-open'));
$('#sidebarBg').onclick = () => setSidebar(false);

function changePassword() {
  const m = modal('เปลี่ยนรหัสผ่าน', `
    <div class="field"><label>รหัสผ่านเดิม</label><input type="password" id="o"></div>
    <div class="field"><label>รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)</label><input type="password" id="n"></div>`,
    '<button class="btn ghost" data-close>ยกเลิก</button><button class="btn" id="s">บันทึก</button>');
  $('#s', m).onclick = async () => {
    if (await run(() => api('/api/me/password', { method: 'POST', body: { oldPassword: $('#o', m).value, newPassword: $('#n', m).value } }), 'เปลี่ยนรหัสผ่านแล้ว')) m.remove();
  };
}

// ---------- Booking calendar picker ----------
function calendarPicker(container, booked, onChange) {
  let cur = new Date(); cur.setDate(1);
  let start = null, end = null;
  const isBooked = (d) => booked.some((b) => d >= b.start_date && d <= b.end_date);
  function draw() {
    const y = cur.getFullYear(), mo = cur.getMonth();
    const first = new Date(y, mo, 1).getDay();
    const days = new Date(y, mo + 1, 0).getDate();
    const t = TODAY();
    let cells = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].map((d) => `<div class="dow">${d}</div>`).join('');
    cells += '<div></div>'.repeat(first);
    for (let i = 1; i <= days; i++) {
      const d = iso(new Date(y, mo, i));
      let c = 'd';
      if (d < t) c += ' past'; else if (isBooked(d)) c += ' booked';
      if (d === start || d === end) c += ' sel'; else if (start && end && d > start && d < end) c += ' range';
      if (d === t) c += ' today';
      cells += `<div class="${c}" data-d="${d}">${i}</div>`;
    }
    container.innerHTML = `<div class="cal"><div class="cal-head"><button type="button" data-m="-1">‹</button>
      <span>${TH_MONTH_FULL[mo]} ${y + 543}</span><button type="button" data-m="1">›</button></div>
      <div class="cal-grid">${cells}</div>
      <div class="legend"><span><i style="background:var(--blue)"></i>วันที่เลือก</span><span><i style="background:var(--red-bg);border:1px solid var(--red)"></i>ถูกจองแล้ว</span><span><i style="outline:1.5px solid var(--blue)"></i>วันนี้</span></div></div>`;
  }
  container.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]');
    if (m) { cur.setMonth(cur.getMonth() + +m.dataset.m); return draw(); }
    const cell = e.target.closest('.d[data-d]');
    if (!cell || cell.classList.contains('past')) return;
    const d = cell.dataset.d;
    if (!start || end || d < start) { start = d; end = null; }
    else end = d;
    draw(); onChange(start, end || start);
  });
  draw();
  return { set(s, e2) { start = s; end = e2; if (s) { const d = new Date(s + 'T00:00'); cur = new Date(d.getFullYear(), d.getMonth(), 1); } draw(); } };
}

async function openBooking(item, { onBehalf = false } = {}) {
  const booked = await api(`/api/items/${item.id}/bookings`);
  let users = [];
  if (onBehalf) users = (await api('/api/admin/users')).filter((u) => u.active);
  const m = modal(onBehalf ? 'จองหุ่นแทนผู้ใช้' : 'จองล่วงหน้า', `
    <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">
      ${img(item.image, 'mini-thumb')}<div><div style="color:var(--blue);font-size:.8rem;font-weight:600">${esc(item.code)}</div><b>${esc(item.name)}</b></div>
    </div>
    ${onBehalf ? `
      <div class="field"><label>ผู้ยืม</label><select id="uSel"><option value="">— เลือกผู้ใช้ —</option>
        ${users.map((u) => `<option value="${u.id}">${esc(u.name)} (${esc(u.department || u.username)})</option>`).join('')}
        <option value="new">+ ผู้ยืมใหม่ (สร้างบัญชี)</option></select></div>
      <div id="newU" style="display:none" class="card" >
        <div class="field-row"><div class="field"><label>ชื่อ-นามสกุล</label><input id="nuName"></div><div class="field"><label>ชื่อผู้ใช้ (สำหรับ login)</label><input id="nuUser"></div></div>
        <div class="field-row"><div class="field"><label>หน่วยงาน</label><input id="nuDept"></div><div class="field"><label>เบอร์โทร</label><input id="nuPhone"></div></div>
        <div class="field" style="margin:0"><label>รหัสผ่านเริ่มต้น (อย่างน้อย 6 ตัว)</label><input id="nuPw"></div>
      </div><div style="height:12px"></div>` : ''}
    <label>เลือกวันที่ยืม → วันที่คืน บนปฏิทิน</label>
    <div id="cal"></div>
    ${booked.length ? `<div class="booked-list"><b>ช่วงเวลาที่ถูกจองแล้ว</b>${booked.map((b) => `<div>${fmtD(b.start_date)} ${b.start_time} – ${b.end_date !== b.start_date ? fmtD(b.end_date) + ' ' : ''}${b.end_time} น.</div>`).join('')}</div>` : ''}
    <div class="field-row">
      <div class="field"><label>วันที่ยืม</label><input type="date" id="sd" min="${TODAY()}"></div>
      <div class="field"><label>เวลายืม</label><input type="time" id="st" value="08:00" step="900"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>วันที่คืน</label><input type="date" id="ed" min="${TODAY()}"></div>
      <div class="field"><label>เวลาคืน</label><input type="time" id="et" value="16:30" step="900"></div>
    </div>
    <div class="field"><label>วัตถุประสงค์ / รายวิชา / สถานที่ใช้</label><textarea id="pp" rows="2" placeholder="เช่น สอน ACLS นักศึกษาแพทย์ปี 4 ห้อง Sim 2"></textarea></div>`,
    `<button class="btn ghost" data-close>ยกเลิก</button><button class="btn" id="ok">${onBehalf ? 'ยืนยันการจองแทนผู้ใช้' : 'ยืนยันการจอง'}</button>`);
  const cal = calendarPicker($('#cal', m), booked, (s, e) => { $('#sd', m).value = s; $('#ed', m).value = e; });
  const sync = () => cal.set($('#sd', m).value, $('#ed', m).value || $('#sd', m).value);
  $('#sd', m).onchange = sync; $('#ed', m).onchange = sync;
  if (onBehalf) $('#uSel', m).onchange = (e) => { $('#newU', m).style.display = e.target.value === 'new' ? 'block' : 'none'; };
  $('#ok', m).onclick = async () => {
    const body = { item_id: item.id, start_date: $('#sd', m).value, end_date: $('#ed', m).value || $('#sd', m).value, start_time: $('#st', m).value, end_time: $('#et', m).value, purpose: $('#pp', m).value };
    let url = '/api/bookings';
    if (onBehalf) {
      url = '/api/admin/bookings';
      const v = $('#uSel', m).value;
      if (v === 'new') body.new_user = { name: $('#nuName', m).value, username: $('#nuUser', m).value, department: $('#nuDept', m).value, phone: $('#nuPhone', m).value, password: $('#nuPw', m).value };
      else body.user_id = v;
    }
    if (await run(() => api(url, { method: 'POST', body }), onBehalf ? 'จองแทนผู้ใช้เรียบร้อย' : 'จองสำเร็จ')) {
      m.remove(); refreshMe(); route();
    }
  };
}

// ---------- Pages ----------
async function pageItems() {
  const q = pageItems.state || (pageItems.state = { text: '', cat: '', onlyFree: false, start: TODAY(), end: TODAY() });
  view.innerHTML = `
    <div class="page-head"><div><h1>หุ่นและอุปกรณ์ Simulation</h1><p>ตรวจสอบสถานะและจองล่วงหน้าตามช่วงวันที่ต้องการ</p></div></div>
    <div class="toolbar">
      <div class="grow"><input id="qt" placeholder="ค้นหาชื่อหรือรหัส เช่น CPR, SimMan" value="${esc(q.text)}"></div>
      <select id="qc"><option value="">ทุกหมวดหมู่</option>${CATS.map((c) => `<option ${c === q.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <input type="date" id="qs" value="${q.start}" min="${TODAY()}" title="ตั้งแต่"><span style="color:var(--muted)">ถึง</span><input type="date" id="qe" value="${q.end}" min="${TODAY()}" title="ถึง">
      <label class="check"><input type="checkbox" id="qf" ${q.onlyFree ? 'checked' : ''}> แสดงเฉพาะที่ว่าง</label>
    </div>
    <div class="grid kpis" id="sum"></div>
    <div class="grid items-grid" id="list"><div class="empty">กำลังโหลด...</div></div>`;
  let items = [];
  const load = async () => { items = await api(`/api/items?start=${q.start}&end=${q.end}`); draw(); };
  const draw = () => {
    const t = q.text.toLowerCase();
    const list = items.filter((i) => (!q.cat || i.category === q.cat) && (!q.onlyFree || i.available) && (!t || (i.code + ' ' + i.name).toLowerCase().includes(t)));
    const free = items.filter((i) => i.available).length, rep = items.filter((i) => i.status !== 'normal').length;
    $('#sum').innerHTML = [[ic('items'), items.length, 'ทั้งหมด'], [ic('check'), free, `ว่างช่วง ${fmtD(q.start)}${q.end !== q.start ? ' – ' + fmtD(q.end) : ''}`], [ic('bookings'), items.length - free - rep, 'ถูกจอง/ยืมอยู่'], [ic('report'), rep, 'ซ่อม / เสีย']]
      .map(([i, v, l]) => `<div class="card kpi"><div class="ico">${i}</div><div><div class="v">${v}</div><div class="l">${l}</div></div></div>`).join('');
    $('#list').innerHTML = list.length ? list.map((i) => `
      <div class="card item">
        <div class="thumb">${img(i.image)}<span class="pill-wrap" style="position:absolute;top:10px;left:10px">${itemPill(i)}</span></div>
        <div class="body">
          <div class="code">${esc(i.code)}</div>
          <div class="name" title="${esc(i.name)}">${esc(i.name)}</div>
          <div class="cat">${esc(i.category)}</div>
          <div class="actions">
            <button class="btn sm" data-book="${i.id}" ${i.status !== 'normal' ? 'disabled' : ''}>${ic('bookings')} จอง</button>
            <button class="btn ghost sm" data-info="${i.id}">รายละเอียด</button>
          </div>
        </div>
      </div>`).join('') : `<div class="empty" style="grid-column:1/-1"><div class="big">${ic('search')}</div>ไม่พบรายการที่ตรงกับเงื่อนไข</div>`;
  };
  $('#qt').oninput = (e) => { q.text = e.target.value; draw(); };
  $('#qc').onchange = (e) => { q.cat = e.target.value; draw(); };
  $('#qf').onchange = (e) => { q.onlyFree = e.target.checked; draw(); };
  $('#qs').onchange = (e) => { q.start = e.target.value || TODAY(); if (q.end < q.start) { q.end = q.start; $('#qe').value = q.end; } load(); };
  $('#qe').onchange = (e) => { q.end = e.target.value < q.start ? q.start : e.target.value; e.target.value = q.end; load(); };
  $('#list').onclick = async (e) => {
    const b = e.target.closest('[data-book]'), inf = e.target.closest('[data-info]');
    if (b) openBooking(items.find((i) => i.id == b.dataset.book));
    if (inf) {
      const it = items.find((i) => i.id == inf.dataset.info);
      const bk = await api(`/api/items/${it.id}/bookings`);
      modal(esc(it.code), `<div style="text-align:center;background:var(--blue-50);border-radius:12px;margin-bottom:14px">${it.image ? `<img src="${esc(it.image)}" style="max-width:100%;max-height:320px;object-fit:contain">` : `<div class="noimg" style="padding:30px">${ic('items')}</div>`}</div>
        <h3>${esc(it.name)}</h3><p style="color:var(--muted);margin-top:0">${esc(it.category)} · ${itemPill(it)}</p>
        ${it.description ? `<p>${esc(it.description)}</p>` : ''}
        <h3 style="margin-top:16px">กำหนดการจองที่จะถึง</h3>
        ${bk.length ? bk.map((b) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed var(--line)"><span>${fmtD(b.start_date)} ${b.start_time} – ${fmtD(b.end_date)} ${b.end_time} น.</span>${pill(BK, b.status)}</div>`).join('') : '<p style="color:var(--muted)">ยังไม่มีการจอง</p>'}`);
    }
  };
  await load();
}

async function pageMyBookings() {
  const rows = await api('/api/bookings/mine');
  view.innerHTML = `<div class="page-head"><div><h1>การจองของฉัน</h1><p>ติดตามสถานะคำขอยืมและกำหนดคืน</p></div><a class="btn" href="#/items">+ จองหุ่นเพิ่ม</a></div>
    <div class="card"><div class="table-wrap">${rows.length ? `<table><thead><tr><th></th><th>หุ่น/อุปกรณ์</th><th>วันที่ยืม</th><th>วันที่คืน</th><th>วัตถุประสงค์</th><th>สถานะ</th><th></th></tr></thead><tbody>
    ${rows.map((b) => `<tr><td>${img(b.item_image, 'mini-thumb')}</td><td><b>${esc(b.item_code)}</b><div class="sub">${esc(b.item_name)}</div></td>
      <td>${fmtD(b.start_date)}<div class="sub">${b.start_time} น.</div></td><td>${fmtD(b.end_date)}<div class="sub">${b.end_time} น.</div>${b.status === 'borrowed' && b.end_date < TODAY() ? ' <span class="pill repair">เลยกำหนด</span>' : ''}</td>
      <td class="sub">${esc(b.purpose || '-')}${b.created_by !== b.user_id ? `<div>จองโดย ${esc(b.created_by_name)}</div>` : ''}</td><td>${pill(BK, b.status)}</td>
      <td>${['pending', 'approved'].includes(b.status) ? `<button class="btn ghost sm" data-c="${b.id}">ยกเลิก</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : `<div class="empty"><div class="big">${ic('bookings')}</div>ยังไม่มีการจอง<br><a href="#/items">ไปเลือกหุ่นที่ต้องการ</a></div>`}</div></div>`;
  view.onclick = async (e) => {
    const c = e.target.closest('[data-c]');
    if (c && await confirmBox('ต้องการยกเลิกการจองนี้?')) { await run(() => api(`/api/bookings/${c.dataset.c}/cancel`, { method: 'POST' }), 'ยกเลิกแล้ว'); refreshMe(); route(); }
  };
}

async function pageReport() {
  const [items, mine] = await Promise.all([api('/api/items'), api('/api/reports/mine')]);
  view.innerHTML = `<div class="page-head"><div><h1>แจ้งหุ่นเสีย / ขอซ่อม</h1><p>รายงานความผิดปกติของหุ่นหรืออุปกรณ์ส่งถึงผู้ดูแลระบบ</p></div></div>
    <div class="grid two-col">
      <div class="card"><h2>แจ้งปัญหาใหม่</h2>
        <div class="field"><label>หุ่น/อุปกรณ์</label><input id="rs" list="rl" placeholder="พิมพ์รหัสหรือชื่อเพื่อค้นหา"><datalist id="rl">${items.map((i) => `<option value="${esc(i.code)} — ${esc(i.name)}">`).join('')}</datalist></div>
        <div class="field"><label>อาการ / ปัญหาที่พบ</label><textarea id="rd" rows="5" placeholder="เช่น ปอดซ้ายไม่ขยายเมื่อช่วยหายใจ, ผิวหนังบริเวณแขนฉีกขาด"></textarea></div>
        <button class="btn" id="rsend">${ic('send')} ส่งเรื่องถึง Admin</button>
      </div>
      <div class="card"><h2>เรื่องที่ฉันแจ้ง</h2>
        ${mine.length ? mine.map((r) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
          <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(r.item_code)}</b>${pill(RP, r.status)}</div>
          <div class="sub" style="color:var(--muted);font-size:.84rem">${esc(r.item_name)} · ${fmtD(r.created_at)}</div>
          <div style="margin-top:4px">${esc(r.detail)}</div>
          ${r.admin_note ? `<div style="margin-top:6px;background:var(--blue-50);padding:8px 10px;border-radius:8px;font-size:.88rem">${ic('chat')} Admin: ${esc(r.admin_note)}</div>` : ''}
        </div>`).join('') : '<div class="empty">ยังไม่มีการแจ้ง</div>'}
      </div>
    </div>`;
  $('#rsend').onclick = async () => {
    const code = $('#rs').value.split(' — ')[0].trim();
    const it = items.find((i) => i.code === code);
    if (!it) return toast('กรุณาเลือกหุ่นจากรายการ', 'err');
    if (await run(() => api('/api/reports', { method: 'POST', body: { item_id: it.id, detail: $('#rd').value } }), 'ส่งเรื่องแจ้งซ่อมแล้ว')) route();
  };
}

function pageGuide() {
  const sec = (icon, title, steps) => `<div class="card guide-section"><h2>${icon} ${title}</h2><div class="steps">${steps.map(([h, p]) => `<div class="step"><div class="n"></div><div><b>${h}</b><p>${p}</p></div></div>`).join('')}</div></div>`;
  view.innerHTML = `<div class="page-head"><div><h1>คู่มือการใช้งาน</h1><p>ขั้นตอนการใช้ CMEC E-Borrow App</p></div></div>
    ${sec(ic('search'), 'ดูหุ่นที่ว่าง', [
      ['ไปที่เมนู "หุ่นและอุปกรณ์"', 'จะเห็นรายการหุ่นทั้งหมดพร้อมรูปและสถานะ'],
      ['เลือกช่วงวันที่ที่ต้องการใช้', 'ระบบจะคำนวณว่าหุ่นตัวใดว่างในช่วงวันที่นั้น'],
      ['ค้นหา / กรองหมวดหมู่', 'ติ๊ก "แสดงเฉพาะที่ว่าง" เพื่อดูเฉพาะหุ่นที่พร้อมให้ยืม']])}
    ${sec(ic('bookings'), 'จองล่วงหน้า', [
      ['กดปุ่ม "จอง" ที่หุ่นที่ต้องการ', 'จะมีปฏิทินแสดงวันที่ถูกจองแล้ว (สีแดง)'],
      ['คลิกวันที่ยืม แล้วคลิกวันที่คืน', 'หรือเลือกจากช่องวันที่ด้านล่าง ระบบไม่ให้เลือกช่วงที่ชนกับการจองอื่น'],
      ['ระบุวัตถุประสงค์และกด "ยืนยันการจอง"', 'การจองสำเร็จทันที ไม่ต้องรออนุมัติ'],
      ['ติดตามที่เมนู "การจองของฉัน"', 'ยกเลิกได้ระหว่างที่ยังไม่ได้รับของ']])}
    ${sec(ic('box'), 'รับและคืนหุ่น', [
      ['มารับหุ่นที่ศูนย์ CMEC ตามวันที่จอง', 'เจ้าหน้าที่จะบันทึกสถานะเป็น "กำลังยืม"'],
      ['ตรวจสภาพหุ่นก่อนใช้งาน', 'หากพบความผิดปกติให้แจ้งทันที'],
      ['คืนหุ่นภายในวันที่กำหนด', 'เจ้าหน้าที่จะบันทึก "คืนแล้ว"']])}
    ${sec(ic('report'), 'แจ้งหุ่นเสีย / ซ่อม', [
      ['ไปที่เมนู "แจ้งซ่อม"', 'พิมพ์รหัสหรือชื่อหุ่นแล้วเลือกจากรายการ'],
      ['อธิบายอาการที่พบ', 'ยิ่งละเอียดยิ่งช่วยให้ซ่อมได้เร็ว'],
      ['ติดตามสถานะได้ทางขวามือ', 'Admin จะอัปเดตสถานะและหมายเหตุการซ่อม']])}
    ${sec(ic('user'), 'บัญชีผู้ใช้', [
      ['คลิกชื่อของคุณมุมขวาบน', 'ดูสถานะบัญชี หน่วยงาน จำนวนการจองที่ใช้งานอยู่'],
      ['เปลี่ยนรหัสผ่าน / ออกจากระบบ', 'แนะนำให้เปลี่ยนรหัสผ่านเมื่อเข้าใช้ครั้งแรก']])}
    ${ME.role === 'admin' ? sec(ic('shield'), 'สำหรับผู้ดูแลระบบ', [
      ['จัดการการจอง', 'บันทึกรับของ → บันทึกคืน (นับสถิติเมื่อบันทึกรับของ) หรือยกเลิกการจอง'],
      ['จองแทนผู้ใช้', 'ปุ่ม "+ จองแทนผู้ใช้" เลือกผู้ใช้เดิมหรือสร้างผู้ยืมใหม่'],
      ['จัดการหุ่น', 'เพิ่ม แก้ไข ลบ อัปโหลดรูป และสลับสถานะ ปกติ / อยู่ระหว่างซ่อม / หุ่นเสีย (หุ่นที่ซ่อมหรือเสียจะจองไม่ได้)'],
      ['สถิติรายเดือน', 'ตัวเลขเริ่มนับใหม่ทุกต้นเดือนอัตโนมัติ และเลือกดูเดือนก่อนหน้าได้']]) : ''}`;
}

// ---------- Admin pages ----------
let chart1, chart2;
async function pageAdminDashboard() {
  const month = pageAdminDashboard.month;
  const s = await api('/api/admin/stats' + (month ? `?month=${month}` : ''));
  view.innerHTML = `<div class="page-head"><div><h1>สถิติการใช้งาน</h1><p>นับจำนวนครั้งที่ยืมจริง (บันทึกรับของ) — เริ่มนับใหม่ทุกต้นเดือน</p></div>
    <select id="mSel" style="width:auto">${s.months.map((m) => `<option value="${m}" ${m === s.month ? 'selected' : ''}>${fmtMonth(m)}</option>`).join('')}</select></div>
    <div class="grid kpis">
      ${[[ic('trend'), s.total, `ครั้งที่ยืม (${fmtMonth(s.month)})`], [ic('box'), s.borrowedNow, 'กำลังถูกยืมอยู่'], [ic('clock'), s.pending, 'คำขอรออนุมัติ'], [ic('repair'), s.repair, `อยู่ระหว่างซ่อม / ${s.items} ทั้งหมด`], [ic('x'), s.broken, 'หุ่นเสีย'], [ic('bell'), s.openReports, 'เรื่องแจ้งซ่อมค้าง']]
      .map(([i, v, l]) => `<div class="card kpi"><div class="ico">${i}</div><div><div class="v">${v}</div><div class="l">${l}</div></div></div>`).join('')}
    </div>
    <div class="grid two-col">
      <div class="card"><h2>หุ่นที่ถูกยืมมากที่สุด (Top 10)</h2>${s.top.length ? '<div style="height:340px"><canvas id="c1"></canvas></div>' : `<div class="empty"><div class="big">${ic('dashboard')}</div>ยังไม่มีการยืมในเดือนนี้</div>`}</div>
      <div class="card"><h2>แยกตามหมวดหมู่</h2>${s.byCategory.length ? '<div style="height:340px"><canvas id="c2"></canvas></div>' : '<div class="empty">—</div>'}</div>
    </div>`;
  $('#mSel').onchange = (e) => { pageAdminDashboard.month = e.target.value; route(); };
  chart1?.destroy(); chart2?.destroy();
  if (window.Chart && s.top.length) {
    chart1 = new Chart($('#c1'), { type: 'bar', data: { labels: s.top.map((t) => t.code), datasets: [{ data: s.top.map((t) => t.count), backgroundColor: '#1e5bb8', borderRadius: 6 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (c) => s.top[c[0].dataIndex].code + ' ' + s.top[c[0].dataIndex].name } } }, scales: { x: { ticks: { precision: 0 } } } } });
  }
  if (window.Chart && s.byCategory.length) {
    chart2 = new Chart($('#c2'), { type: 'doughnut', data: { labels: s.byCategory.map((c) => c.category), datasets: [{ data: s.byCategory.map((c) => c.count), backgroundColor: ['#1e5bb8', '#0f3d82', '#4f86d9', '#8fb4ea', '#c7dbf6', '#2a9d8f', '#e9c46a', '#f4a261', '#94a3b8'] }] },
      options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { family: 'Prompt' } } } } } });
  }
}

async function pageAdminBookings() {
  const st = pageAdminBookings.status || 'approved';
  const rows = await api('/api/admin/bookings?status=' + st);
  const tabs = [['approved', 'รอรับของ'], ['borrowed', 'กำลังยืม'], ['returned', 'คืนแล้ว'], ['all', 'ทั้งหมด']];
  view.innerHTML = `<div class="page-head"><div><h1>จัดการการจอง</h1><p>อนุมัติคำขอ บันทึกรับ-คืน และจองแทนผู้ใช้</p></div><button class="btn" id="behalf">+ จองแทนผู้ใช้</button></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === st ? 'active' : ''}">${l}</button>`).join('')}</div>
    <div class="card"><div class="table-wrap">${rows.length ? `<table><thead><tr><th>#</th><th>หุ่น/อุปกรณ์</th><th>ผู้ยืม</th><th>ช่วงวันที่</th><th>วัตถุประสงค์</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>
      ${rows.map((b) => `<tr><td class="sub">${b.id}</td><td><b>${esc(b.item_code)}</b><div class="sub">${esc(b.item_name)}</div></td>
        <td>${esc(b.user_name)}<div class="sub">${esc(b.user_department || '')} ${esc(b.user_phone || '')}</div></td>
        <td>${fmtD(b.start_date)} ${b.start_time} – ${fmtD(b.end_date)} ${b.end_time} น.${b.status === 'borrowed' && b.end_date < TODAY() ? '<div><span class="pill repair">เลยกำหนดคืน</span></div>' : ''}</td>
        <td class="sub">${esc(b.purpose || '-')}${b.created_by !== b.user_id ? `<div>จองโดย ${esc(b.created_by_name)}</div>` : ''}</td>
        <td>${pill(BK, b.status)}</td>
        <td><div class="acts">${{
          pending: `<button class="btn success sm" data-s="approved" data-id="${b.id}">อนุมัติ</button><button class="btn ghost sm" data-s="rejected" data-id="${b.id}">ไม่อนุมัติ</button>`,
          approved: `<button class="btn sm" data-s="borrowed" data-id="${b.id}">บันทึกรับของ</button><button class="btn ghost sm" data-s="cancelled" data-id="${b.id}">ยกเลิก</button>`,
          borrowed: `<button class="btn success sm" data-s="returned" data-id="${b.id}">บันทึกคืน</button>`,
        }[b.status] || ''}</div></td></tr>`).join('')}
      </tbody></table>` : `<div class="empty"><div class="big">${ic('inbox')}</div>ไม่มีรายการ</div>`}</div></div>`;
  view.onclick = async (e) => {
    const t = e.target.closest('[data-t]');
    if (t) { pageAdminBookings.status = t.dataset.t; return route(); }
    const s = e.target.closest('[data-s]');
    if (s) { if (await run(() => api(`/api/admin/bookings/${s.dataset.id}`, { method: 'PATCH', body: { status: s.dataset.s } }), 'อัปเดตแล้ว')) { refreshMe(); route(); } }
    if (e.target.closest('#behalf')) {
      const items = (await api('/api/items')).filter((i) => i.status === 'normal');
      const m = modal('จองแทนผู้ใช้ — เลือกหุ่น', `<input id="fs" placeholder="ค้นหา" style="margin-bottom:10px"><div id="fl" style="max-height:50vh;overflow:auto"></div>`);
      const draw = () => {
        const t2 = $('#fs', m).value.toLowerCase();
        $('#fl', m).innerHTML = items.filter((i) => (i.code + i.name).toLowerCase().includes(t2)).map((i) =>
          `<div data-pick="${i.id}" style="display:flex;gap:10px;align-items:center;padding:8px;border-radius:10px;cursor:pointer" onmouseover="this.style.background='var(--blue-50)'" onmouseout="this.style.background=''">${img(i.image, 'mini-thumb')}<div><b>${esc(i.code)}</b><div class="sub" style="color:var(--muted);font-size:.84rem">${esc(i.name)}</div></div></div>`).join('');
      };
      $('#fs', m).oninput = draw; draw();
      $('#fl', m).onclick = (ev) => { const p = ev.target.closest('[data-pick]'); if (p) { m.remove(); openBooking(items.find((i) => i.id == p.dataset.pick), { onBehalf: true }); } };
    }
  };
}

async function pageAdminItems() {
  const items = await api('/api/items');
  const q = pageAdminItems.q || '';
  const cats = [...new Set([...CATS, ...items.map((i) => i.category)])].filter((c) => items.some((i) => i.category === c));
  if (pageAdminItems.cat && !cats.includes(pageAdminItems.cat)) pageAdminItems.cat = '';
  view.innerHTML = `<div class="page-head"><div><h1>จัดการหุ่นและอุปกรณ์</h1><p>เพิ่ม แก้ไข ลบ และกำหนดสถานะ ปกติ / อยู่ระหว่างซ่อม / หุ่นเสีย</p></div><button class="btn" id="add">+ เพิ่มหุ่นใหม่</button></div>
    <div class="toolbar"><div class="grow"><input id="q" placeholder="ค้นหารหัส/ชื่อ" value="${esc(q)}"></div></div>
    <div class="cat-tabs" id="ct"></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th></th><th>รหัส</th><th>ชื่อ</th><th>หมวดหมู่</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  const draw = () => {
    const t = $('#q').value.toLowerCase(); pageAdminItems.q = $('#q').value;
    const cur = pageAdminItems.cat || '';
    const match = items.filter((i) => (i.code + ' ' + i.name).toLowerCase().includes(t));
    $('#ct').innerHTML = [['', 'ทั้งหมด', match.length], ...cats.map((c) => [c, c, match.filter((i) => i.category === c).length])]
      .map(([v, l, n]) => `<button type="button" class="cat-tab ${v === cur ? 'on' : ''}" data-cat="${esc(v)}">${esc(l)} <span>${n}</span></button>`).join('');
    const row = (i) => `<tr>
      <td>${img(i.image, 'mini-thumb')}</td><td><b>${esc(i.code)}</b></td><td>${esc(i.name)}</td><td class="sub">${esc(i.category)}</td>
      <td><select data-st="${i.id}" style="width:auto;padding:5px 8px;font-size:.85rem;color:${IST[i.status][2]};border-color:${i.status === 'normal' ? 'var(--line)' : IST[i.status][2]}">
        ${statusOptions(i.status)}</select></td>
      <td><div class="acts"><button class="btn ghost sm" data-ed="${i.id}">แก้ไข</button><button class="btn danger sm" data-del="${i.id}">ลบ</button></div></td></tr>`;
    const groups = (cur ? [cur] : cats).map((c) => [c, match.filter((i) => i.category === c)]).filter(([, l]) => l.length);
    $('#tb').innerHTML = groups.length ? groups.map(([c, l]) => `<tr class="cat-row"><td colspan="6">${esc(c)} <span>${l.length} รายการ</span></td></tr>${l.map(row).join('')}`).join('')
      : '<tr><td colspan="6" class="sub" style="text-align:center;padding:30px">ไม่พบรายการ</td></tr>';
  };
  $('#q').oninput = draw; draw();
  $('#ct').onclick = (e) => { const b = e.target.closest('[data-cat]'); if (b) { pageAdminItems.cat = b.dataset.cat; draw(); } };
  const form = (it = {}) => {
    const m = modal(it.id ? 'แก้ไขข้อมูลหุ่น' : 'เพิ่มหุ่นใหม่', `<form id="itf">
      <div class="field-row"><div class="field"><label>รหัส *</label><input name="code" value="${esc(it.code || '')}" required></div>
      <div class="field"><label>หมวดหมู่</label><select name="category">${CATS.map((c) => `<option ${c === it.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div></div>
      <div class="field"><label>ชื่อหุ่น/อุปกรณ์ *</label><input name="name" value="${esc(it.name || '')}" required></div>
      <div class="field"><label>รายละเอียด</label><textarea name="description" rows="3">${esc(it.description || '')}</textarea></div>
      <div class="field-row"><div class="field"><label>สถานะ</label><select name="status">${statusOptions(it.status || 'normal')}</select></div>
      <div class="field"><label>รูปภาพ ${it.image ? '(เว้นว่างเพื่อใช้รูปเดิม)' : ''}</label><input type="file" name="image" accept="image/png,image/jpeg,image/webp"></div></div>
      </form>`, '<button class="btn ghost" data-close>ยกเลิก</button><button class="btn" id="sv">บันทึก</button>');
    $('#sv', m).onclick = async () => {
      const fd = new FormData($('#itf', m));
      if (!fd.get('image')?.size) fd.delete('image');
      if (await run(() => api(it.id ? `/api/items/${it.id}` : '/api/items', { method: it.id ? 'PUT' : 'POST', body: fd }), 'บันทึกแล้ว')) { m.remove(); route(); }
    };
  };
  $('#add').onclick = () => form();
  $('#tb').onchange = async (e) => {
    const s = e.target.closest('[data-st]');
    if (s && await run(() => api(`/api/items/${s.dataset.st}/status`, { method: 'PATCH', body: { status: s.value } }), 'อัปเดตสถานะแล้ว')) route();
  };
  $('#tb').onclick = async (e) => {
    const ed = e.target.closest('[data-ed]'), del = e.target.closest('[data-del]');
    if (ed) form(items.find((i) => i.id == ed.dataset.ed));
    if (del) {
      const it = items.find((i) => i.id == del.dataset.del);
      if (await confirmBox(`ลบ <b>${esc(it.code)}</b> ${esc(it.name)}?<br><small style="color:var(--red)">ประวัติการจองและสถิติของหุ่นนี้จะถูกลบด้วย</small>`))
        if (await run(() => api(`/api/items/${it.id}`, { method: 'DELETE' }), 'ลบแล้ว')) route();
    }
  };
}

async function pageAdminReports() {
  const rows = await api('/api/admin/reports');
  view.innerHTML = `<div class="page-head"><div><h1>รายการแจ้งซ่อม</h1><p>เรื่องที่ผู้ใช้แจ้งเข้ามา</p></div></div>
    <div class="card"><div class="table-wrap">${rows.length ? `<table><thead><tr><th>วันที่</th><th>หุ่น</th><th>ผู้แจ้ง</th><th>อาการ</th><th>สถานะเรื่อง</th><th>สถานะหุ่น</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="sub">${fmtD(r.created_at)}</td><td><b>${esc(r.item_code)}</b><div class="sub">${esc(r.item_name)}</div></td>
        <td>${esc(r.user_name)}<div class="sub">${esc(r.user_department || '')}</div></td><td>${esc(r.detail)}${r.admin_note ? `<div class="sub">${ic('chat')} ${esc(r.admin_note)}</div>` : ''}</td>
        <td>${pill(RP, r.status)}</td><td>${itemPill({ status: r.item_status, available: true })}</td>
        <td><button class="btn sm" data-r="${r.id}">อัปเดต</button></td></tr>`).join('')}
      </tbody></table>` : `<div class="empty"><div class="big">${ic('party')}</div>ไม่มีเรื่องแจ้งซ่อม</div>`}</div></div>`;
  view.onclick = (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    const r = rows.find((x) => x.id == b.dataset.r);
    const m = modal('อัปเดตเรื่องแจ้งซ่อม', `<p><b>${esc(r.item_code)}</b> ${esc(r.item_name)}<br><span style="color:var(--muted)">${esc(r.detail)}</span></p>
      <div class="field"><label>สถานะเรื่อง</label><select id="rs">${Object.entries(RP).map(([k, v]) => `<option value="${k}" ${k === r.status ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
      <div class="field"><label>หมายเหตุถึงผู้แจ้ง</label><textarea id="rn" rows="3">${esc(r.admin_note || '')}</textarea></div>
      <div class="field"><label>สถานะหุ่น</label><select id="is">${statusOptions(r.item_status, { normal: 'ปกติ (ให้ยืมได้)', repair: 'อยู่ระหว่างซ่อม (ปิดการจอง)', broken: 'หุ่นเสีย (ปิดการจอง)' })}</select></div>`,
      '<button class="btn ghost" data-close>ยกเลิก</button><button class="btn" id="sv">บันทึก</button>');
    $('#sv', m).onclick = async () => {
      const ok = await run(async () => {
        await api(`/api/admin/reports/${r.id}`, { method: 'PATCH', body: { status: $('#rs', m).value, admin_note: $('#rn', m).value } });
        await api(`/api/items/${r.item_id}/status`, { method: 'PATCH', body: { status: $('#is', m).value } });
      }, 'บันทึกแล้ว');
      if (ok) { m.remove(); refreshMe(); route(); }
    };
  };
}

async function pageAdminUsers() {
  const users = await api('/api/admin/users');
  view.innerHTML = `<div class="page-head"><div><h1>ผู้ใช้งาน</h1><p>สร้างบัญชีและเปิด/ปิดการใช้งาน</p></div><button class="btn" id="add">+ เพิ่มผู้ใช้</button></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th>ชื่อผู้ใช้</th><th>หน่วยงาน</th><th>เบอร์โทร</th><th>สิทธิ์</th><th>สถานะ</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr><td><b>${esc(u.name)}</b></td><td>@${esc(u.username)}</td><td>${esc(u.department || '-')}</td><td>${esc(u.phone || '-')}</td>
      <td>${u.role === 'admin' ? '<span class="pill info">Admin</span>' : 'ผู้ใช้'}</td><td>${u.active ? '<span class="pill ok">ใช้งาน</span>' : '<span class="pill gray">ปิดใช้งาน</span>'}</td>
      <td><div class="acts"><button class="btn ghost sm" data-pw="${u.id}">ตั้งรหัสใหม่</button>${u.id !== ME.id ? `<button class="btn ${u.active ? 'danger' : 'success'} sm" data-act="${u.id}" data-v="${u.active ? 0 : 1}">${u.active ? 'ปิด' : 'เปิด'}</button>` : ''}</div></td></tr>`).join('')}
    </tbody></table></div></div>`;
  $('#add').onclick = () => {
    const m = modal('เพิ่มผู้ใช้', `<div class="field-row"><div class="field"><label>ชื่อ-นามสกุล *</label><input id="n"></div><div class="field"><label>ชื่อผู้ใช้ *</label><input id="u"></div></div>
      <div class="field-row"><div class="field"><label>หน่วยงาน</label><input id="d"></div><div class="field"><label>เบอร์โทร</label><input id="p"></div></div>
      <div class="field-row"><div class="field"><label>รหัสผ่าน * (อย่างน้อย 6 ตัว)</label><input id="w"></div><div class="field"><label>สิทธิ์</label><select id="r"><option value="user">ผู้ใช้</option><option value="admin">Admin</option></select></div></div>`,
      '<button class="btn ghost" data-close>ยกเลิก</button><button class="btn" id="sv">บันทึก</button>');
    $('#sv', m).onclick = async () => {
      const body = { name: $('#n', m).value, username: $('#u', m).value, department: $('#d', m).value, phone: $('#p', m).value, password: $('#w', m).value, role: $('#r', m).value };
      if (await run(() => api('/api/admin/users', { method: 'POST', body }), 'เพิ่มผู้ใช้แล้ว')) { m.remove(); route(); }
    };
  };
  view.onclick = async (e) => {
    const a = e.target.closest('[data-act]'), p = e.target.closest('[data-pw]');
    if (a && await run(() => api(`/api/admin/users/${a.dataset.act}`, { method: 'PATCH', body: { active: a.dataset.v === '1' } }), 'อัปเดตแล้ว')) route();
    if (p) {
      const m = modal('ตั้งรหัสผ่านใหม่', '<div class="field"><label>รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)</label><input id="w"></div>', '<button class="btn ghost" data-close>ยกเลิก</button><button class="btn" id="sv">บันทึก</button>');
      $('#sv', m).onclick = async () => { if (await run(() => api(`/api/admin/users/${p.dataset.pw}`, { method: 'PATCH', body: { password: $('#w', m).value } }), 'ตั้งรหัสผ่านแล้ว')) m.remove(); };
    }
  };
}

// ---------- Router ----------
const ROUTES = {
  '/items': pageItems, '/my-bookings': pageMyBookings, '/report': pageReport, '/guide': pageGuide,
  '/admin/dashboard': pageAdminDashboard, '/admin/bookings': pageAdminBookings, '/admin/items': pageAdminItems,
  '/admin/reports': pageAdminReports, '/admin/users': pageAdminUsers,
};
async function route() {
  const p = location.hash.slice(1) || '/items';
  let fn = ROUTES[p] || pageItems;
  if (p.startsWith('/admin') && ME.role !== 'admin') fn = pageItems;
  view.onclick = null;
  document.querySelectorAll('.modal-bg').forEach((m) => m.remove());
  setSidebar(false);
  renderNav();
  try { await fn(); } catch (e) { view.innerHTML = `<div class="empty"><div class="big">${ic('warn')}</div>${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);

(async () => {
  try { await refreshMe(); } catch { return; }
  CATS = await api('/api/categories');
  route();
})();
