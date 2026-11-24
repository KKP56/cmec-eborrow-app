// Builds the files to paste into the Google Apps Script editor:  node apps-script/build.js
//   dist/Code.gs, dist/Index.html, dist/Style.html, dist/App.html, dist/appsscript.json
//   dist/SeedData.gs  — the current data in data/eborrow.db (contains personal data: do not share or commit)
// Options:  --no-data  skip SeedData.gs
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const SRC = path.join(HERE, 'src');
const DIST = path.join(HERE, 'dist');
fs.mkdirSync(DIST, { recursive: true });

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const write = (name, text) => { fs.writeFileSync(path.join(DIST, name), text); console.log('  dist/' + name + '  (' + Math.round(Buffer.byteLength(text) / 1024) + ' KB)'); };

console.log('Building Apps Script files...');
write('Code.gs', read(path.join(SRC, 'Code.gs')));
write('appsscript.json', read(path.join(SRC, 'appsscript.json')));
write('Index.html', read(path.join(SRC, 'Index.html')));
const extraCss = `
.brand-mark { display: inline-grid; place-items: center; height: 40px; min-width: 40px; padding: 0 6px; border-radius: 10px; background: var(--blue); color: #fff; font-size: .72rem; font-weight: 700; letter-spacing: .5px; }
`;
write('Style.html', '<style>\n' + read(path.join(ROOT, 'public', 'css', 'style.css')) + extraCss + '</style>\n');
write('App.html', '<script>\n' + read(path.join(SRC, 'app.js')) + '\n</script>\n');

if (process.argv.includes('--no-data')) process.exit(0);

// ---------- export current data ----------
const dbFile = path.join(ROOT, 'data', 'eborrow.db');
if (!fs.existsSync(dbFile)) { console.log('  (no data/eborrow.db — skipped SeedData.gs)'); process.exit(0); }
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(dbFile, { readOnly: true });
const all = (sql) => db.prepare(sql).all().map((r) => ({ ...r }));

const users = {};
all('SELECT id,name,department,phone FROM users').forEach((u) => { users[u.id] = u; });
const who = (id) => users[id] || { name: '(ผู้ใช้ที่ถูกลบ)', department: '', phone: '' };

const data = {
  Items: all('SELECT id,code,name,category,description,status,created_at FROM items ORDER BY id').map((i) => ({ ...i, image: '' })),
  Bookings: all('SELECT * FROM bookings ORDER BY id').map((b) => ({
    id: b.id, item_id: b.item_id, borrower_name: who(b.user_id).name, department: who(b.user_id).department || '', phone: who(b.user_id).phone || '',
    start_date: b.start_date, end_date: b.end_date, start_time: b.start_time, end_time: b.end_time, purpose: b.purpose || '',
    status: b.status, created_by: b.created_by && b.created_by !== b.user_id ? who(b.created_by).name : '', created_at: b.created_at,
  })),
  Reports: all('SELECT * FROM reports ORDER BY id').map((r) => ({
    id: r.id, item_id: r.item_id, reporter_name: who(r.user_id).name, department: who(r.user_id).department || '', phone: who(r.user_id).phone || '',
    detail: r.detail, status: r.status, admin_note: r.admin_note || '', created_at: r.created_at,
  })),
  Usage: all('SELECT month,item_id,count FROM usage_monthly ORDER BY month,item_id'),
};
write('SeedData.gs', '// Data exported from data/eborrow.db on ' + new Date().toISOString() + ' — contains personal data, delete this file from the Apps Script project after importSeedData()\nconst SEED_DATA = ' + JSON.stringify(data, null, 1) + ';\n');
console.log('  Items ' + data.Items.length + ', Bookings ' + data.Bookings.length + ', Reports ' + data.Reports.length + ', Usage ' + data.Usage.length);
