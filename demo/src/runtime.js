/* Exposift demo runtime: the settings screen runs for real in the browser (rules, categories, scan mapping, backup and
 * change log live in localStorage through mask-store.js). The few actions that need a server are answered here:
 * AI connections are kept (without keys) in this browser only, and nothing is ever sent anywhere. */
(function () {
  'use strict';
  const LS = { llm: 'exi-demo-llm', ai: 'exi-demo-ai' };
  const rd = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const ok = (data) => json({ ok: true, data });
  const fail = (msg, status = 400) => json({ ok: false, error: msg }, status);
  const T = (s) => (window.Ex && window.Ex.t ? window.Ex.t(s) : s);
  const D = window.EX_DEMO || { types: {} };
  const slug = (s) => String(s || 'connection').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'connection';

  const list = () => rd(LS.llm, []);
  const save = (l) => wr(LS.llm, l);

  const handlers = {
    'llm.list': () => ok({ connections: list(), types: D.types }),
    'llm.save': (i) => {
      const inc = i.connection || {}; const l = list();
      const name = String(inc.name || '').trim();
      if (!name) return fail(T('Name is required.'));
      const prev = l.find(c => c.id === i.id);
      const row = Object.assign({ id: i.id || slug(name) + '-' + Math.random().toString(36).slice(2, 6), enabled: true, models: [] }, prev || {}, inc);
      delete row.api_key;
      row.has_key = !!(inc.api_key || (prev && prev.has_key)); row.key_hint = row.has_key ? '••••' : '';
      const idx = l.findIndex(c => c.id === row.id);
      if (idx >= 0) l[idx] = row; else l.push(row);
      save(l); return ok({ connections: l });
    },
    'llm.delete': (i) => { const l = list().filter(c => c.id !== i.id); save(l); return ok({ connections: l }); },
    'llm.reorder': (i) => { const l = list(); const o = (i.ids || []).map(id => l.find(c => c.id === id)).filter(Boolean); const rest = l.filter(c => !(i.ids || []).includes(c.id)); const n = o.concat(rest); save(n); return ok({ connections: n }); },
    'llm.test': () => fail(T('Connections cannot be tested in the demo: it has no server.'), 502),
    'chat.models': () => ok({ models: list().filter(c => c.enabled).flatMap(c => (c.models || []).map(m => ({ id: c.id + ':' + m, name: m }))), errors: [], default: (rd(LS.ai, {}).default_model) || '' }),
    'ai.settings': (i) => { const a = { default_model: String(i.default_model || ''), max_chars: Math.max(1000, Math.min(2000000, parseInt(i.max_chars, 10) || 200000)) }; wr(LS.ai, a); return ok(a); },
    'ai.settings.read': () => ok(Object.assign({ default_model: '', max_chars: 200000 }, rd(LS.ai, {}))),
    'security.get': () => ok({ session_minutes: 60 }),
    'security.save': () => fail(T('Disabled in the demo.')),
    'password.change': () => fail(T('The password cannot be changed in the demo.')),
    'logout': () => ok([]),
    'login': () => ok({ signed_in: true }),
    'admin.setup': () => ok({ signed_in: true }),
    'ai.models': () => fail(T('The AI features are switched off in the demo.'), 503),
    'ai.chat': () => fail(T('The AI features are switched off in the demo.'), 503)
  };

  const prev = window.fetch.bind(window);
  window.fetch = async function (url, opts = {}) {
    const m = typeof url === 'string' && /^api\.php\?action=([^&]+)/.exec(url);
    const action = m ? decodeURIComponent(m[1]) : '';
    if (!m || !Object.prototype.hasOwnProperty.call(handlers, action)) return prev(url, opts);
    let input = {}; try { input = opts.body ? JSON.parse(opts.body) : {}; } catch (e) { input = {}; }
    return handlers[action](input);
  };

  window.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('demoReset');
    if (b) b.addEventListener('click', () => {
      if (!confirm(T('Reset the demo? Your rules, categories and settings in this browser are cleared.'))) return;
      try { Object.keys(localStorage).filter(k => k.indexOf('exi-') === 0 && k !== 'exi-theme').forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
      location.reload();
    });
  });
})();
