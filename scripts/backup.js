// Backup script: snapshot of data/ (database + uploaded images + secret key)
// Safe to run while the server is running: the database is copied with
// SQLite's VACUUM INTO, which produces a consistent single-file copy (no -wal/-shm needed).
//
// Usage:  npm run backup
// Options (environment variables):
//   BACKUP_DIR   where to put backups (default: <project>/backups), e.g. a USB or network drive
//   BACKUP_KEEP  how many latest backups to keep (default: 30); older ones are deleted
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'eborrow.db');
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(ROOT, 'backups'));
const KEEP = Math.max(1, parseInt(process.env.BACKUP_KEEP, 10) || 30);
const PREFIX = 'eborrow-';

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function main() {
  if (!fs.existsSync(DB_FILE)) throw new Error(`ไม่พบฐานข้อมูล: ${DB_FILE}`);

  const target = path.join(BACKUP_DIR, PREFIX + stamp());
  fs.mkdirSync(target, { recursive: true });

  // 1) database — consistent snapshot even while the app is writing
  const db = new DatabaseSync(DB_FILE);
  try {
    db.exec('PRAGMA busy_timeout = 10000');
    const out = path.join(target, 'eborrow.db').replace(/'/g, "''");
    db.exec(`VACUUM INTO '${out}'`);
  } finally {
    db.close();
  }

  // 2) uploaded images and 3) login secret key (keeps existing sessions valid after restore)
  const uploads = path.join(DATA_DIR, 'uploads');
  if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(target, 'uploads'), { recursive: true });
  const secret = path.join(DATA_DIR, 'secret.key');
  if (fs.existsSync(secret)) fs.copyFileSync(secret, path.join(target, 'secret.key'));

  // verify the copy opens and passes an integrity check
  const check = new DatabaseSync(path.join(target, 'eborrow.db'), { readOnly: true });
  const ok = check.prepare('PRAGMA integrity_check').get();
  const counts = ['users', 'items', 'bookings']
    .map(t => `${t}=${check.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n}`).join(', ');
  check.close();
  if (Object.values(ok)[0] !== 'ok') throw new Error('สำเนาฐานข้อมูลไม่ผ่านการตรวจสอบ integrity_check');

  // prune old backups
  const all = fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith(PREFIX))
    .map(e => e.name).sort();
  const old = all.slice(0, Math.max(0, all.length - KEEP));
  for (const name of old) fs.rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true });

  console.log(`สำรองข้อมูลเรียบร้อย: ${target}`);
  console.log(`  ข้อมูล: ${counts}`);
  console.log(`  เก็บไว้ ${all.length - old.length} ชุด (สูงสุด ${KEEP})${old.length ? `, ลบชุดเก่า ${old.length} ชุด` : ''}`);
}

try {
  main();
} catch (err) {
  console.error('สำรองข้อมูลไม่สำเร็จ:', err.message);
  process.exit(1);
}
