/*
 * Exposift – DOCX adapter (inspection).
 * A .docx is a ZIP of XML parts. Everything here reads parts directly, so nothing depends on
 * how Word would render the file: deleted text, comments, hidden runs and leftover parts are
 * all visible to this reader exactly as they are visible to anyone who unzips the file.
 */
(function (g) {
  'use strict';
  const Ex = g.Ex = g.Ex || {};
  const U = () => Ex.util;

  // ---- XML helpers (namespace-agnostic: parts always use the conventional prefixes, but we match on local names)
  const parseXml = (str) => {
    const doc = (Ex.env && Ex.env.parseXml) ? Ex.env.parseXml(str) : new DOMParser().parseFromString(str, 'application/xml');
    return doc.documentElement;
  };
  const els = (root, name) => Array.from(root.getElementsByTagNameNS('*', name));
  const kids = (el, name) => Array.from(el.childNodes).filter(n => n.nodeType === 1 && n.localName === name);
  const kid = (el, name) => (el ? kids(el, name)[0] || null : null);
  const attr = (el, name) => {
    if (!el || !el.attributes) return '';
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i];
      if ((a.localName || a.name.split(':').pop()) === name) return a.value;
    }
    return '';
  };
  const text = (el) => (el ? (el.textContent || '').trim() : '');
  const on = (el) => { if (!el) return false; const v = attr(el, 'val'); return !(v === '0' || v === 'false' || v === 'off'); };
  const closest = (el, names) => {
    for (let n = el.parentNode; n; n = n.parentNode) if (n.nodeType === 1 && names.includes(n.localName)) return n;
    return null;
  };

  const RELTYPE = t => String(t).split('/').pop();

  /** How visible a run is: visible | hidden (vanish) | deleted (tracked deletion) | lookalike (white or 1 pt) */
  function runKind(r) {
    const rPr = kid(r, 'rPr');
    const vanish = on(kid(rPr, 'vanish')) || on(kid(rPr, 'specVanish'));
    const color = rPr ? attr(kid(rPr, 'color'), 'val').toUpperCase() : '';
    const sz = rPr ? parseInt(attr(kid(rPr, 'sz'), 'val'), 10) : NaN;
    const shaded = rPr && kid(rPr, 'shd') && attr(kid(rPr, 'shd'), 'fill') && !/^(auto|FFFFFF)$/i.test(attr(kid(rPr, 'shd'), 'fill'));
    const lookalike = (color === 'FFFFFF' && !shaded) || (sz > 0 && sz <= 2);
    const hl = rPr ? attr(kid(rPr, 'highlight'), 'val').toLowerCase() : '';
    const fill = rPr && kid(rPr, 'shd') ? attr(kid(rPr, 'shd'), 'fill') : '';
    const darkFill = /^[0-9a-f]{6}$/i.test(fill) && [0, 2, 4].every(i => parseInt(fill.substr(i, 2), 16) < 0x38);
    const lightText = /^[0-9a-f]{6}$/i.test(color) && [0, 2, 4].some(i => parseInt(color.substr(i, 2), 16) > 0xB0);
    const blackbox = (hl === 'black' || darkFill) && !lightText && !lookalike;
    const deleted = !!closest(r, ['del', 'moveFrom']);
    return deleted ? 'deleted' : vanish ? 'hidden' : lookalike ? 'lookalike' : blackbox ? 'blackbox' : 'visible';
  }

  /** Segments of one paragraph, split by how visible each run is */
  function paragraphKinds(p) {
    const parts = { visible: '', hidden: '', deleted: '', lookalike: '', blackbox: '' };
    const fields = [];
    for (const r of els(p, 'r')) {
      if (closest(r, ['p']) !== p) continue;
      let s = '';
      for (const c of Array.from(r.childNodes)) {
        if (c.nodeType !== 1) continue;
        switch (c.localName) {
          case 't': case 'delText': s += c.textContent; break;
          case 'tab': s += '\t'; break;
          case 'br': case 'cr': s += '\n'; break;
          case 'noBreakHyphen': s += '-'; break;
          case 'instrText': fields.push(c.textContent.trim()); break;
          default: break;
        }
      }
      if (!s) continue;
      parts[runKind(r)] += s;
    }
    return { parts, fields };
  }

  async function readDocx(bytes, name) {
    const util = U();
    const files = util.safeUnzip(bytes);
    const has = n => Object.prototype.hasOwnProperty.call(files, n);
    const xml = n => parseXml(util.decodeXml(files[n]));
    const names = Object.keys(files);

    if (!has('word/document.xml')) {
      if (has('xl/workbook.xml') || has('ppt/presentation.xml')) throw new util.ExposiftError('wrong_office', 'This is an Excel or PowerPoint file; only Word documents are supported in this version.');
      throw new util.ExposiftError('not_docx', 'This ZIP file is not a Word document.');
    }

    const doc = { format: 'docx', name, size: bytes.length, segments: [], findings: [], checks: [], unsupported: [], meta: {} };
    const check = (id, label, status, note = '') => doc.checks.push({ id, label, status, note });
    const authors = new Map();   // name -> Set(where)
    const noteAuthor = (n, where) => { n = (n || '').trim(); if (!n) return; if (!authors.has(n)) authors.set(n, new Set()); authors.get(n).add(where); };
    let segN = 0;
    const seg = (o) => doc.segments.push({ id: 's' + (++segN), visible: true, kind: 'text', ...o });
    const finding = (o) => doc.findings.push({ visible: false, ...o });

    // ---------------------------------------------------------------- metadata
    const meta = { author: [], org: [], software: [], dates: [], title: [], custom: [], path: [] };
    const addMeta = (group, k, v, where) => {
      v = (v || '').trim();
      if (!v) return;
      meta[group].push({ k, v, where });
      if (group !== 'dates') seg({ text: v, visible: false, kind: 'meta', where: where + ' · ' + k });
    };
    if (has('docProps/core.xml')) {
      const c = xml('docProps/core.xml');
      const g1 = n => text(els(c, n)[0]);
      addMeta('author', 'Author', g1('creator'), 'docProps/core.xml'); noteAuthor(g1('creator'), 'document properties');
      addMeta('author', 'Last modified by', g1('lastModifiedBy'), 'docProps/core.xml'); noteAuthor(g1('lastModifiedBy'), 'document properties');
      addMeta('title', 'Title', g1('title'), 'docProps/core.xml');
      addMeta('title', 'Subject', g1('subject'), 'docProps/core.xml');
      addMeta('title', 'Keywords', g1('keywords'), 'docProps/core.xml');
      addMeta('title', 'Description', g1('description'), 'docProps/core.xml');
      addMeta('title', 'Category', g1('category'), 'docProps/core.xml');
      addMeta('dates', 'Created', g1('created'), 'docProps/core.xml');
      addMeta('dates', 'Last modified', g1('modified'), 'docProps/core.xml');
      addMeta('dates', 'Last printed', g1('lastPrinted'), 'docProps/core.xml');
      check('meta.core', 'Core document properties', 'done');
    }
    if (has('docProps/app.xml')) {
      const a = xml('docProps/app.xml');
      const g1 = n => text(els(a, n)[0]);
      addMeta('org', 'Company', g1('Company'), 'docProps/app.xml');
      addMeta('org', 'Manager', g1('Manager'), 'docProps/app.xml');
      addMeta('software', 'Application', [g1('Application'), g1('AppVersion')].filter(Boolean).join(' '), 'docProps/app.xml');
      addMeta('dates', 'Total editing time (min)', g1('TotalTime'), 'docProps/app.xml');
      addMeta('path', 'Hyperlink base', g1('HyperlinkBase'), 'docProps/app.xml');
      const tpl = g1('Template');
      if (/[\\/]/.test(tpl)) addMeta('path', 'Template', tpl, 'docProps/app.xml');
      check('meta.app', 'Application properties', 'done');
    }
    if (has('docProps/custom.xml')) {
      for (const pr of els(xml('docProps/custom.xml'), 'property')) {
        addMeta('custom', attr(pr, 'name'), text(pr), 'docProps/custom.xml');
      }
      check('meta.custom', 'Custom properties', 'done');
    }
    const META_TYPE = { author: 'meta.author', org: 'meta.org', software: 'meta.software', dates: 'meta.dates', title: 'meta.title', custom: 'meta.custom', path: 'meta.path' };
    const META_DETAIL = {
      author: 'Names of the people who created and last edited the file travel with it.',
      org: 'Company and manager names come from the Office installation of whoever made the file.',
      software: 'Reveals which program and version created the file.',
      dates: 'When the file was created, edited and how long it was worked on.',
      title: 'These fields are not visible on the page but are shown by file properties and search.',
      custom: 'Custom properties are often added by document management systems or templates.',
      path: 'A path can reveal user names, server names and folder structure.'
    };
    for (const [group, rows] of Object.entries(meta)) {
      if (group === 'author') continue; // reported after all sources are collected
      if (!rows.length) continue;
      finding({ type: META_TYPE[group], detail: META_DETAIL[group], value: rows.map(r => r.k + ': ' + r.v).join('\n'), items: rows, where: [...new Set(rows.map(r => r.where))].join(', ') });
    }

    // ---------------------------------------------------------------- content parts
    const contentParts = names.filter(n => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));
    let paraNo = 0, trackedIns = 0, trackedDel = 0;
    const hiddenTexts = { hidden: [], deleted: [], lookalike: [], blackbox: [] };
    const rowIds = new Map();
    const fieldCodes = [];
    for (const part of contentParts) {
      const root = xml(part);
      const label = part.replace('word/', '');
      let pIdx = -1;
      for (const p of els(root, 'p')) {
        pIdx++;
        const { parts, fields } = paragraphKinds(p);
        paraNo++;
        for (const f of fields) fieldCodes.push(f);
        const tc = closest(p, ['tc']), tr = tc && closest(tc, ['tr']);
        let cell = {};
        if (tr) { if (!rowIds.has(tr)) rowIds.set(tr, rowIds.size + 1); cell = { row: rowIds.get(tr), col: Array.from(tr.childNodes).filter(n => n.nodeType === 1 && n.localName === 'tc').indexOf(tc) }; }
        for (const [kind, s] of Object.entries(parts)) {
          if (!s.trim()) continue;
          if (kind === 'blackbox') {
            seg({ text: s, visible: false, kind: 'covered', where: label + ' · ¶' + paraNo + ' · under a black highlight', part: label, para: paraNo });
            hiddenTexts.blackbox.push({ where: label + ' · ¶' + paraNo, text: s });
            continue;
          }
          // a plain paragraph (only visible runs, no tab, line break, field or tracked change) can be rewritten by Transform
          const plain = kind === 'visible' && Object.entries(parts).every(([k2, v2]) => k2 === 'visible' || !v2) && !/[\t\n]/.test(s) && !fields.length && !els(p, 'ins').length && !els(p, 'del').length;
          seg({ text: s, visible: kind === 'visible', kind, where: label + ' · ¶' + paraNo, part: label, para: paraNo, ...(plain ? { loc: { part, idx: pIdx } } : {}), ...(kind === 'visible' ? cell : {}) });
          if (kind !== 'visible') hiddenTexts[kind].push({ where: label + ' · ¶' + paraNo, text: s });
        }
      }
      for (const e of els(root, 'ins').concat(els(root, 'moveTo'))) { trackedIns++; noteAuthor(attr(e, 'author'), 'tracked changes'); }
      for (const e of els(root, 'del').concat(els(root, 'moveFrom'))) { if (e.parentNode && e.parentNode.localName === 'rPr') continue; trackedDel++; noteAuthor(attr(e, 'author'), 'tracked changes'); }
    }
    check('content', 'Body, headers, footers, footnotes and endnotes', 'done');
    check('hidden.runs', 'Hidden, deleted and white or tiny text', 'done');

    if (hiddenTexts.hidden.length) {
      finding({ type: 'hidden.text', detail: 'Text formatted as hidden is not shown by Word until "show hidden text" is turned on, but it is part of the file.', value: hiddenTexts.hidden.map(x => x.text).join('\n'), where: hiddenTexts.hidden.slice(0, 3).map(x => x.where).join(', '), count: hiddenTexts.hidden.length });
    }
    for (const x of hiddenTexts.blackbox) {
      finding({ type: 'fake_redaction', conf: 'high', detail: 'This text is only covered by a black highlight. Anyone can select, copy or search it, or remove the highlight.', value: x.text, where: x.where, count: 1 });
    }
    if (hiddenTexts.deleted.length) {
      finding({ type: 'hidden.deleted', detail: 'Tracked deletions still contain the removed text. Accepting or rejecting the changes is the only way to drop it.', value: hiddenTexts.deleted.map(x => x.text).join('\n'), where: hiddenTexts.deleted.slice(0, 3).map(x => x.where).join(', '), count: hiddenTexts.deleted.length });
    }
    if (hiddenTexts.lookalike.length) {
      finding({ type: 'hidden.lookalike', conf: 'medium', detail: 'White text on a white page or text at 1 pt is invisible when reading but is still text. It can also be formatting meant to be shown on a dark background, so verify.', value: hiddenTexts.lookalike.map(x => x.text).join('\n'), where: hiddenTexts.lookalike.slice(0, 3).map(x => x.where).join(', '), count: hiddenTexts.lookalike.length });
    }
    if (trackedIns || trackedDel) {
      finding({ type: 'hidden.tracked', detail: trackedIns + ' insertion(s) and ' + trackedDel + ' deletion(s) are recorded with author and date. Anyone opening the file can step back through them.', count: trackedIns + trackedDel, where: 'word/document.xml' });
    }
    if (fieldCodes.length) {
      const risky = fieldCodes.filter(c => /^\s*(INCLUDETEXT|INCLUDEPICTURE|LINK|DDE|DDEAUTO|DATABASE|MERGEFIELD)\b/i.test(c));
      if (risky.length) finding({ type: 'external_link', detail: 'Field codes that pull data from other files or sources.', value: risky.join('\n'), where: 'word/document.xml', count: risky.length });
      for (const c of fieldCodes) seg({ text: c, visible: false, kind: 'field', where: 'word/document.xml · field code' });
    }

    // comments
    if (has('word/comments.xml')) {
      const rows = [];
      for (const cm of els(xml('word/comments.xml'), 'comment')) {
        const a = attr(cm, 'author'), d = attr(cm, 'date');
        const body = els(cm, 'p').map(p => paragraphKinds(p).parts).map(pp => Object.values(pp).join('')).join('\n').trim();
        noteAuthor(a, 'comments');
        rows.push({ k: a + (d ? ' · ' + d.slice(0, 10) : ''), v: body });
        if (body) seg({ text: body, visible: false, kind: 'comment', where: 'Comment by ' + (a || 'unknown') });
      }
      if (rows.length) finding({ type: 'hidden.comments', detail: rows.length + ' comment(s) with author names and dates. Comments are often internal remarks that were never meant for the recipient.', value: rows.map(r => r.k + ': ' + r.v).join('\n'), items: rows, where: 'word/comments.xml', count: rows.length });
    }
    check('comments', 'Comments', 'done');
    if (has('word/people.xml')) {
      for (const pe of els(xml('word/people.xml'), 'person')) noteAuthor(attr(pe, 'author'), 'people list');
    }

    // authors collected from every source
    {
      const rows = [...authors.entries()].map(([n, w]) => ({ k: n, v: [...w].join(', '), where: '' }));
      if (rows.length) finding({ type: 'meta.author', detail: META_DETAIL.author + ' Found in: ' + [...new Set(rows.flatMap(r => r.v.split(', ')))].join(', ') + '.', value: rows.map(r => r.k).join('\n'), items: rows, where: 'docProps/core.xml, comments, tracked changes', count: rows.length });
    }

    // settings: protection, variables, track revisions
    if (has('word/settings.xml')) {
      const s = xml('word/settings.xml');
      const prot = els(s, 'documentProtection')[0];
      if (prot && !['0', 'false'].includes(attr(prot, 'enforcement'))) {
        finding({ type: 'protection', detail: 'Editing restrictions are on. Removing content may be blocked or may invalidate the protection.', where: 'word/settings.xml' });
      }
      const vars = els(s, 'docVar');
      if (vars.length) {
        const rows = vars.map(v => ({ k: attr(v, 'name'), v: attr(v, 'val'), where: 'word/settings.xml' }));
        for (const r of rows) seg({ text: r.v, visible: false, kind: 'meta', where: 'Document variable ' + r.k });
        finding({ type: 'hidden.vars', detail: 'Document variables are invisible values stored by macros or add-ins.', value: rows.map(r => r.k + ': ' + r.v).join('\n'), items: rows, where: 'word/settings.xml', count: rows.length });
      }
      check('settings', 'Document settings (protection, variables)', 'done');
    }

    // ---------------------------------------------------------------- relationships: external references
    const external = [];
    for (const n of names.filter(x => x.endsWith('.rels'))) {
      for (const rel of els(xml(n), 'Relationship')) {
        if (attr(rel, 'TargetMode') !== 'External') continue;
        const type = RELTYPE(attr(rel, 'Type')), target = attr(rel, 'Target');
        if (type === 'hyperlink') seg({ text: target, visible: false, kind: 'link', where: 'Link target in ' + n.replace('word/_rels/', '').replace('.rels', '') });
        else external.push({ k: type, v: target, where: n });
      }
    }
    if (external.length) {
      for (const r of external) seg({ text: r.v, visible: false, kind: 'link', where: r.k + ' reference' });
      finding({ type: 'external_link', detail: 'The document points to files or resources outside itself (templates, linked pictures, data sources). Opening it may contact those locations, and the paths can reveal servers and folders.', value: external.map(r => r.k + ': ' + r.v).join('\n'), items: external, where: 'relationship parts', count: external.length });
    }
    check('rels', 'Relationships and external references', 'done');

    // ---------------------------------------------------------------- embedded objects, macros, thumbnails, custom XML
    const embedded = names.filter(n => /^word\/(embeddings|activeX|objects)\//.test(n) && !n.endsWith('.rels'));
    if (embedded.length) {
      const rows = embedded.map(n => ({ k: n.split('/').pop(), v: util.fmtBytes(files[n].length), where: n }));
      finding({ type: 'embedded', detail: 'Embedded objects can contain full files, for example the whole spreadsheet behind a chart. They are not part of what you see on the page.', value: rows.map(r => r.k + ' (' + r.v + ')').join('\n'), items: rows, where: 'word/embeddings', count: rows.length });
    }
    const macroParts = names.filter(n => /vbaProject\.bin$|vbaData\.xml$/i.test(n));
    if (macroParts.length || /\.docm$/i.test(name)) {
      finding({ type: 'macro', detail: 'The file contains a macro project. Macros can run code and often hold internal names, paths and comments.', value: macroParts.join('\n'), where: macroParts[0] || name });
    }
    const thumb = names.find(n => /^docProps\/thumbnail\./i.test(n));
    if (thumb) finding({ type: 'thumbnail', detail: 'A small preview image of the first page was saved with the file. It is made when the document is saved and may still show content that was later removed.', where: thumb });
    const cx = names.filter(n => /^customXml\/item\d+\.xml$/.test(n));
    if (cx.length) {
      const rows = [];
      for (const n of cx) {
        const root = xml(n), t = (root.textContent || '').trim();
        rows.push({ k: n.split('/').pop() + ' <' + root.localName + '>', v: t.slice(0, 200), where: n });
        if (t) seg({ text: t.slice(0, 20000), visible: false, kind: 'meta', where: n });
      }
      finding({ type: 'hidden.custom_xml', conf: 'medium', detail: 'Custom XML parts hold data for add-ins, content controls or document management systems. Exposift lists them but cannot tell whether the data is sensitive.', value: rows.map(r => r.k + (r.v ? ': ' + r.v : '')).join('\n'), items: rows, where: 'customXml', count: rows.length });
    }
    check('embedded', 'Embedded objects, macros, thumbnail, custom XML', 'done');

    // charts and diagrams carry their own text caches
    for (const n of names.filter(x => /^word\/(charts\/chart|diagrams\/data)\d*\.xml$/.test(x))) {
      const root = xml(n), t = els(root, 't').map(x => x.textContent).concat(els(root, 'v').map(x => x.textContent)).join(' ').trim();
      if (t) seg({ text: t, visible: false, kind: 'chart', where: n });
    }

    // images: photo metadata
    const media = names.filter(n => /^word\/media\//.test(n));
    let exifN = 0, gpsN = 0;
    const exifRows = [];
    for (const n of media) {
      if (!/\.jpe?g$/i.test(n)) continue;
      const ex = util.readExif(files[n]);
      if (!ex) continue;
      exifN++;
      const bits = [ex.make, ex.model, ex.software, ex.artist, ex.date].filter(Boolean).join(', ');
      exifRows.push({ k: n.split('/').pop(), v: (ex.gps ? 'GPS position; ' : '') + bits, where: n });
      if (ex.gps) gpsN++;
      for (const s of [ex.artist, ex.software, ex.copyright]) if (s) seg({ text: s, visible: false, kind: 'meta', where: n + ' · EXIF' });
    }
    if (gpsN) finding({ type: 'image_gps', conf: 'high', detail: gpsN + ' picture(s) contain the location where the photo was taken.', value: exifRows.filter(r => /GPS/.test(r.v)).map(r => r.k).join('\n'), items: exifRows, where: 'word/media', count: gpsN });
    if (exifN) finding({ type: 'image_exif', detail: 'Pictures keep camera, software, owner and date data inside the image file.', value: exifRows.map(r => r.k + ': ' + r.v).join('\n'), items: exifRows, where: 'word/media', count: exifN });
    check('images.exif', 'Photo metadata (EXIF) in JPEG pictures', 'done');
    if (media.length) {
      doc.unsupported.push({ id: 'images.text', label: 'Text inside ' + media.length + ' picture(s)', note: 'Text drawn inside images (screenshots, scans) is not read in this version.' });
      check('images.text', 'Text inside pictures', 'not_run', 'Not read automatically. Use "Read text in pictures (OCR)" to scan them.');
    }

    // anything we do not model
    const known = /^(\[Content_Types\]\.xml|_rels\/|docProps\/|word\/(document|settings|styles|fontTable|webSettings|numbering|theme\/|_rels\/|comments|people|header|footer|footnotes|endnotes|media\/|embeddings\/|charts\/|diagrams\/|activeX\/|vbaProject|stylesWithEffects|glossary\/|customXml|theme)|customXml\/|word\/\w+\.xml)/;
    const rest = names.filter(n => !known.test(n) && !n.endsWith('/'));
    if (names.some(n => n.startsWith('word/glossary/'))) doc.unsupported.push({ id: 'glossary', label: 'Glossary (building blocks) document', note: 'Reusable text blocks stored inside the file are not analyzed.' });
    if (rest.length) doc.unsupported.push({ id: 'other', label: rest.length + ' other part(s)', note: rest.slice(0, 6).join(', ') + (rest.length > 6 ? ', …' : '') });

    doc.meta = { paragraphs: paraNo, parts: names.length };
    return doc;
  }

  Ex.adapters = Ex.adapters || {};
  Ex.adapters.docx = { read: readDocx, h: { parseXml, els, kids, kid, attr, text, on, closest, runKind } };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ex;
})(typeof window !== 'undefined' ? window : globalThis);
