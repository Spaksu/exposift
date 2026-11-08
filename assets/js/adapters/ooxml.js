/*
 * Exposift – Excel (.xlsx) and PowerPoint (.pptx) adapter (inspection).
 * Like the DOCX adapter it reads the XML parts directly, so hidden sheets, hidden rows and columns,
 * speaker notes, comments, cached data and leftover parts are seen exactly as anyone who unzips the file sees them.
 * Ex.adapters.office.read() looks at the package and hands it to the right reader.
 */
(function (g) {
  'use strict';
  const Ex = g.Ex = g.Ex || {};
  const U = () => Ex.util;
  const H = () => Ex.adapters.docx.h;

  const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
  function resolve(dir, target) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
    const out = [];
    for (const p of (target.startsWith('/') ? target.slice(1) : dir + target).split('/')) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
    return out.join('/');
  }
  const colNum = (ref) => { const m = /^([A-Z]+)/.exec(ref || ''); if (!m) return 0; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n; };

  /** The part's relationships: [{id, type, target, external, path}] */
  function relsOf(files, part) {
    const h = H(), util = U();
    const rp = dirOf(part) + '_rels/' + part.split('/').pop() + '.rels';
    if (!Object.prototype.hasOwnProperty.call(files, rp)) return [];
    return h.els(h.parseXml(util.decodeXml(files[rp])), 'Relationship').map(r => {
      const external = h.attr(r, 'TargetMode') === 'External', target = h.attr(r, 'Target');
      return { id: h.attr(r, 'Id'), type: String(h.attr(r, 'Type')).split('/').pop(), target, external, path: external ? null : resolve(dirOf(part), target) };
    });
  }

  async function readOoxml(bytes, name, kind) {
    const util = U(), h = H();
    const { els, kids, kid, attr, text } = h;
    const files = util.safeUnzip(bytes);
    const has = n => Object.prototype.hasOwnProperty.call(files, n);
    const xml = n => h.parseXml(util.decodeXml(files[n]));
    const names = Object.keys(files);
    const main = kind === 'xlsx' ? 'xl/workbook.xml' : 'ppt/presentation.xml';
    const dir = kind === 'xlsx' ? 'xl/' : 'ppt/';
    if (!has(main)) throw new util.ExposiftError('not_office', 'This ZIP file is not a valid Office document.');

    const doc = { format: kind, name, size: bytes.length, segments: [], findings: [], checks: [], unsupported: [], meta: {} };
    const check = (id, label, status, note = '') => doc.checks.push({ id, label, status, note });
    const authors = new Map();
    const noteAuthor = (n, where) => { n = (n || '').trim(); if (!n) return; if (!authors.has(n)) authors.set(n, new Set()); authors.get(n).add(where); };
    let segN = 0, paraNo = 0;
    const seg = (o) => doc.segments.push({ id: 's' + (++segN), visible: true, kind: 'text', ...o });
    const para = (o) => { paraNo++; seg({ ...o, para: paraNo }); };
    const finding = (o) => doc.findings.push({ visible: false, ...o });

    // ---------------------------------------------------------------- document properties
    const meta = { author: [], org: [], software: [], dates: [], title: [], custom: [], path: [] };
    const addMeta = (group, k, v, where) => {
      v = (v || '').trim(); if (!v) return;
      meta[group].push({ k, v, where });
      if (group !== 'dates') seg({ text: v, visible: false, kind: 'meta', where: where + ' · ' + k });
    };
    if (has('docProps/core.xml')) {
      const c = xml('docProps/core.xml'), g1 = n => text(els(c, n)[0]);
      addMeta('author', 'Author', g1('creator'), 'docProps/core.xml'); noteAuthor(g1('creator'), 'document properties');
      addMeta('author', 'Last modified by', g1('lastModifiedBy'), 'docProps/core.xml'); noteAuthor(g1('lastModifiedBy'), 'document properties');
      for (const [k, n] of [['Title', 'title'], ['Subject', 'subject'], ['Keywords', 'keywords'], ['Description', 'description'], ['Category', 'category']]) addMeta('title', k, g1(n), 'docProps/core.xml');
      for (const [k, n] of [['Created', 'created'], ['Last modified', 'modified'], ['Last printed', 'lastPrinted']]) addMeta('dates', k, g1(n), 'docProps/core.xml');
      check('meta.core', 'Core document properties', 'done');
    }
    if (has('docProps/app.xml')) {
      const a = xml('docProps/app.xml'), g1 = n => text(els(a, n)[0]);
      addMeta('org', 'Company', g1('Company'), 'docProps/app.xml');
      addMeta('org', 'Manager', g1('Manager'), 'docProps/app.xml');
      addMeta('software', 'Application', [g1('Application'), g1('AppVersion')].filter(Boolean).join(' '), 'docProps/app.xml');
      addMeta('dates', 'Total editing time (min)', g1('TotalTime'), 'docProps/app.xml');
      addMeta('path', 'Hyperlink base', g1('HyperlinkBase'), 'docProps/app.xml');
      check('meta.app', 'Application properties', 'done');
    }
    if (has('docProps/custom.xml')) {
      for (const pr of els(xml('docProps/custom.xml'), 'property')) addMeta('custom', attr(pr, 'name'), text(pr), 'docProps/custom.xml');
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

    const hiddenCells = [];     // xlsx
    const hiddenSheets = [];
    let sheetsSeen = 0, cellsSeen = 0;

    // ================================================================ XLSX
    if (kind === 'xlsx') {
      const wb = xml(main);
      const wbRels = relsOf(files, main);
      const relById = new Map(wbRels.map(r => [r.id, r]));
      // workbook path hint (where the file was saved)
      for (const e of els(wb, 'absPath')) { const u = attr(e, 'url'); if (u) addMeta('path', 'Saved in folder', u, main); }
      // shared strings
      const shared = [];
      if (has('xl/sharedStrings.xml')) {
        for (const si of els(xml('xl/sharedStrings.xml'), 'si')) {
          shared.push(els(si, 't').filter(t => !(t.parentNode && t.parentNode.localName === 'rPh')).map(t => t.textContent).join(''));
        }
      }
      check('shared', 'Shared strings', 'done');
      // sheets
      const sheets = els(wb, 'sheet').map(s => ({ name: attr(s, 'name'), state: attr(s, 'state') || 'visible', rid: attr(s, 'id') }));
      for (const sh of sheets) {
        const rel = relById.get(sh.rid); sh.path = rel && rel.path;
        sh.hidden = sh.state === 'hidden' || sh.state === 'veryHidden';
      }
      const commentRows = [];
      for (const sh of sheets) {
        if (!sh.path || !has(sh.path)) continue;
        sheetsSeen++;
        const root = xml(sh.path);
        const hiddenCols = new Set();
        for (const c of els(root, 'col')) {
          if (attr(c, 'hidden') !== '1' && attr(c, 'hidden') !== 'true') continue;
          const a = parseInt(attr(c, 'min'), 10), b = parseInt(attr(c, 'max'), 10);
          for (let i = a; i <= Math.min(b, a + 200); i++) hiddenCols.add(i);
        }
        const hidCellsHere = []; let anyCell = false;
        for (const row of els(root, 'row')) {
          const rowHidden = attr(row, 'hidden') === '1' || attr(row, 'hidden') === 'true';
          for (const c of kids(row, 'c')) {
            let s = '';
            const t = attr(c, 't'), v = text(kid(c, 'v'));
            if (t === 's') s = shared[parseInt(v, 10)] || '';
            else if (t === 'inlineStr') s = els(c, 't').map(x => x.textContent).join('');
            else if (t === 'str') s = v;
            else if (/^\d{7,}$/.test(v)) s = v;
            if (!s || !s.trim()) continue;
            cellsSeen++; anyCell = true;
            const ref = attr(c, 'r');
            const hidCell = sh.hidden || rowHidden || hiddenCols.has(colNum(ref));
            const where = sh.name + ' · ' + ref;
            if (hidCell) {
              const why = sh.hidden ? 'hidden sheet' : rowHidden ? 'hidden row' : 'hidden column';
              para({ text: s, visible: false, kind: 'hidden', where: where + ' · ' + why, part: sh.path, ref });
              hidCellsHere.push({ k: where, v: s.slice(0, 120), where: sh.path });
            } else para({ text: s, visible: true, where, part: sh.path, ref, ...((t === 's' || t === 'inlineStr') && !kid(c, 'f') && !/[\t\n]/.test(s) ? { loc: { part: sh.path, ref } } : {}) });
          }
        }
        if (sh.hidden && anyCell) hiddenSheets.push(sh);
        if (!sh.hidden && hidCellsHere.length) hiddenCells.push(...hidCellsHere);
        // links, comments, drawings of this sheet
        for (const r of relsOf(files, sh.path)) {
          if (r.type === 'hyperlink' && r.external) seg({ text: r.target, visible: false, kind: 'link', where: 'Link target on ' + sh.name });
          if (r.type === 'comments' && r.path && has(r.path)) {
            const cr = xml(r.path);
            const auth = els(cr, 'author').map(a => a.textContent);
            for (const cm of els(cr, 'comment')) {
              const body = els(cm, 't').map(x => x.textContent).join('').trim();
              const a = auth[parseInt(attr(cm, 'authorId'), 10)] || '';
              noteAuthor(a, 'comments');
              commentRows.push({ k: a + ' · ' + sh.name + ' ' + attr(cm, 'ref'), v: body });
              if (body) seg({ text: body, visible: false, kind: 'comment', where: 'Comment by ' + (a || 'unknown') + ' on ' + sh.name + ' ' + attr(cm, 'ref') });
            }
          }
        }
      }
      for (const n of names.filter(x => /^xl\/threadedComments\/.*\.xml$/.test(x))) {
        for (const tc of els(xml(n), 'threadedComment')) {
          const body = text(kid(tc, 'text'));
          commentRows.push({ k: 'Threaded comment ' + attr(tc, 'ref'), v: body });
          if (body) seg({ text: body, visible: false, kind: 'comment', where: 'Threaded comment ' + attr(tc, 'ref') });
        }
      }
      for (const n of names.filter(x => /^xl\/persons\/.*\.xml$/.test(x))) for (const p of els(xml(n), 'person')) noteAuthor(attr(p, 'displayName'), 'comments');
      check('cells', 'Cell values of every sheet (also hidden sheets, rows and columns)', 'done');
      if (hiddenSheets.length) {
        const rows = hiddenSheets.map(s => ({ k: s.name, v: s.state === 'veryHidden' ? 'very hidden (cannot be unhidden from the menu)' : 'hidden', where: s.path || '' }));
        finding({ type: 'hidden.sheet', detail: 'Hidden sheets are not shown in Excel tabs but all their cells are stored in the file and can be unhidden.', value: rows.map(r => r.k + ' (' + r.v + ')').join('\n'), items: rows, where: 'xl/workbook.xml', count: rows.length });
      }
      if (hiddenCells.length) finding({ type: 'hidden.cells', detail: 'Rows or columns hidden in the sheet still hold their values. Anyone can unhide them.', value: hiddenCells.slice(0, 30).map(r => r.k + ': ' + r.v).join('\n'), items: hiddenCells.slice(0, 200), where: 'worksheets', count: hiddenCells.length });
      if (commentRows.length) finding({ type: 'hidden.comments', detail: commentRows.length + ' comment(s) with author names. Comments are often internal remarks that were never meant for the recipient.', value: commentRows.map(r => r.k + ': ' + r.v).join('\n'), items: commentRows, where: 'xl/comments', count: commentRows.length });
      check('comments', 'Comments and threaded comments', 'done');

      // defined names
      const dn = els(wb, 'definedName').filter(d => !/^_xlnm\./.test(attr(d, 'name')));
      if (dn.length) {
        const rows = dn.map(d => ({ k: attr(d, 'name'), v: text(d), where: main }));
        for (const r of rows) seg({ text: r.k + ' ' + r.v, visible: false, kind: 'meta', where: 'Defined name ' + r.k });
        finding({ type: 'hidden.names', detail: 'Named ranges and constants are invisible in the grid. They can hold values, file paths and references to other workbooks. Removing one breaks formulas that use it.', value: rows.map(r => r.k + ' = ' + r.v).join('\n'), items: rows, where: main, count: rows.length });
      }
      // external links
      const ext = [];
      for (const r of wbRels) if ((r.external && !/removed\.invalid/.test(r.target)) || r.type === 'externalLink') ext.push({ k: r.type, v: r.external ? r.target : (r.path || ''), where: main });
      for (const n of names.filter(x => /^xl\/externalLinks\/_rels\/.*\.rels$/.test(x))) {
        for (const rel of els(xml(n), 'Relationship')) if (attr(rel, 'TargetMode') === 'External' && !/removed\.invalid/.test(attr(rel, 'Target'))) ext.push({ k: 'externalLink', v: attr(rel, 'Target'), where: n });
      }
      if (ext.length) {
        for (const r of ext) if (r.v) seg({ text: r.v, visible: false, kind: 'link', where: r.k + ' reference' });
        finding({ type: 'external_link', detail: 'The workbook is linked to other files or data sources. The paths can reveal servers and folders, and the cached values of those files are stored inside this one.', value: ext.map(r => r.k + ': ' + r.v).join('\n'), items: ext, where: 'xl/externalLinks', count: ext.length });
      }
      // pivot caches
      const pivots = names.filter(n => /^xl\/pivotCache\/pivotCacheRecords\d*\.xml$/.test(n));
      if (pivots.length) {
        for (const n of names.filter(x => /^xl\/pivotCache\/pivotCacheDefinition\d*\.xml$/.test(x))) {
          const t = els(xml(n), 's').map(x => attr(x, 'v')).filter(Boolean).slice(0, 5000).join('\n');
          if (t) seg({ text: t, visible: false, kind: 'cache', where: n + ' · pivot cache items' });
        }
        finding({ type: 'hidden.pivot', detail: 'A pivot table keeps a copy of its source data inside the file, even if the source rows were deleted from the sheets.', where: 'xl/pivotCache', count: pivots.length });
      }
      // charts: cached labels and values
      for (const n of names.filter(x => /^xl\/charts\/chart\d*\.xml$/.test(x))) {
        const t = els(xml(n), 'v').map(x => x.textContent).concat(els(xml(n), 't').map(x => x.textContent)).join(' ').trim();
        if (t) seg({ text: t, visible: false, kind: 'chart', where: n });
      }
    }

    // ================================================================ PPTX
    if (kind === 'pptx') {
      const pres = xml(main);
      const rels = relsOf(files, main);
      const relById = new Map(rels.map(r => [r.id, r]));
      const sz = els(pres, 'sldSz')[0];
      const W = sz ? parseInt(attr(sz, 'cx'), 10) : 0, Hh = sz ? parseInt(attr(sz, 'cy'), 10) : 0;
      const order = els(pres, 'sldId').map(s => relById.get(s.getAttribute('r:id'))).filter(Boolean).map(r => r.path).filter(p => p && has(p));
      const slideHidden = [], offSlide = [], hiddenShapes = [], notes = [], commentRows = [];
      let no = 0;
      const shapeText = (root, label, slideHide, part) => {
        const allP = els(root, 'p');
        for (const sp of els(root, 'sp').concat(els(root, 'graphicFrame'), els(root, 'pic'))) {
          const nv = els(sp, 'cNvPr')[0];
          const shapeHidden = nv && (attr(nv, 'hidden') === '1' || attr(nv, 'hidden') === 'true');
          const off = els(sp, 'off')[0], ext = els(sp, 'ext')[0];
          let outside = false;
          if (off && ext && W && Hh) {
            const x = parseInt(attr(off, 'x'), 10), y = parseInt(attr(off, 'y'), 10), cx = parseInt(attr(ext, 'cx'), 10), cy = parseInt(attr(ext, 'cy'), 10);
            outside = x + cx <= 0 || y + cy <= 0 || x >= W || y >= Hh;
          }
          if (h.closest(sp, ['grpSp'])) outside = false;
          for (const p of els(sp, 'p')) {
            // a nested shape (group) is visited on its own
            const t = els(p, 't').map(x => x.textContent).join('').trim();
            if (!t) continue;
            const hid = slideHide || shapeHidden || outside;
            const plainP = !hid && !/[\t\n]/.test(t) && !els(p, 'fld').length && !els(p, 'br').length;
            para({ ...(plainP ? { loc: { part, idx: allP.indexOf(p) } } : {}), text: t, visible: !hid, kind: hid ? 'hidden' : 'text', where: label + (shapeHidden ? ' · hidden shape' : outside ? ' · outside the slide' : slideHide ? ' · hidden slide' : ''), part: label });
            if (shapeHidden) hiddenShapes.push({ k: label, v: t.slice(0, 120), where: label });
            else if (outside) offSlide.push({ k: label, v: t.slice(0, 120), where: label });
          }
        }
      };
      order.forEach((path, i) => {
        no++;
        const root = xml(path);
        const label = 'Slide ' + no;
        const hid = attr(root, 'show') === '0';
        if (hid) slideHidden.push({ k: label, v: 'hidden slide', where: path });
        shapeText(root, label, hid, path);
        for (const r of relsOf(files, path)) {
          if (r.type === 'hyperlink' && r.external) seg({ text: r.target, visible: false, kind: 'link', where: 'Link target on ' + label });
          if (r.type === 'notesSlide' && r.path && has(r.path)) {
            const t = els(xml(r.path), 'sp').filter(sp => /body|sldNum/i.test((els(sp, 'ph')[0] ? attr(els(sp, 'ph')[0], 'type') : '')) || (els(sp, 'ph')[0] && attr(els(sp, 'ph')[0], 'type') === 'body'))
              .map(sp => els(sp, 'p').map(p => els(p, 't').map(x => x.textContent).join('')).join('\n')).join('\n').trim();
            if (t) { notes.push({ k: label, v: t, where: r.path }); seg({ text: t, visible: false, kind: 'notes', where: 'Speaker notes of ' + label }); }
          }
          if (r.type === 'comments' && r.path && has(r.path)) {
            for (const cm of els(xml(r.path), 'cm')) {
              const body = text(kid(cm, 'text')); commentRows.push({ k: label + ' · author ' + attr(cm, 'authorId'), v: body });
              if (body) seg({ text: body, visible: false, kind: 'comment', where: 'Comment on ' + label });
            }
          }
        }
      });
      for (const n of names.filter(x => /^ppt\/comments\/modernComment_.*\.xml$/.test(x))) {
        for (const cm of els(xml(n), 'cm')) {
          const body = els(cm, 't').map(x => x.textContent).join(' ').trim();
          commentRows.push({ k: 'Modern comment ' + attr(cm, 'authorId'), v: body });
          if (body) seg({ text: body, visible: false, kind: 'comment', where: 'Modern comment' });
        }
      }
      if (has('ppt/commentAuthors.xml')) for (const a of els(xml('ppt/commentAuthors.xml'), 'cmAuthor')) { noteAuthor(attr(a, 'name'), 'comments'); }
      if (has('ppt/authors.xml')) for (const a of els(xml('ppt/authors.xml'), 'author')) noteAuthor(attr(a, 'name'), 'comments');
      doc.meta.slides = no;
      check('slides', 'Text of every slide (also hidden slides and shapes)', 'done');
      if (slideHidden.length) finding({ type: 'hidden.slide', detail: 'Hidden slides are skipped when presenting, but all their text and pictures are stored in the file.', value: slideHidden.map(r => r.k).join('\n'), items: slideHidden, where: 'ppt/slides', count: slideHidden.length });
      if (notes.length) finding({ type: 'hidden.notes', detail: 'Speaker notes are not shown to the audience, but they travel with the file. They often hold talking points, internal remarks and names.', value: notes.map(r => r.k + ': ' + r.v).join('\n'), items: notes, where: 'ppt/notesSlides', count: notes.length });
      if (hiddenShapes.length) finding({ type: 'hidden.text', detail: 'Text in shapes that are switched off in the selection pane is not shown, but it is part of the slide.', value: hiddenShapes.map(r => r.k + ': ' + r.v).join('\n'), items: hiddenShapes, where: 'ppt/slides', count: hiddenShapes.length });
      if (offSlide.length) finding({ type: 'hidden.offpage', detail: 'Text placed outside the slide area is not shown while presenting but can be found by anyone who opens the file.', value: offSlide.map(r => r.k + ': ' + r.v).join('\n'), items: offSlide, where: 'ppt/slides', count: offSlide.length });
      if (commentRows.length) finding({ type: 'hidden.comments', detail: commentRows.length + ' comment(s) with author names. Comments are often internal remarks that were never meant for the recipient.', value: commentRows.map(r => r.k + ': ' + r.v).join('\n'), items: commentRows, where: 'ppt/comments', count: commentRows.length });
      check('notes', 'Speaker notes and comments', 'done');
      // external references
      const ext = [];
      for (const n of names.filter(x => x.endsWith('.rels') && /^ppt\//.test(x))) {
        for (const rel of els(xml(n), 'Relationship')) {
          if (attr(rel, 'TargetMode') !== 'External') continue;
          const type = String(attr(rel, 'Type')).split('/').pop();
          if (type !== 'hyperlink' && !/removed\.invalid/.test(attr(rel, 'Target'))) ext.push({ k: type, v: attr(rel, 'Target'), where: n });
        }
      }
      if (ext.length) {
        for (const r of ext) seg({ text: r.v, visible: false, kind: 'link', where: r.k + ' reference' });
        finding({ type: 'external_link', detail: 'The presentation points to files or resources outside itself (linked media, charts, templates). The paths can reveal servers and folders.', value: ext.map(r => r.k + ': ' + r.v).join('\n'), items: ext, where: 'relationship parts', count: ext.length });
      }
      for (const n of names.filter(x => /^ppt\/charts\/chart\d*\.xml$/.test(x))) {
        const r = xml(n), t = els(r, 'v').map(x => x.textContent).concat(els(r, 't').map(x => x.textContent)).join(' ').trim();
        if (t) seg({ text: t, visible: false, kind: 'chart', where: n });
      }
    }

    // ---------------------------------------------------------------- shared reporting
    for (const [group, rows] of Object.entries(meta)) {
      if (group === 'author' || !rows.length) continue;
      finding({ type: META_TYPE[group], detail: META_DETAIL[group], value: rows.map(r => r.k + ': ' + r.v).join('\n'), items: rows, where: [...new Set(rows.map(r => r.where))].join(', ') });
    }
    {
      const rows = [...authors.entries()].map(([n, w]) => ({ k: n, v: [...w].join(', '), where: '' }));
      if (rows.length) finding({ type: 'meta.author', detail: META_DETAIL.author + ' Found in: ' + [...new Set(rows.flatMap(r => r.v.split(', ')))].join(', ') + '.', value: rows.map(r => r.k).join('\n'), items: rows, where: 'docProps/core.xml, comments', count: rows.length });
    }
    const embedded = names.filter(n => new RegExp('^' + dir + '(embeddings|activeX|objects)/').test(n) && !n.endsWith('.rels'));
    if (embedded.length) {
      const rows = embedded.map(n => ({ k: n.split('/').pop(), v: util.fmtBytes(files[n].length), where: n }));
      finding({ type: 'embedded', detail: 'Embedded objects can contain full files, for example the whole spreadsheet behind a chart. They are not part of what you see on the page.', value: rows.map(r => r.k + ' (' + r.v + ')').join('\n'), items: rows, where: dir + 'embeddings', count: rows.length });
    }
    const macroParts = names.filter(n => /vbaProject\.bin$|vbaData\.xml$/i.test(n));
    if (macroParts.length || /\.(xlsm|pptm)$/i.test(name)) finding({ type: 'macro', detail: 'The file contains a macro project. Macros can run code and often hold internal names, paths and comments.', value: macroParts.join('\n'), where: macroParts[0] || name });
    const thumb = names.find(n => /^docProps\/thumbnail\./i.test(n));
    if (thumb) finding({ type: 'thumbnail', detail: 'A small preview image of the first page was saved with the file. It may still show content that was later removed.', where: thumb });
    const cx = names.filter(n => /^customXml\/item\d+\.xml$/.test(n));
    if (cx.length) {
      const rows = cx.map(n => { const r = xml(n), t = (r.textContent || '').trim(); if (t) seg({ text: t.slice(0, 20000), visible: false, kind: 'meta', where: n }); return { k: n.split('/').pop() + ' <' + r.localName + '>', v: t.slice(0, 200), where: n }; });
      finding({ type: 'hidden.custom_xml', conf: 'medium', detail: 'Custom XML parts hold data for add-ins or document management systems. Exposift lists them but cannot tell whether the data is sensitive.', value: rows.map(r => r.k + (r.v ? ': ' + r.v : '')).join('\n'), items: rows, where: 'customXml', count: rows.length });
    }
    check('embedded', 'Embedded objects, macros, thumbnail, custom XML', 'done');
    if (kind === 'xlsx' && has('xl/workbook.xml') && els(xml('xl/workbook.xml'), 'workbookProtection').some(e => ['lockStructure', 'lockWindows', 'lockRevision'].some(k => ['1', 'true'].includes(attr(e, k))) || attr(e, 'workbookPassword') || attr(e, 'workbookHashValue'))) finding({ type: 'protection', detail: 'Workbook structure protection is on. Removing content may be blocked or may invalidate the protection.', where: 'xl/workbook.xml' });
    // pictures
    const media = names.filter(n => new RegExp('^' + dir + 'media/').test(n));
    let exifN = 0, gpsN = 0; const exifRows = [];
    for (const n of media) {
      if (!/\.jpe?g$/i.test(n)) continue;
      const ex = util.readExif(files[n]); if (!ex) continue;
      exifN++;
      const bits = [ex.make, ex.model, ex.software, ex.artist, ex.date].filter(Boolean).join(', ');
      exifRows.push({ k: n.split('/').pop(), v: (ex.gps ? 'GPS position; ' : '') + bits, where: n });
      if (ex.gps) gpsN++;
      for (const s of [ex.artist, ex.software, ex.copyright]) if (s) seg({ text: s, visible: false, kind: 'meta', where: n + ' · EXIF' });
    }
    if (gpsN) finding({ type: 'image_gps', conf: 'high', detail: gpsN + ' picture(s) contain the location where the photo was taken.', value: exifRows.filter(r => /GPS/.test(r.v)).map(r => r.k).join('\n'), items: exifRows, where: dir + 'media', count: gpsN });
    if (exifN) finding({ type: 'image_exif', detail: 'Pictures keep camera, software, owner and date data inside the image file.', value: exifRows.map(r => r.k + ': ' + r.v).join('\n'), items: exifRows, where: dir + 'media', count: exifN });
    check('images.exif', 'Photo metadata (EXIF) in JPEG pictures', 'done');
    if (media.length) {
      doc.unsupported.push({ id: 'images.text', label: 'Text inside ' + media.length + ' picture(s)', note: 'Text drawn inside images (screenshots, scans) is not read in this version.' });
      check('images.text', 'Text inside pictures', 'not_run', 'Not read automatically. Use "Read text in pictures (OCR)" to scan them.');
    }
    doc.meta = { ...doc.meta, paragraphs: paraNo, parts: names.length, sheets: sheetsSeen, cells: cellsSeen };
    return doc;
  }

  async function readOffice(bytes, name) {
    const files = U().safeUnzip(bytes);
    const has = n => Object.prototype.hasOwnProperty.call(files, n);
    if (has('word/document.xml')) return Ex.adapters.docx.read(bytes, name);
    if (has('xl/workbook.xml')) return readOoxml(bytes, name, 'xlsx');
    if (has('ppt/presentation.xml')) return readOoxml(bytes, name, 'pptx');
    throw new (U().ExposiftError)('not_office', 'This ZIP file is not a Word, Excel or PowerPoint document.');
  }

  Ex.adapters = Ex.adapters || {};
  Ex.adapters.office = { read: readOffice, readOoxml };
  Ex.adapters.xlsx = { read: (b, n) => readOoxml(b, n, 'xlsx') };
  Ex.adapters.pptx = { read: (b, n) => readOoxml(b, n, 'pptx') };
  Ex.ooxml = { resolve, dirOf, relsOf, colNum };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ex;
})(typeof window !== 'undefined' ? window : globalThis);
