/*
 * Exposift – PDF sanitizer (EXP-005) and independent verifier (EXP-006). No MuPDF: pdf-lib + PDF.js.
 *
 *  "Clean structure"   edits the PDF object graph (metadata, notes, attachments, scripts, bookmarks) and then
 *                      drops every object that is no longer reachable, which also removes earlier versions.
 *                      Page content is kept exactly as it is.
 *  "Flatten & rebuild" draws every page as a picture (after covering the chosen values) and builds a new PDF
 *                      from the pictures. Text search, accessibility, forms and signatures are lost.
 *
 * The verifier reopens the output with PDF.js (a different reader than the writer) and searches text,
 * metadata, annotations, attachments and the decompressed raw streams for the removed values.
 */
(function (g) {
  'use strict';
  const Ex = g.Ex = g.Ex || {};
  const fold = (s) => Ex.detectUtil.fold(s);

  // ---------------------------------------------------------------- clean structure
  async function cleanPdf(bytes, plan, opts = {}) {
    const L = g.PDFLib;
    if (!L) throw new Error('pdf-lib is not loaded');
    const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFStream } = L;
    const T = plan.structTypes;
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: false, throwOnInvalidObject: false });
    const ctx = doc.context;
    const cat = doc.catalog;
    const ops = [];
    const N = (s) => PDFName.of(s);
    const dict = (o) => (o instanceof PDFRef ? ctx.lookup(o) : o);

    // metadata
    const metaChosen = [...T].filter(t => t.startsWith('meta.'));
    if (metaChosen.length) {
      const infoRef = ctx.trailerInfo.Info;
      const info = infoRef ? ctx.lookup(infoRef) : null;
      const KEYS = { 'meta.author': ['Author'], 'meta.title': ['Title', 'Subject', 'Keywords'], 'meta.software': ['Creator', 'Producer'], 'meta.dates': ['CreationDate', 'ModDate'], 'meta.org': [], 'meta.path': [] };
      if (info instanceof PDFDict) {
        for (const t of metaChosen) for (const k of KEYS[t] || []) info.delete(N(k));
        if (T.has('meta.custom')) {
          const std = new Set(['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped']);
          for (const [k] of info.entries()) { const nm = k.decodeText ? k.decodeText() : String(k).replace(/^\//, ''); if (!std.has(nm)) info.delete(k); }
        }
      }
      // XMP is one block that repeats the same facts, so it goes entirely
      if (cat.has(N('Metadata'))) { cat.delete(N('Metadata')); ops.push('XMP metadata removed'); }
      ops.push('Document information cleared');
    }

    const pages = doc.getPages();
    const isJs = (a) => { const d = dict(a); return d instanceof PDFDict && ['JavaScript', 'Launch', 'SubmitForm', 'ImportData'].includes((d.get(N('S')) || {}).encodedName ? d.get(N('S')).encodedName.slice(1) : ''); };

    if (T.has('annotation')) {
      let n = 0;
      for (const p of pages) {
        const arr = dict(p.node.get(N('Annots')));
        if (!(arr instanceof PDFArray)) continue;
        const keep = [];
        for (let i = 0; i < arr.size(); i++) {
          const a = dict(arr.get(i));
          const st = a instanceof PDFDict && a.get(N('Subtype')) ? a.get(N('Subtype')).encodedName : '';
          if (st === '/Link' || st === '/Widget' || st === '/FileAttachment') keep.push(arr.get(i)); else n++;
        }
        if (keep.length) p.node.set(N('Annots'), ctx.obj(keep)); else p.node.delete(N('Annots'));
      }
      ops.push(n + ' note(s) and markup annotation(s) removed');
    }
    if (T.has('embedded')) {
      const names = dict(cat.get(N('Names')));
      if (names instanceof PDFDict) names.delete(N('EmbeddedFiles'));
      cat.delete(N('AF'));
      for (const p of pages) {
        p.node.delete(N('AF'));
        const arr = dict(p.node.get(N('Annots')));
        if (arr instanceof PDFArray) {
          const keep = [];
          for (let i = 0; i < arr.size(); i++) { const a = dict(arr.get(i)); const st = a instanceof PDFDict && a.get(N('Subtype')) ? a.get(N('Subtype')).encodedName : ''; if (st !== '/FileAttachment') keep.push(arr.get(i)); }
          if (keep.length) p.node.set(N('Annots'), ctx.obj(keep)); else p.node.delete(N('Annots'));
        }
      }
      ops.push('Embedded files removed');
    }
    if (T.has('macro')) {
      cat.delete(N('OpenAction')); cat.delete(N('AA'));
      const names = dict(cat.get(N('Names')));
      if (names instanceof PDFDict) names.delete(N('JavaScript'));
      for (const p of pages) {
        p.node.delete(N('AA'));
        const arr = dict(p.node.get(N('Annots')));
        if (arr instanceof PDFArray) for (let i = 0; i < arr.size(); i++) { const a = dict(arr.get(i)); if (a instanceof PDFDict) { if (a.has(N('A')) && isJs(a.get(N('A')))) a.delete(N('A')); a.delete(N('AA')); } }
      }
      const form = dict(cat.get(N('AcroForm')));
      if (form instanceof PDFDict) form.delete(N('XFA'));
      ops.push('Scripts and actions removed');
    }
    if (T.has('hidden.outline')) { cat.delete(N('Outlines')); ops.push('Bookmarks removed'); }

    if (opts.pre) await opts.pre(doc, ops);

    // drop everything that is no longer reachable: this is what removes earlier versions and orphaned objects
    const seen = new Set();
    const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(Boolean);
    while (stack.length) {
      const o = stack.pop();
      if (o instanceof PDFRef) { const key = o.toString(); if (seen.has(key)) continue; seen.add(key); const t = ctx.lookup(o); if (t) stack.push(t); }
      else if (o instanceof PDFDict) for (const [, v] of o.entries()) stack.push(v);
      else if (o instanceof PDFArray) for (let i = 0; i < o.size(); i++) stack.push(o.get(i));
      else if (o instanceof PDFStream) stack.push(o.dict);
    }
    let dropped = 0;
    for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.toString())) { ctx.delete(ref); dropped++; }
    ops.push('File rewritten from scratch; ' + dropped + ' unreachable object(s) dropped (earlier versions included)');

    const out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false, addDefaultPage: false });
    return { bytes: out, ops };
  }

  // ---------------------------------------------------------------- flatten & rebuild
  /**
   * hooks.renderPage(pageNumber, rectsOfThatPage) -> { jpeg: Uint8Array, width, height }   (width/height in PDF points)
   */
  async function flattenPdf(bytes, plan, pageCount, hooks) {
    const L = g.PDFLib;
    const out = await L.PDFDocument.create({ updateMetadata: false });
    const byPage = new Map();
    for (const r of plan.rects) { if (!byPage.has(r.page)) byPage.set(r.page, []); byPage.get(r.page).push(r); }
    for (let pn = 1; pn <= pageCount; pn++) {
      const { jpeg, width, height } = await hooks.renderPage(pn, byPage.get(pn) || []);
      const img = await out.embedJpg(jpeg);
      const page = out.addPage([width, height]);
      page.drawImage(img, { x: 0, y: 0, width, height });
    }
    const covered = plan.rects.length;
    return {
      bytes: await out.save({ useObjectStreams: false, addDefaultPage: false }),
      ops: ['Every page was drawn as a picture and the PDF rebuilt from the pictures (text, metadata, notes, attachments, scripts, layers and earlier versions are gone)']
        .concat(covered ? [covered + ' area(s) covered with a black box before drawing'] : [])
    };
  }

  // ---------------------------------------------------------------- verification
  /** Decompressed content of every Flate stream, as latin1 strings (capped) */
  function rawStreamTexts(bytes) {
    const latin1 = new TextDecoder('latin1');
    const s = latin1.decode(bytes);
    const out = [s];
    let i = 0, n = 0, total = 0;
    while (n < 4000 && total < 200 * 1048576) {
      const a = s.indexOf('stream', i);
      if (a === -1) break;
      let start = a + 6; if (s[start] === '\r') start++; if (s[start] === '\n') start++;
      const b = s.indexOf('endstream', start);
      if (b === -1) break;
      i = b + 9; n++;
      try { const inflated = g.fflate.unzlibSync(bytes.subarray(start, b)); total += inflated.length; out.push(latin1.decode(inflated)); } catch (e) { /* not a Flate stream */ }
    }
    return out;
  }

  async function verifyPdf(outBytes, plan, pdfjs, opts = {}) {
    const checks = [];
    const add = (id, label, status, detail = '') => checks.push({ id, label, status, detail });
    let doc2;
    try {
      doc2 = await Ex.adapters.pdf.read(outBytes, 'cleaned.pdf', pdfjs, { docOptions: opts.docOptions });
      add('open', 'The cleaned file opens as a valid PDF', 'pass');
    } catch (e) { add('open', 'The cleaned file opens as a valid PDF', 'fail', e.message); return Ex.verifyUtil.finish(checks, plan, null); }
    if (doc2._pdf) { try { await doc2._pdf.destroy(); } catch (e) { /* ignore */ } }

    if (opts.pageCount != null) add('pages', 'Page count is unchanged', doc2.meta.pages === opts.pageCount ? 'pass' : 'fail', doc2.meta.pages + ' of ' + opts.pageCount);

    const left = Ex.analyze(doc2, null, opts.names || []);
    const still = [...plan.structTypes].map(tp => [tp, left.filter(f => f.type === tp).length]).filter(x => x[1] > 0);
    if (plan.key === 'pdf_flatten') {
      const loose = left.filter(f => ['meta.author', 'meta.org', 'meta.software', 'meta.title', 'meta.custom', 'annotation', 'embedded', 'macro', 'hidden.layer', 'incremental', 'removed_text', 'form_field'].includes(f.type));
      add('struct', 'No metadata, notes, attachments, scripts, layers or earlier versions remain', loose.length ? 'fail' : 'pass', loose.map(f => f.type).join(', '));
      const text = doc2.segments.map(s => s.text).join('').replace(/\s+/g, '');
      add('text', 'No extractable text remains (pages are pictures)', text.length ? 'fail' : 'pass', text.length ? text.length + ' character(s) still extractable' : '');
    } else {
      add('struct', 'Selected kinds of hidden content are gone', still.length ? 'fail' : 'pass', still.map(x => x[0] + ' ×' + x[1]).join(', '));
    }

    const values = plan.values.map(fold).filter(v => v.length >= 2);
    if (values.length) {
      const hay = [];
      for (const s of doc2.segments) hay.push(fold(s.text));
      for (const f of doc2.findings) { if (f.value) hay.push(fold(String(f.value))); if (f.items) for (const it of f.items) hay.push(fold(it.k + ' ' + it.v)); }
      let raw = [];
      try { raw = rawStreamTexts(outBytes).map(fold); } catch (e) { /* the text view above still applies */ }
      const found = new Set();
      values.forEach((v, i) => {
        if (hay.some(h => h.includes(v))) found.add(i + ' (extracted text)');
        else if (raw.some(h => h.includes(v))) found.add(i + ' (raw stream)');
      });
      add('values', 'Removed values are not found: extracted text, metadata, notes, attachments, raw streams', found.size ? 'fail' : 'pass',
        found.size ? [...found].slice(0, 5).map(x => 'value #' + (parseInt(x, 10) + 1) + ' in ' + x.replace(/^\d+ /, '')).join('; ') : values.length + ' value(s) searched');
    } else add('values', 'Removed values are not found', 'info', 'No values were selected for removal.');

    if (plan.key === 'pdf_flatten' && plan.rects.length) {
      if (opts.coverage) {
        try {
          const worst = await opts.coverage(outBytes, plan.rects);
          add('pixels', 'Covered areas are solid black in the rendered output', worst >= 0.97 ? 'pass' : 'fail', 'darkest-check ratio ' + worst.toFixed(3));
        } catch (e) { add('pixels', 'Covered areas are solid black in the rendered output', 'fail', e.message); }
      } else add('pixels', 'Covered areas are solid black in the rendered output', 'info', 'Not run in this environment.');
    }
    add('scope', 'Not checked: text drawn inside pictures', 'info', 'Pictures are not read in this version.');
    return Ex.verifyUtil.finish(checks, plan, left);
  }

  Ex.adapters.pdf.sanitize = { clean: cleanPdf, flatten: flattenPdf };
  Ex.adapters.pdf.verify = verifyPdf;
  if (typeof module !== 'undefined' && module.exports) module.exports = Ex;
})(typeof window !== 'undefined' ? window : globalThis);
