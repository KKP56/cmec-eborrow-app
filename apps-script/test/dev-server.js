// Local preview of the Apps Script version (mock Google services, data from dist/SeedData.gs).
//   node apps-script/build.js && node apps-script/test/dev-server.js   →  http://localhost:3100
// Data lives in memory only; restarting resets it. The first admin's password is printed below.
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createGas } = require('./mock-gas');

const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(__dirname, '..', 'dist');
const PORT = process.env.PORT || 3100;

const gas = createGas({ quiet: false });
gas.load(path.join(DIST, 'Code.gs'));
gas.context.setup();
const seed = path.join(DIST, 'SeedData.gs');
if (fs.existsSync(seed)) {
  gas.load(seed);
  gas.context.importSeedData();
  // preview only: show the local photos for imported items
  const files = fs.readdirSync(path.join(ROOT, 'pic'));
  const items = gas.sheets.Items._data;
  for (let r = 1; r < items.length; r++) {
    const f = files.find((n) => n.toUpperCase().startsWith(items[r][1] + '-'));
    if (f) items[r][5] = '/pic/' + encodeURIComponent(f);
  }
}

const shim = `<script>
// stand-in for google.script.run: forwards calls to the local mock backend
(function () {
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, fn) {
      if (fn === 'withSuccessHandler') return function (h) { return runner(h, fail); };
      if (fn === 'withFailureHandler') return function (h) { return runner(ok, h); };
      return function () {
        var args = Array.prototype.slice.call(arguments);
        fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: fn, args: args }) })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (d) { setTimeout(function () { ok && ok(d.result); }, 250); })
          .catch(function (e) { fail && fail(e); });
      };
    } });
  }
  window.google = { script: { run: runner() } };
})();
</script>`;

function page() {
  const inc = (n) => fs.readFileSync(path.join(DIST, n + '.html'), 'utf8');
  return fs.readFileSync(path.join(DIST, 'Index.html'), 'utf8')
    .replace("<?!= include('Style'); ?>", inc('Style'))
    .replace("<?!= include('App'); ?>", shim + inc('App'))
    .replace(/<\? if \(logoUrl\) \{ \?>([\s\S]*?)<\? \} else \{ \?>[\s\S]*?<\? \} \?>/, '$1')
    .replace('<?= logoUrl ?>', '/logo/Logo.jpg');
}

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'POST' && url === '/rpc') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const { fn, args } = JSON.parse(body);
      if (fn !== 'api') { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: gas.context.api(...args) }));
    });
    return;
  }
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(page());
  }
  const m = url.match(/^\/(pic|logo)\/([^/]+)$/);
  if (m && fs.existsSync(path.join(ROOT, m[1], m[2]))) {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    return fs.createReadStream(path.join(ROOT, m[1], m[2])).pipe(res);
  }
  res.writeHead(404); res.end('not found');
}).listen(PORT, () => console.log('Apps Script preview at http://localhost:' + PORT));
