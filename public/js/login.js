(() => {
  const portal = document.currentScript.dataset.portal;
  const f = document.getElementById('f');
  const err = document.getElementById('err');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const btn = f.querySelector('button');
    btn.disabled = true;
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: f.u.value, password: f.p.value, portal }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      location.href = portal === 'admin' ? '/app.html#/admin/dashboard' : '/app.html#/items';
    } catch (ex) {
      err.textContent = ex.message || 'เข้าสู่ระบบไม่สำเร็จ';
    } finally {
      btn.disabled = false;
    }
  });
})();
