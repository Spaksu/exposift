/* Exposift – inspection screen. Everything here runs in the browser; no request carries file content. */
(function () {
  'use strict';
  const Ex = window.Ex;
  const t = Ex.t, esc = Ex.util.esc;
  const M = Ex.model;
  const $ = (id) => document.getElementById(id);
  const VERSION = '0.3.0';

  const S = {
    file: null, bytes: null, doc: null, findings: [], hash: '',
    ctx: null, names: [], decisions: {}, cls: 'all', q: '', limit: 60,
    pdfjs: null, rendered: new Set(), observer: null, aiLog: []
  };

  // ------------------------------------------------------------------ labels
  const SEV_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
  const SEV_CLASS = {
    high: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
    medium: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
    low: 'bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200'
  };
  const CLS_DOT = { hidden: 'bg-violet-500', personal: 'bg-sky-500', credential: 'bg-rose-500', oversharing: 'bg-amber-500', recoverable: 'bg-red-600', unverified: 'bg-slate-400' };
  const CONF_LABEL = { high: 'Sure', medium: 'Fairly sure', low: 'Unsure' };
  const STANCE_CLASS = {
    expected: 'text-emerald-700 dark:text-emerald-300', verify: 'text-amber-700 dark:text-amber-300',
    strong: 'text-rose-700 dark:text-rose-300', remove: 'text-rose-700 dark:text-rose-300'
  };

  // ------------------------------------------------------------------ views
  const views = ['viewHome', 'viewBusy', 'viewError', 'viewWork', 'viewAI', 'viewOut'];
  // Review screen fits the viewport on wide screens: no page scroll, only the inner panes scroll.
  function fitWork() {
    const w = $('viewWork'), on = !w.classList.contains('hidden') && window.matchMedia('(min-width: 1024px)').matches;
    document.body.style.overflow = on ? 'hidden' : '';
    w.style.display = on ? 'flex' : '';
    if (!on) { w.style.height = ''; return; }
    const foot = document.querySelector('footer'), main = document.querySelector('main');
    const pad = parseFloat(getComputedStyle(main).paddingBottom) || 0;
    w.style.height = Math.max(320, window.innerHeight - w.getBoundingClientRect().top - window.scrollY * 0 - (foot ? foot.offsetHeight : 0) - pad) + 'px';
    const over = document.documentElement.scrollHeight - window.innerHeight;
    if (over > 0) w.style.height = Math.max(320, w.offsetHeight - over) + 'px';
  }
  window.addEventListener('resize', fitWork);
  function show(id) { for (const v of views) $(v).classList.toggle('hidden', v !== id); window.scrollTo({ top: 0 }); fitWork(); }
  Ex.app = { S, show, VERSION };

  // ------------------------------------------------------------------ home controls
  function fillSelect(sel, map, current) {
    sel.innerHTML = Object.entries(map).map(([k, v]) => '<option value="' + esc(k) + '"' + (k === current ? ' selected' : '') + '>' + esc(t(v)) + '</option>').join('');
  }
  function bindPurposeSelects(docSel, purpSel, audSel, onChange) {
    fillSelect(docSel, M.DOC_TYPES, docSel.value || 'generic');
    const refill = () => { fillSelect(purpSel, M.PURPOSES[docSel.value] || M.PURPOSES.generic, purpSel.value); };
    fillSelect(audSel, M.AUDIENCES, audSel.value || 'external');
    refill();
    docSel.addEventListener('change', () => { purpSel.innerHTML = ''; refill(); onChange(); });
    purpSel.addEventListener('change', onChange);
    audSel.addEventListener('change', onChange);
  }
  bindPurposeSelects($('selDoc'), $('selPurpose'), $('selAud'), () => {});
  document.querySelectorAll('input[name=mode]').forEach(r => r.addEventListener('change', () => {
    $('purposeBox').classList.toggle('hidden', currentMode() !== 'purpose');
  }));
  const currentMode = () => document.querySelector('input[name=mode]:checked').value;

  function parseNames(str) { return String(str || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).slice(0, 200); }

  // ------------------------------------------------------------------ file intake
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('ex-over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('ex-over'); }));
  // Choosing a file only selects it; the button below the options starts the inspection.
  S.pending = null;
  function pick(f) { S.pending = f; start(f); }
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) pick(f); });
  $('file').addEventListener('change', e => { const f = e.target.files[0]; if (f) pick(f); e.target.value = ''; });
  $('errBack').addEventListener('click', reset);
  $('btnNew').addEventListener('click', reset);

  function reset() {
    teardownPdf();
    S.pending = null;
    Object.assign(S, { file: null, bytes: null, doc: null, findings: [], hash: '', decisions: {}, cls: 'all', q: '', limit: 60, out: null });
    $('resultBox').classList.add('hidden'); $('resultBox').innerHTML = '';
    $('q').value = '';
    show('viewHome');
  }
  function teardownPdf() {
    if (S.observer) { S.observer.disconnect(); S.observer = null; }
    S.rendered.clear();
    if (S.doc && S.doc._pdf) { try { S.doc._pdf.destroy(); } catch (e) { /* already gone */ } }
  }

  const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  function sniff(bytes) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
    if (head.includes('%PDF-')) return 'pdf';
    if (bytes[0] === 0x50 && bytes[1] === 0x4B) return 'zip';
    if (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) return 'ole';
    return 'unknown';
  }

  async function loadPdfjs() {
    if (S.pdfjs) return S.pdfjs;
    const abs = (p) => new URL(p, document.baseURI).href;
    const mod = await import('../vendor/pdf.min.js');   // relative to this script
    mod.GlobalWorkerOptions.workerSrc = abs('assets/vendor/pdf.worker.min.js');
    S.pdfjs = mod;
    return mod;
  }

  async function start(file) {
    try {
      const L = Ex.util.LIMITS;
      if (file.size > L.maxFileBytes) throw new Ex.util.ExposiftError('too_big', t('This file is larger than {mb} MB, which is more than the browser can inspect comfortably.', { mb: Math.round(L.maxFileBytes / 1048576) }));
      if (file.size === 0) throw new Ex.util.ExposiftError('empty', t('The file is empty.'));
      S.names = parseNames($('names').value);
      S.aiLog = [];
      if (currentMode() === 'purpose') S.ctx = { docType: $('selDoc').value, purpose: $('selPurpose').value, audience: $('selAud').value };
      else S.ctx = null;
      $('busyFile').textContent = file.name + ' · ' + Ex.util.fmtBytes(file.size);
      $('busyText').textContent = t('Reading the file…');
      show('viewBusy');
      await new Promise(r => setTimeout(r, 30));          // let the spinner paint
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = sniff(bytes);
      let doc;
      if (kind === 'pdf') {
        const pdfjs = await loadPdfjs();
        const abs = (p) => new URL(p, document.baseURI).href;
        const docOptions = { standardFontDataUrl: abs('assets/vendor/pdfjs/standard_fonts/'), cMapUrl: abs('assets/vendor/pdfjs/cmaps/'), cMapPacked: true };
        doc = await withTimeout(Ex.adapters.pdf.read(bytes, file.name, pdfjs, {
          docOptions,
          progress: (p, n) => { $('busyText').textContent = t('Inspecting page {p} of {n}…', { p, n }); }
        }), 120000);
      } else if (kind === 'zip') {
        $('busyText').textContent = t('Inspecting the document parts…');
        await new Promise(r => setTimeout(r, 30));
        doc = await Ex.adapters.office.read(bytes, file.name);
      } else if (kind === 'ole') {
        throw new Ex.util.ExposiftError('legacy', t('This looks like an older Office file (.doc/.xls/.ppt) or a password-protected one. Save it as .docx, .xlsx or .pptx first; encrypted files are not supported.'));
      } else {
        throw new Ex.util.ExposiftError('unknown', t('This is not a PDF, Word, Excel or PowerPoint file.'));
      }
      teardownPdf();
      S.file = file; S.bytes = bytes; S.doc = doc;
      S.hash = await Ex.util.sha256(bytes);
      S.decisions = {}; S.ocrDone = false; S.ocrMsg = '';
      rescan();
      initWorkspace();
      show('viewWork');
      renderAll();
    } catch (e) {
      console.error(e);
      $('errText').textContent = e && e.code ? t(e.message) : t('Something went wrong while reading this file: {msg}', { msg: e && e.message ? e.message : String(e) });
      show('viewError');
    }
  }

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Ex.util.ExposiftError('timeout', 'The inspection took too long and was stopped. The file may be damaged or very complex.')), ms))]);
  }

  function rescan() {
    S.findings = Ex.analyze(S.doc, S.ctx, S.names);
    // "Clean structure" never touches the pages, so findings on the page itself are not shown at all.
    if (S.doc.format === 'pdf' && pdfModeVal() === 'clean') S.findings = S.findings;
  }

  // ------------------------------------------------------------------ workspace
  function initWorkspace() {
    $('wName').textContent = S.file.name;
    $('wMeta').textContent = [S.doc.format.toUpperCase(), Ex.util.fmtBytes(S.file.size), S.doc.format === 'pdf' ? t('{n} page(s)', { n: S.doc.meta.pages }) : S.doc.format === 'xlsx' ? t('{n} sheet(s)', { n: S.doc.meta.sheets }) : S.doc.format === 'pptx' ? t('{n} slide(s)', { n: S.doc.meta.slides }) : t('{n} paragraph(s)', { n: S.doc.meta.paragraphs }), 'SHA-256 ' + S.hash.slice(0, 12) + '…'].join(' · ');
    $('wMode').value = S.ctx ? 'purpose' : 'quick';
    $('wNames').value = S.names.join(', ');
    $('wDoc').value = S.ctx ? S.ctx.docType : $('selDoc').value;
    bindWorkSelects();
  }
  let boundWork = false;
  function bindWorkSelects() {
    if (boundWork) { syncWorkSelects(); return; }
    boundWork = true;
    fillSelect($('wDoc'), M.DOC_TYPES, S.ctx ? S.ctx.docType : 'generic');
    fillSelect($('wAud'), M.AUDIENCES, S.ctx ? S.ctx.audience : 'external');
    syncWorkSelects();
    const apply = () => {
      if ($('wMode').value === 'purpose') S.ctx = { docType: $('wDoc').value, purpose: $('wPurp').value, audience: $('wAud').value };
      else S.ctx = null;
      S.names = parseNames($('wNames').value);
      rescan(); renderAll(true);
    };
    $('wMode').addEventListener('change', () => { $('wPurpose').classList.toggle('hidden', $('wMode').value !== 'purpose'); apply(); });
    $('wDoc').addEventListener('change', () => { fillSelect($('wPurp'), M.PURPOSES[$('wDoc').value] || M.PURPOSES.generic, ''); apply(); });
    $('wPurp').addEventListener('change', apply);
    $('wAud').addEventListener('change', apply);
    $('wNames').addEventListener('change', apply);
  }
  function syncWorkSelects() {
    const c = S.ctx;
    fillSelect($('wDoc'), M.DOC_TYPES, c ? c.docType : 'generic');
    fillSelect($('wPurp'), M.PURPOSES[c ? c.docType : 'generic'] || M.PURPOSES.generic, c ? c.purpose : '');
    fillSelect($('wAud'), M.AUDIENCES, c ? c.audience : 'external');
    $('wPurpose').classList.toggle('hidden', !c);
  }

  function renderAll(keepPreview) {
    renderNote();
    renderOcrBar();
    renderSummary();
    renderChips();
    renderList();
    renderChecks();
    renderDecisions();
    if (!keepPreview) { setTab('doc'); renderPreview(); }
    else decoratePreview();
  }

  // ------------------------------------------------------------------ OCR (text inside pictures), on request
  const OCR_MEDIA = /^(word|xl|ppt)\/media\/.*\.(png|jpe?g|gif|bmp|webp|tiff?)$/i;
  function ocrTargets() {
    const d = S.doc;
    if (!d || S.ocrDone) return [];
    if (d.format === 'pdf') {
      const len = new Map();
      for (const sg of d.segments) if (sg.page && sg.kind === 'text') len.set(sg.page, (len.get(sg.page) || 0) + sg.text.replace(/\s+/g, '').length);
      const out = [];
      for (let p = 1; p <= (d.meta.analyzedPages || d.meta.pages); p++) if ((len.get(p) || 0) < 40) out.push(p);
      return out.slice(0, 30);
    }
    if (!d.unsupported.some(u => u.id === 'images.text')) return [];
    try { return Object.keys(Ex.util.safeUnzip(S.bytes)).filter(n => OCR_MEDIA.test(n)).slice(0, 40); } catch (e) { return []; }
  }
  function renderOcrBar() {
    const bar = $('ocrBar');
    if (S.ocrBusy) return;
    const tg = ocrTargets();
    bar.classList.toggle('hidden', !tg.length && !S.ocrMsg);
    bar.classList.toggle('flex', !!(tg.length || S.ocrMsg));
    if (tg.length) {
      $('ocrText').textContent = S.doc.format === 'pdf'
        ? t('{n} page(s) have little or no text and may be pictures. OCR reads the text in them. It runs in your browser and nothing is uploaded; it can take a while.', { n: tg.length })
        : t('{n} picture(s) in this file may contain text. OCR reads it. It runs in your browser and nothing is uploaded; it can take a while.', { n: tg.length });
      $('btnOcr').classList.remove('hidden'); $('btnOcr').disabled = false;
    } else if (S.ocrMsg) { $('ocrText').textContent = S.ocrMsg; $('btnOcr').classList.add('hidden'); }
  }
  async function runOcr() {
    const tg = ocrTargets(); if (!tg.length) return;
    S.ocrBusy = true; $('btnOcr').disabled = true;
    const say = (m) => { $('ocrText').textContent = t(m); };
    const segs = []; let n = 0;
    try {
      const ids = () => 'o' + (++n);
      if (S.doc.format === 'pdf') {
        for (let i = 0; i < tg.length; i++) {
          const pn = tg[i];
          say(t('Reading page {p} of {n}…', { p: i + 1, n: tg.length }));
          const page = await S.doc._pdf.getPage(pn);
          const scale = 2.5, vp = page.getViewport({ scale });
          const cv = document.createElement('canvas'); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
          await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
          const res = await Ex.ocr.read(cv, say);
          page.cleanup();
          if (res.text.trim()) segs.push({ id: ids(), ...Ex.ocr.segment(res, 'Page ' + pn + ' · read from the page picture', page.rotate ? {} : { page: pn, view: page.view, scale }), page: pn });
        }
      } else {
        const files = Ex.util.safeUnzip(S.bytes);
        for (let i = 0; i < tg.length; i++) {
          say(t('Reading picture {p} of {n}…', { p: i + 1, n: tg.length }));
          const mime = /png$/i.test(tg[i]) ? 'image/png' : /jpe?g$/i.test(tg[i]) ? 'image/jpeg' : 'application/octet-stream';
          const res = await Ex.ocr.read(new Blob([files[tg[i]]], { type: mime }), say);
          if (res.text.trim()) segs.push({ id: ids(), ...Ex.ocr.segment(res, tg[i] + ' · text inside the picture') });
        }
      }
      S.doc.segments.push(...segs);
      const fresh = Ex.analyze({ format: S.doc.format, segments: segs, findings: [], checks: [], unsupported: [], meta: {} }, S.ctx, S.names);
      S.findings.push(...fresh);
      const order = { high: 0, medium: 1, low: 2 };
      S.findings.sort((a, b) => order[a.sev] - order[b.sev] || (a.page || 0) - (b.page || 0) || a.id.localeCompare(b.id, 'en', { numeric: true }));
      S.doc.unsupported = S.doc.unsupported.filter(u => u.id !== 'images.text');
      for (const c of S.doc.checks) if (c.id === 'images.text') { c.status = 'done'; c.note = ''; }
      S.ocrDone = true;
      S.ocrMsg = t('OCR finished: text was read in {s} of {n} item(s) and {f} finding(s) were added.', { s: segs.length, n: tg.length, f: fresh.length });
      Ex.toast(S.ocrMsg);
    } catch (e) {
      console.error(e);
      S.ocrMsg = '';
      Ex.toast(t('OCR could not run: {msg}', { msg: e && e.message ? e.message : String(e) }), 'warn');
    } finally { S.ocrBusy = false; await Ex.ocr.stop(); }
    renderAll(true);
  }
  $('btnOcr').addEventListener('click', runOcr);

  function renderNote() {
    const c = S.ctx;
    const note = c ? M.PURPOSE_NOTES[c.docType + '/' + c.purpose] : '';
    $('purposeNote').textContent = note ? t(note) : (c ? t('Findings are weighed against this purpose. "Verify" means: check whether the recipient really needs it. Exposift does not decide that for you.') : '');
  }

  // Counters follow the cards: identical findings shown as one card count once.
  function cardReps(list) {
    const seen = new Set(), out = [];
    for (const f of list) { const k = groupKey(f); if (k) { if (seen.has(k)) continue; seen.add(k); } out.push(f); }
    return out;
  }
  function renderSummary() {
    const sum = Ex.summarize(cardReps(S.findings));
    const box = (sev, tone) => '<div class="rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900"><div class="text-2xl font-bold ' + tone + '">' + sum.bySev[sev] + '</div><div class="text-[11px] text-slate-500">' + esc(t(SEV_LABEL[sev])) + '</div></div>';
    $('sumRow').innerHTML = box('high', 'text-rose-600') + box('medium', 'text-amber-600') + box('low', 'text-slate-500');
    S.sum = sum;
  }

  function renderChips() {
    const counts = S.sum.byClass;
    const chip = (key, label, n, dot) => '<button type="button" data-cls="' + key + '" class="clsChip inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium '
      + (S.cls === key ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 bg-white hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800') + '">'
      + (dot ? '<span class="h-2 w-2 rounded-full ' + dot + '"></span>' : '') + esc(label) + ' <span class="opacity-70">' + n + '</span></button>';
    let h = chip('all', t('All'), cardReps(S.findings).length, '');
    for (const [k, label] of Object.entries(M.CLASSES)) if (counts[k]) h += chip(k, t(label), counts[k], CLS_DOT[k]);
    $('clsChips').innerHTML = h;
    $('clsChips').querySelectorAll('.clsChip').forEach(b => b.addEventListener('click', () => { S.cls = b.dataset.cls; S.limit = 60; renderChips(); renderList(); }));
  }

  function visibleFindings() {
    const q = S.q.trim().toLowerCase();
    return S.findings.filter(f => (S.cls === 'all' || f.cls === S.cls) && (!q || (f.title + ' ' + (f.where || '') + ' ' + (f.detail || '') + ' ' + (f.value || '')).toLowerCase().includes(q)));
  }
  $('q').addEventListener('input', () => { S.q = $('q').value; S.limit = 60; renderList(); });

  // Same value found in several places is shown once, with a link per place.
  function locLabel(m) { return String(m.where || '').replace(/^[^·]*\.xml · /, '') || t('Location'); }
  function groupKey(f) { return f.value && !(f.items && f.items.length) ? [f.cls, f.type, f.title, String(f.value).trim().toLowerCase()].join('|') : null; }
  function groupList(list) {
    const seen = new Map(), out = [];
    for (const f of list) {
      f._grp = null;
      const k = groupKey(f);
      if (k && seen.has(k)) { seen.get(k)._grp.push(f); continue; }
      if (k) { f._grp = [f]; seen.set(k, f); }
      out.push(f);
    }
    // Several different values of the same kind get a number: "Email address 1", "Email address 2".
    const byTitle = new Map();
    for (const f of out) byTitle.set(f.title, (byTitle.get(f.title) || 0) + 1);
    const idx = new Map();
    for (const f of out) { f._num = byTitle.get(f.title) > 1 ? (idx.set(f.title, (idx.get(f.title) || 0) + 1), idx.get(f.title)) : 0; }
    return out;
  }
  function card(f) {
    const dec = S.decisions[f.id] || '';
    const btn = (v, label) => '<button type="button" data-d="' + v + '" class="decBtn rounded-md border px-2 py-1 text-[11px] font-medium '
      + (dec === v ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800') + '">' + esc(t(label)) + '</button>';
    const items = f.items && f.items.length ? '<details class="mt-2 text-xs"><summary class="cursor-pointer text-slate-500">' + esc(t('Show details')) + ' (' + f.items.length + ')</summary><ul class="mt-1 space-y-0.5 font-mono text-[11px]">'
      + f.items.slice(0, 40).map(i => '<li><span class="text-slate-500">' + esc(i.k) + '</span> <span class="ex-blur">' + esc(String(i.v).slice(0, 160)) + '</span></li>').join('') + (f.items.length > 40 ? '<li class="text-slate-400">…</li>' : '') + '</ul></details>' : '';
    const value = f.value ? '<div class="mt-1.5 break-words font-mono text-[12px]"><span class="ex-blur" title="' + esc(t('Click to reveal')) + '">' + esc(String(f.value).slice(0, f.items ? 120 : 300)) + '</span></div>' : '';
    const stance = f.stance ? '<div class="mt-1.5 text-xs font-medium ' + STANCE_CLASS[f.stance] + '">' + esc(t(M.STANCE_LABEL[f.stance])) + '</div>' : '';
    const detail = f.detail || f.note;
    return '<article class="ex-card rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900" data-fid="' + f.id + '" data-group="' + (f._grp ? f._grp.map(m => m.id).join(',') : f.id) + '">'
      + '<div class="flex flex-wrap items-center gap-1.5">'
      + '<span class="h-2 w-2 rounded-full ' + CLS_DOT[f.cls] + '"></span>'
      + '<b class="text-sm">' + esc(t(f.title)) + (f._num ? ' ' + f._num : '') + (f.count > 1 ? ' <span class="font-normal text-slate-400">×' + f.count + '</span>' : '') + '</b>'
      + '<span class="rounded-full px-2 py-0.5 text-[10px] font-semibold ' + SEV_CLASS[f.sev] + '">' + esc(t(SEV_LABEL[f.sev])) + '</span>'
      + '<span class="text-[10px] text-slate-400" title="' + esc(t('How sure Exposift is that this is what it looks like')) + '">' + esc(t(CONF_LABEL[f.conf] || f.conf)) + '</span>'
      + (f.visible === false ? '<span class="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800 dark:bg-violet-500/20 dark:text-violet-200">' + esc(t('Not visible on the page')) + '</span>' : '')
      + '<span class="ml-auto text-[11px] text-slate-400">' + esc(t(M.CLASSES[f.cls])) + '</span></div>'
      + (f._grp && f._grp.length > 1
        ? '<div class="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500"><span>' + esc(t('Found {n} times:', { n: f._grp.length })) + '</span>'
          + f._grp.map(m => '<button type="button" class="locBtn font-medium text-teal-700 hover:underline dark:text-teal-300" data-fid="' + m.id + '">' + esc(locLabel(m)) + '</button>').join('<span class="text-slate-300">,</span>') + '</div>'
        : '<div class="mt-0.5 text-[11px] text-slate-500">' + esc(t(f.where || '')) + '</div>')
      + (detail ? '<p class="mt-1.5 text-xs text-slate-600 dark:text-slate-400">' + esc(t(detail)) + '</p>' : '')
      + value + items + stance
      + '<div class="mt-2 flex items-center gap-1.5">' + btn('keep', 'Keep') + btn('remove', 'Remove') + btn('skip', 'Not now')
      + (f._grp && f._grp.length > 1 ? '' : '<button type="button" class="locBtn ml-auto text-[11px] font-medium text-teal-700 hover:underline dark:text-teal-300">' + esc(t('Show in document')) + '</button>') + '</div>'
      + '</article>';
  }

  function renderList() {
    // Hidden exposure goes to the bottom, under its own heading.
    const vis = visibleFindings();
    const list = groupList(vis.filter(f => f.cls !== 'hidden').concat(vis.filter(f => f.cls === 'hidden')));
    const shown = list.slice(0, S.limit);
    const firstHidden = shown.findIndex(f => f.cls === 'hidden');
    let h = shown.map((f, i) => (i === firstHidden && firstHidden > 0 ? '<div class="px-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">' + esc(t(M.CLASSES.hidden)) + '</div>' : '') + card(f)).join('');
    if (!list.length) h = '<div class="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">' + esc(S.findings.length ? t('No findings match this filter.') : t('Nothing found. That does not prove the file is safe: see "What was checked" for the parts that could not be inspected.')) + '</div>';
    if (list.length > shown.length) h += '<button type="button" id="more" class="w-full rounded-lg border border-slate-300 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">' + esc(t('Show {n} more', { n: list.length - shown.length })) + '</button>';
    $('list').innerHTML = h;
    $('more')?.addEventListener('click', () => { S.limit += 100; renderList(); });
  }

  $('list').addEventListener('click', e => {
    const blur = e.target.closest('.ex-blur');
    if (blur) { blur.classList.toggle('ex-open'); return; }
    const art = e.target.closest('.ex-card');
    if (!art) return;
    const id = art.dataset.fid;
    const d = e.target.closest('.decBtn');
    if (d) {
      const v = d.dataset.d;
      const ids = (art.dataset.group || id).split(',');
      const had = S.decisions[id] === v;
      for (const x of ids) { if (had) delete S.decisions[x]; else S.decisions[x] = v; }
      const f = S.findings.find(x => x.id === id);
      art.outerHTML = card(f);
      renderDecisions();
      return;
    }
    const lb = e.target.closest('.locBtn');
    if (lb) locate(lb.dataset.fid || id);
  });

  // Decision tags on the document preview (shown through CSS from data-tag / data-dec)
  const DEC_TAG = { remove: 'To be removed', keep: 'Will stay', skip: 'Not changed' };
  function tagMarks(root) {
    (root || $('tabDoc')).querySelectorAll('[data-fid].ex-tag, [data-fid].ex-box').forEach(el => {
      const d = S.decisions[el.dataset.fid] || '';
      if (d) el.dataset.dec = d; else delete el.dataset.dec;
      el.dataset.tag = t(DEC_TAG[d] || 'No action yet');
    });
  }
  function renderDecisions() {
    tagMarks();
    const c = { keep: 0, remove: 0, skip: 0 };
    const reps = cardReps(S.findings);
    for (const f of reps) { const v = S.decisions[f.id]; if (c[v] !== undefined) c[v]++; }
    const open = reps.length - c.keep - c.remove - c.skip;
    $('decSum').textContent = t('{r} to remove · {k} to keep · {s} postponed · {o} not reviewed', { r: c.remove, k: c.keep, s: c.skip, o: open });
  }

  // ------------------------------------------------------------------ checks tab
  function renderChecks() {
    const ICON = { done: ['✓', 'text-emerald-600'], partial: ['◐', 'text-amber-600'], not_run: ['–', 'text-slate-400'] };
    const LBL = { done: 'Checked', partial: 'Partly checked', not_run: 'Not checked' };
    let h = '<p class="mb-3 text-xs text-slate-500">' + esc(t('An empty result only means something when you know what was looked at. Parts Exposift could not inspect are never skipped silently.')) + '</p><ul class="space-y-1.5">';
    for (const c of S.doc.checks) {
      const [ic, tone] = ICON[c.status] || ICON.not_run;
      h += '<li class="flex gap-2"><span class="w-4 text-center font-bold ' + tone + '">' + ic + '</span><span><span class="font-medium">' + esc(t(c.label)) + '</span> <span class="text-xs text-slate-400">· ' + esc(t(LBL[c.status] || c.status)) + '</span>'
        + (c.note ? '<span class="block text-xs text-slate-500">' + esc(t(c.note)) + '</span>' : '') + '</span></li>';
    }
    h += '</ul>';
    if (S.doc.unsupported.length) {
      h += '<h3 class="mt-5 text-sm font-semibold">' + esc(t('Not analyzed')) + '</h3><ul class="mt-1.5 space-y-1.5">';
      for (const u of S.doc.unsupported) h += '<li class="text-xs"><b>' + esc(t(u.label)) + '</b><span class="block text-slate-500">' + esc(t(u.note)) + '</span></li>';
      h += '</ul>';
    }
    $('tabChecks').innerHTML = h;
  }

  function setTab(name) {
    $('tabDoc').classList.toggle('hidden', name !== 'doc');
    $('tabChecks').classList.toggle('hidden', name !== 'checks');
    document.querySelectorAll('.tabBtn').forEach(b => {
      const on = b.dataset.tab === name;
      b.className = 'tabBtn rounded-md px-3 py-1 font-medium ' + (on ? 'bg-teal-50 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800');
    });
  }
  document.querySelectorAll('.tabBtn').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // ------------------------------------------------------------------ preview
  function renderPreview() {
    if (S.doc.format === 'pdf') renderPdfPreview(); else renderDocxPreview();
  }
  function decoratePreview() {
    if (S.doc.format === 'pdf') drawBoxesAll(); else renderDocxPreview();
  }

  // ---- DOCX: segments in order, findings as marks
  function renderDocxPreview() {
    const byseg = new Map();
    for (const f of S.findings) if (f.segId && f.start != null) { if (!byseg.has(f.segId)) byseg.set(f.segId, []); byseg.get(f.segId).push(f); }
    const mark = (seg) => {
      const hits = (byseg.get(seg.id) || []).slice().sort((a, b) => a.start - b.start);
      let out = '', pos = 0;
      for (const f of hits) {
        if (f.start < pos) continue;
        out += esc(seg.text.slice(pos, f.start)) + '<mark class="ex-mk sev-' + f.sev + '" data-fid="' + f.id + '" title="' + esc(t(f.title)) + '">' + esc(seg.text.slice(f.start, f.end)) + '</mark><span class="ex-tag" data-fid="' + f.id + '"></span>';
        pos = f.end;
      }
      return out + esc(seg.text.slice(pos));
    };
    const body = [], extra = [];
    const segs = S.doc.segments;
    const CAP = 1500;
    let n = 0;
    for (const seg of segs) {
      if (seg.para) {
        if (n++ > CAP) continue;
        const cls = seg.visible ? '' : (seg.kind === 'deleted' ? 'ex-hid ex-hid-del' : 'ex-hid');
        const tag = seg.visible ? '' : '<span class="mr-1 text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300">' + esc(t(seg.kind === 'deleted' ? 'deleted' : seg.kind === 'lookalike' ? 'hard to see' : 'hidden')) + '</span>';
        body.push('<p class="ex-seg my-1.5 ' + cls + '" id="seg-' + seg.id + '" data-seg="' + seg.id + '">' + tag + mark(seg) + '</p>');
      } else if (seg.text) {
        extra.push('<div class="ex-seg rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900" id="seg-' + seg.id + '"><div class="mb-0.5 text-[10px] font-semibold uppercase text-slate-400">' + esc(seg.where || seg.kind) + '</div>' + mark(seg) + '</div>');
      }
    }
    let h = '<div class="ex-doc mx-auto max-w-2xl rounded-lg bg-white p-6 text-[13px] leading-relaxed shadow dark:bg-slate-900">' + (body.join('') || '<p class="text-slate-400">' + esc(t('This document has no text.')) + '</p>') + (n > CAP ? '<p class="mt-3 text-xs text-slate-400">' + esc(t('Preview shortened; all text was still inspected.')) + '</p>' : '') + '</div>';
    if (extra.length) h += '<h3 class="mx-auto mt-5 max-w-2xl text-xs font-semibold uppercase tracking-wide text-slate-500">' + esc(t('Stored in the file but not in the page text')) + '</h3><div class="mx-auto mt-2 max-w-2xl space-y-1.5 text-[12px]">' + extra.slice(0, 400).join('') + '</div>';
    $('tabDoc').innerHTML = h;
    $('tabDoc').querySelectorAll('.ex-mk').forEach(m => m.addEventListener('click', () => focusCard(m.dataset.fid)));
    tagMarks();
  }

  // ---- PDF: canvases rendered lazily, boxes over findings that have a position
  function renderPdfPreview() {
    const pdf = S.doc._pdf;
    const box = $('tabDoc');
    box.innerHTML = '';
    S.rendered.clear();
    if (S.observer) S.observer.disconnect();
    const limit = S.doc.meta.analyzedPages;
    const holders = [];
    pdf.getPage(1).then(p0 => {
      const baseW = Math.min(box.clientWidth - 32 || 560, 760);
      for (let pn = 1; pn <= limit; pn++) {
        const d = document.createElement('div');
        d.className = 'ex-page'; d.dataset.page = pn;
        d.style.width = baseW + 'px';
        d.style.height = Math.round(baseW * (p0.view[3] - p0.view[1]) / (p0.view[2] - p0.view[0])) + 'px';
        box.appendChild(d); holders.push(d);
      }
      S.observer = new IntersectionObserver(entries => {
        for (const en of entries) if (en.isIntersecting) { const pn = +en.target.dataset.page; if (!S.rendered.has(pn)) renderPdfPage(pn, en.target, baseW); }
      }, { root: box, rootMargin: '400px' });
      holders.forEach(h => S.observer.observe(h));
    });
  }
  async function renderPdfPage(pn, holder, baseW) {
    S.rendered.add(pn);
    try {
      const page = await S.doc._pdf.getPage(pn);
      const v1 = page.getViewport({ scale: 1 });
      const scale = baseW / v1.width;
      const vp = page.getViewport({ scale: scale * Math.min(2, window.devicePixelRatio || 1) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      holder.style.height = '';
      holder.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      holder._vp = page.getViewport({ scale });
      drawBoxes(holder);
      page.cleanup();
    } catch (e) {
      S.rendered.delete(pn);
      holder.insertAdjacentHTML('beforeend', '<div class="p-4 text-xs text-rose-600">' + esc(t('This page could not be drawn.')) + '</div>');
    }
  }
  function drawBoxes(holder) {
    if (!holder._vp) return;
    holder.querySelectorAll('.ex-box').forEach(b => b.remove());
    const pn = +holder.dataset.page;
    for (const f of S.findings) {
      const r = f.rect;
      if (!r || r.page !== pn) continue;
      const [x0, y0, x1, y1] = holder._vp.convertToViewportRectangle([r.x0, r.y0, r.x1, r.y1]);
      const b = document.createElement('div');
      b.className = 'ex-box sev-' + f.sev; b.dataset.fid = f.id; b.title = t(f.title);
      Object.assign(b.style, { left: Math.min(x0, x1) - 2 + 'px', top: Math.min(y0, y1) - 2 + 'px', width: Math.abs(x1 - x0) + 4 + 'px', height: Math.abs(y1 - y0) + 4 + 'px' });
      b.addEventListener('click', () => focusCard(f.id));
      holder.appendChild(b);
    }
    tagMarks(holder);
  }
  function drawBoxesAll() { $('tabDoc').querySelectorAll('.ex-page').forEach(drawBoxes); }

  // ---- locate / focus
  function flash(el) { if (!el) return; el.classList.add('ex-flash'); setTimeout(() => el.classList.remove('ex-flash'), 1800); }
  function focusCard(id) {
    S.cls = 'all'; S.q = ''; $('q').value = '';
    S.limit = Math.max(S.limit, S.findings.length);
    renderChips(); renderList();
    const el = [...$('list').querySelectorAll('.ex-card')].find(c => (c.dataset.group || c.dataset.fid).split(',').includes(id));
    if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); flash(el); }
  }
  function locate(id) {
    const f = S.findings.find(x => x.id === id);
    if (!f) return;
    setTab('doc');
    if (S.doc.format === 'pdf') {
      const pn = (f.rect && f.rect.page) || f.page;
      const holder = $('tabDoc').querySelector('.ex-page[data-page="' + pn + '"]');
      if (!holder) { Ex.toast(t('This finding is not tied to a place on a page.'), 'warn'); return; }
      holder.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(() => flash(holder.querySelector('.ex-box[data-fid="' + id + '"]')), 500);
    } else {
      const el = f.segId ? $('seg-' + f.segId) : null;
      const m = $('tabDoc').querySelector('mark[data-fid="' + id + '"]');
      if (el || m) { (m || el).scrollIntoView({ block: 'center', behavior: 'smooth' }); flash(m || el); }
      else Ex.toast(t('This finding is about the file itself, not a place in the text. See the details on the card.'), 'warn', 4500);
    }
  }

  // ------------------------------------------------------------------ report (never contains the sensitive values)
  $('btnReport').addEventListener('click', () => {
    const counts = {};
    for (const f of S.findings) {
      const k = f.type + '|' + f.cls + '|' + f.sev;
      counts[k] = (counts[k] || 0) + (f.count || 1);
    }
    const report = {
      tool: 'Exposift', version: VERSION, report: 'inspection', analyzed_at: new Date().toISOString(),
      document: { name: S.file.name, format: S.doc.format, bytes: S.file.size, sha256: S.hash },
      review: S.ctx ? { mode: 'purpose', document_type: S.ctx.docType, purpose: S.ctx.purpose, recipient: S.ctx.audience } : { mode: 'quick' },
      checks: S.doc.checks.map(c => ({ id: c.id, status: c.status, note: c.note || undefined })),
      not_analyzed: S.doc.unsupported.map(u => ({ id: u.id, label: u.label })),
      findings: Object.entries(counts).map(([k, n]) => { const [type, cls, sev] = k.split('|'); return { type, class: cls, severity: sev, count: n }; }),
      decisions: Object.values(S.decisions).reduce((a, v) => { a[v] = (a[v] || 0) + 1; return a; }, {}),
      sanitized: false,
      limitations: [
        'Inspection only: the file was not modified and no output was verified.',
        'Detections are indications with a confidence level, not proof.',
        'Text inside images is not analyzed.',
        'This report is not legal advice and gives no guarantee that a file is safe to share.'
      ],
      sensitive_values_included: false
    };
    Ex.download('exposift-report-' + S.file.name.replace(/[^\w.-]+/g, '_') + '.json', JSON.stringify(report, null, 2));
  });

  // ====================================================================== sanitize + verify (steps 3 and 4)
  // The PDF method is derived from the chosen items: page content forces a rebuild, otherwise only structure is cleaned.
  const pdfModeVal = () => S.pmodeAuto || 'clean';
  const currentPlan = () => Ex.plan.build(S.findings, S.decisions, S.doc.format, pdfModeVal());

  $('btnRecommend').addEventListener('click', () => {
    const rec = Ex.plan.recommended(S.findings, S.ctx);
    for (const f of rec) S.decisions[f.id] = 'remove';
    renderList(); renderDecisions();
    Ex.toast(t('{n} finding(s) marked for removal. Look through them, then continue.', { n: cardReps(rec).length }));
  });
  $('btnContinue').addEventListener('click', () => {
    if (!Object.values(S.decisions).includes('remove')) { Ex.toast(t('Mark at least one finding with "Remove" first.'), 'warn'); return; }
    $('resultBox').classList.add('hidden'); $('resultBox').innerHTML = '';
    if (S.doc.format === 'pdf') { S.pmodeAuto = 'clean'; S.pmodeAuto = 'clean'; if (currentPlan().blocked.length) { S.pmodeAuto = 'redact'; if (currentPlan().blocked.length) S.pmodeAuto = 'flatten'; } }
    const pn = $('pdfModeNote');
    pn.classList.toggle('hidden', S.doc.format !== 'pdf');
    pn.textContent = pdfModeVal() === 'redact' ? t('Chosen values on the pages are taken out of the page text and covered with a black box; the rest of every page stays as it is (text search and copying still work). If the result cannot be verified, every page is rebuilt as a picture instead.') : pdfModeVal() === 'flatten' ? t('Some chosen items are on the page itself, so every page will be rebuilt as a picture: chosen values are covered and hidden content is gone, but text search, copying and accessibility are lost. Go back and unmark those items to keep the pages as they are.') : t('Only metadata, notes, attachments and similar parts are removed; the pages themselves are not changed.');
    renderPlan();
    show('viewOut');
  });
  $('outBack').addEventListener('click', () => show('viewWork'));

  function groupCount(list, get) {
    const m = new Map();
    for (const x of list) { const f = get(x); m.set(f.title, (m.get(f.title) || 0) + (f.count || 1)); }
    return [...m.entries()];
  }
  function renderPlan() {
    const plan = currentPlan();
    const li = (rows, tone) => rows.map(([title, n]) => '<li class="flex justify-between gap-3"><span>' + esc(t(title)) + '</span><span class="' + tone + '">×' + n + '</span></li>').join('');
    // Split what is removed into the file's structure (metadata, attachments, ...) and what is inside the file (text on the pages).
    const inContent = f => {
      if (S.doc.format !== 'pdf') return f.segId != null;
      if (f._ct === undefined) f._ct = Ex.plan.build([f], { [f.id]: 'remove' }, 'pdf', 'clean').blocked.length > 0;
      return f._ct;
    };
    const group = (title, list) => list.length ? '<div class="mt-2 first:mt-0"><div class="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">' + esc(t(title)) + ' · ' + list.length + '</div><ul class="space-y-0.5 text-sm">' + li(groupCount(list, f => f), 'text-slate-400') + '</ul></div>' : '';
    const structAct = plan.actions.filter(f => !inContent(f)), contentAct = plan.actions.filter(inContent);
    let h = '<div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div class="mb-2 text-sm font-semibold text-teal-700 dark:text-teal-300">'
      + esc(t('Will be removed')) + ' · ' + plan.actions.length + '</div>'
      + (group('File structure', structAct) + group('File contents', contentAct) || '<div class="text-sm text-slate-400">–</div>') + '</div>';
    if (plan.blocked.length) {
      h += '<div class="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10"><div class="mb-1 text-sm font-semibold text-amber-800 dark:text-amber-200">'
        + esc(t('Cannot be removed with this method')) + ' · ' + plan.blocked.length + '</div><ul class="space-y-1 text-sm">'
        + plan.blocked.slice(0, 30).map(b => '<li><b>' + esc(t(b.f.title)) + '</b> <span class="text-xs text-slate-500">' + esc(t(b.f.where || '')) + '</span><span class="block text-xs text-amber-800 dark:text-amber-200">' + esc(t(b.why)) + '</span></li>').join('')
        + '</ul><p class="mt-2 text-xs">' + esc(t('These stay in the file. The result will be marked "partly cleaned", not verified.')) + '</p></div>';
    }
    const stat = f => ({ keep: 'Keep', later: 'Not now' }[S.decisions[f.id]] || 'Not reviewed');
    const leftRows = plan.left.map(f => '<li class="flex justify-between gap-3"><span>' + esc(t(f.title)) + (f.where ? ' <span class="text-xs text-slate-400">' + esc(t(f.where)) + '</span>' : '') + '</span><span class="text-xs text-slate-400">' + esc(t(stat(f))) + '</span></li>').join('');
    h += '<div class="rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900"><div class="mb-1 font-semibold">' + esc(t('Left as they are')) + ' · ' + plan.left.length + '</div>'
      + (leftRows ? '<ul class="mb-2 space-y-0.5">' + leftRows + '</ul>' : '') + '<p class="text-xs text-slate-500">'
      + esc(t('Findings you kept, postponed or did not review are not touched.')) + (plan.values.length && S.doc.format !== 'pdf' ? ' ' + esc(t('A value chosen for removal is replaced everywhere it appears in the file.')) : '') + '</p></div>';
    $('planBox').innerHTML = h;
    $('btnClean').disabled = plan.actions.length === 0;
    S.plan = plan;
  }

  // ---- flatten helpers (PDF.js drawing)
  async function drawPage(pdf, pn, scale, rects) {
    const page = await pdf.getPage(pn);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const c2 = canvas.getContext('2d', { willReadFrequently: true });
    c2.fillStyle = '#fff'; c2.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: c2, viewport: vp }).promise;
    const boxes = (rects || []).map(r => { const [x0, y0, x1, y1] = vp.convertToViewportRectangle([r.x0, r.y0, r.x1, r.y1]); return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }; });
    page.cleanup();
    return { canvas, c2, v1, boxes };
  }
  const flattenHooks = {
    async renderPage(pn, rects) {
      const { canvas, c2, v1, boxes } = await drawPage(S.doc._pdf, pn, 2, rects);
      c2.fillStyle = '#000';
      for (const b of boxes) c2.fillRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
      return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: v1.width, height: v1.height };
    }
  };
  async function coverage(outBytes, rects) {
    const pdf = await S.pdfjs.getDocument({ data: outBytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
    let worst = 1;
    try {
      const byPage = new Map();
      for (const r of rects) { if (!byPage.has(r.page)) byPage.set(r.page, []); byPage.get(r.page).push(r); }
      for (const [pn, rs] of byPage) {
        const { c2, boxes } = await drawPage(pdf, pn, 2, rs);
        for (const b of boxes) {
          const w = Math.max(1, Math.floor(b.w)), h = Math.max(1, Math.floor(b.h));
          const d = c2.getImageData(Math.max(0, Math.floor(b.x)), Math.max(0, Math.floor(b.y)), w, h).data;
          let dark = 0;
          for (let i = 0; i < d.length; i += 4) if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 60) dark++;
          worst = Math.min(worst, dark / (d.length / 4));
        }
      }
    } finally { await pdf.destroy(); }
    return worst;
  }

  $('btnClean').addEventListener('click', async () => {
    let plan = currentPlan();
    if (!plan.actions.length) return;
    $('btnClean').disabled = true;
    const busy = (m) => { $('cleanBusy').classList.remove('hidden'); $('cleanBusy').textContent = m; };
    try {
      busy(t('Cleaning…'));
      await new Promise(r => setTimeout(r, 30));
      const docOptions = { standardFontDataUrl: new URL('assets/vendor/pdfjs/standard_fonts/', document.baseURI).href, cMapUrl: new URL('assets/vendor/pdfjs/cmaps/', document.baseURI).href, cMapPacked: true };
      const run = async (pl) => {
        let r;
        if (S.doc.format !== 'pdf') r = Ex.adapters[S.doc.format].sanitize(S.bytes, pl);
        else if (pl.key === 'pdf_flatten') r = await Ex.adapters.pdf.sanitize.flatten(S.bytes, pl, S.doc.meta.pages, flattenHooks);
        else if (pl.key === 'pdf_redact') r = await Ex.adapters.pdf.sanitize.redact(S.bytes, pl);
        else r = await Ex.adapters.pdf.sanitize.clean(S.bytes, pl);
        busy(t('Verifying the cleaned file with a separate reader…'));
        await new Promise(r2 => setTimeout(r2, 30));
        const v = S.doc.format !== 'pdf'
          ? await Ex.adapters[S.doc.format].verify(r.bytes, pl, { names: S.names })
          : await Ex.adapters.pdf.verify(r.bytes, pl, S.pdfjs, { names: S.names, pageCount: S.doc.meta.pages, docOptions, coverage });
        return { res: r, ver: v };
      };
      let { res, ver } = await run(plan);
      if (plan.key === 'pdf_redact' && ver.status === 'failed') {
        // the text could not be removed reliably (unsupported font or encoding): rebuild every page as a picture instead
        busy(t('Text removal could not be verified for this file. Rebuilding every page as a picture instead…'));
        plan = Ex.plan.build(S.findings, S.decisions, 'pdf', 'flatten');
        ({ res, ver } = await run(plan));
        res.ops = [t('Text removal from the page could not be verified for this file, so every page was rebuilt as a picture instead')].concat(res.ops);
      }
      const hash = await Ex.util.sha256(res.bytes);
      S.out = { bytes: res.bytes, ver, plan, ops: res.ops, hash, name: S.file.name.replace(/(\.[^.]+)?$/, '-cleaned$1') };
      renderResult();
    } catch (e) {
      console.error(e);
      $('resultBox').classList.remove('hidden');
      $('resultBox').innerHTML = '<div class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"><b>' + esc(t('The cleaned file could not be created')) + '</b><p class="mt-1">' + esc(e.message || String(e)) + '</p></div>';
    } finally { $('cleanBusy').classList.add('hidden'); $('btnClean').disabled = false; }
  });

  function renderResult() {
    const o = S.out, v = o.ver;
    const tone = { verified: ['border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200', 'Verified'],
      partial: ['border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200', 'Partly cleaned: some chosen items could not be removed'],
      failed: ['border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200', 'Verification failed'] }[v.status];
    const ICON = { pass: ['✓', 'text-emerald-600'], fail: ['✗', 'text-rose-600'], info: ['i', 'text-slate-400'] };
    let h = '<div class="rounded-2xl border p-4 ' + tone[0] + '"><div class="text-base font-semibold">' + esc(t(tone[1])) + '</div><p class="mt-1 text-xs">'
      + esc(v.status === 'verified' ? t('The cleaned file was reopened by a separate reader and the removed items were not found. This is a strong check, not a guarantee: pictures were not read.')
        : v.status === 'partial' ? t('The checks passed for what was removed, but items you chose are still in the file. It is not labelled verified.')
        : t('At least one check failed. Do not treat this file as cleaned.')) + '</p></div>';
    h += '<div class="mt-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div class="mb-2 text-sm font-semibold">' + esc(t('Verification report')) + '</div><ul class="space-y-1.5 text-sm">';
    for (const c of v.checks) { const [ic, tn] = ICON[c.status] || ICON.info; h += '<li class="flex gap-2"><span class="w-4 text-center font-bold ' + tn + '">' + ic + '</span><span>' + esc(t(c.label)) + (c.detail ? '<span class="block text-xs text-slate-500">' + esc(c.detail) + '</span>' : '') + '</span></li>'; }
    h += '</ul></div>';
    {
      const done = (o.plan.actions || []).map(f => '<li class="flex gap-2"><span class="w-4 text-center font-bold text-emerald-600">✓</span><span class="flex-1">' + esc(t(f.title)) + (f.where ? ' <span class="text-xs text-slate-400">' + esc(t(f.where)) + '</span>' : '') + '</span><span class="text-xs text-emerald-700 dark:text-emerald-400">' + esc(t('Removed')) + '</span></li>');
      const stay = (o.plan.blocked || []).map(b => '<li class="flex gap-2"><span class="w-4 text-center font-bold text-amber-600">!</span><span class="flex-1">' + esc(t(b.f.title)) + (b.f.where ? ' <span class="text-xs text-slate-400">' + esc(b.f.where) + '</span>' : '') + '</span><span class="text-xs text-amber-700 dark:text-amber-400">' + esc(t('Still in the file')) + '</span></li>');
      if (done.length + stay.length) h += '<div class="mt-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div class="mb-2 text-sm font-semibold">' + esc(t('Result for each chosen item')) + '</div><ul class="space-y-1 text-sm">' + done.join('') + stay.join('') + '</ul></div>';
    }
    h += '<div class="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900"><div class="mb-1 font-semibold">' + esc(t('What was done')) + '</div><ul class="list-disc space-y-0.5 pl-5 text-xs text-slate-600 dark:text-slate-400">'
      + o.ops.map(x => '<li>' + esc(t(x)) + '</li>').join('') + '</ul><div class="mt-2 break-all font-mono text-[11px] text-slate-500">SHA-256 ' + esc(o.hash) + ' · ' + esc(Ex.util.fmtBytes(o.bytes.length)) + '</div></div>';
    h += '<div class="mt-3 flex flex-wrap gap-2"><button type="button" id="btnGet" class="rounded-lg ' + (v.status === 'verified' ? 'bg-teal-600 text-white hover:bg-teal-700' : 'border border-rose-300 text-rose-700 hover:bg-rose-50') + ' px-4 py-2 text-sm font-medium">'
      + esc(v.status === 'verified' ? t('Download the cleaned file') : t('Download anyway (not verified)')) + '</button>'
      + '<button type="button" id="btnReceipt" class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">' + esc(t('Privacy Receipt')) + '</button></div>';
    const box = $('resultBox'); box.innerHTML = h; box.classList.remove('hidden');
    $('btnGet').addEventListener('click', () => Ex.download(o.name, o.bytes, S.doc.format === 'pdf' ? 'application/pdf' : MIME[S.doc.format]));
    $('btnReceipt').addEventListener('click', downloadReceipt);
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- Privacy Receipt: no sensitive values, only what was done and what was checked
  function downloadReceipt() {
    const o = S.out;
    const byType = (list) => { const m = {}; for (const f of list) m[f.type] = (m[f.type] || 0) + (f.count || 1); return m; };
    const receipt = {
      tool: 'Exposift', version: VERSION, report: 'privacy-receipt', created_at: new Date().toISOString(),
      input: { name: S.file.name, format: S.doc.format, bytes: S.file.size, sha256: S.hash },
      output: { name: o.name, bytes: o.bytes.length, sha256: o.hash },
      method: o.plan.key,
      review: S.ctx ? { mode: 'purpose', document_type: S.ctx.docType, purpose: S.ctx.purpose, recipient: S.ctx.audience } : { mode: 'quick' },
      approved_removals: byType(o.plan.actions),
      not_removed_by_method: byType(o.plan.blocked.map(b => b.f)),
      left_in_file_by_choice: byType(o.plan.left),
      operations: o.ops,
      verification: { status: o.ver.status, engine: 'separate reader (PDF.js / raw package scan)', checks: o.ver.checks.map(c => ({ id: c.id, label: c.label, result: c.status, detail: c.detail || undefined })) },
      not_checked: S.doc.unsupported.map(u => u.label),
      ai_requests: S.aiLog,
      limitations: [
        'Verification is a strong technical check, not a guarantee.',
        'Text inside pictures is not analyzed.',
        'This receipt is not legal advice and gives no assurance that sharing the file is lawful or safe.'
      ],
      sensitive_values_included: false
    };
    Ex.download('exposift-receipt-' + S.file.name.replace(/[^\w.-]+/g, '_') + '.json', JSON.stringify(receipt, null, 2));
  }
})();
