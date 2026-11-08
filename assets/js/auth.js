/* Exposift – settings sign-in / first password / sign out */
(function () {
  'use strict';
  const Ex = window.Ex, t = (s, v) => Ex.t(s, v);
  const csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  async function api(action, body) {
    const res = await fetch('api.php?action=' + encodeURIComponent(action), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body || {}), credentials: 'same-origin' });
    let j; try { j = await res.json(); } catch (e) { throw new Error('Invalid response from the server (HTTP ' + res.status + ')'); }
    if (!res.ok || !j.ok) throw new Error(j.error || ('HTTP ' + res.status));
    return j.data;
  }
  const form = document.getElementById('authForm');
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(form), err = document.getElementById('authErr');
      err.classList.add('hidden');
      try {
        if (form.dataset.mode === 'setup') {
          if (fd.get('password') !== fd.get('password2')) throw new Error(t('The passwords do not match.'));
          await api('admin.setup', { password: fd.get('password') });
        } else await api('login', { password: fd.get('password') });
        location.reload();
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
    });
  }
  const out = document.getElementById('logoutBtn');
  if (out) out.addEventListener('click', async () => { try { await api('logout'); } catch (e) { /* ignore */ } location.reload(); });
})();
