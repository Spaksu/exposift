/* Exposift – content detection with the masking rules. Maskink rules find values; the scan mapping (Settings → Scan mapping)
   decides which scan type each match becomes. Native detectors (checksums, validated patterns) keep priority on overlaps. */
(function (g) {
  'use strict';
  const Ex = g.Ex = g.Ex || {};
  let scanner = null, labels = null;
  const words = (v) => String(v).trim().split(/\s+/).length;

  /** Scan type for a field label such as "Full name" or "API token (fictional)", or null */
  Ex.fieldLabel = function (text) {
    if (!labels) return null;
    const k = labels.fold(text);
    return k && k.length <= 40 ? (labels.get(k) || null) : null;
  };
  const valueOk = (type, v) => v.length >= 2 && v.length <= 200 && !Ex.fieldLabel(v) && (type !== 'person' || words(v) <= 6) && (type !== 'secret' || !/\s/.test(v.trim()) || v.length < 80);

  Ex.scanBegin = function () { scanner = g.ExMask && g.ExMask.scanner ? g.ExMask.scanner() : null; labels = g.ExMask && g.ExMask.labelIndex ? g.ExMask.labelIndex() : null; };

  Ex.detectAll = function (text, opts) {
    const native = Ex.detect(text, opts || {});
    if (!scanner) { if (g.ExMask && g.ExMask.scanner) Ex.scanBegin(); if (!scanner) return native; }
    let extra = [];
    try { extra = scanner(text, (opts && opts.names) || []); } catch (e) { extra = []; }
    const out = native.slice();
    for (const x of extra) {
      if (native.some(n => x.start < n.end && x.end > n.start)) continue;
      out.push({ type: x.type, value: x.value, start: x.start, end: x.end, conf: 'medium', note: 'Matched rule: ' + x.rule, sub: x.category, rule: x.rule });
    }
    // "Label: value" on one line
    if (labels) {
      let off = 0;
      for (const line of text.split('\n')) {
        const m = /^(\s*)([^:：\n]{2,60}?)\s*[:：]\s*(\S[^\n]{0,200}?)\s*$/.exec(line);
        if (m) {
          const type = Ex.fieldLabel(m[2]);
          if (type && valueOk(type, m[3])) {
            const start = off + line.indexOf(m[3], m[1].length + m[2].length), end = start + m[3].length;
            if (!out.some(n => start < n.end && end > n.start)) out.push({ type, value: m[3], start, end, conf: 'medium', note: 'Value of the field "' + m[2].trim() + '"', sub: m[2].trim() });
          }
        }
        off += line.length + 1;
      }
    }
    return out.sort((a, b) => a.start - b.start);
  };

  /** Table rows (DOCX): the value cell next to a label cell. Returns extra hits for one segment, or [] */
  Ex.labelledCell = function (seg, prevText, existing) {
    if (!labels || !prevText) return [];
    const type = Ex.fieldLabel(prevText);
    const v = String(seg.text).trim();
    if (!type || !valueOk(type, v)) return [];
    const start = seg.text.indexOf(v), end = start + v.length;
    if (existing.some(n => start < n.end && end > n.start)) return [];
    return [{ type, value: v, start, end, conf: 'medium', note: 'Value of the field "' + prevText.trim().replace(/\s+/g, ' ').slice(0, 40) + '"', sub: prevText.trim().slice(0, 40) }];
  };
})(typeof window !== 'undefined' ? window : globalThis);
