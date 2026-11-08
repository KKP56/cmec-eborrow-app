const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const secretFile = path.join(__dirname, '..', 'data', 'secret.key');
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(48).toString('hex'));
  SECRET = fs.readFileSync(secretFile, 'utf8');
}

const COOKIE = 'eb_token';

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '12h' });
}

function makeAuth(db) {
  function requireUser(req, res, next) {
    try {
      const payload = jwt.verify(req.cookies[COOKIE] || '', SECRET);
      const u = db.prepare('SELECT id,username,name,department,phone,role,active FROM users WHERE id=?').get(payload.id);
      if (!u || !u.active) throw new Error('inactive');
      req.user = u;
      next();
    } catch {
      res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    }
  }
  function requireAdmin(req, res, next) {
    requireUser(req, res, () => {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบ' });
      next();
    });
  }
  return { requireUser, requireAdmin };
}

module.exports = { sign, makeAuth, COOKIE };
