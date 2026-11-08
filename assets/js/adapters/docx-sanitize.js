/*
 * Exposift – DOCX sanitizer (EXP-005) and independent verifier (EXP-006).
 *
 * The sanitizer edits the XML parts directly: removed content is deleted from the package, not hidden.
 * The verifier never reuses the sanitizer's code path: it re-opens the output bytes, searches every
 * part (also decoded, tag-stripped and inside nested ZIPs) for the removed values, checks that the
 * package is still consistent and re-runs the inspection.
 */
(function (g) {
  'use strict';
  const Ex = g.Ex = g.Ex || {};

  const enc = new TextEncoder();
  const ser = (n) => (Ex.env && Ex.env.serialize ? Ex.env.serialize(n) : new XMLSerializer().serializeToString(n));
  const XMLDECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const TOKEN = '████';
  const fold = (s) => Ex.detectUtil.fold(s);

  const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
  function resolve(ownerDir, target) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
    const parts = (target.startsWith('/') ? target.slice(1) : ownerDir + target).split('/');
    const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
    return out.join('/');
  }
  const ownerOf = (relsPath) => {            // word/_rels/document.xml.rels -> {dir:'word/', part:'word/document.xml'}
    const m = /^(.*?)_rels\/(.*)\.rels$/.exec(relsPath);
    return m ? { dir: m[1], part: m[1] + m[2] } : { dir: '', part: '' };
  };

  /** Removes the EXIF/XMP/comment segments of a JPEG, keeps the image data */
  function stripJpeg(u8) {
    if (u8[0] !== 0xFF || u8[1] !== 0xD8) return u8;
    const out = [u8[0], u8[1]];
    let p = 2;
    while (p + 4 <= u8.length) {
      if (u8[p] !== 0xFF) break;
      const marker = u8[p + 1];
      if (marker === 0xDA) break;                                   // start of scan: the rest is image data
      const len = (u8[p + 2] << 8) | u8[p + 3];
      const drop = marker === 0xE1 || marker === 0xED || marker === 0xFE;   // APP1 (EXIF, XMP), APP13 (Photoshop), comment
      if (!drop) for (let i = 0; i < 2 + len; i++) out.push(u8[p + i]);
      p += 2 + len;
    }
    const head = Uint8Array.from(out);
    const res = new Uint8Array(head.length + (u8.length - p));
    res.set(head, 0); res.set(u8.subarray(p), head.length);
    return res;
  }

  function sanitizeDocx(bytes, plan) {
    const util = Ex.util, H = Ex.adapters.docx.h;
    const files = util.safeUnzip(bytes);
    const has = (n) => Object.prototype.hasOwnProperty.call(files, n);
    const T = plan.structTypes;
    const values = plan.values.filter(v => v && v.length >= 2);
    const foldedValues = values.map(fold).filter(v => v.length >= 2).sort((a, b) => b.length - a.length);
    const ops = [];
    const count = { comments: 0, deleted: 0, inserted: 0, hidden: 0, lookalike: 0, redacted: 0, parts: 0, images: 0, links: 0 };
    const parse = (n) => H.parseXml(util.decodeXml(files[n]));
    const put = (n, root) => { files[n] = enc.encode(XMLDECL + ser(root)); };
    const drop = new Set();                                         // parts to delete
    const dropRels = new Map();                                     // owner part -> Set(rId)

    const anyMeta = [...T].some(t => t.startsWith('meta.'));
    const wantComments = T.has('hidden.comments');
    const wantTracked = T.has('hidden.tracked');
    const wantDeleted = wantTracked || T.has('hidden.deleted');
    const wantExif = T.has('image_exif') || T.has('image_gps');

    // ------------------------------------------------------------ relationships
    for (const relsPath of Object.keys(files).filter(n => n.endsWith('.rels'))) {
      const { dir, part } = ownerOf(relsPath);
      const root = parse(relsPath);
      let changed = false;
      for (const rel of H.els(root, 'Relationship')) {
        const type = String(H.attr(rel, 'Type')).split('/').pop();
        const external = H.attr(rel, 'TargetMode') === 'External';
        const target = H.attr(rel, 'Target');
        const path = external ? null : resolve(dir, target);
        let remove = false;
        if (!external && path) {
          if (T.has('embedded') && /^word\/(embeddings|activeX|objects)\//.test(path)) remove = true;
          else if (T.has('thumbnail') && type === 'thumbnail') remove = true;
          else if (T.has('hidden.custom_xml') && (type === 'customXml' || type === 'customXmlProps')) remove = true;
          else if (wantComments && /^(comments|commentsExtended|commentsIds|commentsExtensible)$/.test(type)) remove = true;
          else if ((wantComments || T.has('meta.author')) && type === 'people') remove = true;
          else if (T.has('meta.custom') && type === 'custom-properties') remove = true;
          if (remove) { drop.add(path); if (path.includes('/')) drop.add(dirOf(path) + '_rels/' + path.split('/').pop() + '.rels'); }
        } else if (external) {
          if (T.has('external_link') && type !== 'hyperlink') remove = true;
          else if (foldedValues.length && foldedValues.some(v => fold(target).includes(v))) {
            rel.setAttribute('Target', 'https://removed.invalid/'); count.links++; changed = true; continue;
          }
        }
        if (remove) {
          const id = H.attr(rel, 'Id');
          if (!dropRels.has(part)) dropRels.set(part, new Set());
          dropRels.get(part).add(id);
          rel.parentNode.removeChild(rel); changed = true; count.parts++;
        }
      }
      if (changed) put(relsPath, root);
    }
    if (T.has('hidden.custom_xml')) for (const n of Object.keys(files)) if (/^customXml\//.test(n)) drop.add(n);
    if (T.has('thumbnail')) for (const n of Object.keys(files)) if (/^docProps\/thumbnail\./i.test(n)) drop.add(n);
    if (T.has('meta.custom')) drop.add('docProps/custom.xml');
    if (wantComments) for (const n of Object.keys(files)) if (/^word\/comments(Extended|Ids|Extensible)?\.xml$/.test(n)) drop.add(n);
    if (wantComments || T.has('meta.author')) drop.add('word/people.xml');
    if (T.has('embedded')) for (const n of Object.keys(files)) if (/^word\/(embeddings|activeX|objects)\//.test(n)) drop.add(n);

    // ------------------------------------------------------------ content parts
    const redactParagraph = (p) => {
      if (!foldedValues.length) return;
      const nodes = [];
      for (const r of H.els(p, 'r')) {
        if (H.closest(r, ['p']) !== p) continue;
        for (const c of Array.from(r.childNodes)) if (c.nodeType === 1 && (c.localName === 't' || c.localName === 'delText')) nodes.push(c);
      }
      if (!nodes.length) return;
      const texts = nodes.map(n => n.textContent);
      const full = fold(texts.join(''));
      const ranges = [];
      for (const v of foldedValues) { let i = 0; while ((i = full.indexOf(v, i)) !== -1) { ranges.push([i, i + v.length]); i += v.length; } }
      if (!ranges.length) return;
      ranges.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const r of ranges) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice()); }
      const starts = []; let acc = 0; for (const t of texts) { starts.push(acc); acc += t.length; }
      for (let k = merged.length - 1; k >= 0; k--) {
        const [a, b] = merged[k]; let first = true;
        for (let n = 0; n < nodes.length; n++) {
          const ns = starts[n], ne = ns + texts[n].length;
          if (ne <= a || ns >= b) continue;
          const ls = Math.max(a, ns) - ns, le = Math.min(b, ne) - ns;
          texts[n] = texts[n].slice(0, ls) + (first ? TOKEN : '') + texts[n].slice(le);
          first = false;
        }
        count.redacted++;
      }
      nodes.forEach((n, i) => { if (n.textContent !== texts[i]) { n.textContent = texts[i]; n.setAttribute('xml:space', 'preserve'); } });
    };

    const removeNode = (n) => { if (n && n.parentNode) n.parentNode.removeChild(n); };
    const unwrap = (n) => { const par = n.parentNode; while (n.firstChild) par.insertBefore(n.firstChild, n); par.removeChild(n); };

    const contentParts = Object.keys(files).filter(n => /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(n) && !drop.has(n));
    for (const part of contentParts) {
      const root = parse(part);
      const ids = dropRels.get(part);

      if (wantComments) {
        for (const e of H.els(root, 'commentRangeStart').concat(H.els(root, 'commentRangeEnd'))) removeNode(e);
        for (const e of H.els(root, 'commentReference')) {
          const run = e.parentNode;
          removeNode(e);
          if (run && run.localName === 'r' && !Array.from(run.childNodes).some(c => c.nodeType === 1 && c.localName !== 'rPr')) removeNode(run);
        }
      }
      if (wantDeleted) {
        for (const e of H.els(root, 'del').concat(H.els(root, 'moveFrom'))) {
          if (e.parentNode && e.parentNode.localName === 'rPr') { removeNode(e); continue; }
          count.deleted++; removeNode(e);
        }
        for (const nm of ['moveFromRangeStart', 'moveFromRangeEnd']) for (const e of H.els(root, nm)) removeNode(e);
      }
      if (wantTracked) {
        for (const e of H.els(root, 'ins').concat(H.els(root, 'moveTo'))) {
          if (e.parentNode && e.parentNode.localName === 'rPr') { removeNode(e); continue; }
          count.inserted++; unwrap(e);
        }
        for (const e of Array.from(root.getElementsByTagNameNS('*', '*'))) if (/PrChange$/.test(e.localName) || e.localName === 'moveToRangeStart' || e.localName === 'moveToRangeEnd') removeNode(e);
      }
      if (T.has('hidden.text') || T.has('hidden.lookalike')) {
        for (const r of H.els(root, 'r')) {
          const k = H.runKind(r);
          if ((k === 'hidden' && T.has('hidden.text')) || (k === 'lookalike' && T.has('hidden.lookalike'))) { k === 'hidden' ? count.hidden++ : count.lookalike++; removeNode(r); }
        }
      }
      if (T.has('meta.author')) {
        for (const e of Array.from(root.getElementsByTagNameNS('*', '*'))) {
          if (H.attr(e, 'author')) { for (const a of Array.from(e.attributes)) { const ln = a.localName || a.name.split(':').pop(); if (ln === 'author') a.value = 'Author'; if (ln === 'initials') a.value = ''; } }
        }
      }
      if (T.has('hidden.custom_xml')) for (const e of H.els(root, 'dataBinding')) removeNode(e);
      if (ids && ids.size) {
        for (const e of Array.from(root.getElementsByTagNameNS('*', '*'))) {
          if (!e.parentNode) continue;
          for (const a of Array.from(e.attributes || [])) {
            if (!/^r:/.test(a.name) || !ids.has(a.value)) continue;
            let victim = e, n = e;
            while (n && n.nodeType === 1) { if (['object', 'drawing', 'pict'].includes(n.localName)) { victim = n; break; } if (n.localName === 'r') { victim = n; break; } n = n.parentNode; }
            removeNode(victim); break;
          }
        }
      }
      for (const p of H.els(root, 'p')) redactParagraph(p);
      for (const e of H.els(root, 'instrText')) if (foldedValues.some(v => fold(e.textContent).includes(v))) { e.textContent = ''; count.redacted++; }
      put(part, root);
    }

    // ------------------------------------------------------------ metadata and other XML parts
    const redactText = (root) => {
      if (!foldedValues.length) return;
      for (const e of Array.from(root.getElementsByTagNameNS('*', '*'))) {
        if (e.childNodes.length !== 1 || e.firstChild.nodeType !== 3) continue;
        let tx = e.firstChild.nodeValue, f = fold(tx), hit = false;
        for (const v of foldedValues) {
          let i;
          while ((i = f.indexOf(v)) !== -1) { tx = tx.slice(0, i) + TOKEN + tx.slice(i + v.length); f = fold(tx); hit = true; count.redacted++; }
        }
        if (hit) e.firstChild.nodeValue = tx;
      }
    };
    const META_MAP = {
      'meta.author': ['creator', 'lastModifiedBy'], 'meta.org': ['Company', 'Manager'], 'meta.software': ['Application', 'AppVersion'],
      'meta.dates': ['created', 'modified', 'lastPrinted', 'TotalTime', 'revision'],
      'meta.title': ['title', 'subject', 'keywords', 'description', 'category'], 'meta.path': ['HyperlinkBase', 'Template']
    };
    for (const part of ['docProps/core.xml', 'docProps/app.xml']) {
      if (!has(part) || drop.has(part)) continue;
      const root = parse(part);
      for (const [type, names] of Object.entries(META_MAP)) {
        if (!T.has(type)) continue;
        for (const nm of names) for (const e of H.els(root, nm)) removeNode(e);
      }
      redactText(root);
      put(part, root);
    }
    if (has('docProps/custom.xml') && !drop.has('docProps/custom.xml')) { const root = parse('docProps/custom.xml'); redactText(root); put('docProps/custom.xml', root); }
    if (has('word/settings.xml')) {
      const root = parse('word/settings.xml');
      if (T.has('hidden.vars')) for (const e of H.els(root, 'docVars')) removeNode(e);
      if (T.has('external_link')) for (const e of H.els(root, 'attachedTemplate')) removeNode(e);
      put('word/settings.xml', root);
    }
    for (const n of Object.keys(files)) {
      if (drop.has(n)) continue;
      if (/^customXml\/item\d+\.xml$/.test(n) || /^word\/(charts\/chart|diagrams\/data)\d*\.xml$/.test(n)) { const root = parse(n); redactText(root); put(n, root); }
    }
    if (wantExif) {
      for (const n of Object.keys(files)) if (/^word\/media\/.*\.jpe?g$/i.test(n)) { files[n] = stripJpeg(files[n]); count.images++; }
    }

    // ------------------------------------------------------------ package bookkeeping
    if (has('[Content_Types].xml')) {
      const root = parse('[Content_Types].xml');
      for (const o of H.els(root, 'Override')) if (drop.has(H.attr(o, 'PartName').replace(/^\//, ''))) removeNode(o);
      put('[Content_Types].xml', root);
    }
    const out = {};
    if (files['[Content_Types].xml']) out['[Content_Types].xml'] = files['[Content_Types].xml'];
    for (const n of Object.keys(files)) if (n !== '[Content_Types].xml' && !drop.has(n)) out[n] = files[n];

    if (count.comments || wantComments) ops.push('Comments removed');
    if (wantDeleted) ops.push('Tracked changes accepted (' + count.deleted + ' deletion(s) dropped)');
    if (count.hidden) ops.push(count.hidden + ' hidden run(s) removed');
    if (count.lookalike) ops.push(count.lookalike + ' white or tiny run(s) removed');
    if (anyMeta) ops.push('Document properties cleared');
    if (drop.size) ops.push(drop.size + ' package part(s) deleted');
    if (count.images) ops.push('Photo metadata stripped from ' + count.images + ' picture(s)');
    if (count.redacted) ops.push(count.redacted + ' value occurrence(s) replaced with a block');
    if (count.links) ops.push(count.links + ' link target(s) neutralized');

    return { bytes: g.fflate.zipSync(out, { level: 6 }), ops };
  }

  // ====================================================================== verifier
  const decodeEntities = (s) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  /** Text views of one part: raw, entity-decoded, tag-stripped (rejoins values split across runs), UTF-16 */
  function textViews(name, u8, util) {
    const views = [];
    const isXml = /\.(xml|rels)$/i.test(name);
    const utf8 = new TextDecoder('utf-8').decode(u8);
    views.push(utf8);
    if (isXml) {
      const dec = decodeEntities(utf8);
      views.push(dec, decodeEntities(utf8.replace(/<[^>]*>/g, '')), decodeEntities(utf8.replace(/<[^>]*>/g, ' ')));
    } else {
      views.push(new TextDecoder('latin1').decode(u8));
      if (u8.length % 2 === 0 || u8.length > 2) views.push(new TextDecoder('utf-16le').decode(u8.subarray(0, u8.length - (u8.length % 2))));
    }
    return views.map(fold);
  }

  async function verifyDocx(outBytes, plan, opts = {}) {
    const util = Ex.util, H = Ex.adapters.docx.h;
    const checks = [];
    const add = (id, label, status, detail = '') => checks.push({ id, label, status, detail });
    let files;
    try { files = util.safeUnzip(outBytes); add('open', 'The cleaned file opens as a valid package', 'pass'); }
    catch (e) { add('open', 'The cleaned file opens as a valid package', 'fail', e.message); return finish(checks, plan, null); }

    // integrity: every XML part parses, every internal relationship points at an existing part
    const broken = [], dangling = [];
    for (const n of Object.keys(files)) {
      if (!/\.(xml|rels)$/i.test(n)) continue;
      try { H.parseXml(util.decodeXml(files[n])); } catch (e) { broken.push(n); continue; }
      if (n.endsWith('.rels')) {
        const { dir } = ownerOf(n);
        for (const rel of H.els(H.parseXml(util.decodeXml(files[n])), 'Relationship')) {
          if (H.attr(rel, 'TargetMode') === 'External') continue;
          const path = resolve(dir, H.attr(rel, 'Target'));
          if (path && !Object.prototype.hasOwnProperty.call(files, path)) dangling.push(n.split('/').pop() + ' → ' + path);
        }
      }
    }
    const mainPart = { docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml' }[opts.format || 'docx'];
    if (!files[mainPart]) broken.push(mainPart);
    add('integrity', 'All XML parts are well-formed and every relationship resolves', broken.length || dangling.length ? 'fail' : 'pass', broken.concat(dangling).slice(0, 5).join('; '));

    // the removed values must not be found anywhere
    const values = plan.values.map(fold).filter(v => v.length >= 2);
    if (values.length) {
      const hits = [];
      const scan = (name, u8, depth) => {
        const views = textViews(name, u8, util);
        values.forEach((v, i) => { if (views.some(t => t.includes(v)) && !hits.some(h => h.i === i && h.part === name)) hits.push({ i, part: name }); });
        if (depth < 2 && u8[0] === 0x50 && u8[1] === 0x4B && !/\.(xml|rels)$/i.test(name)) {
          try { const inner = util.safeUnzip(u8); for (const [n2, b2] of Object.entries(inner)) scan(name + ' ▸ ' + n2, b2, depth + 1); } catch (e) { /* not a zip */ }
        }
      };
      for (const [n, u8] of Object.entries(files)) scan(n, u8, 0);
      add('values', 'Removed values are not found in any part (raw, decoded, tag-stripped, nested)', hits.length ? 'fail' : 'pass',
        hits.length ? hits.slice(0, 5).map(h => 'value #' + (h.i + 1) + ' in ' + h.part).join('; ') : values.length + ' value(s) searched');
    } else add('values', 'Removed values are not found in any part', 'info', 'No values were selected for removal.');

    // re-inspection
    let doc2 = null, left = [];
    try {
      doc2 = await Ex.adapters.office.read(outBytes, 'cleaned.' + (opts.format || 'docx'));
      left = Ex.analyze(doc2, null, opts.names || []);
      add('reopen', 'The cleaned file passes a fresh inspection', 'pass');
    } catch (e) { add('reopen', 'The cleaned file passes a fresh inspection', 'fail', e.message); }
    if (doc2) {
      const still = [...plan.structTypes].map(tp => [tp, left.filter(f => f.type === tp).length]).filter(x => x[1] > 0);
      add('struct', 'Selected kinds of hidden content are gone', still.length ? 'fail' : 'pass', still.map(x => x[0] + ' ×' + x[1]).join(', '));
    }
    add('scope', 'Not checked: text inside pictures', 'info', 'Pictures are not read in this version.');
    return finish(checks, plan, left);
  }

  function finish(checks, plan, leftAfter) {
    const failed = checks.some(c => c.status === 'fail');
    const blocked = plan.blocked.length > 0;
    return { status: failed ? 'failed' : (blocked ? 'partial' : 'verified'), checks, remaining: leftAfter ? leftAfter.length : null };
  }

  Ex.ooxmlUtil = { stripJpeg, resolve, ownerOf, dirOf, TOKEN, fold, enc, ser, XMLDECL };
  Ex.adapters.docx.sanitize = sanitizeDocx;
  Ex.adapters.docx.verify = verifyDocx;
  Ex.verifyUtil = { finish };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ex;
})(typeof window !== 'undefined' ? window : globalThis);
