/*
 * Exposift – writes rewritten text back into the ORIGINAL file (Transform mode).
 * Only plain paragraphs and cells are changed: the first run keeps its formatting and takes the new text,
 * the other runs of that paragraph are emptied. Pictures, tables, styles, headers and everything else stay as they were.
 * Nothing here sends anything anywhere.
 */
(function (g) {
  'use strict';
  const Ex = g.Ex = g.Ex || {};

  /** edits: [{ part, idx | ref, text }] -> { bytes, changed, skipped } */
  function apply(bytes, format, edits) {
    const util = Ex.util, h = Ex.adapters.docx.h, X = Ex.ooxmlUtil;
    const files = util.safeUnzip(bytes);
    const has = n => Object.prototype.hasOwnProperty.call(files, n);
    const byPart = new Map();
    for (const e of edits) { if (!byPart.has(e.part)) byPart.set(e.part, []); byPart.get(e.part).push(e); }
    let changed = 0, skipped = 0;
    const sheetsTouched = format === 'xlsx';
    for (const [part, list] of byPart) {
      if (!has(part)) { skipped += list.length; continue; }
      const root = h.parseXml(util.decodeXml(files[part]));
      if (format === 'xlsx') {
        const cells = new Map();
        for (const c of h.els(root, 'c')) cells.set(h.attr(c, 'r'), c);
        for (const e of list) {
          const c = cells.get(e.ref);
          if (!c || h.kid(c, 'f')) { skipped++; continue; }
          while (c.firstChild) c.removeChild(c.firstChild);
          c.setAttribute('t', 'inlineStr');
          const d = c.ownerDocument, is = d.createElementNS(c.namespaceURI, 'is'), tt = d.createElementNS(c.namespaceURI, 't');
          tt.textContent = e.text; tt.setAttribute('xml:space', 'preserve'); is.appendChild(tt); c.appendChild(is); changed++;
        }
      } else {
        const paras = h.els(root, 'p');
        for (const e of list) {
          const p = paras[e.idx];
          if (!p) { skipped++; continue; }
          // text nodes of the paragraph itself (a nested text box has its own paragraphs)
          const nodes = h.els(p, 't').filter(n => h.closest(n, ['p']) === p && !(n.parentNode && n.parentNode.localName === 'rPh'));
          if (!nodes.length) { skipped++; continue; }
          nodes.forEach((n, i) => { n.textContent = i === 0 ? e.text : ''; if (i === 0) n.setAttribute('xml:space', 'preserve'); });
          changed++;
        }
      }
      files[part] = X.enc.encode(X.XMLDECL + X.ser(root));
    }
    // strings no cell uses any more are blanked, so the old wording does not stay in the shared string table
    if (sheetsTouched && has('xl/sharedStrings.xml')) {
      const used = new Set();
      for (const n of Object.keys(files)) if (/^xl\/worksheets\/sheet[^/]*\.xml$/.test(n)) for (const c of h.els(h.parseXml(util.decodeXml(files[n])), 'c')) if (h.attr(c, 't') === 's') used.add(parseInt(h.text(h.kid(c, 'v')), 10));
      const ss = h.parseXml(util.decodeXml(files['xl/sharedStrings.xml']));
      h.els(ss, 'si').forEach((si, i) => { if (!used.has(i)) { while (si.firstChild) si.removeChild(si.firstChild); si.appendChild(ss.ownerDocument.createElementNS(si.namespaceURI, 't')); } });
      files['xl/sharedStrings.xml'] = X.enc.encode(X.XMLDECL + X.ser(ss));
    }
    return { bytes: g.fflate.zipSync(files, { level: 6 }), changed, skipped };
  }

  Ex.transform = { apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ex;
})(typeof window !== 'undefined' ? window : globalThis);
