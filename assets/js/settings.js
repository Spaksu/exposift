/* Exposift – settings / administration */
(function (MK) {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = MK.esc;
  const t = MK.t;

  // ================================================================ login / first password
  const authForm = $('#authForm');
  if (authForm) {
    authForm.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(authForm);
      const err = $('#authErr');
      err.classList.add('hidden');
      try {
        if (authForm.dataset.mode === 'setup') {
          if (fd.get('password') !== fd.get('password2')) throw new Error(t('The passwords do not match.'));
          await MK.api('admin.setup', { password: fd.get('password') });
        } else {
          await MK.api('login', { password: fd.get('password') });
        }
        location.reload();
      } catch (ex) {
        err.textContent = ex.message; err.classList.remove('hidden');
      }
    });
    return;
  }

  $('#logoutBtn')?.addEventListener('click', async () => {
    await MK.api('logout').catch(() => {});
    location.reload();
  });

  // ================================================================ shared styles
  const C = {
    card: 'rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900',
    input: 'w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-400/25 dark:border-slate-700 dark:bg-slate-800',
    btn: 'inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
    primary: 'inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50',
    danger: 'inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-slate-800 dark:hover:bg-rose-500/10',
    label: 'block text-xs font-medium text-slate-600 dark:text-slate-300',
    hint: 'mt-1 text-[11px] leading-snug text-slate-400',
    th: 'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-slate-400'
  };
  const TYPE_LABEL = { regex: t('Regex'), keyvalue: t('Key = value'), keyword: t('Dictionary') };
  const MODE_LABEL = { all: t('All'), log: t('Log'), script: t('Script') };
  const VALIDATORS = {
    '': t('None'), luhn: t('Luhn (card)'), tckn: t('TCKN checksum'), iban: t('IBAN mod-97'), phone: t('Phone digit count'),
    entropy: t('Shannon entropy'), dotted: t('first.last (excluding extensions/code)'), person: t('First Last (excluding common words)')
  };

  const M = window.Ex.model;
  const S = { rules: [], categories: [], settings: {}, invalid: [], stats: null, info: {} };
  const catOf = code => S.categories.find(c => c.code === code);
  const catColor = code => catOf(code)?.color || '#64748b';
  // built-in names/descriptions are stored in English and shown in the UI language
  const catLabel = c => c ? (c.builtin ? t(c.label) : c.label) : '';
  const ruleName = r => r.builtin ? t(r.name) : r.name;
  const ruleDesc = r => r.builtin ? t(r.description) : r.description;
  const catChip = code => `<span class="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium" style="background:${catColor(code)}1f;color:${catColor(code)}"><span class="h-1.5 w-1.5 rounded-full" style="background:${catColor(code)}"></span>${esc(catLabel(catOf(code)) || code)}</span>`;
  const toggle = (on, attrs = '') => `<button type="button" role="switch" aria-checked="${on}" ${attrs} class="relative inline-flex h-5 w-9 flex-none items-center rounded-full transition ${on ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-600'}"><span class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${on ? 'translate-x-4' : 'translate-x-0.5'}"></span></button>`;

  // ================================================================ routing
  const VIEWS = [
    ['overview', t('Overview'), viewOverview],
    ['rules', t('Rules'), viewRules],
    ['dictionary', t('Custom dictionary'), viewDictionary],
    ['categories', t('Categories & tokens'), viewCategories],
    ['scan', t('Scan mapping'), viewScan],
    ['lists', t('Lists & exceptions'), viewLists],
    ['general', t('General settings'), viewGeneral],
    ['ai', t('AI connections'), viewAi],
    ['backup', t('Backup / restore'), viewBackup],
    ['security', t('Security'), viewSecurity],
    ['audit', t('Change log'), viewAudit]
  ];
  function current() { const h = location.hash.slice(1); return VIEWS.find(v => v[0] === h) ? h : 'overview'; }
  function renderNav() {
    const cur = current();
    $('#sideNav').innerHTML = VIEWS.map(([k, l]) => {
      const badge = k === 'rules' && S.invalid.length ? `<span class="ml-auto rounded-full bg-rose-100 px-1.5 text-[11px] text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">${S.invalid.length}</span>` : '';
      return `<a href="#${k}" class="flex items-center rounded-md px-3 py-1.5 font-medium ${k === cur ? 'bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'}">${l}${badge}</a>`;
    }).join('');
    const mob = $('#mobileNav');
    mob.innerHTML = VIEWS.map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('');
    mob.onchange = () => { location.hash = mob.value; };
  }
  function route() { renderNav(); const v = VIEWS.find(x => x[0] === current()); v[2]($('#view')); }
  window.addEventListener('hashchange', route);

  async function load() {
    try {
      const d = await MK.api('admin.bootstrap');
      Object.assign(S, { rules: d.rules, categories: d.categories, settings: d.settings, invalid: d.invalid, stats: d.stats });
      S.info = { version: d.version, php: d.php, pcre: d.pcre, jit: d.jit };
      S.scan = await MK.api('scan.get');
      try { const a = await MK.api('ai.settings.read'); S.settings.chat_default_model = a.default_model; S.ai = a; } catch (e) { S.ai = { max_chars: 200000 }; }
      route();
    } catch (e) {
      if (e.status === 401) return location.reload();
      $('#view').innerHTML = `<div class="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">${esc(e.message)}</div>`;
    }
  }
  async function reloadRules() {
    const d = await MK.api('rules.list');
    S.rules = d.rules; S.invalid = d.invalid;
  }
  function header(title, desc, actions = '') {
    return `<div class="mb-4 flex flex-wrap items-end gap-3"><div><h1 class="text-lg font-semibold">${title}</h1>${desc ? `<p class="mt-0.5 max-w-3xl text-sm text-slate-500 dark:text-slate-400">${desc}</p>` : ''}</div><div class="ml-auto flex flex-wrap gap-2">${actions}</div></div>`;
  }

  // ================================================================ OVERVIEW
  function viewOverview(v) {
    const r = S.stats.rules;
    const card = (label, val) => `<div class="${C.card} p-4"><div class="text-xs text-slate-500 dark:text-slate-400">${label}</div><div class="mt-1 text-2xl font-semibold tabular-nums">${val}</div></div>`;
    const byCat = {};
    S.rules.forEach(x => { byCat[x.category] = byCat[x.category] || { on: 0, all: 0 }; byCat[x.category].all++; if (x.enabled) byCat[x.category].on++; });
    v.innerHTML = header(t('Overview'), t('The masking rule set and its status. Document contents are never stored.')) + `
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        ${card(t('Total'), MK.fmt(r.total))}
        ${card(t('Enabled'), MK.fmt(r.enabled))}
        ${card(t('Custom (user)'), MK.fmt(r.custom))}
        ${card(t('Failed to compile'), `<span class="${S.invalid.length ? 'text-rose-600' : ''}">${S.invalid.length}</span>`)}
      </div>
      <div class="mt-2 text-xs text-slate-400">${t('Masking engine')} ${esc(S.info.version)}</div>
      ${S.invalid.length ? `<div class="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-500/10 dark:text-rose-300"><b>${t('Rules that failed to compile')}</b></div>` : ''}
      <div class="${C.card} mt-4 p-4">
        <div class="mb-3 text-sm font-semibold">${t('Rules per category')}</div>
        <div class="flex flex-wrap gap-2">${S.categories.map(c => `<a href="#rules" data-cat="${c.code}" class="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-600">${catChip(c.code)}<span class="tabular-nums text-slate-500">${byCat[c.code]?.on || 0}/${byCat[c.code]?.all || 0}</span></a>`).join('')}</div>
      </div>
      <div class="${C.card} mt-4 p-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        <div class="mb-2 font-semibold text-slate-800 dark:text-slate-100">${t('How does the engine work?')}</div>
        <ol class="list-decimal space-y-1 pl-5 text-[13px]">
          <li>${t('<b>Rules</b> (regex, key=value, dictionary) run on the text; every match becomes a <i>candidate</i>.')}</li>
          <li>${t('Candidates are <b>reclassified</b> (a host= value that is an IP becomes IP, CORP\\john → DOMAIN + USER, PC01$ → HOST) and <b>filtered</b> (keep lists, variable references, validators).')}</li>
          <li>${t('Among overlapping candidates, the choice is made by <b>priority → length → position</b>.')}</li>
          <li>${t('<b>Propagation:</b> user/host/password values that were found are also masked where they appear elsewhere in the text without context.')}</li>
          <li>${t('The same value always becomes the same token; the mapping table stays in the browser and the AI reply can be restored.')}</li>
        </ol>
      </div>`;
    $$('[data-cat]', v).forEach(a => a.addEventListener('click', () => { ruleFilter.cat = a.dataset.cat; }));
    $$('[data-edit]', v).forEach(a => a.addEventListener('click', () => setTimeout(() => openRule(+a.dataset.edit), 50)));
  }

  // ================================================================ RULES
  const ruleFilter = { q: '', cat: '', type: '', status: '' };
  const selected = new Set();
  function viewRules(v) {
    v.innerHTML = header(t('Rules'), t('Each rule defines how one kind of data is recognized. You can edit, disable or reset built-in rules, and add your own. The rule with the higher priority wins on overlaps.'),
      `<button type="button" id="newRule" class="${C.primary}">${t('+ New rule')}</button>`) + `
      <div class="${C.card}">
        <div class="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3 dark:border-slate-800">
          <input id="rq" type="search" placeholder="${esc(t('Search name, description, pattern or key…'))}" class="${C.input} !w-72" value="${esc(ruleFilter.q)}">
          <select id="rc" class="${C.input} !w-auto"><option value="">${t('All categories')}</option>${S.categories.map(c => `<option value="${c.code}" ${ruleFilter.cat === c.code ? 'selected' : ''}>${esc(catLabel(c))}</option>`).join('')}</select>
          <select id="rt" class="${C.input} !w-auto"><option value="">${t('All types')}</option>${Object.entries(TYPE_LABEL).map(([k, l]) => `<option value="${k}" ${ruleFilter.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <select id="rs" class="${C.input} !w-auto">${[['', t('All states')], ['on', t('Enabled')], ['off', t('Disabled')], ['custom', t('Custom')], ['builtin', t('Built-in')], ['invalid', t('Broken')]].map(([k, l]) => `<option value="${k}" ${ruleFilter.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <div class="ml-auto flex items-center gap-2 text-xs">
            <span id="selInfo" class="text-slate-400"></span>
            <button type="button" class="${C.btn}" data-bulk="enable">${t('Enable selected')}</button>
            <button type="button" class="${C.btn}" data-bulk="disable">${t('Disable selected')}</button>
          </div>
        </div>
        <div class="overflow-x-auto"><table class="w-full text-sm">
          <thead><tr class="border-b border-slate-100 dark:border-slate-800"><th class="${C.th} w-8"><input type="checkbox" id="selAll" class="rounded border-slate-300"></th><th class="${C.th} w-12">${t('On')}</th><th class="${C.th}">${t('Rule')}</th><th class="${C.th}">${t('Category')}</th><th class="${C.th}">${t('Type')}</th><th class="${C.th} text-right">${t('Priority')}</th><th class="${C.th}">${t('Mode')}</th><th class="${C.th} text-right">${t('Actions')}</th></tr></thead>
          <tbody id="ruleBody" class="divide-y divide-slate-100 dark:divide-slate-800"></tbody>
        </table></div>
      </div>`;
    const rerender = () => renderRuleRows();
    $('#rq').addEventListener('input', MK.debounce(e => { ruleFilter.q = e.target.value; rerender(); }, 150));
    $('#rc').addEventListener('change', e => { ruleFilter.cat = e.target.value; rerender(); });
    $('#rt').addEventListener('change', e => { ruleFilter.type = e.target.value; rerender(); });
    $('#rs').addEventListener('change', e => { ruleFilter.status = e.target.value; rerender(); });
    $('#newRule').addEventListener('click', () => openRule(0));
    $('#selAll').addEventListener('change', e => { filteredRules().forEach(r => e.target.checked ? selected.add(r.id) : selected.delete(r.id)); rerender(); });
    $$('[data-bulk]', v).forEach(b => b.addEventListener('click', async () => {
      if (!selected.size) return MK.toast(t('Select rules first'), 'warn');
      await MK.api('rules.bulk', { ids: [...selected], op: b.dataset.bulk });
      selected.clear(); await reloadRules(); rerender(); renderNav();
      MK.toast(t('Updated'));
    }));
    rerender();
  }
  function filteredRules() {
    const q = ruleFilter.q.toLocaleLowerCase(MK.locale);
    const bad = new Set(S.invalid.map(i => i.id));
    return S.rules.filter(r => {
      if (ruleFilter.cat && r.category !== ruleFilter.cat && !Object.values(r.groups).includes(ruleFilter.cat)) return false;
      if (ruleFilter.type && r.type !== ruleFilter.type) return false;
      const st = ruleFilter.status;
      if (st === 'on' && !r.enabled) return false;
      if (st === 'off' && r.enabled) return false;
      if (st === 'custom' && r.builtin) return false;
      if (st === 'builtin' && !r.builtin) return false;
      if (st === 'invalid' && !bad.has(r.id)) return false;
      if (q && ![r.name, r.description, ruleName(r), ruleDesc(r), r.pattern, r.keys_text, r.bkey || ''].join(' ').toLocaleLowerCase(MK.locale).includes(q)) return false;
      return true;
    });
  }
  function renderRuleRows() {
    const bad = Object.fromEntries(S.invalid.map(i => [i.id, i.error]));
    const rows = filteredRules();
    $('#ruleBody').innerHTML = rows.map(r => {
      const cats = [...new Set([r.category, ...Object.values(r.groups)])];
      return `<tr class="${r.enabled ? '' : 'opacity-60'} hover:bg-slate-50 dark:hover:bg-slate-800/40">
        <td class="px-3 py-2"><input type="checkbox" data-sel="${r.id}" class="rounded border-slate-300" ${selected.has(r.id) ? 'checked' : ''}></td>
        <td class="px-3 py-2">${toggle(!!r.enabled, `data-toggle="${r.id}"`)}</td>
        <td class="max-w-[520px] px-3 py-2">
          <button type="button" data-edit="${r.id}" class="text-left font-medium hover:text-teal-600">${esc(ruleName(r))}</button>
          <span class="ml-1 rounded px-1.5 py-px text-[10px] ${r.builtin ? 'bg-slate-100 text-slate-500 dark:bg-slate-800' : 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300'}">${r.builtin ? t('built-in') : t('custom')}</span>
          ${bad[r.id] ? `<span class="ml-1 rounded bg-rose-100 px-1.5 py-px text-[10px] text-rose-700" title="${esc(bad[r.id])}">${t('broken')}</span>` : ''}
          <div class="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">${esc(ruleDesc(r))}</div>
        </td>
        <td class="px-3 py-2"><div class="flex flex-wrap gap-1">${cats.map(catChip).join('')}</div></td>
        <td class="whitespace-nowrap px-3 py-2 text-xs text-slate-500">${TYPE_LABEL[r.type]}</td>
        <td class="px-3 py-2 text-right tabular-nums">${r.priority}</td>
        <td class="px-3 py-2 text-xs text-slate-500">${MODE_LABEL[r.modes]}</td>
        <td class="whitespace-nowrap px-3 py-2 text-right">
          <button type="button" class="${C.btn} !px-2" data-edit="${r.id}">${t('Edit')}</button>
          <button type="button" class="${C.btn} !px-2" data-dup="${r.id}" title="${esc(t('Create a copy'))}">${t('Duplicate')}</button>
          ${r.builtin ? '' : `<button type="button" class="${C.danger} !px-2" data-del="${r.id}">${t('Delete')}</button>`}
        </td></tr>`;
    }).join('') || `<tr><td colspan="8" class="p-8 text-center text-sm text-slate-400">${t('No matching rules')}</td></tr>`;
    $('#selInfo').textContent = selected.size ? t('{n} selected', { n: selected.size }) : t('{n} rules', { n: rows.length });
    const body = $('#ruleBody');
    $$('[data-toggle]', body).forEach(b => b.addEventListener('click', async () => {
      const id = +b.dataset.toggle, r = S.rules.find(x => x.id === id);
      try { await MK.api('rule.toggle', { id, enabled: !r.enabled }); r.enabled = r.enabled ? 0 : 1; renderRuleRows(); }
      catch (e) { MK.toast(e.message, 'err'); }
    }));
    $$('[data-sel]', body).forEach(c => c.addEventListener('change', () => { c.checked ? selected.add(+c.dataset.sel) : selected.delete(+c.dataset.sel); $('#selInfo').textContent = t('{n} selected', { n: selected.size }); }));
    $$('[data-edit]', body).forEach(b => b.addEventListener('click', () => openRule(+b.dataset.edit)));
    $$('[data-dup]', body).forEach(b => b.addEventListener('click', async () => {
      try { const d = await MK.api('rule.duplicate', { id: +b.dataset.dup }); await reloadRules(); renderRuleRows(); openRule(d.id); MK.toast(t('Copy created (disabled)')); }
      catch (e) { MK.toast(e.message, 'err'); }
    }));
    $$('[data-del]', body).forEach(b => b.addEventListener('click', async () => {
      const r = S.rules.find(x => x.id === +b.dataset.del);
      if (!confirm(t('Delete the rule "{name}"?', { name: ruleName(r) }))) return;
      try { await MK.api('rule.delete', { id: r.id }); await reloadRules(); renderRuleRows(); renderNav(); MK.toast(t('Deleted')); }
      catch (e) { MK.toast(e.message, 'err'); }
    }));
  }

  // ---------------------------------------------------------------- rule editor
  const dlg = $('#ruleDlg');
  let editing = null;
  $$('[data-close]', dlg).forEach(b => b.addEventListener('click', () => dlg.close()));

  function openRule(id) {
    const r = id ? S.rules.find(x => x.id === id) : null;
    editing = r ? JSON.parse(JSON.stringify(r)) : {
      id: 0, name: '', description: '', category: 'CUSTOM', type: 'regex', pattern: '', flags: '', keys_text: '',
      groups: {}, options: {}, priority: 70, modes: 'all', enabled: 1, builtin: 0
    };
    $('#ruleDlgTitle').textContent = r ? t('Edit rule') : t('New rule');
    $('#ruleDlgBadge').innerHTML = r ? `<span class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800">${r.builtin ? t('built-in') + ' · ' + esc(r.bkey) : t('custom') + ' #' + r.id}</span>` : '';
    $('#ruleResetBtn').classList.toggle('hidden', !(r && r.builtin));
    $('#ruleErr').classList.add('hidden');
    $('#testSample').value = MK.store.get('testSample:' + (r?.bkey || r?.id || 'new'), MK.store.get('testSample', ''));
    renderRuleFields();
    dlg.showModal();
    runTest();
  }

  function renderRuleFields() {
    const r = editing, o = r.options || {};
    const catOpts = sel => S.categories.map(c => `<option value="${c.code}" ${sel === c.code ? 'selected' : ''}>${esc(catLabel(c))} (${c.code})</option>`).join('');
    const chk = (name, label, on, hint = '') => `<label class="flex items-start gap-2 text-sm"><input type="checkbox" data-opt="${name}" class="mt-0.5 rounded border-slate-300 text-teal-600" ${on ? 'checked' : ''}><span>${label}${hint ? `<span class="block text-[11px] text-slate-400">${hint}</span>` : ''}</span></label>`;
    const groupsRows = Object.entries(r.groups || {}).map(([g, c]) => groupRow(g, c)).join('');
    $('#ruleFields').innerHTML = `
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="sm:col-span-2"><label class="${C.label}">${t('Name')}</label><input data-f="name" class="${C.input} mt-1" value="${esc(r.name)}" maxlength="150"></div>
        <div class="sm:col-span-2"><label class="${C.label}">${t('Description')}</label><textarea data-f="description" rows="2" class="${C.input} mt-1">${esc(r.description)}</textarea></div>
        <div><label class="${C.label}">${t('Main category')}</label><select data-f="category" class="${C.input} mt-1">${catOpts(r.category)}</select></div>
        <div><label class="${C.label}">${t('Scan type')}</label><select data-scan class="${C.input} mt-1">
          <option value="">${esc(t('Follow the category'))}</option><option value="off" ${(S.scan.rules[r.id] || '') === 'off' ? 'selected' : ''}>${esc(t('Not used in document scans'))}</option>
          ${S.scan.types.map(k => `<option value="${k}" ${(S.scan.rules[r.id] || '') === k ? 'selected' : ''}>${esc(t(M.TYPES[k][2]))}</option>`).join('')}</select>
          <p class="${C.hint}">${t('What a match of this rule becomes when a document is scanned.')}</p></div>
        <div><label class="${C.label}">${t('Type')}</label><select data-f="type" class="${C.input} mt-1">${Object.entries(TYPE_LABEL).map(([k, l]) => `<option value="${k}" ${r.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label class="${C.label}">${t('Priority')} <span class="font-normal text-slate-400">(0-1000)</span></label><input data-f="priority" type="number" min="0" max="1000" class="${C.input} mt-1" value="${r.priority}"><p class="${C.hint}">${t('The higher priority wins on overlaps. Passwords/keys ~90, contextual ~70-80, generic patterns ~40-60.')}</p></div>
        <div><label class="${C.label}">${t('Runs in mode')}</label><select data-f="modes" class="${C.input} mt-1">${Object.entries(MODE_LABEL).map(([k, l]) => `<option value="${k}" ${r.modes === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <label class="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" data-f="enabled" class="rounded border-slate-300 text-teal-600" ${r.enabled ? 'checked' : ''}> ${t('Enabled')}</label></div>
      </div>

      <div data-type="regex" class="${r.type === 'regex' ? '' : 'hidden'} space-y-3 rounded-lg border border-slate-100 p-3 dark:border-slate-800">
        <div><label class="${C.label}">${t('Regex pattern (PCRE, without delimiters)')}</label>
          <textarea data-f="pattern" rows="5" spellcheck="false" class="${C.input} mk-code mt-1">${esc(r.pattern)}</textarea>
          <p class="${C.hint}">${t('Templates: <code>{{TLD}}</code> (TLD list), <code>{{FIRSTNAME}}</code> (first-name dictionary, lowercase), <code>{{FIRSTNAME_CAP}}</code> (Capitalized/UPPERCASE). Unicode (<code>u</code>) is always on.')}</p></div>
        <div class="flex flex-wrap items-center gap-3 text-sm"><span class="${C.label}">${t('Flags:')}</span>
          ${[['i', t('case-insensitive')], ['m', t('multiline (^ $)')], ['s', t('. also matches line breaks')], ['x', t('extended')], ['U', t('ungreedy')]].map(([f, l]) => `<label class="flex items-center gap-1" title="${l}"><input type="checkbox" data-flag="${f}" class="rounded border-slate-300 text-teal-600" ${r.flags.includes(f) ? 'checked' : ''}><code>${f}</code> <span class="text-xs text-slate-400">${l}</span></label>`).join('')}
        </div>
        <div>
          <div class="flex items-center"><label class="${C.label}">${t('Capture group → category')}</label><button type="button" id="addGroup" class="${C.btn} ml-auto !py-1">${t('+ Group')}</button></div>
          <div id="groupRows" class="mt-2 space-y-1.5">${groupsRows}</div>
          <p class="${C.hint}">${t('If left empty, the whole match (group 0) is masked with the main category. E.g. <code>url_credentials</code>: group 1 → USER, group 2 → PASSWORD.')}</p>
        </div>
      </div>

      <div data-type="keyvalue" class="${r.type === 'keyvalue' ? '' : 'hidden'} space-y-3 rounded-lg border border-slate-100 p-3 dark:border-slate-800">
        <div><label class="${C.label}">${t('Keys (one per line)')}</label>
          <textarea data-f="keys_text" data-kt="keyvalue" rows="7" spellcheck="false" class="${C.input} mk-code mt-1">${esc(r.type === 'keyvalue' ? r.keys_text : '')}</textarea>
          <p class="${C.hint}">${t('Space, _, - and . separators match loosely: <code>user name</code> → username, user_name, User-Name, UserName, "user name". Case-insensitive. Supported forms: <code>key=value</code>, <code>key: value</code>, <code>"key": "value"</code>, <code>$Key = \'value\'</code>, <code>key =&gt; value</code>, <code>[\'key\'] = value</code>.')}</p></div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div><label class="${C.label}">${t('Prefix / suffix')}</label><select data-opt="affix" class="${C.input} mt-1">
            ${[['none', t('None (exact key)')], ['prefix', t('Prefix (db_user, smtp.user)')], ['both', t('Prefix + suffix (db_password_enc)')]].map(([k, l]) => `<option value="${k}" ${(o.affix || 'none') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label class="${C.label}">${t('Separator')}</label><select data-opt="seps" class="${C.input} mt-1">
            ${[['std', t('= : => := ==  (standard)')], ['eq', t('Only =')], ['space', t('Standard + space')]].map(([k, l]) => `<option value="${k}" ${(o.seps || 'std') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>
        <div><label class="${C.label}">${t('Value regex (optional)')}</label><input data-opt="value_regex" spellcheck="false" class="${C.input} mk-code mt-1" value="${esc(o.value_regex || '')}"><p class="${C.hint}">${t('If empty, a quoted value or an unquoted value up to the next separator is taken.')}</p></div>
        ${chk('xml', t('Also scan XML tags'), o.xml, '<code>&lt;password&gt;…&lt;/password&gt;</code>')}
      </div>

      <div data-type="keyword" class="${r.type === 'keyword' ? '' : 'hidden'} space-y-3 rounded-lg border border-slate-100 p-3 dark:border-slate-800">
        <div><label class="${C.label}">${t('Terms (one per line)')}</label>
          <textarea data-f="keys_text" data-kt="keyword" rows="8" spellcheck="false" class="${C.input} mk-code mt-1">${esc(r.type === 'keyword' ? r.keys_text : '')}</textarea>
          <p class="${C.hint}">${t('Write <code>term | CATEGORY</code> to give a term its own category. Lines starting with # are comments.')}</p></div>
        ${chk('case_sensitive', t('Case-sensitive'), o.case_sensitive)}
      </div>

      <details class="rounded-lg border border-slate-100 p-3 dark:border-slate-800" open>
        <summary class="cursor-pointer text-sm font-semibold">${t('Filtering and validation')}</summary>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          <div><label class="${C.label}">${t('Minimum length')}</label><input data-opt="min_len" type="number" min="0" class="${C.input} mt-1" value="${o.min_len || ''}"></div>
          <div><label class="${C.label}">${t('Maximum length')}</label><input data-opt="max_len" type="number" min="0" class="${C.input} mt-1" value="${o.max_len || ''}"></div>
          <div><label class="${C.label}">${t('Validator')}</label><select data-opt="validate" class="${C.input} mt-1">${Object.entries(VALIDATORS).map(([k, l]) => `<option value="${k}" ${(o.validate || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label class="${C.label}">${t('Min. entropy')}</label><input data-opt="entropy_min" type="number" step="0.1" min="1" max="8" class="${C.input} mt-1" value="${o.entropy_min ?? 4}"><p class="${C.hint}">${t('Used only by the entropy validator.')}</p></div>
          <div class="sm:col-span-2"><label class="${C.label}">${t('Exclude regex (applied to the value)')}</label><input data-opt="skip_regex" spellcheck="false" class="${C.input} mk-code mt-1" value="${esc(o.skip_regex || '')}"><p class="${C.hint}">${t('Matching values are not masked. E.g. <code>^/</code> to skip path values.')}</p></div>
        </div>
        <div class="mt-3 grid gap-2 sm:grid-cols-2">
          ${chk('skip_vars', t('Skip variable references'), o.skip_vars !== false, '$var, ${VAR}, %VAR%, {{x}}, &lt;placeholder&gt;, ****')}
          ${chk('skip_numeric', t('Skip numbers only'), o.skip_numeric, t('such as uid=1000'))}
          ${chk('reclassify', t('Reclassify by value'), o.reclassify, 'IP → IP, a.b.com → FQDN, PC01$ → HOST, S-1-5-21… → SID')}
          ${chk('split_domain', t('Split DOMAIN\\user values'), o.split_domain, 'CORP\\john → DOMAIN + USER')}
          ${chk('propagate', t('Take part in propagation'), o.propagate !== false, t('The value found is also masked elsewhere in the text'))}
        </div>
      </details>`;

    const f = $('#ruleFields');
    f.addEventListener('input', onFieldChange);
    f.addEventListener('change', onFieldChange);
    $('#addGroup').addEventListener('click', () => {
      const used = $$('[data-g]', f).map(x => +x.value);
      const next = used.length ? Math.max(...used) + 1 : 1;
      $('#groupRows').insertAdjacentHTML('beforeend', groupRow(next, editing.category));
      onFieldChange();
    });
    $('#groupRows').addEventListener('click', e => { if (e.target.closest('[data-rmg]')) { e.target.closest('.grow-row').remove(); onFieldChange(); } });
  }
  function groupRow(g, c) {
    return `<div class="grow-row flex items-center gap-2"><span class="text-xs text-slate-400">${t('Group')}</span><input data-g type="number" min="0" max="99" value="${g}" class="${C.input} !w-20"><span class="text-xs text-slate-400">→</span><select data-gc class="${C.input}">${S.categories.map(x => `<option value="${x.code}" ${x.code === c ? 'selected' : ''}>${esc(catLabel(x))} (${x.code})</option>`).join('')}</select><button type="button" data-rmg class="rounded p-1 text-slate-400 hover:text-rose-600">✕</button></div>`;
  }
  function collectRule() {
    const f = $('#ruleFields'), r = editing;
    r.name = $('[data-f="name"]', f).value;
    r.description = $('[data-f="description"]', f).value;
    r.category = $('[data-f="category"]', f).value;
    r.type = $('[data-f="type"]', f).value;
    r.priority = +$('[data-f="priority"]', f).value || 0;
    r.modes = $('[data-f="modes"]', f).value;
    r.enabled = $('[data-f="enabled"]', f).checked ? 1 : 0;
    r.pattern = $('[data-f="pattern"]', f).value;
    r.flags = $$('[data-flag]', f).filter(x => x.checked).map(x => x.dataset.flag).join('');
    const kt = $(`[data-kt="${r.type}"]`, f);
    r.keys_text = kt ? kt.value : '';
    r.groups = {};
    $$('.grow-row', f).forEach(row => { r.groups[$('[data-g]', row).value] = $('[data-gc]', row).value; });
    const o = {};
    $$('[data-opt]', f).forEach(x => { o[x.dataset.opt] = x.type === 'checkbox' ? x.checked : x.value; });
    r.options = o;
    return r;
  }
  function onFieldChange(e) {
    const r = collectRule();
    $$('[data-type]', $('#ruleFields')).forEach(b => b.classList.toggle('hidden', b.dataset.type !== r.type));
    if (!e || e.target.dataset.f !== 'name') debTest();
  }

  const debTest = MK.debounce(runTest, 450);
  $('#testSample').addEventListener('input', () => {
    MK.store.set('testSample:' + (editing?.bkey || editing?.id || 'new'), $('#testSample').value);
    MK.store.set('testSample', $('#testSample').value);
    debTest();
  });
  $('#testMode').addEventListener('change', runTest);

  async function runTest() {
    if (!editing) return;
    const sample = $('#testSample').value;
    const out = $('#testOut'), st = $('#testStatus');
    const r = collectRule();
    if (!sample.trim()) { out.innerHTML = `<p class="text-slate-400">${t('Enter sample text to see the matches, the rejected candidates and the reasons here.')}</p>`; st.textContent = ''; return; }
    st.textContent = t('testing…');
    try {
      const d = await MK.api('rule.test', { rule: r, sample, mode: $('#testMode').value });
      const res = d.result;
      st.textContent = t('{m} matches · {r} rejected · {ms} ms · mode: {mode}', { m: res.stats.matches, r: res.rejects?.length || 0, ms: res.stats.ms, mode: res.stats.mode });
      const hl = res.segments.map(s => s.t !== undefined ? esc(s.t)
        : `<span class="mk-tok" style="color:${catColor(s.c)};background:${catColor(s.c)}1f" title="${esc(s.m)} · ${esc(s.c)}">${esc(s.o)}</span>`).join('');
      const rej = (res.rejects || []).map(x => `<tr><td class="px-2 py-1 font-mono">${esc(x.value)}</td><td class="px-2 py-1">${catChip(x.category)}</td><td class="px-2 py-1 text-slate-500">${esc(x.reason)}</td></tr>`).join('');
      out.innerHTML = `
        ${res.errors.length ? `<div class="rounded-md bg-rose-50 p-2 text-rose-700">${res.errors.map(e => esc(e.error)).join('<br>')}</div>` : ''}
        <div><div class="mb-1 font-medium text-slate-600 dark:text-slate-300">${t('Highlighted sample')}</div><pre class="mk-pre mk-code max-h-72 overflow-auto rounded-lg border border-slate-100 p-2 dark:border-slate-800">${hl}</pre></div>
        <div><div class="mb-1 font-medium text-slate-600 dark:text-slate-300">${t('Masked')}</div><pre class="mk-pre mk-code max-h-48 overflow-auto rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">${esc(res.masked)}</pre></div>
        ${rej ? `<div><div class="mb-1 font-medium text-slate-600 dark:text-slate-300">${t('Rejected candidates (why was it not masked?)')}</div><table class="w-full"><tbody class="divide-y divide-slate-100 dark:divide-slate-800">${rej}</tbody></table></div>` : ''}
        <details><summary class="cursor-pointer font-medium text-slate-600 dark:text-slate-300">${t('Compiled regex ({n})', { n: d.compiled.length })}</summary>
          ${d.compiled.map(c => `<pre class="mk-pre mk-code mt-1 max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[11px] dark:bg-slate-800/60">${esc(c.regex)}</pre><div class="text-[11px] text-slate-400">${t('groups:')} ${esc(JSON.stringify(c.groups))}</div>`).join('')}
        </details>`;
      $('#ruleErr').classList.add('hidden');
    } catch (e) {
      st.textContent = '';
      out.innerHTML = `<div class="rounded-md bg-rose-50 p-2 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">${esc(e.message)}</div>`;
    }
  }

  $('#ruleSaveBtn').addEventListener('click', async () => {
    const r = collectRule();
    try {
      const d = await MK.api('rule.save', { rule: r });
      const sv = $('[data-scan]'); if (sv) S.scan = await MK.api('scan.rule', { id: d.id, type: sv.value });
      await reloadRules();
      dlg.close();
      MK.toast(t('Rule saved'));
      renderNav();
      if (current() === 'rules') renderRuleRows(); else route();
      editing = d.rule;
    } catch (e) {
      const el = $('#ruleErr'); el.textContent = e.message; el.classList.remove('hidden');
    }
  });
  $('#ruleResetBtn').addEventListener('click', async () => {
    if (!editing?.id || !confirm(t('Reset this rule to its built-in default? Your changes will be lost.'))) return;
    try {
      const d = await MK.api('rule.reset', { id: editing.id });
      await reloadRules();
      editing = d.rule; renderRuleFields(); runTest();
      if (current() === 'rules') renderRuleRows();
      MK.toast(t('Reset to default'));
    } catch (e) { MK.toast(e.message, 'err'); }
  });

  // ================================================================ CUSTOM DICTIONARY
  function viewDictionary(v) {
    const rule = S.rules.find(r => r.bkey === 'custom_terms') || S.rules.find(r => r.type === 'keyword');
    const kwRules = S.rules.filter(r => r.type === 'keyword');
    v.innerHTML = header(t('Custom dictionary'), t('Add terms that cannot be recognized by a pattern, such as your organization\'s server names, project code names or customer names. They are matched as whole words, case-insensitively.')) + `
      <div class="${C.card} p-4">
        ${rule ? `
        <div class="mb-2 flex items-center gap-2"><b class="text-sm">${esc(ruleName(rule))}</b> ${catChip(rule.category)} <span class="ml-auto text-xs text-slate-400">${toggle(!!rule.enabled, 'id="dictToggle"')}</span></div>
        <textarea id="dictText" rows="18" spellcheck="false" class="${C.input} mk-code">${esc(rule.keys_text)}</textarea>
        <p class="${C.hint}">${t('Line format: <code>term</code> or <code>term | CATEGORY</code> (e.g. <code>ACME-DC01 | HOST</code>, <code>Project Falcon | CUSTOM</code>, <code>special.person | USER</code>). Categories:')} ${S.categories.map(c => `<code>${c.code}</code>`).join(' ')}</p>
        <div class="mt-3 flex gap-2"><button type="button" id="dictSave" class="${C.primary}">${t('Save')}</button><button type="button" id="dictAdv" class="${C.btn}">${t('Advanced editor')}</button></div>` : `<p class="text-sm text-slate-500">${t('No dictionary rule found. Run "Add missing defaults" in the Backup section.')}</p>`}
      </div>
      ${kwRules.length > 1 ? `<p class="mt-3 text-xs text-slate-500">${t('Other dictionary rules:')} ${kwRules.filter(r => r !== rule).map(r => `<a href="#rules" class="underline" data-edit="${r.id}">${esc(ruleName(r))}</a>`).join(', ')}</p>` : ''}`;
    if (!rule) return;
    $('#dictSave').addEventListener('click', async () => {
      try { await MK.api('rule.save', { rule: { ...rule, keys_text: $('#dictText').value } }); await reloadRules(); MK.toast(t('Dictionary saved')); }
      catch (e) { MK.toast(e.message, 'err'); }
    });
    $('#dictToggle').addEventListener('click', async () => {
      await MK.api('rule.toggle', { id: rule.id, enabled: !rule.enabled }); await reloadRules(); viewDictionary(v);
    });
    $('#dictAdv').addEventListener('click', () => openRule(rule.id));
    $$('[data-edit]', v).forEach(a => a.addEventListener('click', () => setTimeout(() => openRule(+a.dataset.edit), 50)));
  }

  // ================================================================ CATEGORIES
  function viewCategories(v) {
    const tpl = S.settings.placeholder_template;
    v.innerHTML = header(t('Categories & tokens'), t('Token prefix, color, propagation and placeholder template for each category. If the template is empty, the general template (<code>{tpl}</code>) is used. Variables: <code>{CAT}</code> prefix, <code>{cat}</code> lowercase prefix, <code>{n}</code> sequence number, <code>{hash}</code> stable 8-digit digest, <code>{len}</code> length, <code>{stars}</code> asterisks.', { tpl: esc(tpl) }),
      `<button type="button" id="newCat" class="${C.primary}">${t('+ New category')}</button>`) + `
      <div class="${C.card} overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="border-b border-slate-100 dark:border-slate-800"><th class="${C.th}">${t('Code')}</th><th class="${C.th}">${t('Label')}</th><th class="${C.th}">${t('Token prefix')}</th><th class="${C.th}">${t('Color')}</th><th class="${C.th}">${t('Placeholder template')}</th><th class="${C.th}">${t('Example')}</th><th class="${C.th}" title="${esc(t('The value found is also masked elsewhere in the text'))}">${t('Propagation')}</th><th class="${C.th}" title="${esc(t('Spellings that differ in case get separate tokens'))}">${t('Case-sensitive')}</th><th class="${C.th}">${t('Enabled')}</th><th class="${C.th}">${t('Order')}</th><th class="${C.th}"></th></tr></thead>
        <tbody id="catBody" class="divide-y divide-slate-100 dark:divide-slate-800">${S.categories.map(catRow).join('')}</tbody>
      </table></div>`;
    $('#newCat').addEventListener('click', () => {
      $('#catBody').insertAdjacentHTML('afterbegin', catRow({ code: '', label: '', token: '', color: '#64748b', placeholder: '', propagate: 0, case_sensitive: 0, enabled: 1, sort: 500, builtin: 0, _new: 1 }));
      bindCatRows();
    });
    bindCatRows();
  }
  function catRow(c) {
    const ex = (c.placeholder || S.settings.placeholder_template).replace('{CAT}', c.token || 'X').replace('{cat}', (c.token || 'x').toLowerCase()).replace('{n}', '1').replace('{hash}', '3fa9c01e').replace('{len}', '8').replace('{stars}', '********');
    return `<tr data-row="${esc(c.code)}" ${c._new ? 'data-new="1"' : ''} class="align-middle">
      <td class="px-3 py-1.5">${c._new ? `<input data-c="code" class="${C.input} !w-28 font-mono uppercase" placeholder="${esc(t('CODE'))}">` : `<code class="text-xs">${esc(c.code)}</code>${c.builtin ? '' : ` <span class="text-[10px] text-teal-600">${t('custom')}</span>`}`}</td>
      <td class="px-3 py-1.5"><input data-c="label" class="${C.input} !w-44" value="${esc(c.label)}" ${c.builtin && MK.lang !== 'en' ? `title="${esc(t(c.label))}"` : ''}></td>
      <td class="px-3 py-1.5"><input data-c="token" class="${C.input} !w-24 font-mono" value="${esc(c.token)}"></td>
      <td class="px-3 py-1.5"><input data-c="color" type="color" class="h-8 w-10 cursor-pointer rounded border border-slate-200 bg-transparent dark:border-slate-700" value="${esc(c.color)}"></td>
      <td class="px-3 py-1.5"><input data-c="placeholder" class="${C.input} !w-40 font-mono" value="${esc(c.placeholder || '')}" placeholder="${esc(t('general template'))}"></td>
      <td class="px-3 py-1.5"><span class="mk-tok mk-code text-xs" style="color:${c.color};background:${c.color}1f">${esc(ex)}</span></td>
      <td class="px-3 py-1.5 text-center"><input data-c="propagate" type="checkbox" class="rounded border-slate-300 text-teal-600" ${c.propagate ? 'checked' : ''}></td>
      <td class="px-3 py-1.5 text-center"><input data-c="case_sensitive" type="checkbox" class="rounded border-slate-300 text-teal-600" ${c.case_sensitive ? 'checked' : ''}></td>
      <td class="px-3 py-1.5 text-center"><input data-c="enabled" type="checkbox" class="rounded border-slate-300 text-teal-600" ${c.enabled ? 'checked' : ''}></td>
      <td class="px-3 py-1.5"><input data-c="sort" type="number" class="${C.input} !w-20" value="${c.sort}"></td>
      <td class="whitespace-nowrap px-3 py-1.5 text-right"><button type="button" data-save class="${C.btn} !px-2">${t('Save')}</button>${c.builtin || c._new ? '' : ` <button type="button" data-cdel class="${C.danger} !px-2">${t('Delete')}</button>`}</td>
    </tr>`;
  }
  function bindCatRows() {
    $$('#catBody tr').forEach(tr => {
      if (tr.dataset.bound) return; tr.dataset.bound = 1;
      $('[data-save]', tr).addEventListener('click', async () => {
        const data = { code: tr.dataset.new ? $('[data-c="code"]', tr).value : tr.dataset.row };
        $$('[data-c]', tr).forEach(x => { if (x.dataset.c !== 'code') data[x.dataset.c] = x.type === 'checkbox' ? x.checked : x.value; });
        try { const d = await MK.api('category.save', { category: data, is_new: !!tr.dataset.new }); S.categories = d.categories; viewCategories($('#view')); MK.toast(t('Category saved')); }
        catch (e) { MK.toast(e.message, 'err'); }
      });
      $('[data-cdel]', tr)?.addEventListener('click', async () => {
        if (!confirm(t('Delete the {code} category?', { code: tr.dataset.row }))) return;
        try { const d = await MK.api('category.delete', { code: tr.dataset.row }); S.categories = d.categories; viewCategories($('#view')); MK.toast(t('Deleted')); }
        catch (e) { MK.toast(e.message, 'err'); }
      });
    });
  }


  // ================================================================ SCAN MAPPING
  const CLS_NAME = { hidden: 'Hidden Exposure', personal: 'Personal Data', credential: 'Credential Exposure', oversharing: 'Contextual Oversharing', recoverable: 'Recoverable Redaction', unverified: 'Unverified Content' };
  const SEV_NAME = { high: 'High', medium: 'Medium', low: 'Low' };
  function viewScan(v) {
    const cfg = S.scan;
    const typeOpts = sel => cfg.types.map(k => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(t(M.TYPES[k][2]))}</option>`).join('');
    const effect = k => { const ty = M.TYPES[k]; return `${esc(t(CLS_NAME[ty[0]]))} · ${esc(t(SEV_NAME[ty[1]]))}`; };
    const rows = S.categories.map(c => {
      const m = cfg.cats[c.code] || { on: false, type: 'custom' };
      return `<tr data-scan-cat="${c.code}" class="border-b border-slate-100 dark:border-slate-800">
        <td class="px-3 py-2">${catChip(c.code)}</td>
        <td class="px-3 py-2 text-xs text-slate-500">${cfg.counts[c.code] || 0}</td>
        <td class="px-3 py-2">${toggle(!!m.on, 'data-scan-on')}</td>
        <td class="px-3 py-2"><select data-scan-type class="${C.input} !w-56">${typeOpts(m.type)}</select></td>
        <td class="px-3 py-2 text-xs text-slate-500" data-scan-effect>${effect(m.type)}</td></tr>`;
    }).join('');
    const ov = Object.entries(cfg.rules).map(([id, ty]) => {
      const r = S.rules.find(x => String(x.id) === String(id));
      return r ? `<tr class="border-b border-slate-100 dark:border-slate-800"><td class="px-3 py-1.5 text-sm">${esc(ruleName(r))}</td><td class="px-3 py-1.5">${catChip(r.category)}</td>
        <td class="px-3 py-1.5 text-xs">${ty === 'off' ? esc(t('Not used in document scans')) : esc(t(M.TYPES[ty][2]))}</td>
        <td class="px-3 py-1.5 text-right"><button type="button" data-scan-clear="${id}" class="${C.btn} !py-0.5">${t('Follow the category')}</button></td></tr>` : '';
    }).join('');
    v.innerHTML = header(t('Scan mapping'), t('Masking rules find values. This table decides what each match becomes when a document is scanned: the category (or a single rule) is matched to a scan type, and the scan type sets the exposure class, the severity and how it is weighed against the purpose and recipient you choose.'),
      `<button type="button" id="scanReset" class="${C.btn}">${t('Reset to defaults')}</button><button type="button" id="scanSave" class="${C.primary}">${t('Save')}</button>`) + `
      <div class="${C.card} mb-4 overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-slate-100 dark:border-slate-800">
        <th class="${C.th}">${t('Category')}</th><th class="${C.th}">${t('Rules')}</th><th class="${C.th}">${t('Use in document scans')}</th><th class="${C.th}">${t('Scan type')}</th><th class="${C.th}">${t('Becomes')}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="${C.card} mb-4 p-4 text-xs leading-relaxed text-slate-600 dark:text-slate-400"><b class="text-sm text-slate-800 dark:text-slate-200">${t('How a match is decided')}</b><br>
        1. ${t('Exposift’s own checks (email, phone, ID numbers with checksums, IBAN, cards, IP, paths, secrets) run first and win when both find the same text.')}<br>
        2. ${t('The masking rules then add what the checks cannot see: passwords, names, hosts, accounts and your own rules.')}<br>
        3. ${t('A rule with its own scan type uses that type; otherwise its category decides. Categories switched off, and rules set to "Not used", are skipped.')}<br>
        4. ${t('Matches are weighed against the purpose and recipient: the same value may be fine for a colleague and a problem for the public.')}</div>
      <div class="${C.card} mb-4 p-4"><div class="flex items-center gap-2"><b class="text-sm">${t('Field labels')}</b></div>
        <p class="${C.hint} !mt-0.5">${t('Documents often put a label next to a value ("Full name", "Mailing address", "API token"). One line per scan type: the type, a colon, then the labels separated by commas. The value after the label, or in the next table cell, becomes that scan type.')}</p>
        <textarea id="scanLabels" rows="10" spellcheck="false" class="${C.input} mk-code mt-2">${esc(cfg.labels)}</textarea>
        <button type="button" id="labelsDefault" class="${C.btn} mt-2">${t('Restore the default labels')}</button></div>
      <div class="${C.card} mb-4 overflow-x-auto"><div class="border-b border-slate-100 px-3 py-2 text-sm font-semibold dark:border-slate-800">${t('Rules with their own scan type')}</div>
        ${ov ? `<table class="w-full">${ov}</table>` : `<div class="p-4 text-xs text-slate-500">${t('None. Open a rule and choose a scan type to override its category.')}</div>`}</div>
      <div class="${C.card} p-4"><div class="mb-2 text-sm font-semibold">${t('Try it')}</div>
        <textarea id="scanSample" rows="4" spellcheck="false" class="${C.input} mk-code" placeholder="${esc(t('Paste a few lines from a document to see what would be found.'))}"></textarea>
        <div id="scanOut" class="mt-3 text-xs"></div></div>`;
    const collect = () => {
      const cats = {};
      $$('[data-scan-cat]', v).forEach(tr => { cats[tr.dataset.scanCat] = { on: $('[data-scan-on]', tr).getAttribute('aria-checked') === 'true', type: $('[data-scan-type]', tr).value }; });
      return cats;
    };
    $$('[data-scan-type]', v).forEach(sel => sel.addEventListener('change', () => { $('[data-scan-effect]', sel.closest('tr')).innerHTML = effect(sel.value); }));
    $$('[data-scan-on]', v).forEach(b => b.addEventListener('click', () => {
      const on = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', on); b.className = b.className.replace(/bg-teal-600|bg-slate-300 dark:bg-slate-600/, on ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-600');
      const dot = b.firstElementChild; if (dot) dot.className = dot.className.replace(/translate-x-\S+/, on ? 'translate-x-4' : 'translate-x-0.5');
    }));
    $('#scanSave').addEventListener('click', async () => {
      try { S.scan = await MK.api('scan.save', { cats: collect(), rules: S.scan.rules, labels: $('#scanLabels').value }); MK.toast(t('Scan mapping saved')); viewScan(v); } catch (e) { MK.toast(e.message, 'err'); }
    });
    $('#scanReset').addEventListener('click', async () => {
      if (!confirm(t('Reset the scan mapping to its defaults? Rule-level choices are removed too.'))) return;
      try { S.scan = await MK.api('scan.save', { cats: Object.fromEntries(Object.entries(S.scan.cats).map(([k, m]) => [k, { on: m.default_on, type: m.default_type }])), rules: {} }); MK.toast(t('Reset to default')); viewScan(v); } catch (e) { MK.toast(e.message, 'err'); }
    });
    $('#labelsDefault').addEventListener('click', () => { $('#scanLabels').value = cfg.default_labels; });
    $$('[data-scan-clear]', v).forEach(b => b.addEventListener('click', async () => { S.scan = await MK.api('scan.rule', { id: +b.dataset.scanClear, type: '' }); viewScan(v); }));
    $('#scanSample').addEventListener('input', MK.debounce(() => {
      const txt = $('#scanSample').value, out = $('#scanOut');
      if (!txt.trim()) { out.innerHTML = ''; return; }
      Ex.scanBegin();
      const hits = Ex.detectAll(txt, {});
      out.innerHTML = hits.length ? `<table class="w-full">${hits.map(h => { const ty = M.TYPES[h.type]; return `<tr class="border-b border-slate-100 dark:border-slate-800"><td class="py-1 pr-3 font-mono">${esc(h.value)}</td><td class="pr-3">${esc(t(ty[2]))}</td><td class="pr-3 text-slate-500">${esc(t(CLS_NAME[ty[0]]))} · ${esc(t(SEV_NAME[ty[1]]))}</td><td class="text-slate-400">${esc(h.rule || t('built-in check'))}</td></tr>`; }).join('')}</table>` : `<span class="text-slate-500">${esc(t('Nothing found.'))}</span>`;
    }, 250));
  }

  // ================================================================ LISTS
  const LISTS = [
    ['keep_values', t('Values that are never masked'), t('Applies to all categories; case-insensitive. E.g. root, localhost, n/a, true. Separate with lines or commas; # starts a comment.')],
    ['keep_cidrs', t('IPv4 ranges that are not masked'), t('A single IP or a CIDR. E.g. add 10.0.0.0/8 to leave the internal network visible.')],
    ['keep_domains', t('Domains that are not masked'), t('These domains and all their subdomains (FQDNs and e-mail domains) stay visible: microsoft.com, gmail.com …')],
    ['tlds', t('TLD list (FQDN recognition)'), t('The FQDN rule only treats names ending in these extensions as domain names. Be sure to add the extensions of your internal domains (corp, local, lan …). Do not add file extensions (py, sh, json).')],
    ['first_names', t('First-name dictionary (first.last and First Last recognition)'), t('List of first names for the john.smith and "John Smith" patterns. ASCII equivalents of spellings with Turkish characters (şükrü → sukru) are generated automatically.')],
    ['dotted_deny', t('Parts excluded from the first.last pattern'), t('File extensions and systemd units: sshd.service, app.log and config.json are not mistaken for users.')],
    ['code_deny', t('Code tokens'), t('Prevents code expressions such as os.path, self.name and logger.info from being taken for first.last or an FQDN.')],
    ['fqdn_deny_first', t('FQDN first-label exceptions'), t('Names starting with this first label (System.Net, ASP.NET) are not treated as FQDNs.')],
    ['person_stopwords', t('First Last stop words'), t('Filters out phrases that start with a name but are not people, such as "Can Not" or "Deniz Error".')]
  ];
  function viewLists(v) {
    v.innerHTML = header(t('Lists & exceptions'), t('Lists that control how the engine recognizes and excludes values. Changes apply to all rules as soon as they are saved.'),
      `<button type="button" id="listsSave" class="${C.primary}">${t('Save all')}</button>`) +
      `<div class="grid gap-4 xl:grid-cols-2">${LISTS.map(([k, title, d]) => {
        const n = (S.settings[k] || '').split(/\n/).filter(l => l.trim() && !l.trim().startsWith('#')).join(',').split(',').filter(x => x.trim()).length;
        return `<div class="${C.card} p-4"><div class="flex items-center gap-2"><b class="text-sm">${title}</b><span class="rounded-full bg-slate-100 px-2 text-[11px] text-slate-500 dark:bg-slate-800">${t('{n} items', { n })}</span><button type="button" data-reset="${k}" class="ml-auto text-[11px] text-slate-400 hover:text-teal-600">${t('reset to default')}</button></div>
          <p class="${C.hint} !mt-0.5">${d}</p><textarea data-set="${k}" rows="${k === 'first_names' ? 10 : 7}" spellcheck="false" class="${C.input} mk-code mt-2">${esc(S.settings[k] || '')}</textarea></div>`;
      }).join('')}</div>`;
    $('#listsSave').addEventListener('click', () => saveSettings($$('[data-set]', v)));
    bindReset(v);
  }
  function bindReset(v) {
    $$('[data-reset]', v).forEach(b => b.addEventListener('click', async () => {
      if (!confirm(t('Reset this setting to its default value?'))) return;
      try { const d = await MK.api('settings.reset', { key: b.dataset.reset }); S.settings[b.dataset.reset] = d.value; route(); MK.toast(t('Reset to default')); }
      catch (e) { MK.toast(e.message, 'err'); }
    }));
  }
  async function saveSettings(els) {
    const data = {};
    els.forEach(x => { data[x.dataset.set] = x.type === 'checkbox' ? x.checked : x.value; });
    try {
      const d = await MK.api('settings.save', { settings: data });
      S.settings = d.settings; S.invalid = d.invalid; renderNav();
      MK.toast(t('Settings saved'));
    } catch (e) { MK.toast(e.message, 'err'); }
  }

  // ================================================================ GENERAL SETTINGS
  function viewGeneral(v) {
    const s = S.settings;
    const row = (title, desc, control) => `<div class="grid gap-2 border-b border-slate-100 py-4 last:border-0 dark:border-slate-800 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"><div><div class="text-sm font-medium">${title}</div><div class="${C.hint}">${desc}</div></div><div>${control}</div></div>`;
    const sw = (k) => `<label class="inline-flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" data-set="${k}" class="h-4 w-4 rounded border-slate-300 text-teal-600" ${s[k] === '1' ? 'checked' : ''}> ${t('On')}</label>`;
    v.innerHTML = header(t('General settings'), t('Token format, propagation and runtime behavior.'), `<button type="button" id="genSave" class="${C.primary}">${t('Save')}</button>`) + `
      <div class="${C.card} px-5">
        ${row(t('General placeholder template'), t('Default token format for all categories. {CAT}, {cat}, {n}, {hash}, {len} and {stars} can be used. Without {n} or {hash}, restoring is not possible.'),
          `<input data-set="placeholder_template" class="${C.input} mk-code" value="${esc(s.placeholder_template)}"><div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">${['<{CAT}_{n}>', '[{CAT}_{n}]', '{{{CAT}_{n}}}', '<{CAT}:{hash}>', '{CAT}_{n}', '[MASKED_{CAT}]'].map(x => `<button type="button" data-tpl="${esc(x)}" class="rounded border border-slate-200 px-1.5 py-0.5 font-mono hover:border-teal-400 dark:border-slate-700">${esc(x)}</button>`).join('')}</div><div id="tplPrev" class="mt-2 text-xs text-slate-500"></div>`)}
        ${row(t('Propagation'), t('A value found through context (e.g. user=john) is also masked where it appears elsewhere in the text without context (e.g. "john logged in"). Set per category on the Categories screen.'), sw('propagate'))}
        ${row(t('Minimum length for propagation'), t('Prevents short values (e.g. "it", "db") from being masked everywhere.'), `<input data-set="propagate_min_len" type="number" min="1" class="${C.input} !w-28" value="${esc(s.propagate_min_len)}">`)}
        ${row(t('Default mode'), t('Automatic mode guesses from the line structure whether the text is a log or a script. Some rules run in only one mode. Used for Ask AI and for document scans.'),
          `<select data-set="default_mode" class="${C.input} !w-48">${[['auto', t('Automatic')], ['log', t('Log')], ['script', t('Script')]].map(([k, l]) => `<option value="${k}" ${s.default_mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${row(t('Keep subnet masks'), t('Mask/wildcard values such as 255.255.255.0 and 0.0.0.255 are not treated as IPs; they stay visible for network analysis.'), sw('keep_netmasks'))}
        ${row(t('Remaining-risk keywords (regex)'), t('Ask AI warns you if this expression appears on lines where nothing was masked. If left empty, no warning is given.'), `<textarea data-set="risk_keywords" rows="3" spellcheck="false" class="${C.input} mk-code">${esc(s.risk_keywords)}</textarea>`)}
      </div>
      <h3 class="mb-2 mt-6 text-sm font-semibold">${t('Ask AI')}</h3>
      <div class="${C.card} px-5">
        ${row(t('Default model'), t('The model selected when you open Ask AI. Addresses, API keys and models are managed in the <a href="#ai" class="text-teal-600 underline">AI connections</a> section.'),
          `<select id="chatModelSel" class="${C.input} !w-72"><option value="${esc(s.chat_default_model)}">${esc(s.chat_default_model)}</option></select>`)}
        ${row(t('Largest request (characters)'), t('Longer documents are refused before anything is sent.'), `<input id="aiMax" type="number" min="1000" class="${C.input} !w-40" value="${esc((S.ai && S.ai.max_chars) || 200000)}">`)}
      </div>`;
    MK.api('chat.models').then(d => {
      const sel = $('#chatModelSel'); if (!sel) return;
      const cur = s.chat_default_model;
      sel.innerHTML = d.models.map(m => `<option value="${esc(m.id)}" ${m.id === cur ? 'selected' : ''}>${esc(m.provider)} · ${esc(m.name)}</option>`).join('') +
        (d.models.some(m => m.id === cur) ? '' : `<option value="${esc(cur)}" selected>${esc(cur)} ${t('(not in the list)')}</option>`);
    }).catch(() => {});
    bindReset(v);
    const prev = () => {
      const tp = $('[data-set="placeholder_template"]', v).value;
      $('#tplPrev').innerHTML = t('Example:') + ' ' + ['IP', 'USER', 'PASS'].map((c, i) => `<code class="mk-tok" style="color:${catColor(['IP', 'USER', 'PASSWORD'][i])};background:${catColor(['IP', 'USER', 'PASSWORD'][i])}1f">${esc(tp.replace('{CAT}', c).replace('{cat}', c.toLowerCase()).replace('{n}', i + 1).replace('{hash}', ['a1f3c9e0', '77b20d4c', '0e9d51aa'][i]).replace('{len}', 8).replace('{stars}', '********'))}</code>`).join(' ') +
        (!/\{n\}|\{hash\}/.test(tp) ? ` <span class="text-amber-600">${t('— no {n} or {hash}: restoring and one-to-one mapping will not work')}</span>` : '');
    };
    $('[data-set="placeholder_template"]', v).addEventListener('input', prev);
    $$('[data-tpl]', v).forEach(b => b.addEventListener('click', () => { $('[data-set="placeholder_template"]', v).value = b.dataset.tpl; prev(); }));
    prev();
    $('#genSave').addEventListener('click', async () => {
      await saveSettings($$('[data-set]', v));
      try { S.ai = await MK.api('ai.settings', { default_model: $('#chatModelSel').value, max_chars: +$('#aiMax').value }); S.settings.chat_default_model = S.ai.default_model; } catch (e) { MK.toast(e.message, 'err'); }
    });
  }

  // ================================================================ AI CONNECTIONS
  const AI = { list: [], types: {}, edit: null };
  const aiUrls = (type, base) => {
    const b = (base || '').replace(/\/+$/, '') || 'https://…';
    return type === 'vllm_gateway' ? [b + '/v1/models', b + '/<model>/v1/chat/completions']
      : type === 'nvidia' ? [(base ? b : 'https://integrate.api.nvidia.com') + '/v1/models', (base ? b : 'https://integrate.api.nvidia.com') + '/v1/chat/completions']
      : type === 'ollama' ? [b + '/models', b + '/v1/chat/completions']
        : [b + '/models', b + '/chat/completions'];
  };
  async function viewAi(v) {
    v.innerHTML = header(t('AI connections'), t('OpenAI-compatible AI endpoints used by the chat screen. Models of enabled connections appear in the chat model list. Only masked text is ever sent to the AI.'),
      `<button type="button" id="aiNew" class="${C.primary}">${t('+ New connection')}</button>`) +
      `<div id="aiForm"></div><div id="aiList" class="grid gap-3"><div class="text-sm text-slate-400">${t('Loading…')}</div></div>`;
    $('#aiNew').addEventListener('click', () => aiForm(null));
    try {
      const d = await MK.api('llm.list');
      AI.list = d.connections; AI.types = d.types;
      aiRenderList();
    } catch (e) { $('#aiList').innerHTML = `<div class="rounded-lg bg-rose-50 p-4 text-sm text-rose-700">${esc(e.message)}</div>`; }
  }
  function aiRenderList() {
    const box = $('#aiList'); if (!box) return;
    if (!AI.list.length) { box.innerHTML = `<div class="${C.card} p-6 text-center text-sm text-slate-500">${t('No connections yet. Add at least one connection for the chat to work.')}</div>`; return; }
    const def = (S.settings.chat_default_model || '').split(':')[0];
    const n = AI.list.length;
    const lines = s => s.split(/[\n,]+/).filter(x => x.trim() && !x.trim().startsWith('#')).join(', ');
    box.innerHTML = AI.list.map((c, i) => `
      <div class="${C.card} flex flex-wrap items-start gap-3 p-4 ${c.enabled ? '' : 'opacity-70'}">
        <div class="flex flex-col gap-1">
          <button type="button" data-aimove="${i}" data-dir="-1" class="${C.btn} !px-2 !py-0.5" title="${esc(t('Move up'))}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-aimove="${i}" data-dir="1" class="${C.btn} !px-2 !py-0.5" title="${esc(t('Move down'))}" ${i === n - 1 ? 'disabled' : ''}>↓</button>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <b class="text-sm">${esc(c.name)}</b>
            <span class="rounded-full ${c.enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'} px-2 text-[11px] font-medium">${c.enabled ? t('Enabled') : t('Disabled')}</span>
            <span class="rounded-full bg-teal-50 px-2 text-[11px] font-medium text-teal-700 dark:bg-teal-500/15 dark:text-teal-300">${esc(AI.types[c.type] || c.type)}</span>
            ${c.id === def ? `<span class="rounded-full bg-amber-100 px-2 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">${t('Default model is here')}</span>` : ''}
          </div>
          <div class="mt-1 break-all font-mono text-xs text-slate-500">${esc(c.base_url)}</div>
          <div class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span>${t('ID:')} <code>${esc(c.id)}</code></span>
            <span>${t('Models:')} ${c.models_mode === 'manual' ? t('manual') + ' – ' + esc(lines(c.models)) : t('automatic') + (c.order.trim() ? ' ' + t('(custom order)') : '')}</span>
            <span>${t('API key:')} ${c.has_key ? esc(c.key_hint) : t('none')}</span>
            ${c.vision.trim() ? `<span>${t('Vision:')} ${esc(lines(c.vision))}</span>` : ''}
            ${c.verify_ssl ? '' : `<span class="text-amber-600">${t('SSL verification off')}</span>`}
          </div>
        </div>
        <div class="flex gap-2">
          <button type="button" data-aiedit="${esc(c.id)}" class="${C.btn}">${t('Edit')}</button>
          <button type="button" data-aidel="${esc(c.id)}" class="${C.danger}">${t('Delete')}</button>
        </div>
      </div>`).join('');
    $$('[data-aimove]', box).forEach(b => b.addEventListener('click', async () => {
      const i = +b.dataset.aimove, j = i + +b.dataset.dir;
      const ids = AI.list.map(c => c.id);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      try { const d = await MK.api('llm.reorder', { ids }); AI.list = d.connections; aiRenderList(); MK.toast(t('Order saved')); }
      catch (e) { MK.toast(e.message, 'err'); }
    }));
    $$('[data-aiedit]', box).forEach(b => b.addEventListener('click', () => aiForm(AI.list.find(c => c.id === b.dataset.aiedit))));
    $$('[data-aidel]', box).forEach(b => b.addEventListener('click', async () => {
      const c = AI.list.find(x => x.id === b.dataset.aidel);
      const warn = c.id === def ? '\n\n' + t('The default chat model is on this connection; if you delete it, choose a new default model under General settings.') : '';
      if (!confirm(t('Delete the "{name}" connection? Chats using its models will have to choose another model.', { name: c.name }) + warn)) return;
      try { const d = await MK.api('llm.delete', { id: c.id }); AI.list = d.connections; aiRenderList(); if (AI.edit === c.id) $('#aiForm').innerHTML = ''; MK.toast(t('Connection deleted')); }
      catch (e) { MK.toast(e.message, 'err'); }
    }));
  }
  function aiForm(c) {
    AI.edit = c ? c.id : '';
    const x = c || { name: '', type: 'openai', base_url: '', models_mode: 'auto', models: '', exclude: '', order: '', vision: '', enabled: true, verify_ssl: true, timeout: 600, has_key: false };
    const f = (label, hint, control) => `<label class="block"><span class="${C.label}">${label}</span><div class="mt-1">${control}</div>${hint ? `<div class="${C.hint}">${hint}</div>` : ''}</label>`;
    const box = $('#aiForm');
    box.innerHTML = `<div class="${C.card} mb-4 border-teal-300 p-5 dark:border-teal-800">
      <div class="mb-4 flex items-center gap-2"><b class="text-sm">${c ? t('Edit connection:') + ' ' + esc(c.name) : t('New connection')}</b>${c ? `<code class="text-xs text-slate-400">${esc(c.id)}</code>` : ''}</div>
      <div class="grid gap-4 md:grid-cols-2">
        ${f(t('Name'), t('Shown as the group name in the model list on the chat screen.'), `<input data-ai="name" class="${C.input}" value="${esc(x.name)}" placeholder="${esc(t('e.g. Company vLLM'))}">`)}
        ${f(t('Type'), '', `<select data-ai="type" class="${C.input}">${Object.entries(AI.types).map(([k, l]) => `<option value="${k}" ${x.type === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`)}
        <div class="md:col-span-2">${f(t('Base address'), '<span id="aiUrlHint"></span>', `<input data-ai="base_url" class="${C.input} font-mono" value="${esc(x.base_url)}" placeholder="https://ai.example.com/v1">`)}</div>
        ${f(t('API key'), x.has_key ? t('Saved key: {hint}. Type a new one to change it; if left empty, the current key is kept.', { hint: esc(x.key_hint) }) : t('Leave empty if not needed. Sent with the <code>Authorization: Bearer</code> header; never shown again after saving.'),
          `<input data-ai="api_key" type="password" autocomplete="new-password" class="${C.input} font-mono" placeholder="${x.has_key ? esc(t('type to change')) : ''}">${x.has_key ? `<label class="mt-1.5 inline-flex items-center gap-1.5 text-xs text-rose-600"><input data-ai="clear_key" type="checkbox" class="rounded border-slate-300"> ${t('Delete the saved key')}</label>` : ''}`)}
        ${f(t('Timeout (seconds)'), t('The longest time to wait for a reply.'), `<input data-ai="timeout" type="number" min="10" class="${C.input} !w-32" value="${esc(x.timeout)}">`)}
        <div class="md:col-span-2">
          <span class="${C.label}">${t('Model list')}</span>
          <div class="mt-1 flex gap-4 text-sm">
            <label class="inline-flex items-center gap-1.5"><input type="radio" name="aiMode" value="auto" ${x.models_mode !== 'manual' ? 'checked' : ''} class="text-teal-600"> ${t('Automatic (read from the endpoint)')}</label>
            <label class="inline-flex items-center gap-1.5"><input type="radio" name="aiMode" value="manual" ${x.models_mode === 'manual' ? 'checked' : ''} class="text-teal-600"> ${t('Enter manually')}</label>
          </div>
        </div>
        <div data-modebox="manual" class="md:col-span-2">${f(t('Models'), t('One model name per line (the <code>model</code> value the endpoint expects, e.g. <code>Llama-3.3-70B</code>). Shown in the chat list in the order written.'), `<textarea data-ai="models" rows="3" spellcheck="false" class="${C.input} mk-code">${esc(x.models)}</textarea>`)}</div>
        <div data-modebox="auto" class="md:col-span-2">${f(t('Models to exclude'), t('Models you do not want in the list; one name or <code>/regex/i</code> per line. Embedding models are never shown. Lines starting with <code>#</code> are comments.'), `<textarea data-ai="exclude" rows="3" spellcheck="false" class="${C.input} mk-code">${esc(x.exclude)}</textarea>`)}</div>
        <div data-modebox="auto" class="md:col-span-2">${f(t('Model order'), t('Models to show first in the chat list; one name or <code>/regex/i</code> per line, top to bottom. Models not listed are appended in the endpoint\'s order. If left empty, the endpoint\'s order is used. You can copy the list returned by "Test connection" here and edit it.'), `<textarea data-ai="order" rows="4" spellcheck="false" class="${C.input} mk-code" placeholder="gpt-oss-120b&#10;/qwen/i">${esc(x.order)}</textarea>`)}</div>
        <div class="md:col-span-2">${f(t('Vision-capable models'), t('Models that accept screenshots (images); one name or <code>/regex/i</code> per line. When one of these models is selected, screenshots added to the chat are sent with the sensitive text covered; other models only receive the text read from the image, masked. Ollama reports vision support itself, so you do not need to list its models here.'), `<textarea data-ai="vision" rows="2" spellcheck="false" class="${C.input} mk-code" placeholder="/vl/i">${esc(x.vision)}</textarea>`)}</div>
        <div class="flex flex-wrap gap-5 md:col-span-2 text-sm">
          <label class="inline-flex items-center gap-1.5"><input data-ai="enabled" type="checkbox" class="rounded border-slate-300 text-teal-600" ${x.enabled ? 'checked' : ''}> ${t('Enabled (show its models in the chat)')}</label>
          <label class="inline-flex items-center gap-1.5"><input data-ai="verify_ssl" type="checkbox" class="rounded border-slate-300 text-teal-600" ${x.verify_ssl ? 'checked' : ''}> ${t('Verify the TLS certificate')}</label>
        </div>
      </div>
      <div id="aiTestOut" class="mt-4 hidden rounded-lg px-3 py-2 text-xs"></div>
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" id="aiCancel" class="${C.btn}">${t('Cancel')}</button>
        <button type="button" id="aiTest" class="${C.btn}">${t('Test connection')}</button>
        <button type="button" id="aiSave" class="${C.primary}">${t('Save')}</button>
      </div>
    </div>`;
    const val = () => {
      const o = {};
      $$('[data-ai]', box).forEach(i => { o[i.dataset.ai] = i.type === 'checkbox' ? i.checked : i.value; });
      o.models_mode = $('input[name="aiMode"]:checked', box).value;
      return o;
    };
    const sync = () => {
      const o = val();
      $$('[data-modebox]', box).forEach(b => b.classList.toggle('hidden', b.dataset.modebox !== o.models_mode));
      const [m, ch] = aiUrls(o.type, o.base_url);
      $('#aiUrlHint').innerHTML = `${t('Model list:')} <code>${esc(m)}</code> · ${t('Chat:')} <code>${esc(ch)}</code>`;
    };
    $$('[data-ai="type"], [data-ai="base_url"], input[name="aiMode"]', box).forEach(i => i.addEventListener('input', sync));
    $$('input[name="aiMode"]', box).forEach(i => i.addEventListener('change', sync));
    sync();
    $('#aiCancel').addEventListener('click', () => { box.innerHTML = ''; AI.edit = null; });
    $('#aiTest').addEventListener('click', async () => {
      const out = $('#aiTestOut'), btn = $('#aiTest');
      btn.disabled = true; btn.textContent = t('Testing…');
      out.className = 'mt-4 rounded-lg px-3 py-2 text-xs bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'; out.textContent = t('Connecting…');
      try {
        const d = await MK.api('llm.test', { id: AI.edit, connection: val() });
        out.className = 'mt-4 rounded-lg px-3 py-2 text-xs bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300';
        out.innerHTML = `<b>${t('Connection successful.')}</b> ${d.note ? esc(d.note) + ' ' : ''}${t('{n} models:', { n: d.models.length })} ${d.models.map(m => `<code>${esc(m)}</code>${(d.vision || []).includes(m) ? ' ' + t('(vision)') : ''}`).join(', ') || '—'}` +
          (d.models.length && val().models_mode === 'auto' ? ` <button type="button" id="aiToOrder" class="ml-1 underline">${t('Copy this list to the order field')}</button>` : '');
        $('#aiToOrder')?.addEventListener('click', () => { $('[data-ai="order"]', box).value = d.models.join('\n'); $('[data-ai="order"]', box).focus(); });
      } catch (e) {
        out.className = 'mt-4 rounded-lg px-3 py-2 text-xs bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300';
        out.textContent = e.message;
      } finally { btn.disabled = false; btn.textContent = t('Test connection'); }
    });
    $('#aiSave').addEventListener('click', async () => {
      try {
        const d = await MK.api('llm.save', { id: AI.edit, connection: val() });
        AI.list = d.connections; box.innerHTML = ''; AI.edit = null; aiRenderList();
        MK.toast(t('Connection saved'));
      } catch (e) { MK.toast(e.message, 'err'); }
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('[data-ai="name"]', box).focus();
  }

  // ================================================================ BACKUP
  function viewBackup(v) {
    v.innerHTML = header(t('Backup / restore'), t('Export all rules, categories and settings as JSON; move them to another Exposift installation or restore the built-in defaults.')) + `
      <div class="grid gap-4 xl:grid-cols-3">
        <div class="${C.card} p-4"><b class="text-sm">${t('Export')}</b><p class="${C.hint}">${t('The admin password is never part of an export.')}</p><button type="button" id="expBtn" class="${C.primary} mt-3">${t('Download JSON')}</button></div>
        <div class="${C.card} p-4"><b class="text-sm">${t('Import')}</b><p class="${C.hint}">${t('Built-in rules are matched by bkey and updated; custom rules are added.')}</p>
          <label class="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" id="impReplace" class="rounded border-slate-300 text-teal-600"> ${t('Delete existing custom rules first')}</label>
          <label class="${C.btn} mt-3 cursor-pointer">${t('Choose JSON file')}<input type="file" id="impFile" accept=".json,application/json" class="hidden"></label></div>
        <div class="${C.card} p-4"><b class="text-sm">${t('Defaults')}</b><p class="${C.hint}">${t('Add built-in rules introduced in a new version, or reset all built-in rules/categories to their original state (your custom rules are kept).')}</p>
          <div class="mt-3 flex flex-wrap gap-2"><button type="button" id="seedAdd" class="${C.btn}">${t('Add missing defaults')}</button><button type="button" id="seedReset" class="${C.danger}">${t('Reset built-ins')}</button></div></div>
      </div>`;
    $('#expBtn').addEventListener('click', async () => {
      const d = await MK.api('export');
      MK.download(`exposift-settings-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(d, null, 2), 'application/json');
    });
    $('#impFile').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await MK.readFile(f));
        if (!confirm(t('Import {r} rules and {c} categories?', { r: (data.rules || []).length, c: (data.categories || []).length }))) return;
        const d = await MK.api('import', { data, replace_custom: $('#impReplace').checked });
        MK.toast(t('{n} rules imported', { n: d.rules })); await load();
      } catch (err) { MK.toast(err.message, 'err', 6000); }
      e.target.value = '';
    });
    $('#seedAdd').addEventListener('click', async () => { const d = await MK.api('reseed', { overwrite: false }); MK.toast(t('{n} rules added', { n: d.rules })); await load(); });
    $('#seedReset').addEventListener('click', async () => {
      if (!confirm(t('All built-in rules and categories will be reset to their defaults. Changes you made to built-in rules will be lost. Continue?'))) return;
      const d = await MK.api('reseed', { overwrite: true }); MK.toast(t('{n} rules reset', { n: d.rules })); await load();
    });
  }


  // ================================================================ SECURITY
  async function viewSecurity(v) {
    let minutes = 60;
    try { minutes = (await MK.api('security.get')).session_minutes; } catch (e) { MK.toast(e.message, 'err'); }
    v.innerHTML = header(t('Security'), t('Administrator password and access settings.')) + `
      <div class="grid gap-4 xl:grid-cols-2">
        <form id="pwForm" class="${C.card} space-y-3 p-4"><b class="text-sm">${t('Change the administrator password')}</b>
          <div><label class="${C.label}">${t('Current password')}</label><input name="current" type="password" required autocomplete="current-password" class="${C.input} mt-1"></div>
          <div><label class="${C.label}">${t('New password (at least 8 characters)')}</label><input name="new" type="password" required minlength="8" autocomplete="new-password" class="${C.input} mt-1"></div>
          <div><label class="${C.label}">${t('New password (again)')}</label><input name="new2" type="password" required minlength="8" autocomplete="new-password" class="${C.input} mt-1"></div>
          <button class="${C.primary}">${t('Change password')}</button></form>
        <div class="${C.card} space-y-4 p-4"><b class="text-sm">${t('Access')}</b>
          <div><label class="${C.label}">${t('Session timeout (minutes)')}</label><input id="secMin" type="number" min="5" max="1440" class="${C.input} mt-1 !w-32" value="${esc(minutes)}"></div>
          <button type="button" id="secSave" class="${C.primary}">${t('Save')}</button>
          <div class="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500 dark:bg-slate-800/60">
            <b class="text-slate-700 dark:text-slate-200">${t('What the password protects')}</b><br>
            • ${t('Opening the settings and the AI connections (addresses, keys, models). These are only available from this computer.')}<br>
            • ${t('The masking rules are kept in this browser, so the password is a lock on the screen, not encryption of the browser data.')}<br>
            • ${t('Five wrong attempts lock sign-in for five minutes.')}
          </div></div>
      </div>`;
    $('#pwForm').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (fd.get('new') !== fd.get('new2')) return MK.toast(t('The new passwords do not match'), 'err');
      try { await MK.api('password.change', { current: fd.get('current'), new: fd.get('new') }); e.target.reset(); MK.toast(t('Password changed')); }
      catch (ex) { MK.toast(ex.message, 'err'); }
    });
    $('#secSave').addEventListener('click', async () => {
      try { await MK.api('security.save', { session_minutes: +$('#secMin').value }); MK.toast(t('Saved')); } catch (ex) { MK.toast(ex.message, 'err'); }
    });
  }

  // ================================================================ CHANGE LOG
  const AUDIT_LABEL = {
    'rule.create': 'Rule created', 'rule.update': 'Rule changed', 'rule.delete': 'Rule deleted', 'rule.enable': 'Rule turned on', 'rule.disable': 'Rule turned off', 'rule.reset': 'Rule reset',
    'rules.bulk': 'Several rules changed', 'category.create': 'Category created', 'category.update': 'Category changed', 'category.delete': 'Category deleted',
    'settings.update': 'Settings saved', 'settings.reset': 'Setting reset', 'scan.save': 'Scan mapping saved', 'export': 'Settings exported', 'reseed': 'Defaults restored'
  };
  async function viewAudit(v) {
    v.innerHTML = header(t('Change log'), t('Rule, category and settings changes made in this browser.'));
    try {
      const rows = await MK.api('audit', { limit: 500 });
      v.insertAdjacentHTML('beforeend', `<div class="${C.card} overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-slate-100 dark:border-slate-800"><th class="${C.th}">${t('Time')}</th><th class="${C.th}">${t('Action')}</th><th class="${C.th}">${t('Detail')}</th></tr></thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">${rows.map(r => `<tr><td class="whitespace-nowrap px-3 py-1.5 text-xs text-slate-500">${esc(r.at)}</td><td class="px-3 py-1.5">${esc(t(AUDIT_LABEL[r.action] || r.action))}</td><td class="px-3 py-1.5 text-xs">${esc(r.detail)}</td></tr>`).join('') || `<tr><td colspan="3" class="p-6 text-center text-slate-400">${t('No entries')}</td></tr>`}</tbody></table></div>`);
    } catch (e) { MK.toast(e.message, 'err'); }
  }

  load();
})(window.MK);
