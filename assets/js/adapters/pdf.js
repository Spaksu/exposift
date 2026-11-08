/*
 * Exposift – PDF adapter (inspection) on top of PDF.js.
 *
 * What PDF.js cannot show us (compressed object streams, content-stream details) is covered by a
 * raw byte scan, and every limit is reported in doc.checks / doc.unsupported instead of being skipped.
 * Earlier revisions are found by re-opening the file cut at each earlier %%EOF marker.
 */
(function (g) {
  'use strict';
  const Ex = g.Ex = g.Ex || {};

  const latin1 = new TextDecoder('latin1');
  const count = (hay, needle) => { let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; } return n; };

  const norm = s => s.replace(/\s+/g, ' ').trim();
  const lineSet = (pages) => {
    const set = new Set();
    for (const t of pages) for (const piece of t.split(/\n+/)) { const n = norm(piece).toLowerCase(); if (n.length >= 4) set.add(n); }
    return set;
  };

  /** dark fill colour -> true (RGB 0..255 or gray) */
  const isDark = (r, g2, b) => (0.299 * r + 0.587 * g2 + 0.114 * b) < 40;

  function mulMatrix(m, n) { // m applied after n  (PDF: new = n × m)
    return [
      n[0] * m[0] + n[1] * m[2], n[0] * m[1] + n[1] * m[3],
      n[2] * m[0] + n[3] * m[2], n[2] * m[1] + n[3] * m[3],
      n[4] * m[0] + n[5] * m[2] + m[4], n[4] * m[1] + n[5] * m[3] + m[5]
    ];
  }
  const applyPt = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  /** Dark filled rectangles of a page, in page user space: [{x0,y0,x1,y1}] */
  async function darkRects(page, OPS) {
    const ops = await page.getOperatorList();
    const rects = [];
    let ctm = [1, 0, 0, 1, 0, 0], fill = [0, 0, 0];
    const stack = [];
    let pending = []; // rectangles from the last constructPath
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], a = ops.argsArray[i];
      switch (fn) {
        case OPS.save: stack.push({ ctm: ctm.slice(), fill: fill.slice() }); break;
        case OPS.restore: { const s = stack.pop(); if (s) { ctm = s.ctm; fill = s.fill; } break; }
        case OPS.transform: ctm = mulMatrix(ctm, a); break;
        case OPS.setFillRGBColor: fill = [a[0], a[1], a[2]]; break;
        case OPS.setFillGray: fill = [a[0], a[0], a[0]]; break;
        case OPS.setFillColor: if (Array.isArray(a) && a.length === 3) fill = a.slice(); break;
        case OPS.setFillCMYKColor: { const [c, m, y, k] = a; fill = [255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k)]; break; }
        case OPS.constructPath: {
          // PDF.js 4 turns re / m / l / h into moveTo + lineTo + closePath; keep the bounding box of every sub-path
          pending = [];
          const pOps = a[0], coords = a[1];
          let ci = 0, pts = [];
          const flush = () => {
            if (pts.length >= 3) {
              const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
              pending.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
            }
            pts = [];
          };
          const pt = (x, y) => pts.push(applyPt(ctm, x, y));
          for (const op of pOps) {
            if (op === OPS.moveTo) { flush(); pt(coords[ci], coords[ci + 1]); ci += 2; }
            else if (op === OPS.lineTo) { pt(coords[ci], coords[ci + 1]); ci += 2; }
            else if (op === OPS.rectangle) {
              flush();
              const [x, y, w, h] = [coords[ci], coords[ci + 1], coords[ci + 2], coords[ci + 3]]; ci += 4;
              pt(x, y); pt(x + w, y); pt(x + w, y + h); pt(x, y + h); flush();
            } else if (op === OPS.curveTo) { pt(coords[ci + 4], coords[ci + 5]); ci += 6; }
            else if (op === OPS.curveTo2 || op === OPS.curveTo3) { pt(coords[ci + 2], coords[ci + 3]); ci += 4; }
          }
          flush();
          break;
        }
        case OPS.fill: case OPS.eoFill: case OPS.fillStroke: case OPS.eoFillStroke: case OPS.closeFillStroke: case OPS.closeEOFillStroke:
          if (isDark(fill[0], fill[1], fill[2])) rects.push(...pending.map(r => ({ ...r, at: i })));
          pending = [];
          break;
        case OPS.endPath: case OPS.stroke: case OPS.closeStroke: pending = []; break;
        default: break;
      }
    }
    return rects;
  }

  /** Strings shown by the page's text operators, whitespace stripped (compared with what PDF.js returns) */
  async function shownStrings(page, OPS) {
    const ops = await page.getOperatorList();
    const out = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== OPS.showText && ops.fnArray[i] !== OPS.showSpacedText) continue;
      const glyphs = ops.argsArray[i][0] || [];
      let t = '';
      for (const gl of glyphs) if (gl && typeof gl === 'object' && typeof gl.unicode === 'string') t += gl.unicode;
      const clean = t.replace(/\s+/g, '');
      if (clean.length >= 1) out.push({ t: t.trim(), at: i });
    }
    return out;
  }

  async function readPdf(bytes, name, pdfjs, hooks = {}) {
    const util = Ex.util;
    const { OPS } = pdfjs;
    const L = util.LIMITS;
    const doc = { format: 'pdf', name, size: bytes.length, segments: [], findings: [], checks: [], unsupported: [], meta: {} };
    const check = (id, label, status, note = '') => doc.checks.push({ id, label, status, note });
    const finding = (o) => doc.findings.push({ visible: false, ...o });
    let segN = 0;
    const seg = (o) => doc.segments.push({ id: 's' + (++segN), visible: true, kind: 'text', ...o });
    const progress = hooks.progress || (() => {});

    const raw = latin1.decode(bytes);
    // ---------------------------------------------------------------- open
    let pdf;
    try {
      pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, stopAtErrors: false, verbosity: 0, ...(hooks.docOptions || {}) }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new util.ExposiftError('encrypted', 'This PDF is password-protected. Remove the password first; encrypted files are not supported in this version.');
      throw new util.ExposiftError('bad_pdf', 'This PDF could not be read (' + (e && e.message ? e.message : 'invalid file') + ').');
    }
    doc._pdf = pdf;                    // kept for the preview; destroyed by the app
    const nPages = pdf.numPages;
    const pageCap = Math.min(nPages, L.pdfMaxPages);
    doc.meta = { pages: nPages, analyzedPages: pageCap };
    if (nPages > pageCap) {
      doc.unsupported.push({ id: 'pages', label: (nPages - pageCap) + ' page(s) beyond the limit', note: 'Only the first ' + pageCap + ' pages were analyzed to keep the browser responsive.' });
    }

    // ---------------------------------------------------------------- metadata
    let info = {}, xmp = null;
    try { const m = await pdf.getMetadata(); info = m.info || {}; xmp = m.metadata; } catch (e) { /* keep empty */ }
    const rows = { author: [], org: [], software: [], dates: [], title: [], custom: [], ids: [] };
    const add = (grp, k, v, where) => { v = (v == null ? '' : String(v)).trim(); if (!v) return; rows[grp].push({ k, v, where }); if (grp !== 'dates' && grp !== 'ids') seg({ text: v, visible: false, kind: 'meta', where: where + ' · ' + k }); };
    add('author', 'Author', info.Author, 'Info dictionary');
    add('title', 'Title', info.Title, 'Info dictionary');
    add('title', 'Subject', info.Subject, 'Info dictionary');
    add('title', 'Keywords', info.Keywords, 'Info dictionary');
    add('software', 'Creator', info.Creator, 'Info dictionary');
    add('software', 'Producer', info.Producer, 'Info dictionary');
    add('dates', 'Created', info.CreationDate, 'Info dictionary');
    add('dates', 'Modified', info.ModDate, 'Info dictionary');
    if (info.Custom) for (const [k, v] of Object.entries(info.Custom)) add('custom', k, v, 'Info dictionary');
    const STD = new Set(['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped', 'PDFFormatVersion', 'IsAcroFormPresent', 'IsXFAPresent', 'IsCollectionPresent', 'IsSignaturesPresent', 'Language', 'EncryptFilterName', 'Custom']);
    for (const [k, v] of Object.entries(info)) if (!STD.has(k) && typeof v === 'string') add('custom', k, v, 'Info dictionary');
    if (xmp) {
      try {
        const all = typeof xmp.getAll === 'function' ? xmp.getAll() : {};
        for (const [k, v] of Object.entries(all)) {
          const val = Array.isArray(v) ? v.join(', ') : String(v);
          if (/creator$|^dc:creator|author|lastmodifiedby/i.test(k)) add('author', k, val, 'XMP metadata');
          else if (/creatortool|producer|softwareagent/i.test(k)) add('software', k, val, 'XMP metadata');
          else if (/date/i.test(k)) add('dates', k, val, 'XMP metadata');
          else if (/documentid|instanceid|originaldocumentid/i.test(k)) add('ids', k, val, 'XMP metadata');
          else if (/title|subject|description|keyword/i.test(k)) add('title', k, val, 'XMP metadata');
          else add('custom', k, val, 'XMP metadata');
        }
      } catch (e) { /* XMP unreadable: the raw scan below still notes it */ }
    }
    const MT = { author: 'meta.author', org: 'meta.org', software: 'meta.software', dates: 'meta.dates', title: 'meta.title', custom: 'meta.custom', ids: 'meta.ids' };
    const MD = {
      author: 'The author name is stored in the file properties and is shown by every PDF reader.',
      software: 'Reveals which program and version created or converted the file.',
      dates: 'When the file was created and last changed.',
      title: 'Not visible on the page, but shown in the reader title bar, file properties and search results.',
      custom: 'Extra properties added by the program or workflow that made the file.',
      ids: 'Unique identifiers that let the same document be recognised across copies.'
    };
    for (const [grp, list] of Object.entries(rows)) {
      if (!list.length) continue;
      finding({ type: MT[grp], detail: MD[grp], value: list.map(r => r.k + ': ' + r.v).join('\n'), items: list, where: [...new Set(list.map(r => r.where))].join(', ') });
    }
    check('meta', 'Info dictionary and XMP metadata', 'done');

    // ---------------------------------------------------------------- raw structure scan
    const eofs = [];
    { let i = 0; while ((i = raw.indexOf('%%EOF', i)) !== -1) { eofs.push(i); i += 5; } }
    const linearized = /\/Linearized\s+\d/.test(raw.slice(0, 2048));
    const flags = {
      js: /\/(JS|JavaScript)\b/.test(raw), launch: /\/Launch\b/.test(raw), openAction: /\/OpenAction\b/.test(raw), aa: /\/AA\b/.test(raw),
      embedded: /\/EmbeddedFile\b/.test(raw), rich: /\/(RichMedia|3D)\b/.test(raw), xfa: /\/XFA\b/.test(raw), sig: /\/ByteRange\b/.test(raw),
      submit: /\/SubmitForm\b/.test(raw), objStm: /\/ObjStm\b/.test(raw)
    };
    check('raw', 'Raw structure scan (revisions, scripts, embedded files)', flags.objStm ? 'partial' : 'done',
      flags.objStm ? 'Some objects are compressed; the scan sees them through PDF.js instead of byte search.' : '');

    // ---------------------------------------------------------------- scripts and actions
    let jsList = [];
    try { jsList = (await pdf.getJavaScript()) || []; } catch (e) { /* none */ }
    if (jsList.length || flags.launch || flags.submit || flags.xfa || (flags.js && !jsList.length)) {
      const why = [];
      if (jsList.length) why.push(jsList.length + ' JavaScript block(s)');
      else if (flags.js) why.push('JavaScript actions');
      if (flags.launch) why.push('a "launch" action');
      if (flags.submit) why.push('a form-submit action');
      if (flags.xfa) why.push('XFA form data');
      finding({ type: 'macro', detail: 'This PDF contains ' + why.join(', ') + '. Scripts and actions can run when the file is opened and may hold internal names and addresses.', value: jsList.join('\n---\n').slice(0, 4000), where: 'PDF actions', count: why.length });
      for (const s of jsList) seg({ text: s.slice(0, 20000), visible: false, kind: 'script', where: 'Document JavaScript' });
    }
    check('actions', 'JavaScript, launch and submit actions', 'done');

    // ---------------------------------------------------------------- attachments
    let atts = null;
    try { atts = await pdf.getAttachments(); } catch (e) { /* none */ }
    const attList = atts ? Object.values(atts) : [];
    if (attList.length || flags.embedded) {
      const r = attList.map(a => ({ k: a.filename, v: util.fmtBytes(a.content ? a.content.length : 0), where: 'EmbeddedFiles' }));
      finding({ type: 'embedded', detail: 'Files are attached inside the PDF. A viewer shows them in the attachments panel, but they are not on the page.', value: r.map(x => x.k + ' (' + x.v + ')').join('\n') || 'Embedded file stream', items: r, where: 'EmbeddedFiles', count: Math.max(r.length, 1) });
    }
    check('attachments', 'Embedded files and attachments', 'done');

    // ---------------------------------------------------------------- layers
    try {
      const cfg = await pdf.getOptionalContentConfig();
      const groups = [];
      for (const [id, grp] of cfg) groups.push({ id, name: grp.name || id, visible: grp.visible });
      if (groups.length) {
        const hiddenGrp = groups.filter(x => !x.visible);
        for (const x of groups) seg({ text: x.name, visible: false, kind: 'meta', where: 'Layer name' });
        finding({ type: 'hidden.layer', conf: hiddenGrp.length ? 'high' : 'medium', detail: groups.length + ' layer(s)' + (hiddenGrp.length ? ', ' + hiddenGrp.length + ' hidden by default' : '') + '. Content on a hidden layer is still in the file and can be switched on in a viewer.', value: groups.map(x => x.name + (x.visible ? '' : ' (hidden)')).join('\n'), items: groups.map(x => ({ k: x.name, v: x.visible ? 'visible' : 'hidden', where: 'OCProperties' })), where: 'OCProperties', count: groups.length, sev: hiddenGrp.length ? 'high' : 'medium' });
      }
    } catch (e) { /* no layers */ }
    check('layers', 'Optional content (layers)', 'done');

    // ---------------------------------------------------------------- outline
    try {
      const out = await pdf.getOutline();
      if (out && out.length) {
        const titles = []; const walk = (items) => { for (const it of items) { titles.push(it.title); if (it.items && it.items.length) walk(it.items); } };
        walk(out);
        for (const t of titles) seg({ text: t, visible: false, kind: 'meta', where: 'Bookmark' });
        finding({ type: 'hidden.outline', detail: 'Bookmarks hold their own text, which can differ from the page.', value: titles.join('\n'), where: 'Outlines', count: titles.length });
      }
    } catch (e) { /* none */ }

    // ---------------------------------------------------------------- pages
    const annotRows = [], formRows = [], linkRows = [], redactMarks = [];
    let images = 0, hiddenByBox = 0;
    const offpage = [];
    for (let pn = 1; pn <= pageCap; pn++) {
      progress(pn, pageCap);
      let page;
      try { page = await pdf.getPage(pn); } catch (e) { doc.unsupported.push({ id: 'page' + pn, label: 'Page ' + pn, note: 'Could not be read.' }); continue; }
      const view = page.view; // [x0,y0,x1,y1]
      const tc = await page.getTextContent({ includeMarkedContent: false });

      // join items into page text, keeping the geometry of every item
      let txt = ''; const spans = [];
      for (const it of tc.items) {
        if (typeof it.str !== 'string') continue;
        const start = txt.length;
        txt += it.str;
        const x = it.transform[4], y = it.transform[5], w = it.width, h = it.height || Math.abs(it.transform[3]) || 8;
        spans.push({ start, end: txt.length, x0: x, y0: y, x1: x + w, y1: y + h, str: it.str });
        if (it.hasEOL) txt += '\n';
        else if (it.str && !it.str.endsWith(' ')) { /* PDF.js gives word-level items; the next item adds its own gap */ }
      }
      const outsideBox = (s) => s.str.trim() && (s.x1 < view[0] - 1 || s.x0 > view[2] + 1 || s.y1 < view[1] - 1 || s.y0 > view[3] + 1);
      const rectOf = (a, b) => {
        const hit = spans.filter(s => s.end > a && s.start < b && s.str.trim());
        if (!hit.length) return null;
        return { page: pn, x0: Math.min(...hit.map(s => s.x0)), y0: Math.min(...hit.map(s => s.y0)), x1: Math.max(...hit.map(s => s.x1)), y1: Math.max(...hit.map(s => s.y1)) };
      };

      // text outside the page area is not visible but extractable (PDF.js may not even return it)
      const outs = spans.filter(outsideBox);
      let shown = [];
      try {
        const have = txt.replace(/\s+/g, '');
        shown = await shownStrings(page, OPS);
        const lost = shown.filter(x => x.t.replace(/\s+/g, '').length >= 3 && !have.includes(x.t.replace(/\s+/g, ''))).map(x => x.t);
        for (const t of lost) outs.push({ str: t, start: 0, end: 0 });
      } catch (e) { /* the page text above is still used */ }
      if (outs.length) {
        offpage.push({ page: pn, text: outs.map(s => s.str).join(' ') });
        // remove it from the visible segment, keep as hidden
        for (let k = outs.length - 1; k >= 0; k--) { const s = outs[k]; if (s.end === s.start) continue; txt = txt.slice(0, s.start) + ' '.repeat(s.end - s.start) + txt.slice(s.end); }
        seg({ text: outs.map(s => s.str).join(' '), visible: false, kind: 'offpage', where: 'Page ' + pn + ' · outside the page area', page: pn });
      }
      seg({ text: txt, visible: true, kind: 'text', where: 'Page ' + pn, page: pn, rectOf });

      // black boxes drawn over text
      let rects = [];
      try {
        rects = await darkRects(page, OPS);
        const ops = await page.getOperatorList();
        images += ops.fnArray.filter(f => f === OPS.paintImageXObject || f === OPS.paintInlineImageXObject || f === OPS.paintImageMaskXObject).length;
      } catch (e) { check('fake.p' + pn, 'Black-box scan, page ' + pn, 'not_run', e.message); }
      if (rects.length) {
        // PDF.js returns whole strings, so character positions are estimated evenly across each string;
        // a character counts as covered when its centre lies inside a dark box.
        const pageArea = (view[2] - view[0]) * (view[3] - view[1]);
        const boxes = rects.filter(r => (r.x1 - r.x0) * (r.y1 - r.y0) < pageArea * 0.6 && (r.x1 - r.x0) > 2 && (r.y1 - r.y0) > 2);
        const groups = [];
        for (const sp of spans) {
          if (!sp.str.trim() || outsideBox(sp)) continue;
          const n = sp.str.length, cw = (sp.x1 - sp.x0) / n, cy = (sp.y0 + sp.y1) / 2;
          let run = null;
          for (let k = 0; k < n; k++) {
            const cx = sp.x0 + cw * (k + 0.5);
            const box = sp.str[k].trim() !== '' ? boxes.find(r => cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1) : null;
            if (box) {
              if (!run) { run = { str: '', x0: sp.x0 + cw * k, y0: sp.y0, y1: sp.y1, x1: 0, at: box.at }; groups.push(run); }
              run.str += sp.str[k]; run.x1 = sp.x0 + cw * (k + 1);
            } else if (run && sp.str[k].trim() === '') { run.str += sp.str[k]; run.x1 = sp.x0 + cw * (k + 1); }
            else run = null;
          }
        }
        // A box painted BEFORE the text is a background (white text on a black bar); only boxes painted after the text hide it.
        const flat = (x) => x.replace(/\s+/g, '');
        for (let gi = groups.length - 1; gi >= 0; gi--) {
          const gr = groups[gi], needle = flat(gr.str);
          const holders = shown.filter(x => flat(x.t).includes(needle));
          if (holders.length && holders.every(x => x.at > gr.at)) groups.splice(gi, 1);        // text drawn on top of the box
          else gr.sure = holders.length > 0;
        }
        if (groups.length) {
          hiddenByBox += groups.length;
          const t = groups.map(x => x.str.trim()).join(' ');
          finding({
            type: 'fake_redaction', page: pn, conf: groups.every(x => x.sure) ? 'high' : 'medium', visible: false,
            detail: 'Text on page ' + pn + ' sits under a dark box. Drawing a box over text does not remove it: anyone can select, copy or extract the words below.',
            value: t, where: 'Page ' + pn, count: groups.length,
            rect: { page: pn, x0: Math.min(...groups.map(x => x.x0)), y0: Math.min(...groups.map(x => x.y0)), x1: Math.max(...groups.map(x => x.x1)), y1: Math.max(...groups.map(x => x.y1)) }
          });
          seg({ text: t, visible: false, kind: 'covered', where: 'Page ' + pn + ' · under a black box', page: pn });
        }
      }

      // annotations, links, form fields
      let anns = [];
      try { anns = await page.getAnnotations(); } catch (e) { /* none */ }
      for (const a of anns) {
        const st = a.subtype;
        if (st === 'Popup') continue;
        if (st === 'Link') {
          const url = a.url || a.unsafeUrl;
          if (url) { linkRows.push({ k: 'p' + pn, v: url, where: 'Page ' + pn }); seg({ text: url, visible: false, kind: 'link', where: 'Link target · page ' + pn, page: pn }); }
          continue;
        }
        if (st === 'Widget') {
          const v = Array.isArray(a.fieldValue) ? a.fieldValue.join(', ') : a.fieldValue;
          if (v != null && String(v).trim() !== '' && a.fieldType !== 'Btn') {
            formRows.push({ k: a.fieldName || 'field', v: String(v), where: 'Page ' + pn });
            seg({ text: String(v), visible: true, kind: 'form', where: 'Form field ' + (a.fieldName || '') + ' · page ' + pn, page: pn });
          }
          continue;
        }
        if (st === 'Redact') { redactMarks.push({ page: pn, text: a.contentsObj ? a.contentsObj.str : '' }); continue; }
        if (st === 'FileAttachment') { continue; }
        const body = (a.contentsObj && a.contentsObj.str) || a.contents || '';
        const who = (a.titleObj && a.titleObj.str) || a.title || '';
        if (body || who) {
          annotRows.push({ k: st + (who ? ' · ' + who : ''), v: body, where: 'Page ' + pn });
          if (body) seg({ text: body, visible: false, kind: 'comment', where: st + (who ? ' by ' + who : '') + ' · page ' + pn, page: pn });
          if (who) seg({ text: who, visible: false, kind: 'meta', where: 'Annotation author · page ' + pn, page: pn });
        }
      }
      page.cleanup();
    }
    check('pages.text', 'Text of ' + pageCap + ' page(s)', pageCap < nPages ? 'partial' : 'done');
    check('pages.fake', 'Text under dark boxes', 'done');
    check('pages.annots', 'Annotations, links and form fields', 'done');

    if (hiddenByBox) { /* findings already added per page */ }
    if (offpage.length) {
      finding({ type: 'hidden.offpage', detail: 'Text is positioned outside the page area. It is not shown but can be extracted.', value: offpage.map(o => 'p' + o.page + ': ' + o.text).join('\n'), where: 'Pages ' + offpage.map(o => o.page).join(', '), count: offpage.length });
    }
    if (annotRows.length) {
      finding({ type: 'annotation', detail: annotRows.length + ' comment(s) or note(s) with author names.', value: annotRows.map(r => r.k + (r.v ? ': ' + r.v : '')).join('\n'), items: annotRows, where: 'Annotations', count: annotRows.length });
    }
    if (formRows.length) {
      finding({ type: 'form_field', detail: formRows.length + ' form field(s) hold values. Form values live apart from the page content and stay editable.', value: formRows.map(r => r.k + ': ' + r.v).join('\n'), items: formRows, where: 'AcroForm', count: formRows.length });
    }
    if (redactMarks.length) {
      finding({ type: 'redact_annot', conf: 'high', detail: redactMarks.length + ' redaction mark(s) were placed but the redaction was not applied. The marked text is still in the file.', where: 'Pages ' + [...new Set(redactMarks.map(r => r.page))].join(', '), count: redactMarks.length });
    }
    if (images) {
      doc.unsupported.push({ id: 'images.text', label: 'Text inside ' + images + ' picture(s)', note: 'Text drawn inside images (scans, screenshots) is not read in this version.' });
      check('images.text', 'Text inside pictures', 'not_run', 'Not read automatically. Use "Read text in pictures (OCR)" to scan them.');
    }

    // ---------------------------------------------------------------- signatures
    if (flags.sig) {
      finding({ type: 'signature', detail: 'The file carries a digital signature. Any change, including removing metadata, will invalidate it.', where: 'ByteRange' });
    }

    // ---------------------------------------------------------------- earlier revisions
    const meaningfulEof = linearized ? eofs.length - 1 : eofs.length;
    if (meaningfulEof > 1) {
      // revisions end at every %%EOF except the last; linearized files carry one extra at the first-page section
      const cuts = eofs.slice(0, -1).filter((p, idx) => !(linearized && idx === 0));
      const limited = cuts.slice(-L.pdfMaxRevisions);
      const current = lineSet(doc.segments.filter(s => s.page).map(s => s.text));
      const removed = [];
      for (const cut of limited) {
        const end = raw.indexOf('\n', cut) === -1 ? cut + 5 : Math.min(raw.length, cut + 6);
        let old;
        try {
          old = await pdfjs.getDocument({ data: bytes.slice(0, end), isEvalSupported: false, verbosity: 0, stopAtErrors: false, ...(hooks.docOptions || {}) }).promise;
          const texts = [];
          for (let pn = 1; pn <= Math.min(old.numPages, L.pdfMaxPages); pn++) {
            const pg = await old.getPage(pn); const c = await pg.getTextContent();
            texts.push(c.items.map(i => i.str + (i.hasEOL ? '\n' : '')).join('')); pg.cleanup();
          }
          const before = lineSet(texts);
          for (const l of before) if (!current.has(l)) removed.push(l);
          await old.destroy();
        } catch (e) { /* this revision boundary is not a readable file */ }
      }
      const uniq = [...new Set(removed)];
      finding({ type: 'incremental', conf: 'high', detail: 'This PDF was saved by appending changes instead of rewriting it (' + (cuts.length + 1) + ' versions). The earlier versions stay inside the file.' + (uniq.length ? ' Text that exists only in earlier versions was found.' : ''), where: 'File trailer', count: cuts.length + 1 });
      if (uniq.length) {
        const joined = uniq.join('\n');
        finding({ type: 'removed_text', conf: 'high', detail: uniq.length + ' line(s) of text appear in an earlier version but not in the current one. Anyone can restore them by opening the earlier version.', value: joined.slice(0, 6000), where: 'Earlier versions', count: uniq.length });
        seg({ text: joined, visible: false, kind: 'deleted', where: 'Earlier version of the file' });
      }
      check('revisions', 'Earlier versions (incremental updates)', 'done', limited.length < cuts.length ? 'Only the last ' + limited.length + ' versions were compared.' : '');
    } else {
      check('revisions', 'Earlier versions (incremental updates)', 'done');
    }

    if (flags.objStm) doc.meta.objectStreams = true;
    return doc;
  }

  Ex.adapters = Ex.adapters || {};
  Ex.adapters.pdf = { read: readPdf };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ex;
})(typeof window !== 'undefined' ? window : globalThis);
