// Database layer: Node built-in SQLite (node:sqlite), schema + first-run seed
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'eborrow.db'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  department TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'อื่นๆ',
  description TEXT DEFAULT '',
  image TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'normal' CHECK (status IN ('normal','repair','broken')),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  purpose TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','borrowed','returned','cancelled','rejected')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  admin_note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS usage_monthly (
  month TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, item_id)
);
`);

// Migration: older databases only allowed status 'normal'/'repair'. SQLite can't alter a CHECK,
// so rebuild the items table (keeping ids, so bookings/reports/stats stay linked).
const itemsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='items'").get().sql;
if (!itemsSql.includes("'broken'")) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`BEGIN;
    CREATE TABLE items_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'อื่นๆ',
      description TEXT DEFAULT '',
      image TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'normal' CHECK (status IN ('normal','repair','broken')),
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    INSERT INTO items_new SELECT id,code,name,category,description,image,status,created_at FROM items;
    DROP TABLE items;
    ALTER TABLE items_new RENAME TO items;
    COMMIT;`);
  db.exec('PRAGMA foreign_keys = ON');
  console.log('Migrated items table: added status "broken"');
}

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
function categoryOf(code) {
  const prefix = (code.match(/^[A-Z.]+/) || [''])[0].replace(/\.$/, '');
  return CATEGORY_BY_PREFIX[prefix] || 'อื่นๆ';
}

function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
    const ins = db.prepare('INSERT INTO users (username,password_hash,name,department,role) VALUES (?,?,?,?,?)');
    ins.run('admin', bcrypt.hashSync('admin1234', 10), 'ผู้ดูแลระบบ CMEC', 'CMEC', 'admin');
    ins.run('user', bcrypt.hashSync('user1234', 10), 'ผู้ใช้ทดสอบ', 'แผนกการพยาบาล', 'user');
    console.log('Seeded default accounts: admin / admin1234, user / user1234 (please change)');
  }
  if (db.prepare('SELECT COUNT(*) c FROM items').get().c === 0) {
    const picDir = path.join(ROOT, 'pic');
    if (!fs.existsSync(picDir)) return;
    const ins = db.prepare('INSERT OR IGNORE INTO items (code,name,category,image) VALUES (?,?,?,?)');
    let n = 0;
    for (const file of fs.readdirSync(picDir)) {
      const m = file.match(/^([A-Z.]+\d+(?:-\d+)?)\s*-?\s*(.+)\.(jpe?g|png|webp)$/i);
      if (!m) continue;
      const code = m[1].toUpperCase();
      const name = m[2].replace(/\s+/g, ' ').trim();
      ins.run(code, name, categoryOf(code), '/pic/' + encodeURIComponent(file));
      n++;
    }
    console.log(`Seeded ${n} items from pic/`);
  }
}
seed();

module.exports = { db, CATEGORIES: [...new Set(Object.values(CATEGORY_BY_PREFIX)), 'อื่นๆ'] };
