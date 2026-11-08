/* Exposift – AI Gateway (Ask mode). Masking and restoring happen here; api.php only ever receives masked text. */
(function () {
  'use strict';
  const Ex = window.Ex, t = Ex.t, esc = Ex.util.esc, $ = (id) => document.getElementById(id);
  const { S, show, VERSION } = Ex.app;
  const MAX_VISIBLE = 150000;
  const TOKEN_RE = /<[A-Z0-9]+_\d+>/g;
  const TYPE_CAT = { email: 'EMAIL', phone: 'PHONE', iban: 'IBAN', card: 'CARD', ip: 'IP', secret: 'SECRET', name: 'PERSON', tckn: 'TCKN' };
  const SYSTEM = 'You answer questions about a document that was pseudonymized. Placeholders such as <PERSON_1>, <EMAIL_2> or <IBAN_1> stand for real values you cannot see. '
    + 'Keep every placeholder exactly as written (same brackets, same letters, same number) whenever you refer to it. Never guess or invent the real value behind a placeholder. '
    + 'Answer in the language of the question.';

  const SYSTEM_RW = 'You rewrite text segments of a document that was pseudonymized. Placeholders such as <PERSON_1>, <EMAIL_2> or <IBAN_1> stand for real values you cannot see. '
    + 'Every line of the input starts with a marker like [[S12]] followed by one segment of text. Apply the user\'s instruction to each segment. '
    + 'Return EVERY marker exactly as written, in the same order, each followed by its rewritten text on ONE line. Keep every placeholder exactly as written; never invent the real value behind it. '
    + 'Do not add comments, numbering or any other lines.';
  const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  const BATCH = 8000;
  let csrf = '', models = [], defaultModel = '';
  let rwSegs = [];                // segments that Transform can write back: [{ n, seg }]
  const rewriteOn = () => { const r = document.querySelector('input[name=aiMode]:checked'); return !!r && r.value === 'rewrite'; };
  let cur = null;                 // { masked, items, text, sent }
  let mask = null;

  const newEngine = () => window.ExMask.engine();

  function rewritable() { return S.doc.format === 'pdf' ? [] : S.doc.segments.filter(sg => sg.loc && sg.visible !== false && sg.text && sg.text.trim()); }
  function visibleText() {
    if (rewriteOn()) {
      rwSegs = rewritable().map((seg, i) => ({ n: i + 1, seg }));
      return rwSegs.map(x => '[[S' + x.n + ']] ' + x.seg.text.replace(/\s+/g, ' ').trim()).join('\n');
    }
    const parts = [];
    for (const s of S.doc.segments) if (s.visible !== false && (s.kind === 'text' || s.kind === 'visible') && s.text) parts.push(s.text);
    return parts.join('\n\n');
  }
  // everything the scan found in the visible text is masked too, so Ask AI never sees what the findings list shows
  const FINDING_CAT = { person: 'PERSON', name: 'PERSON', email: 'EMAIL', phone: 'PHONE', national_id: 'TCKN', tax_id: 'CUSTOM', iban: 'IBAN', card: 'CARD', ip: 'IP', secret: 'SECRET', account: 'USER', host: 'HOST', address: 'LOCATION', custom: 'CUSTOM' };
  const findingHints = () => S.findings.filter(f => f.visible !== false && typeof f.value === 'string' && FINDING_CAT[f.type]).map(f => ({ category: FINDING_CAT[f.type], value: f.value.trim() }));
  const hintList = (extra) => [...S.names, ...extra].map(v => ({ category: 'PERSON', value: v })).concat(findingHints()).filter(h => h.value.length >= 2 && h.value.length <= 300);
  const lines = (s) => String(s || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 200);

  async function loadModels() {
    try {
      const r = await fetch('api.php?action=ai.models', { credentials: 'same-origin' });
      const j = await r.json();
      csrf = j.csrf || ''; models = j.models || []; defaultModel = j.default || '';
    } catch (e) { models = []; }
    $('aiNoCfg').classList.toggle('hidden', models.length > 0);
    $('aiModel').innerHTML = models.map(m => '<option value="' + esc(m.id) + '"' + (m.id === defaultModel ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('');
    $('aiMask').disabled = models.length === 0;
  }

  function syncMode() {
    const n = rewritable().length, rw = $('aiModeRw');
    rw.disabled = n === 0;
    $('aiRwNote').textContent = S.doc.format === 'pdf' ? t('Rewriting is not available for PDF files.') : n === 0 ? t('This file has no plain paragraphs or cells that can be rewritten.') : t('{n} paragraph(s) or cell(s) can be rewritten.', { n });
    if (rw.disabled && rewriteOn()) document.querySelector('input[name=aiMode][value=ask]').checked = true;
    $('aiQLabel').textContent = rewriteOn() ? t('What should be changed? (for example: fix the spelling, make it formal, translate to English)') : t('Your question');
    $('aiSend').textContent = t('Send the masked text');
  }
  document.querySelectorAll('input[name=aiMode]').forEach(r => r.addEventListener('change', () => { syncMode(); $('aiPrev').classList.add('hidden'); $('aiOut').classList.add('hidden'); $('aiOut').innerHTML = ''; cur = null; scopeLine(); }));
  function scopeLine() {
    const txt = visibleText();
    $('aiScope').textContent = txt.trim()
      ? (rewriteOn() ? t('The text of {n} paragraph(s) or cell(s) is used ({c} characters). Hidden content, comments and metadata are never sent.', { n: rwSegs.length, c: txt.length })
        : t('Only the visible text of the document is used ({n} characters). Hidden content, comments and metadata are never sent.', { n: txt.length }))
      : t('This document has no visible text to send.');
  }
  $('btnAsk').addEventListener('click', async () => {
    document.querySelector('input[name=aiMode][value=ask]').checked = true;
    syncMode();
    const txt = visibleText();
    $('aiScope').textContent = txt.trim()
      ? t('Only the visible text of the document is used ({n} characters). Hidden content, comments and metadata are never sent.', { n: txt.length })
      : t('This document has no visible text to send.');
    $('aiPrev').classList.add('hidden'); $('aiOut').classList.add('hidden'); $('aiOut').innerHTML = ''; cur = null;
    show('viewAI');
    await loadModels();
  });
  $('aiBack').addEventListener('click', () => show('viewWork'));

  function runMask(extraHints) {
    const text = visibleText();
    if (!text.trim()) throw new Error(t('This document has no visible text to send.'));
    if (text.length > MAX_VISIBLE) throw new Error(t('The text is too long for one request ({n} characters, limit {m}).', { n: text.length, m: MAX_VISIBLE }));
    mask = newEngine();
    const res = mask.run(text, { mode: (mask.set && mask.set.default_mode) || 'auto', known: [], hints: hintList([...lines($('aiExtra').value), ...extraHints]) });
    return { text, masked: res.masked, items: res.items, stats: res.stats, warnings: res.warnings || [] };
  }

  /** Looks for anything that still looks sensitive in the text that is about to leave the browser */
  function leakCheck(masked) {
    const stripped = masked.replace(TOKEN_RE, ' ');
    const found = Ex.detect(stripped, { names: [...S.names, ...lines($('aiExtra').value)] })
      .filter(m => ['email', 'phone', 'iban', 'card', 'secret', 'name', 'tckn'].includes(m.type) && (m.conf === 'high' || m.conf === 'medium' || m.type === 'name'));
    return found;
  }

  function renderPreview() {
    $('aiMasked').textContent = cur.masked;
    const by = {};
    for (const it of cur.items) { by[it.category] = (by[it.category] || 0) + (it.count || 1); }
    $('aiStats').textContent = t('{n} values replaced, {u} different', { n: cur.items.reduce((a, i) => a + (i.count || 1), 0), u: cur.items.length });
    $('aiItems').innerHTML = Object.entries(by).map(([c, n]) => '<span class="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">' + esc(c) + ' ×' + n + '</span>').join('');
    const rk = $('aiRisk'), w = cur.warnings || [];
    rk.classList.toggle('hidden', !w.length);
    rk.innerHTML = w.length ? '<b>' + esc(t('Lines with nothing masked contain a risk keyword:')) + '</b><ul class="mt-1 list-disc pl-5 text-xs">' + w.slice(0, 8).map(x => '<li>' + esc(t('Line {n}', { n: x.line })) + ' · <code>' + esc(x.keyword) + '</code></li>').join('') + '</ul>' : '';
    const leaks = cur.leaks;
    const box = $('aiLeak');
    if (leaks.length) {
      box.classList.remove('hidden');
      box.innerHTML = '<div class="font-semibold">' + esc(t('{n} value(s) in the masked text still look sensitive.', { n: leaks.length })) + '</div>'
        + '<div class="mt-1 text-xs">' + esc(leaks.slice(0, 6).map(m => m.type + ' (' + String(m.value).length + ' ' + t('characters') + ')').join(', ')) + '</div>'
        + '<div class="mt-2 flex flex-wrap items-center gap-2"><button type="button" id="aiFix" class="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white">' + esc(t('Mask these too')) + '</button>'
        + '<label class="flex items-center gap-1.5 text-xs"><input type="checkbox" id="aiAck" class="accent-rose-600"> ' + esc(t('I checked it; send anyway')) + '</label></div>';
      $('aiFix').addEventListener('click', () => doMask(leaks.map(m => m.value)));
      $('aiAck').addEventListener('change', () => { $('aiSend').disabled = !$('aiAck').checked; });
    } else { box.classList.add('hidden'); box.innerHTML = ''; }
    $('aiSend').disabled = leaks.length > 0;
    $('aiPrev').classList.remove('hidden');
  }

  let fixes = [];
  function doMask(more) {
    try {
      fixes = fixes.concat(more || []);
      const r = runMask(fixes);
      cur = { ...r, leaks: leakCheck(r.masked), sent: false };
      renderPreview();
    } catch (e) { Ex.toast(e.message, 'err', 5000); }
  }
  $('aiMask').addEventListener('click', () => { fixes = []; $('aiOut').classList.add('hidden'); $('aiOut').innerHTML = ''; doMask([]); });

  function restore(reply) {
    const map = new Map(cur.items.map(i => [i.token, i.original]));
    const unknown = new Set(); let restored = 0;
    const text = reply.replace(TOKEN_RE, (tk) => { if (map.has(tk)) { restored++; return map.get(tk); } unknown.add(tk); return tk; });
    return { text, unknown: [...unknown], restored };
  }

  $('aiSend').addEventListener('click', async () => {
    if (!cur || $('aiSend').disabled) return;
    const q = $('aiQ').value.trim();
    if (!q) { Ex.toast(t('Write your question first.'), 'warn'); return; }
    const modelId = $('aiModel').value;
    if (rewriteOn()) { await sendRewrite(q, modelId); return; }
    const content = q + '\n\n--- DOCUMENT (masked) ---\n' + cur.masked;
    $('aiSend').disabled = true; $('aiBusy').classList.remove('hidden'); $('aiBusy').textContent = t('Waiting for the model…');
    const entry = { at: new Date().toISOString(), model: modelId, chars_sent: content.length, values_masked: cur.items.reduce((a, i) => a + (i.count || 1), 0), categories: [...new Set(cur.items.map(i => i.category))], leak_warnings_acknowledged: cur.leaks.length, ok: false };
    try {
      const r = await fetch('api.php?action=ai.chat', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf },
        body: JSON.stringify({ model: modelId, system: SYSTEM, messages: [{ role: 'user', content }], max_tokens: 4096 })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      const rest = restore(j.text || '');
      entry.ok = true; entry.chars_received = (j.text || '').length; entry.unknown_tokens = rest.unknown.length;
      renderAnswer(j.text || '', rest);
    } catch (e) { Ex.toast(e.message, 'err', 6000); entry.error = String(e.message).slice(0, 120); }
    S.aiLog.push(entry);
    $('aiBusy').classList.add('hidden'); $('aiSend').disabled = cur.leaks.length > 0 && !($('aiAck') && $('aiAck').checked);
  });

  // ---------------------------------------------------------------- Transform: the model rewrites, the original file is edited
  const MARK = /^\[\[S(\d+)\]\] ?(.*)$/;
  const tokensOf = (txt) => new Set(txt.match(TOKEN_RE) || []);
  async function sendRewrite(q, modelId) {
    const entry = { at: new Date().toISOString(), model: modelId, mode: 'rewrite', chars_sent: 0, values_masked: cur.items.reduce((a, i) => a + (i.count || 1), 0), categories: [...new Set(cur.items.map(i => i.category))], leak_warnings_acknowledged: cur.leaks.length, ok: false };
    $('aiSend').disabled = true; $('aiBusy').classList.remove('hidden');
    try {
      const segs = [];
      for (const ln of cur.masked.split('\n')) { const m = MARK.exec(ln); if (m) segs.push({ n: +m[1], masked: m[2] }); else if (segs.length) segs[segs.length - 1].masked += ' ' + ln; }
      if (segs.length !== rwSegs.length) throw new Error(t('The masking changed the structure of the text. Try again.'));
      const batches = []; let batch = [], size = 0;
      for (const sg of segs) { const line = '[[S' + sg.n + ']] ' + sg.masked; if (size + line.length > BATCH && batch.length) { batches.push(batch); batch = []; size = 0; } batch.push(line); size += line.length + 1; }
      if (batch.length) batches.push(batch);
      const got = new Map(); let received = 0;
      for (let i = 0; i < batches.length; i++) {
        $('aiBusy').textContent = t('Waiting for the model… ({i} of {n})', { i: i + 1, n: batches.length });
        const content = q + '\n\n--- SEGMENTS (masked) ---\n' + batches[i].join('\n');
        entry.chars_sent += content.length;
        const r = await fetch('api.php?action=ai.chat', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': csrf },
          body: JSON.stringify({ model: modelId, system: SYSTEM_RW, messages: [{ role: 'user', content }], max_tokens: 4096 })
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
        received += (j.text || '').length;
        let last = null;
        for (const ln of String(j.text || '').split('\n')) { const m = MARK.exec(ln.trim()); if (m) { last = +m[1]; got.set(last, m[2]); } else if (last != null && ln.trim()) got.set(last, got.get(last) + ' ' + ln.trim()); }
      }
      // check every segment, restore the real values, keep what looks wrong out of the default selection
      const map = new Map(cur.items.map(i => [i.token, i.original]));
      const changes = []; let missing = 0, flagged = 0;
      for (const sg of segs) {
        const x = rwSegs.find(y => y.n === sg.n);
        const nw = got.get(sg.n);
        if (nw == null) { missing++; continue; }
        const origTokens = tokensOf(sg.masked), newTokens = tokensOf(nw);
        const lost = [...origTokens].filter(tk => !newTokens.has(tk)), invented = [...newTokens].filter(tk => !origTokens.has(tk));
        const text = nw.replace(TOKEN_RE, tk => (map.has(tk) ? map.get(tk) : tk));
        if (text.trim() === x.seg.text.replace(/\s+/g, ' ').trim()) continue;
        const bad = lost.length || invented.length || !text.trim();
        if (bad) flagged++;
        changes.push({ n: sg.n, seg: x.seg, text, bad, why: lost.length ? t('A placeholder was dropped.') : invented.length ? t('The model used a placeholder that does not exist.') : !text.trim() ? t('The new text is empty.') : '' });
      }
      entry.ok = true; entry.chars_received = received; entry.segments = segs.length; entry.changed = changes.length; entry.flagged = flagged; entry.missing = missing;
      renderRewrite(changes, missing);
    } catch (e) { Ex.toast(e.message, 'err', 6000); entry.error = String(e.message).slice(0, 120); }
    S.aiLog.push(entry);
    $('aiBusy').classList.add('hidden'); $('aiSend').disabled = cur.leaks.length > 0 && !($('aiAck') && $('aiAck').checked);
  }

  function renderRewrite(changes, missing) {
    const out = $('aiOut'); out.classList.remove('hidden');
    const rows = changes.map((c, i) => '<li class="rounded-lg border ' + (c.bad ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10' : 'border-slate-200 dark:border-slate-800') + ' p-2">'
      + '<label class="flex items-start gap-2"><input type="checkbox" data-rw="' + i + '" class="mt-1 accent-teal-600"' + (c.bad ? '' : ' checked') + '>'
      + '<span class="min-w-0 flex-1"><span class="block text-[10px] font-semibold uppercase text-slate-400">' + esc(t(c.seg.where || '')) + '</span>'
      + '<span class="block text-xs text-slate-500 line-through decoration-slate-300">' + esc(c.seg.text) + '</span>'
      + '<span class="mt-0.5 block text-sm">' + esc(c.text) + '</span>'
      + (c.bad ? '<span class="mt-1 block text-xs text-amber-800 dark:text-amber-200">' + esc(c.why) + ' ' + esc(t('Not selected by default.')) + '</span>' : '') + '</span></label></li>').join('');
    out.innerHTML = '<div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">'
      + '<div class="mb-2 text-sm font-semibold">' + esc(t('Proposed changes ({n})', { n: changes.length })) + '</div>'
      + '<p class="mb-3 text-xs text-slate-500">' + esc(t('The real values were put back in your browser. Choose what to apply: the rest of the file, its pictures, tables and layout are not touched. In a changed paragraph the formatting of the first run is used for the whole paragraph.')) + '</p>'
      + (missing ? '<div class="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">' + esc(t('{n} segment(s) came back without an answer and were left as they are.', { n: missing })) + '</div>' : '')
      + (rows ? '<ul class="max-h-[28rem] space-y-2 overflow-auto">' + rows + '</ul>' : '<div class="text-sm text-slate-500">' + esc(t('The model changed nothing.')) + '</div>')
      + '<div class="mt-3 flex flex-wrap items-center gap-3"><button type="button" id="rwApply" class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"' + (rows ? '' : ' disabled') + '>' + esc(t('Download the rewritten file')) + '</button><span id="rwMsg" class="text-xs text-slate-500"></span></div></div>';
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('rwApply').addEventListener('click', async () => {
      const picked = [...out.querySelectorAll('[data-rw]')].filter(b => b.checked).map(b => changes[+b.dataset.rw]);
      if (!picked.length) { Ex.toast(t('Choose at least one change.'), 'warn'); return; }
      try {
        const res = Ex.transform.apply(S.bytes, S.doc.format, picked.map(c => ({ ...c.seg.loc, text: c.text })));
        const check = await Ex.adapters.office.read(res.bytes, 'rewritten.' + S.doc.format);   // must open again
        void check;
        Ex.download(S.file.name.replace(/(\.[^.]+)?$/, '-rewritten$1'), res.bytes, MIME[S.doc.format]);
        $('rwMsg').textContent = t('{n} change(s) written, {s} skipped. The file was reopened to check that it is still valid.', { n: res.changed, s: res.skipped });
        S.aiLog.push({ at: new Date().toISOString(), mode: 'rewrite-download', changes_applied: res.changed, skipped: res.skipped });
      } catch (e) { Ex.toast(e.message, 'err', 6000); }
    });
  }

  function renderAnswer(raw, rest) {
    const out = $('aiOut'); out.classList.remove('hidden');
    out.innerHTML = '<div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">'
      + '<div class="mb-2 flex items-center justify-between"><div class="text-sm font-semibold">' + esc(t('Answer (real values restored here, in your browser)')) + '</div>'
      + '<button type="button" id="aiCopy" class="rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">' + esc(t('Copy')) + '</button></div>'
      + '<pre id="aiAns" class="whitespace-pre-wrap break-words text-sm"></pre>'
      + (rest.unknown.length ? '<div class="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">' + esc(t('The model used label(s) that do not exist in this document and were left unchanged: {list}', { list: rest.unknown.join(', ') })) + '</div>' : '')
      + '<details class="mt-3 text-xs"><summary class="cursor-pointer text-slate-500">' + esc(t('Show the raw answer as the model wrote it')) + '</summary><pre class="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 dark:bg-slate-950" id="aiRaw"></pre></details></div>';
    $('aiAns').textContent = rest.text; $('aiRaw').textContent = raw;
    $('aiCopy').addEventListener('click', () => { navigator.clipboard.writeText(rest.text).then(() => Ex.toast(t('Copied.'))); });
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  Ex.ai = { restore: (reply, items) => { cur = cur || { items }; return restore(reply); }, TOKEN_RE };
  void VERSION;
})();
