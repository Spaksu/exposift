/* Exposift – shared UI helpers (i18n, toast, theme, language switch) */
window.Ex = window.Ex || {};
(function (Ex) {
  const I = window.EX_I18N || { lang: 'en', locale: 'en-US', dict: {} };
  Ex.lang = I.lang;
  Ex.locale = I.locale;
  /** Translates an English source string; {name} placeholders are filled from vars */
  Ex.t = function (s, vars) {
    let out = I.dict && I.dict[s];
    if (!out && I.dict && I.dict.__patterns) {            // sentences with numbers or names inside
      for (const [re, rep] of I.dict.__patterns) { const m = new RegExp(re).exec(s); if (m) { out = s.replace(new RegExp(re), rep); break; } }
    }
    out = out || s;
    if (vars) for (const k in vars) out = out.split('{' + k + '}').join(String(vars[k]));
    return out;
  };
  Ex.toast = function (msg, type = 'ok', ms = 3600) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const el = document.createElement('div');
    const tone = { ok: 'bg-slate-900 text-white dark:bg-white dark:text-slate-900', err: 'bg-rose-600 text-white', warn: 'bg-amber-500 text-white' }[type] || '';
    el.className = 'ex-toast pointer-events-auto max-w-sm rounded-lg px-4 py-2.5 text-sm shadow-lg ' + tone;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, ms);
  };
  Ex.download = function (name, content, type = 'application/json') {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('exi-theme', dark ? 'dark' : 'light'); } catch (e) {}
  });
  document.getElementById('langToggle')?.addEventListener('click', e => {
    const lang = e.currentTarget.dataset.lang;
    const path = location.pathname.replace(/[^/]*$/, '');
    document.cookie = 'exi_lang=' + lang + '; path=' + path + '; max-age=31536000; samesite=lax';
    location.reload();
  });
})(window.Ex);
