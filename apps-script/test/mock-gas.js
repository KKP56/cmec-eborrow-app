// Minimal in-memory stand-ins for the Google Apps Script services Code.gs uses,
// so the backend can be tested and previewed locally with Node.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function makeSheet(name) {
  const data = [];
  const sheet = {
    _data: data,
    getName: () => name,
    getMaxRows: () => 1000,
    getLastRow: () => data.length,
    getDataRange: () => ({ getValues: () => (data.length ? data.map((r) => r.slice()) : [['']]) }),
    getRange: (row, col, nr = 1, nc = 1) => ({
      setNumberFormat() { return this; },
      setFontWeight() { return this; },
      setValues(vals) {
        if (vals.length !== nr || vals.some((r) => r.length !== nc)) throw new Error('setValues: size mismatch');
        vals.forEach((r, i) => {
          const ri = row - 1 + i;
          while (data.length <= ri) data.push([]);
          r.forEach((v, j) => { data[ri][col - 1 + j] = v; });
        });
        return this;
      },
    }),
    deleteRow: (r) => { data.splice(r - 1, 1); },
    setFrozenRows() {},
  };
  return sheet;
}

function createGas({ quiet = true } = {}) {
  const logs = [];
  const sheets = {};
  const ss = {
    getId: () => 'mock-spreadsheet',
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
    getSheets: () => Object.values(sheets),
    deleteSheet: (s) => { delete sheets[s.getName()]; },
  };
  const kv = () => { const m = new Map(); return m; };
  const props = kv(), cache = kv();
  const folders = {};
  const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));

  function fmt(date, tz, pattern) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value]));
    return pattern.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day)
      .replace('HH', parts.hour).replace('mm', parts.minute).replace('ss', parts.second);
  }

  function makeFolder(name) {
    const id = 'folder-' + crypto.randomUUID().slice(0, 8);
    const files = [];
    const folder = {
      _files: files,
      getId: () => id,
      getUrl: () => 'https://drive.google.com/drive/folders/' + id,
      createFile(blob) {
        const fid = 'file-' + crypto.randomUUID().slice(0, 8);
        const f = { getId: () => fid, getName: () => blob.name, setSharing() {}, _bytes: blob.bytes };
        files.push(f);
        return f;
      },
      getFiles() { let i = 0; return { hasNext: () => i < files.length, next: () => files[i++] }; },
    };
    folders[id] = folder;
    return folder;
  }

  const globals = {
    console: {
      log: (...a) => { logs.push(a.join(' ')); if (!quiet) console.log(...a); },
      warn: (...a) => { logs.push(a.join(' ')); if (!quiet) console.warn(...a); },
      error: (...a) => { logs.push(a.join(' ')); console.error(...a); },
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => toSigned(crypto.createHash(alg).update(String(s), 'utf8').digest()),
      getUuid: () => crypto.randomUUID(),
      formatDate: fmt,
      base64Decode: (s) => toSigned(Buffer.from(s, 'base64')),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
      getFolderById: (id) => { if (!folders[id]) throw new Error('no folder'); return folders[id]; },
      createFolder: makeFolder,
    },
    HtmlService: {},
  };
  const context = vm.createContext(globals);
  const load = (file) => vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: path.basename(file) });
  return { context, logs, sheets, load, call: (req) => JSON.parse(context.api(req)) };
}

module.exports = { createGas };
