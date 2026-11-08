/* Exposift – small compatibility layer so Maskink's settings screen can run here (window.MK) */
window.MK = window.MK || {};
(function (MK) {
  'use strict';
  const Ex = window.Ex;
  MK.csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  MK.lang = Ex.lang; MK.locale = Ex.locale;
  MK.t = (s, v) => Ex.t(s, v);
  MK.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  MK.toast = (m, type, ms) => Ex.toast(m, type, ms);
  MK.api = async function (action, body = {}) {
    const res = await fetch('api.php?action=' + encodeURIComponent(action), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': MK.csrf }, body: JSON.stringify(body), credentials: 'same-origin'
    });
    let j;
    try { j = await res.json(); } catch (e) { throw new Error('Invalid response from the server (HTTP ' + res.status + ')'); }
    if (!res.ok || !j.ok) { const err = new Error(j.error || ('HTTP ' + res.status)); err.status = res.status; throw err; }
    return j.data;
  };
  MK.download = function (name, content, type = 'text/plain;charset=utf-8') {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };
  MK.readFile = file => new Promise((resolve, reject) => {
    const fr = new FileReader(); fr.onerror = () => reject(fr.error);
    fr.onload = () => { const b = new Uint8Array(fr.result); let enc = 'utf-8'; if (b[0] === 0xFF && b[1] === 0xFE) enc = 'utf-16le'; else if (b[0] === 0xFE && b[1] === 0xFF) enc = 'utf-16be'; resolve(new TextDecoder(enc).decode(b)); };
    fr.readAsArrayBuffer(file);
  });
  MK.store = {
    get(k, d) { try { const v = localStorage.getItem('exi-' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('exi-' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };
  MK.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  MK.fmt = n => Number(n || 0).toLocaleString(MK.locale);
})(window.MK);
