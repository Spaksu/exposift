/*
 * Exposift – masking configuration (rules, categories, lists, settings). Works like Maskink's admin API but entirely in this browser:
 * the state lives in localStorage and the masking engine reads it. Requests to api.php for these actions never leave the page.
 * Adapted from Maskink's demo runtime.
 */
(function () {
  'use strict';
  const Engine = window.MaskinkEngine, P = window.MaskinkPcre, SEED = window.EX_MASK_SEED;
  const STATE_KEY = 'exi-mask-state-v1';
  const VERSION = SEED.version || '1';
  const t = (s, a) => (window.MK && window.MK.t ? window.MK.t(s, a) : (window.Ex && window.Ex.t ? window.Ex.t(s, a) : s));
  class Fail extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

  // ---------------------------------------------------------------- state
  // ---------------------------------------------------------------- state
  const clone = o => JSON.parse(JSON.stringify(o));
  const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  let memory = null; // used when storage is unavailable (private mode, blocked site data)
  function fresh() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return {
      settings: {}, rules: clone(SEED.rules), categories: clone(SEED.categories), audit: [], usage: [], nextId: SEED.rules.length + 1,
      secret: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* falls through to memory */ }
    return memory || (memory = fresh());
  }
  function save(s) {
    memory = s;
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) { /* kept in memory until the page closes */ }
  }
  const allSettings = s => ({ ...SEED.settings, ...s.settings });
  const sortRules = rules => rules.slice().sort((a, b) => (b.priority - a.priority) || (a.sort - b.sort) || (a.id - b.id));
  const sortCats = cats => cats.slice().sort((a, b) => (a.sort - b.sort) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const engine = (s, rules) => new Engine(rules || sortRules(s.rules), sortCats(s.categories), allSettings(s), s.secret, t);
  const audit = (s, action, detail = '') => {
    s.audit.push({ id: s.audit.length ? s.audit[s.audit.length - 1].id + 1 : 1, at: now(), action, detail: String(detail).slice(0, 2000), ip: 'browser' });
    if (s.audit.length > 500) s.audit.splice(0, s.audit.length - 500);
  };
  const logUsage = (s, st) => {
    if (parseInt(allSettings(s).log_usage, 10)) {
      s.usage.push({ at: now(), mode: st.mode, chars: st.chars_in, matches: st.matches, uniq: st.unique, ms: st.ms });
      if (s.usage.length > 1000) s.usage.splice(0, s.usage.length - 1000);
    }
  };
  function usageStats(s) {
    const u = s.usage, n = u.length;
    const sum = k => u.reduce((a, r) => a + (r[k] || 0), 0);
    const days = {};
    const since = new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10);
    u.forEach(r => {
      const d = r.at.slice(0, 10);
      if (d < since) return;
      const x = days[d] || (days[d] = { d, runs: 0, matches: 0 });
      x.runs++; x.matches += r.matches;
    });
    return {
      total: { runs: n, chars: sum('chars'), matches: sum('matches'), avg_ms: n ? sum('ms') / n : 0 },
      days: Object.values(days).sort((a, b) => (a.d < b.d ? -1 : 1)),
      rules: { total: s.rules.length, enabled: s.rules.filter(r => r.enabled).length, custom: s.rules.filter(r => !r.builtin).length }
    };
  }

  // ---------------------------------------------------------------- rules (src/Repo.php)
  const isTrue = v => v === true || v === 1 || (typeof v === 'string' && ['1', 'true', 'on', 'yes'].includes(v.trim().toLowerCase()));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const toInt = v => { const n = parseInt(v, 10); return Number.isNaN(n) ? 0 : n; };
  const invalid = m => new Fail(m, 422);

  function sanitizeRule(s, input) {
    const cats = s.categories.map(c => c.code);
    const name = String(input.name ?? '').trim();
    if (name === '' || Array.from(name).length > 150) throw invalid(t('The rule name must be 1-150 characters.'));
    const cat = String(input.category ?? '');
    if (!cats.includes(cat)) throw invalid(t('Invalid category.'));
    const type = String(input.type ?? 'regex');
    if (!['regex', 'keyvalue', 'keyword'].includes(type)) throw invalid(t('Invalid rule type.'));
    const modes = String(input.modes ?? 'all');
    if (!['all', 'log', 'script'].includes(modes)) throw invalid(t('Invalid mode.'));
    const groups = {};
    const rawGroups = input.groups || {};
    (Array.isArray(rawGroups) ? rawGroups.map((v, i) => [i, v]) : Object.entries(rawGroups)).forEach(([k0, v0]) => {
      let k = k0, v = v0;
      if (v && typeof v === 'object') { k = v.group; v = v.category; }
      if (k === null || k === undefined || k === '' || Number.isNaN(Number(k)) || +k < 0 || +k > 99) return;
      if (!cats.includes(v)) throw invalid(t('Invalid category for group {n}.', { n: k }));
      groups[toInt(k)] = String(v);
    });
    const o = input.options || {};
    const opt = {};
    if (['prefix', 'both'].includes(o.affix)) opt.affix = o.affix;
    if (['eq', 'space'].includes(o.seps)) opt.seps = o.seps;
    ['value_regex', 'skip_regex'].forEach(k => { if (o[k] !== undefined && String(o[k]).trim() !== '') opt[k] = String(o[k]).trim(); });
    ['min_len', 'max_len'].forEach(k => { if (o[k] && toInt(o[k]) > 0) opt[k] = toInt(o[k]); });
    ['skip_numeric', 'reclassify', 'split_domain', 'xml', 'case_sensitive'].forEach(k => { if (o[k] && isTrue(o[k])) opt[k] = true; });
    ['skip_vars', 'propagate'].forEach(k => { if (k in o && !isTrue(o[k])) opt[k] = false; });
    const val = String(o.validate ?? '');
    if (!['', 'luhn', 'tckn', 'iban', 'phone', 'entropy', 'dotted', 'person'].includes(val)) throw invalid(t('Invalid validator.'));
    if (val !== '') {
      opt.validate = val;
      if (val === 'entropy') opt.entropy_min = clamp(parseFloat(o.entropy_min ?? 4) || 0, 1, 8);
    }
    const rule = {
      id: toInt(input.id), name, description: String(input.description ?? '').trim(), category: cat, type,
      pattern: type === 'regex' ? String(input.pattern ?? '').trim() : '',
      flags: String(input.flags ?? '').replace(/[^imsxU]/g, ''),
      keys_text: type === 'regex' ? '' : String(input.keys_text ?? '').replace(/\r\n/g, '\n'),
      groups: type === 'regex' ? groups : {}, options: opt,
      priority: clamp(toInt(input.priority ?? 50), 0, 1000), modes, enabled: input.enabled ? 1 : 0
    };
    if (type === 'regex' && rule.pattern === '') throw invalid(t('The regex pattern cannot be empty.'));
    if (type === 'keyvalue' && !Engine.lines(rule.keys_text, true).length) throw invalid('Enter at least one key.');
    try { engine(s, [rule]).compile(rule); } catch (e) { throw invalid(e.message); }
    return rule;
  }
  const findRule = (s, id) => {
    const r = s.rules.find(x => x.id === toInt(id));
    if (!r) throw invalid(t('Rule not found.'));
    return r;
  };
  function saveRule(s, input) {
    const r = sanitizeRule(s, input);
    if (r.id > 0) {
      Object.assign(findRule(s, r.id), r, { updated_at: now() });
      audit(s, 'rule.update', `#${r.id} ${r.name}`);
      return r.id;
    }
    const id = s.nextId++;
    const sort = s.rules.reduce((a, x) => Math.max(a, x.sort || 0), 0) + 10;
    s.rules.push({ ...r, id, bkey: null, builtin: 0, sort, updated_at: now() });
    audit(s, 'rule.create', `#${id} ${r.name}`);
    return id;
  }
  function validateAll(s) {
    const e = engine(s), bad = [];
    for (const r of s.rules) {
      try { e.compile(r); } catch (x) { bad.push({ id: r.id, name: r.name, error: x.message }); }
    }
    return bad;
  }
  function saveCategory(s, input, isNew) {
    const code = String(input.code ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(code)) throw invalid(t('The code must be 2-32 characters of uppercase letters, digits and underscores.'));
    const label = String(input.label ?? '').trim();
    const token = String(input.token ?? code).trim();
    const color = String(input.color ?? '#64748b').trim();
    const ph = String(input.placeholder ?? '').trim();
    if (label === '' || Array.from(label).length > 100) throw invalid(t('The label must be 1-100 characters.'));
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(token)) throw invalid(t('The token prefix may contain letters, digits, _ and -.'));
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw invalid(t('The color must be in #RRGGBB format.'));
    const existing = s.categories.find(c => c.code === code);
    if (isNew && existing) throw invalid('This code already exists.');
    const vals = {
      label, token, color, placeholder: ph === '' ? null : ph.slice(0, 120), description: String(input.description ?? '').trim().slice(0, 255),
      propagate: input.propagate ? 1 : 0, case_sensitive: input.case_sensitive ? 1 : 0, enabled: input.enabled ? 1 : 0, sort: toInt(input.sort ?? 500)
    };
    if (existing) { Object.assign(existing, vals); audit(s, 'category.update', code); }
    else { s.categories.push({ code, builtin: 0, ...vals }); audit(s, 'category.create', code); }
  }
  function saveSettings(s, input) {
    const out = {};
    for (const [k, type] of Object.entries(SEED.editable)) {
      if (!(k in input)) continue;
      const v = input[k];
      if (type === 'bool') out[k] = isTrue(v) ? '1' : '0';
      else if (type === 'int') out[k] = String(Math.max(0, toInt(v)));
      else if (type.startsWith('enum:')) {
        if (!type.slice(5).split(',').includes(v)) throw invalid(t('Invalid value: {key}', { key: k }));
        out[k] = v;
      } else out[k] = String(v).replace(/\r\n/g, '\n');
    }
    if (out.placeholder_template !== undefined && out.placeholder_template.trim() === '') throw invalid(t('The placeholder template cannot be empty.'));
    if (out.risk_keywords) {
      try { P.compile(out.risk_keywords, 'iu'); } catch (e) { throw invalid(t('The risk keyword regex is invalid.')); }
    }
    if (out.chat_temperature !== undefined) {
      const v = out.chat_temperature.trim().replace(',', '.');
      if (v !== '' && (Number.isNaN(Number(v)) || +v < 0 || +v > 2)) throw invalid(t('Temperature must be between 0 and 2 (empty = model default).'));
      out.chat_temperature = v;
    }
    Object.assign(s.settings, out);
    return Object.keys(out);
  }
  const editableSettings = s => {
    const all = allSettings(s), out = {};
    Object.keys(SEED.editable).forEach(k => { if (k in all) out[k] = all[k]; });
    return out;
  };
  function reseed(s, overwrite) {
    let cats = 0, rules = 0;
    for (const c of SEED.categories) {
      const i = s.categories.findIndex(x => x.code === c.code);
      if (i < 0) { s.categories.push(clone(c)); cats++; } else if (overwrite) { s.categories[i] = clone(c); cats++; }
    }
    for (const r of SEED.rules) {
      const cur = s.rules.find(x => x.bkey === r.bkey);
      if (cur && !overwrite) continue;
      if (cur) Object.assign(cur, clone(r), { id: cur.id, updated_at: now() });
      else s.rules.push({ ...clone(r), id: s.nextId++, updated_at: now() });
      rules++;
    }
    return { categories: cats, rules };
  }
  function exportData(s) {
    return {
      app: 'exposift', version: VERSION, exported_at: new Date().toISOString(), settings: editableSettings(s), categories: sortCats(s.categories),
      rules: sortRules(s.rules).map(r => { const c = { ...r }; delete c.id; delete c.updated_at; return c; }),
      scan: s.scan || { cats: {}, rules: {} }
    };
  }
  function importData(s0, data, replaceCustom) {
    if (!['exposift', 'maskink', 'maskara'].includes(data.app)) throw invalid(t('This file is not an Exposift settings export.'));
    const s = clone(s0); // all or nothing, like the transaction in Repo::import
    (data.categories || []).forEach(c => saveCategory(s, c, false));
    if (data.settings && typeof data.settings === 'object') saveSettings(s, data.settings);
    if (replaceCustom) s.rules = s.rules.filter(r => r.builtin);
    let n = 0;
    for (const r of data.rules || []) {
      const hit = r.bkey ? s.rules.find(x => x.bkey === r.bkey)
        : s.rules.find(x => !x.builtin && x.name === String(r.name ?? '') && x.type === String(r.type ?? '') && x.category === String(r.category ?? ''));
      saveRule(s, { ...r, id: hit ? hit.id : 0 });
      n++;
    }
    if (data.scan && typeof data.scan === 'object') s.scan = { cats: data.scan.cats || {}, rules: {}, labels: data.scan.labels || '' };
    Object.assign(s0, s);
    return { rules: n, categories: (data.categories || []).length };
  }

  // ---------------------------------------------------------------- scan mapping: which scan type a rule's matches become
  const DEFAULT_SCAN = {
    EMAIL: ['email', 1], PHONE: ['phone', 1], TCKN: ['national_id', 1], IBAN: ['iban', 1], CARD: ['card', 1], IP: ['ip', 1], IP6: ['ip', 1],
    PASSWORD: ['secret', 1], SECRET: ['secret', 1], USER: ['account', 1], SID: ['account', 1], PERSON: ['person', 1], HOST: ['host', 1],
    LOCATION: ['address', 1], FQDN: ['host', 0], DOMAIN: ['host', 0], MAC: ['host', 0], NETLABEL: ['custom', 0], CUSTOM: ['custom', 1]
  };
  const DEFAULT_LABELS = [
    'person: full name, name, ad soyad, adi soyadi, isim, applicant, candidate, aday, customer name, musteri adi, contact person, signatory, imza yetkilisi',
    'address: address, mailing address, home address, postal address, street address, adres, ev adresi, posta adresi, test adresi, teslimat adresi',
    'secret: api token, api key, token, secret, client secret, access key, private key, password, parola, sifre, anahtar',
    'national_id: national id, ssn, social security number, tc kimlik, tc kimlik no, tc kimlik numarasi, kimlik no, kimlik numarasi, passport number, pasaport no',
    'tax_id: tax id, tax number, vergi no, vergi numarasi, vergi kimlik numarasi, vkn, ein',
    'iban: iban, bank account, account number, hesap no, hesap numarasi',
    'phone: phone, telephone, mobile, cell, tel, telefon, gsm, cep telefonu',
    'email: email, e-mail, mail, eposta, e-posta',
    'account: username, user name, login, kullanici adi, kullanici',
    'ip: ip address, ip adresi, ip'
  ].join('\n');
  const SCAN_TYPES = ['email', 'phone', 'national_id', 'tax_id', 'iban', 'card', 'ip', 'url', 'internal_url', 'path', 'name', 'secret', 'person', 'account', 'host', 'address', 'custom'];
  function scanConfig(s) {
    const saved = s.scan || { cats: {}, rules: {} };
    const cats = {};
    for (const c of s.categories) {
      const d = DEFAULT_SCAN[c.code] || ['custom', 1];
      const v = (saved.cats || {})[c.code] || {};
      cats[c.code] = { on: v.on === undefined ? !!d[1] : !!v.on, type: SCAN_TYPES.includes(v.type) ? v.type : d[0], default_type: d[0], default_on: !!d[1] };
    }
    const rules = {};
    for (const [id, ty] of Object.entries(saved.rules || {})) if (ty === 'off' || SCAN_TYPES.includes(ty)) rules[id] = ty;
    return { cats, rules, labels: (saved.labels || '').trim() ? saved.labels : DEFAULT_LABELS, default_labels: DEFAULT_LABELS };
  }
  const scanState = s => ({ ...scanConfig(s), types: SCAN_TYPES, counts: s.categories.reduce((a, c) => { a[c.code] = s.rules.filter(r => r.category === c.code).length; return a; }, {}) });

  // ---------------------------------------------------------------- run options (helpers at the top of api.php)
  const knownMap = v => (Array.isArray(v) ? v.slice(0, 2000) : []).filter(k => k && typeof k === 'object').map(k => ({
    token: k.token, category: k.category, original: k.original, variants: Array.isArray(k.variants) ? k.variants : []
  }));
  const hintList = v => (Array.isArray(v) ? v.slice(0, 500) : []).filter(h => h && typeof h.category === 'string' && typeof h.value === 'string' && h.value.length <= 300)
    .map(h => ({ category: h.category, value: h.value }));
  const allowList = v => (Array.isArray(v) ? v.slice(0, 500) : []).filter(x => typeof x === 'string' && x !== '' && x.length <= 300);
  const knownAdd = (known, items) => known.concat(items.map(it => ({ token: it.token, category: it.category, original: it.original, variants: it.variants || [] })));
  const byteLength = str => new TextEncoder().encode(str).length;
  const maxKb = s => Math.max(16, toInt(allSettings(s).max_input_kb));

  const handlers = {
    'scan.get': s => scanState(s),
    'scan.save'(s, i) {
      const cats = {};
      for (const [code, v] of Object.entries(i.cats || {})) {
        if (!s.categories.some(c => c.code === code)) continue;
        cats[code] = { on: !!v.on, type: SCAN_TYPES.includes(v.type) ? v.type : 'custom' };
      }
      const labels = String(i.labels || '').replace(/\r\n/g, '\n').trim();
      s.scan = { cats, rules: scanConfig({ ...s, scan: { cats: {}, rules: i.rules || {} } }).rules, labels: labels === DEFAULT_LABELS ? '' : labels };
      audit(s, 'scan.save', Object.keys(cats).length + ' categories');
      return scanState(s);
    },
    'scan.rule'(s, i) {
      const r = findRule(s, i.id);
      s.scan = s.scan || { cats: {}, rules: {} };
      s.scan.rules = s.scan.rules || {};
      if (i.type === '' || i.type == null) delete s.scan.rules[r.id];
      else if (i.type === 'off' || SCAN_TYPES.includes(i.type)) s.scan.rules[r.id] = i.type;
      else throw invalid(t('Invalid scan type.'));
      return scanState(s);
    },
    meta: s => ({
      categories: sortCats(s.categories).map(c => ({ code: c.code, label: t(c.label), token: c.token, color: c.color, enabled: c.enabled, description: t(c.description || '') })),
      default_mode: allSettings(s).default_mode, admin: true
    }),
    'admin.bootstrap': s => ({
      rules: sortRules(s.rules), categories: sortCats(s.categories), settings: editableSettings(s), invalid: validateAll(s), stats: usageStats(s),
      version: VERSION, php: 'browser', pcre: 'JS port', jit: false
    }),
    'rules.list': s => ({ rules: sortRules(s.rules), invalid: validateAll(s) }),
    'rule.save': (s, i) => { const id = saveRule(s, i.rule || {}); return { id, rule: findRule(s, id) }; },
    'rule.delete'(s, i) {
      const r = findRule(s, i.id);
      if (r.builtin) throw invalid(t('Built-in rules cannot be deleted; you can disable them.'));
      s.rules = s.rules.filter(x => x !== r);
      audit(s, 'rule.delete', `#${r.id} ${r.name}`);
      return null;
    },
    'rule.toggle'(s, i) {
      const r = findRule(s, i.id);
      r.enabled = i.enabled ? 1 : 0; r.updated_at = now();
      audit(s, i.enabled ? 'rule.enable' : 'rule.disable', `#${r.id} ${r.name}`);
      return null;
    },
    'rule.reset'(s, i) {
      const r = findRule(s, i.id);
      const d = SEED.rules.find(x => x.bkey && x.bkey === r.bkey);
      if (!d) throw invalid(t('This rule is not built in; it has no default.'));
      Object.assign(r, clone(d), { id: r.id, updated_at: now() });
      audit(s, 'rule.reset', `#${r.id} ${r.name}`);
      return { rule: r };
    },
    'rule.duplicate'(s, i) {
      const r = findRule(s, i.id);
      const id = saveRule(s, { ...r, id: 0, name: (r.name + ' (kopya)').slice(0, 150), enabled: 0 });
      return { id, rule: findRule(s, id) };
    },
    'rule.test'(s, i) {
      const raw = { ...(i.rule || {}) };
      if (String(raw.name ?? '').trim() === '') raw.name = 'Test rule';
      const rule = sanitizeRule(s, raw);
      rule.enabled = 1;
      rule.id = rule.id || 'test';
      const e = engine(s, [rule]);
      const compiled = e.compile(rule).map(x => ({ regex: x[0].src, groups: x[1] }));
      return { compiled, result: e.run(String(i.sample ?? ''), { mode: String(i.mode ?? 'auto'), propagate: false, debug: true }) };
    },
    'rules.bulk'(s, i) {
      const ids = i.ids || [];
      if (!['enable', 'disable'].includes(i.op)) throw new Fail(t('Invalid bulk operation.'));
      ids.forEach(id => { findRule(s, id).enabled = i.op === 'enable' ? 1 : 0; });
      audit(s, 'rules.bulk', i.op + ' ' + ids.length);
      return { count: ids.length };
    },
    'category.save': (s, i) => { saveCategory(s, i.category || {}, !!i.is_new); return { categories: sortCats(s.categories) }; },
    'category.delete'(s, i) {
      const c = s.categories.find(x => x.code === String(i.code ?? ''));
      if (!c) throw invalid(t('Category not found.'));
      if (c.builtin) throw invalid(t('Built-in categories cannot be deleted.'));
      const n = s.rules.filter(r => r.category === c.code).length;
      if (n) throw invalid(`${n} rule(s) use this category.`);
      s.categories = s.categories.filter(x => x !== c);
      audit(s, 'category.delete', c.code);
      return { categories: sortCats(s.categories) };
    },
    'settings.save'(s, i) {
      const keys = saveSettings(s, i.settings || {});
      audit(s, 'settings.update', keys.join(', '));
      return { settings: editableSettings(s), invalid: validateAll(s) };
    },
    'settings.reset'(s, i) {
      const k = String(i.key ?? '');
      if (!(k in SEED.editable) || !(k in SEED.settings)) throw new Fail(t('This setting cannot be reset.'));
      delete s.settings[k];
      audit(s, 'settings.reset', k);
      return { value: SEED.settings[k] };
    },
    export(s) { audit(s, 'export', 'Configuration exported'); return exportData(s); },
    import: (s, i) => importData(s, i.data || {}, !!i.replace_custom),
    reseed(s, i) {
      const r = reseed(s, !!i.overwrite);
      audit(s, 'reseed', (i.overwrite ? 'Built-ins reset' : 'Missing defaults added') + ' – ' + JSON.stringify(r));
      return r;
    },
    audit: (s, i) => s.audit.slice(-Math.max(1, Math.min(1000, toInt(i.limit ?? 300)))).reverse()
  };

  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (url, opts = {}) {
    const m = typeof url === 'string' && /^api\.php\?action=([^&]+)/.exec(url);
    const action = m ? decodeURIComponent(m[1]) : '';
    if (!m || !Object.prototype.hasOwnProperty.call(handlers, action)) return realFetch(url, opts);
    let input = {};
    try { input = opts.body ? JSON.parse(opts.body) : {}; } catch (e) { input = {}; }
    try {
      const s = load();
      const data = handlers[action](s, input);
      save(s);
      return json({ ok: true, data: data === undefined ? null : data });
    } catch (e) {
      if (e instanceof Fail) return json({ ok: false, error: e.message }, e.status);
      console.error('[exposift mask]', e);
      return json({ ok: false, error: t('Server error:') + ' ' + e.message }, 500);
    }
  };

  // used by Ask AI: the engine with the saved rules, categories and settings
  window.ExMask = {
    engine: () => { const s = load(); return engine(s); },
    state: () => load(),
    hints: (list) => hintList(list),
    scanConfig: () => scanConfig(load()),
    /** normalized field label -> scan type, from the "Field labels" setting */
    labelIndex() {
      const fold = x => String(x).toLowerCase().replace(/[ıİ]/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
      const map = new Map();
      for (const line of scanConfig(load()).labels.split('\n')) {
        const m = /^\s*([a-z_]+)\s*:\s*(.+)$/.exec(line);
        if (!m || !SCAN_TYPES.includes(m[1])) continue;
        for (const l of m[2].split(',')) { const k = fold(l); if (k) map.set(k, m[1]); }
      }
      map.fold = fold;
      return map;
    },
    /** Returns function(text, names) -> [{type, value, start, end, rule, category}] using the saved rules and the scan mapping */
    scanner() {
      const s = load(), cfg = scanConfig(s);
      const eng = new Engine(sortRules(s.rules), sortCats(s.categories), allSettings(s), s.secret);
      const byName = new Map(s.rules.map(r => [r.name, r.id]));
      return (text, names) => {
        const res = eng.run(text, { mode: (eng.set && eng.set.default_mode) || 'auto', known: [], hints: (names || []).filter(n => String(n).length >= 2).map(n => ({ category: 'PERSON', value: String(n) })) });
        const hits = [];
        let pos = 0;
        for (const sg of res.segments) {
          if (sg.t !== undefined) { pos += sg.t.length; continue; }
          const start = pos, end = pos + sg.o.length;
          pos = end;
          const ov = cfg.rules[byName.get(sg.r)];
          const cat = cfg.cats[sg.c];
          if (ov === 'off' || (ov === undefined && (!cat || !cat.on))) continue;
          hits.push({ type: ov || cat.type, value: sg.o, start, end, rule: sg.r, category: sg.c });
        }
        return hits;
      };
    }
  };
})();
