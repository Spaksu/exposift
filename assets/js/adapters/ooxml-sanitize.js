/*
 * Exposift – XLSX and PPTX sanitizer. Edits the XML parts directly (removed content is deleted from the package, not hidden).
 * Verification is done by Ex.adapters.docx.verify with { format: 'xlsx' | 'pptx' }: it re-opens the output bytes,
 * searches every part for the removed values and re-runs the inspection.
 */
(function (g) {
  'use strict';
  const Ex = g.Ex = g.Ex || {};

  function sanitizeOoxml(bytes, plan, kind) {
    const util = Ex.util, h = Ex.adapters.docx.h, X = Ex.ooxmlUtil, O = Ex.ooxml;
    const { els, kids, kid, attr, text } = h;
    const files = util.safeUnzip(bytes);
    const has = n => Object.prototype.hasOwnProperty.call(files, n);
    const T = plan.structTypes;
    const foldedValues = plan.values.filter(v => v && v.length >= 2).map(X.fold).filter(v => v.length >= 2).sort((a, b) => b.length - a.length);
    const dir = kind === 'xlsx' ? 'xl/' : 'ppt/';
    const main = kind === 'xlsx' ? 'xl/workbook.xml' : 'ppt/presentation.xml';
    const parse = n => h.parseXml(util.decodeXml(files[n]));
    const put = (n, root) => { files[n] = X.enc.encode(X.XMLDECL + X.ser(root)); };
    const drop = new Set();
    const dropIds = new Map();                    // owner part -> Set(rId)
    const count = { redacted: 0, sheets: 0, rows: 0, cols: 0, names: 0, shapes: 0, slides: 0, links: 0, images: 0, formulas: 0 };
    const ops = [];
    const removeNode = n => { if (n && n.parentNode) n.parentNode.removeChild(n); };
    const allEls = root => Array.from(root.getElementsByTagNameNS('*', '*'));
    const dropPart = p => { if (!p) return; drop.add(p); drop.add(O.dirOf(p) + '_rels/' + p.split('/').pop() + '.rels'); };

    const wantComments = T.has('hidden.comments');
    const wantNotes = T.has('hidden.notes');
    const wantExif = T.has('image_exif') || T.has('image_gps');
    const anyMeta = [...T].some(t => t.startsWith('meta.'));

    // ------------------------------------------------------------ hidden slides (pptx): collect first, they take their notes with them
    const removedSlideRids = new Set(), removedSlideIds = new Set();
    if (kind === 'pptx' && T.has('hidden.slide')) {
      const pres = parse(main);
      const rels = new Map(O.relsOf(files, main).map(r => [r.id, r]));
      for (const s of els(pres, 'sldId')) {
        const r = rels.get(s.getAttribute('r:id')); if (!r || !r.path || !has(r.path)) continue;
        if (attr(parse(r.path), 'show') !== '0') continue;
        removedSlideRids.add(r.id); removedSlideIds.add(s.getAttribute('id'));
        dropPart(r.path); count.slides++;
        for (const sr of O.relsOf(files, r.path)) if (sr.type === 'notesSlide' && sr.path) { dropPart(sr.path); drop.add(sr.path); }
      }
    }

    // ------------------------------------------------------------ relationships
    const REMOVE_TYPES = [];
    for (const relsPath of Object.keys(files).filter(n => n.endsWith('.rels'))) {
      const { dir: rd, part } = X.ownerOf(relsPath);
      if (drop.has(relsPath)) continue;
      const root = parse(relsPath);
      let changed = false;
      for (const rel of els(root, 'Relationship')) {
        const id = attr(rel, 'Id'), type = String(attr(rel, 'Type')).split('/').pop();
        const external = attr(rel, 'TargetMode') === 'External', target = attr(rel, 'Target');
        const path = external ? null : X.resolve(rd, target);
        let remove = false;
        if (part === main && removedSlideRids.has(id)) remove = true;
        else if (!external && path) {
          if (T.has('embedded') && new RegExp('^' + dir + '(embeddings|activeX|objects)/').test(path)) remove = true;
          else if (T.has('thumbnail') && type === 'thumbnail') remove = true;
          else if (T.has('hidden.custom_xml') && (type === 'customXml' || type === 'customXmlProps')) remove = true;
          else if (wantComments && /^(comments|commentAuthors|authors|threadedComment|person|vmlDrawing)$/.test(type) && (type !== 'vmlDrawing' || kind === 'xlsx')) remove = true;
          else if (wantNotes && type === 'notesSlide') remove = true;
          else if (T.has('meta.custom') && type === 'custom-properties') remove = true;
          if (remove) dropPart(path);
        } else if (external) {
          if (T.has('external_link') && type !== 'hyperlink') { rel.setAttribute('Target', 'https://removed.invalid/'); changed = true; count.links++; continue; }
          if (foldedValues.length && foldedValues.some(v => X.fold(target).includes(v))) { rel.setAttribute('Target', 'https://removed.invalid/'); changed = true; count.links++; continue; }
        }
        if (remove) {
          if (!dropIds.has(part)) dropIds.set(part, new Set());
          dropIds.get(part).add(id);
          removeNode(rel); changed = true;
        }
      }
      if (changed) put(relsPath, root);
    }
    if (T.has('hidden.custom_xml')) for (const n of Object.keys(files)) if (/^customXml\//.test(n)) drop.add(n);
    if (T.has('thumbnail')) for (const n of Object.keys(files)) if (/^docProps\/thumbnail\./i.test(n)) drop.add(n);
    if (T.has('meta.custom')) drop.add('docProps/custom.xml');
    if (T.has('embedded')) for (const n of Object.keys(files)) if (new RegExp('^' + dir + '(embeddings|activeX|objects)/').test(n)) drop.add(n);
    if (wantComments) for (const n of Object.keys(files)) if (/^(xl\/(comments.*\.xml|threadedComments\/|persons\/)|ppt\/(comments\/|commentAuthors\.xml|authors\.xml))/.test(n)) drop.add(n);
    if (wantNotes) for (const n of Object.keys(files)) if (/^ppt\/notesSlides\//.test(n)) drop.add(n);
    if (kind === 'xlsx') dropPart('xl/calcChain.xml');       // Excel rebuilds it; stale entries would trigger a repair prompt

    // ------------------------------------------------------------ text redaction helper (values split across runs)
    const redactNodes = (nodes) => {
      if (!foldedValues.length || !nodes.length) return;
      const texts = nodes.map(n => n.textContent);
      const full = X.fold(texts.join(''));
      const ranges = [];
      for (const v of foldedValues) { let i = 0; while ((i = full.indexOf(v, i)) !== -1) { ranges.push([i, i + v.length]); i += v.length; } }
      if (!ranges.length) return;
      ranges.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const r of ranges) { const l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push(r.slice()); }
      const starts = []; let acc = 0; for (const t of texts) { starts.push(acc); acc += t.length; }
      for (let k = merged.length - 1; k >= 0; k--) {
        const [a, b] = merged[k]; let first = true;
        for (let n = 0; n < nodes.length; n++) {
          const ns = starts[n], ne = ns + texts[n].length;
          if (ne <= a || ns >= b) continue;
          const ls = Math.max(a, ns) - ns, le = Math.min(b, ne) - ns;
          texts[n] = texts[n].slice(0, ls) + (first ? X.TOKEN : '') + texts[n].slice(le);
          first = false;
        }
        count.redacted++;
      }
      nodes.forEach((n, i) => { if (n.textContent !== texts[i]) { n.textContent = texts[i]; n.setAttribute('xml:space', 'preserve'); } });
    };
    const redactSimple = (root) => {
      if (!foldedValues.length) return;
      for (const e of allEls(root)) {
        if (e.childNodes.length !== 1 || e.firstChild.nodeType !== 3) continue;
        let tx = e.firstChild.nodeValue, f = X.fold(tx), hit = false;
        for (const v of foldedValues) { let i; while ((i = f.indexOf(v)) !== -1) { tx = tx.slice(0, i) + X.TOKEN + tx.slice(i + v.length); f = X.fold(tx); hit = true; count.redacted++; } }
        if (hit) e.firstChild.nodeValue = tx;
      }
    };
    const killRefs = (root, ids) => {
      if (!ids || !ids.size) return;
      for (const e of allEls(root)) {
        if (!e.parentNode) continue;
        for (const a of Array.from(e.attributes || [])) {
          if (!/^r:/.test(a.name) || !ids.has(a.value)) continue;
          let victim = e;
          for (let n = e; n && n.nodeType === 1; n = n.parentNode) {
            if (n.localName === 'graphicFrame') { victim = n; break; }
            if (n.localName === 'AlternateContent' && e.localName === 'oleObject') { victim = n; break; }
          }
          const par = victim.parentNode; removeNode(victim);
          if (par && par.localName === 'oleObjects' && !kids(par, 'oleObject').length && !kids(par, 'AlternateContent').length) removeNode(par);
          break;
        }
      }
    };

    // ------------------------------------------------------------ XLSX content
    if (kind === 'xlsx') {
      const wbPath = main;
      const wb = parse(wbPath);
      const wbRels = new Map(O.relsOf(files, wbPath).map(r => [r.id, r]));
      const sheets = els(wb, 'sheet').map(s => ({ name: attr(s, 'name'), hidden: ['hidden', 'veryHidden'].includes(attr(s, 'state')), path: (wbRels.get(attr(s, 'id')) || {}).path }));
      // shared strings
      if (has('xl/sharedStrings.xml') && foldedValues.length) {
        const ss = parse('xl/sharedStrings.xml');
        for (const si of els(ss, 'si')) redactNodes(els(si, 't').filter(t => !(t.parentNode && t.parentNode.localName === 'rPh')));
        put('xl/sharedStrings.xml', ss);
      }
      const sharedText = [];
      if (has('xl/sharedStrings.xml')) for (const si of els(parse('xl/sharedStrings.xml'), 'si')) sharedText.push(els(si, 't').filter(t => !(t.parentNode && t.parentNode.localName === 'rPh')).map(t => t.textContent).join(''));
      for (const sh of sheets) {
        if (!sh.path || !has(sh.path) || drop.has(sh.path)) continue;
        const root = parse(sh.path);
        const sd = els(root, 'sheetData')[0];
        if (sh.hidden && T.has('hidden.sheet') && sd) { while (sd.firstChild) sd.removeChild(sd.firstChild); count.sheets++; }
        const hiddenCols = new Set();
        if (T.has('hidden.cells')) for (const c of els(root, 'col')) {
          if (attr(c, 'hidden') !== '1' && attr(c, 'hidden') !== 'true') continue;
          const a = parseInt(attr(c, 'min'), 10), b = parseInt(attr(c, 'max'), 10);
          for (let i = a; i <= Math.min(b, a + 200); i++) hiddenCols.add(i);
        }
        for (const row of els(root, 'row')) {
          if (T.has('hidden.cells') && (attr(row, 'hidden') === '1' || attr(row, 'hidden') === 'true')) { removeNode(row); count.rows++; continue; }
          for (const c of kids(row, 'c')) {
            if (hiddenCols.has(O.colNum(attr(c, 'r')))) { removeNode(c); count.cols++; continue; }
            if (!foldedValues.length) continue;
            const t = attr(c, 't'), vEl = kid(c, 'v'), v = text(vEl), f = kid(c, 'f');
            if (f && foldedValues.some(x => X.fold(text(f)).includes(x))) { removeNode(f); count.formulas++; }
            if (t === 'inlineStr') redactNodes(els(c, 't'));
            else if (t === 'str' && vEl) redactNodes([vEl]);
            else if (t === 's') {
              // a shared string already redacted above; nothing to do
            } else if (vEl && foldedValues.some(x => X.fold(v).includes(x))) {
              // numeric cell holding a value: replace by a text block
              while (c.firstChild) c.removeChild(c.firstChild);
              c.setAttribute('t', 'inlineStr');
              const doc = c.ownerDocument, is = doc.createElementNS(c.namespaceURI, 'is'), tt = doc.createElementNS(c.namespaceURI, 't');
              tt.textContent = X.TOKEN; is.appendChild(tt); c.appendChild(is); count.redacted++;
            }
          }
        }
        if (T.has('external_link')) for (const e of els(root, 'hyperlink')) { /* link targets live in the rels file; handled above */ }
        killRefs(root, dropIds.get(sh.path));
        // redact hyperlink display text and similar attributes is out of scope; cells carry the text
        put(sh.path, root);
      }
      // strings that no cell uses any more (their sheet, row or column was removed) are blanked; indexes stay valid
      if ((count.sheets || count.rows || count.cols) && has('xl/sharedStrings.xml')) {
        const used = new Set();
        for (const n of Object.keys(files)) {
          if (drop.has(n) || !/^xl\/worksheets\/sheet[^/]*\.xml$/.test(n)) continue;
          for (const c of els(parse(n), 'c')) if (attr(c, 't') === 's') used.add(parseInt(text(kid(c, 'v')), 10));
        }
        const ss = parse('xl/sharedStrings.xml');
        els(ss, 'si').forEach((si, i) => { if (!used.has(i)) { while (si.firstChild) si.removeChild(si.firstChild); const t = ss.ownerDocument.createElementNS(si.namespaceURI, "t"); si.appendChild(t); } });
        put('xl/sharedStrings.xml', ss);
      }
      // defined names
      if (T.has('hidden.names')) for (const d of els(wb, 'definedName')) if (!/^_xlnm\./.test(attr(d, 'name'))) { removeNode(d); count.names++; }
      if (T.has('meta.path')) for (const e of els(wb, 'absPath')) { const p = e.parentNode; removeNode(p && p.localName === 'Choice' && p.parentNode && p.parentNode.localName === 'AlternateContent' ? p.parentNode : e); }
      if (foldedValues.length) for (const d of els(wb, 'definedName')) redactNodes([d]);
      killRefs(wb, dropIds.get(wbPath));
      put(wbPath, wb);
      // external workbooks: cached cell values
      if (T.has('external_link')) for (const n of Object.keys(files)) if (/^xl\/externalLinks\/externalLink\d+\.xml$/.test(n) && !drop.has(n)) { const r = parse(n); for (const e of els(r, 'sheetDataSet')) removeNode(e); put(n, r); }
      for (const n of Object.keys(files)) {
        if (drop.has(n)) continue;
        if (/^xl\/(comments[^/]*|charts\/chart\d*|externalLinks\/externalLink\d*|pivotCache\/pivotCacheDefinition\d*)\.xml$/.test(n) || /^xl\/threadedComments\//.test(n)) { const r = parse(n); redactSimple(r); put(n, r); }
      }
      if (T.has('meta.author')) for (const n of Object.keys(files)) if (/^xl\/comments[^/]*\.xml$/.test(n) && !drop.has(n)) { const r = parse(n); for (const a of els(r, 'author')) a.textContent = 'Author'; put(n, r); }
    }

    // ------------------------------------------------------------ PPTX content
    if (kind === 'pptx') {
      const pres = parse(main);
      if (removedSlideRids.size) {
        for (const s of els(pres, 'sldId')) { if (s.getAttribute('r:id') && removedSlideRids.has(s.getAttribute('r:id'))) removeNode(s); else if (!s.getAttribute('r:id') && removedSlideIds.has(s.getAttribute('id'))) removeNode(s); }
      }
      killRefs(pres, dropIds.get(main));
      put(main, pres);
      const sz = els(pres, 'sldSz')[0];
      const W = sz ? parseInt(attr(sz, 'cx'), 10) : 0, Hh = sz ? parseInt(attr(sz, 'cy'), 10) : 0;
      for (const n of Object.keys(files)) {
        if (drop.has(n) || !/^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+|charts\/chart\d*|comments\/[^/]+|commentAuthors|authors)\.xml$/.test(n)) continue;
        const root = parse(n);
        if (/^ppt\/slides\//.test(n)) {
          for (const sp of els(root, 'sp').concat(els(root, 'graphicFrame'), els(root, 'pic'))) {
            if (!sp.parentNode) continue;
            const nv = els(sp, 'cNvPr')[0];
            const hid = nv && (attr(nv, 'hidden') === '1' || attr(nv, 'hidden') === 'true');
            let outside = false;
            const off = els(sp, 'off')[0], ext = els(sp, 'ext')[0];
            if (off && ext && W && Hh && !h.closest(sp, ['grpSp'])) {
              const x = parseInt(attr(off, 'x'), 10), y = parseInt(attr(off, 'y'), 10), cx = parseInt(attr(ext, 'cx'), 10), cy = parseInt(attr(ext, 'cy'), 10);
              outside = x + cx <= 0 || y + cy <= 0 || x >= W || y >= Hh;
            }
            const hasText = els(sp, 't').some(t => t.textContent.trim());
            if (hasText && ((hid && T.has('hidden.text')) || (outside && T.has('hidden.offpage')))) { removeNode(sp); count.shapes++; }
          }
          killRefs(root, dropIds.get(n));
        }
        for (const p of els(root, 'p')) redactNodes(els(p, 't'));
        if (/comments|commentAuthors|authors/.test(n) && T.has('meta.author')) for (const e of allEls(root)) if (attr(e, 'name') && e.localName.endsWith('uthor')) e.setAttribute('name', 'Author');
        redactSimple(root);
        put(n, root);
      }
    }

    // ------------------------------------------------------------ metadata
    const META_MAP = {
      'meta.author': ['creator', 'lastModifiedBy'], 'meta.org': ['Company', 'Manager'], 'meta.software': ['Application', 'AppVersion'],
      'meta.dates': ['created', 'modified', 'lastPrinted', 'TotalTime', 'revision'],
      'meta.title': ['title', 'subject', 'keywords', 'description', 'category'], 'meta.path': ['HyperlinkBase', 'Template']
    };
    for (const part of ['docProps/core.xml', 'docProps/app.xml']) {
      if (!has(part) || drop.has(part)) continue;
      const root = parse(part);
      for (const [type, nm] of Object.entries(META_MAP)) if (T.has(type)) for (const x of nm) for (const e of els(root, x)) removeNode(e);
      redactSimple(root); put(part, root);
    }
    if (has('docProps/custom.xml') && !drop.has('docProps/custom.xml')) { const r = parse('docProps/custom.xml'); redactSimple(r); put('docProps/custom.xml', r); }
    for (const n of Object.keys(files)) if (!drop.has(n) && /^customXml\/item\d+\.xml$/.test(n)) { const r = parse(n); redactSimple(r); put(n, r); }
    if (wantExif) for (const n of Object.keys(files)) if (new RegExp('^' + dir + 'media/.*\\.jpe?g$', 'i').test(n) && !drop.has(n)) { files[n] = X.stripJpeg(files[n]); count.images++; }

    // ------------------------------------------------------------ package bookkeeping
    if (has('[Content_Types].xml')) {
      const root = parse('[Content_Types].xml');
      for (const o of els(root, 'Override')) if (drop.has(attr(o, 'PartName').replace(/^\//, ''))) removeNode(o);
      put('[Content_Types].xml', root);
    }
    const out = {};
    if (files['[Content_Types].xml']) out['[Content_Types].xml'] = files['[Content_Types].xml'];
    for (const n of Object.keys(files)) if (n !== '[Content_Types].xml' && !drop.has(n)) out[n] = files[n];

    if (count.sheets) ops.push(count.sheets + ' hidden sheet(s) emptied');
    if (count.rows || count.cols) ops.push('Hidden rows and columns removed (' + count.rows + ' row(s), ' + count.cols + ' cell(s) in hidden columns)');
    if (count.names) ops.push(count.names + ' defined name(s) removed');
    if (count.slides) ops.push(count.slides + ' hidden slide(s) removed');
    if (count.shapes) ops.push(count.shapes + ' hidden or off-slide shape(s) removed');
    if (wantNotes) ops.push('Speaker notes removed');
    if (wantComments) ops.push('Comments removed');
    if (anyMeta) ops.push('Document properties cleared');
    if (drop.size) ops.push(drop.size + ' package part(s) deleted');
    if (count.images) ops.push('Photo metadata stripped from ' + count.images + ' picture(s)');
    if (count.redacted) ops.push(count.redacted + ' value occurrence(s) replaced with a block');
    if (count.formulas) ops.push(count.formulas + ' formula(s) containing a removed value dropped');
    if (count.links) ops.push(count.links + ' link target(s) neutralized');
    return { bytes: g.fflate.zipSync(out, { level: 6 }), ops };
  }

  Ex.adapters.xlsx.sanitize = (b, p) => sanitizeOoxml(b, p, 'xlsx');
  Ex.adapters.pptx.sanitize = (b, p) => sanitizeOoxml(b, p, 'pptx');
  Ex.adapters.xlsx.verify = (b, p, o) => Ex.adapters.docx.verify(b, p, { ...(o || {}), format: 'xlsx' });
  Ex.adapters.pptx.verify = (b, p, o) => Ex.adapters.docx.verify(b, p, { ...(o || {}), format: 'pptx' });
  if (typeof module !== 'undefined' && module.exports) module.exports = Ex;
})(typeof window !== 'undefined' ? window : globalThis);
