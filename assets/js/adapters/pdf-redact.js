/*
 * Exposift – true PDF text redaction. The page keeps its vector text; only the glyphs of the chosen values are
 * taken out of the page content (text-showing operators are rewritten, spacing is kept with TJ adjustments) and a
 * black box is drawn where they were. The verifier then searches the result like any other output; if a value is
 * still found (unsupported font, odd encoding), the caller falls back to "Flatten & rebuild".
 *
 * Supported: simple fonts (1-byte codes, /Widths or standard-14 metrics) and Type0/Identity-H fonts (2-byte CIDs,
 * /W, /DW). Text inside Form XObjects is handled. Anything else is reported in `skipped`.
 */
(function (g) {
  'use strict';
  const Ex = g.Ex = g.Ex || {};

  // ------------------------------------------------------------ small helpers
  const mul = (a, b) => [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const I = () => [1, 0, 0, 1, 0, 0];
  const WS = ' \t\r\n\f\0';
  const DELIM = '()<>[]{}/%';
  const isWs = (c) => WS.indexOf(c) !== -1;
  const isDelim = (c) => DELIM.indexOf(c) !== -1;

  // ------------------------------------------------------------ content stream tokenizer
  /** Returns [{op, args:[{t,v,s,e}], s, e}] where s..e covers the operands and the operator. */
  function parse(str) {
    const ops = []; let i = 0; const n = str.length;
    let args = [], first = -1;

    function readString() { // literal string at str[i] === '('
      const s = i; let depth = 0; const out = [];
      for (; i < n; i++) {
        const c = str[i];
        if (c === '\\') {
          const d = str[++i];
          if (d === 'n') out.push(10); else if (d === 'r') out.push(13); else if (d === 't') out.push(9); else if (d === 'b') out.push(8); else if (d === 'f') out.push(12);
          else if (d === '\r') { if (str[i + 1] === '\n') i++; } else if (d === '\n') { /* continuation */ }
          else if (d >= '0' && d <= '7') { let o = d; while (o.length < 3 && str[i + 1] >= '0' && str[i + 1] <= '7') o += str[++i]; out.push(parseInt(o, 8) & 255); }
          else out.push(d.charCodeAt(0));
        } else if (c === '(') { if (depth++ > 0) out.push(40); }
        else if (c === ')') { if (--depth === 0) { i++; break; } out.push(41); }
        else out.push(c.charCodeAt(0) & 255);
      }
      return { t: 'str', v: Uint8Array.from(out), s, e: i };
    }
    function readHex() { // <...>
      const s = i; i++; let h = '';
      while (i < n && str[i] !== '>') { if (!isWs(str[i])) h += str[i]; i++; }
      i++; if (h.length % 2) h += '0';
      const out = []; for (let k = 0; k < h.length; k += 2) out.push(parseInt(h.substr(k, 2), 16) || 0);
      return { t: 'str', v: Uint8Array.from(out), s, e: i };
    }
    function readArray() {
      const s = i; i++; const items = [];
      while (i < n) {
        while (i < n && isWs(str[i])) i++;
        if (str[i] === ']') { i++; break; }
        const t = readOperand(); if (!t) break; items.push(t);
      }
      return { t: 'arr', v: items, s, e: i };
    }
    function skipDict() {
      const s = i; let d = 0;
      while (i < n) {
        if (str[i] === '<' && str[i + 1] === '<') { d++; i += 2; }
        else if (str[i] === '>' && str[i + 1] === '>') { d--; i += 2; if (d === 0) break; }
        else if (str[i] === '(') readString();
        else i++;
      }
      return { t: 'dict', v: null, s, e: i };
    }
    function readOperand() { // returns operand token, or null at an operator keyword (does not consume it)
      while (i < n) {
        const c = str[i];
        if (isWs(c)) { i++; continue; }
        if (c === '%') { while (i < n && str[i] !== '\n' && str[i] !== '\r') i++; continue; }
        break;
      }
      if (i >= n) return null;
      const c = str[i];
      if (c === '(') return readString();
      if (c === '[') return readArray();
      if (c === '<') return str[i + 1] === '<' ? skipDict() : readHex();
      if (c === '/') { const s = i++; while (i < n && !isWs(str[i]) && !isDelim(str[i])) i++; return { t: 'name', v: str.slice(s + 1, i), s, e: i }; }
      if (c === ']' || c === '>' || c === ')' || c === '{' || c === '}') { i++; return { t: 'junk', s: i - 1, e: i }; }
      const s = i; while (i < n && !isWs(str[i]) && !isDelim(str[i])) i++;
      const w = str.slice(s, i);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return { t: 'num', v: parseFloat(w), s, e: i };
      return { t: 'kw', v: w, s, e: i };
    }

    while (i < n) {
      const tk = readOperand(); if (!tk) break;
      if (tk.t !== 'kw') { if (first < 0) first = tk.s; args.push(tk); continue; }
      const op = tk.v; let e = tk.e;
      if (op === 'BI') { // inline image: skip to "EI"
        let j = tk.e; const idm = /[\s]ID[\s]/g; idm.lastIndex = j; const m = idm.exec(str);
        if (m) { j = m.index + m[0].length; const em = /[\s]EI(?=[\s]|$)/g; em.lastIndex = j; const x = em.exec(str); j = x ? x.index + x[0].length : n; } else j = n;
        i = j; e = j;
      }
      ops.push({ op, args, s: first < 0 ? tk.s : first, e });
      args = []; first = -1;
    }
    return ops;
  }

  const hexOf = (u8) => { let h = '<'; for (const b of u8) h += (b < 16 ? '0' : '') + b.toString(16); return h + '>'; };

  // ------------------------------------------------------------ fonts
  function decodeToUnicodeMap(text) {
    const map = new Map();
    const hexToStr = (h) => { let o = ''; for (let k = 0; k + 3 < h.length + 1; k += 4) o += String.fromCharCode(parseInt(h.substr(k, 4), 16)); return o; };
    for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2].padEnd(Math.ceil(m[2].length / 4) * 4, '0')));
    }
    for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g; let m;
      while ((m = re.exec(blk[1]))) {
        const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
        if (m[3][0] === '[') { const items = [...m[3].matchAll(/<([0-9a-fA-F]+)>/g)].map(x => hexToStr(x[1])); for (let c = lo; c <= hi && c - lo < items.length; c++) map.set(c, items[c - lo]); }
        else { const base = m[3].slice(1, -1); const s0 = hexToStr(base); for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, s0.slice(0, -1) + String.fromCharCode(s0.charCodeAt(s0.length - 1) + (c - lo))); }
      }
    }
    return map;
  }

  const STD = (name) => {
    const n = String(name || '').replace(/^[A-Z]{6}\+/, '').replace(/[-,\s]/g, '').toLowerCase();
    const bold = /bold/.test(n), ital = /italic|oblique/.test(n);
    if (/^(arial|helvetica)/.test(n)) return bold ? (ital ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : (ital ? 'Helvetica-Oblique' : 'Helvetica');
    if (/^(timesnewroman|times)/.test(n)) return bold ? (ital ? 'Times-BoldItalic' : 'Times-Bold') : (ital ? 'Times-Italic' : 'Times-Roman');
    if (/^(couriernew|courier)/.test(n)) return bold ? (ital ? 'Courier-BoldOblique' : 'Courier-Bold') : (ital ? 'Courier-Oblique' : 'Courier');
    return null;
  };

  async function makeFontInfo(ctx, fontDict, L, tmpDocRef) {
    const N = (s) => L.PDFName.of(s);
    const look = (o) => (o instanceof L.PDFRef ? ctx.lookup(o) : o);
    const num = (o) => { o = look(o); return o && typeof o.asNumber === 'function' ? o.asNumber() : null; };
    const sub = look(fontDict.get(N('Subtype')));
    const subtype = sub ? sub.encodedName : '';
    const info = { ok: true, twoByte: false, width: () => 500, uni: (c) => String.fromCharCode(c), approx: false };
    // text of the glyph (best effort); used only to find the chosen value among the glyphs
    const tu = look(fontDict.get(N('ToUnicode')));
    let tmap = null;
    if (tu && tu.contents !== undefined) { try { tmap = decodeToUnicodeMap(new TextDecoder('latin1').decode(L.decodePDFRawStream(tu).decode())); } catch (e) { tmap = null; } }
    if (tmap && tmap.size) info.uni = (c) => (tmap.has(c) ? tmap.get(c) : (info.twoByte ? '' : String.fromCharCode(c)));
    else if (subtype === '/Type0') info.uni = () => '';

    if (subtype === '/Type0') {
      const enc = look(fontDict.get(N('Encoding')));
      const encName = enc && enc.encodedName ? enc.encodedName : '';
      if (encName !== '/Identity-H' && encName !== '/Identity-V') { info.ok = false; info.why = 'CMap ' + (encName || 'embedded'); return info; }
      info.twoByte = true;
      const desc = look(look(fontDict.get(N('DescendantFonts'))).get(0));
      const dw = num(desc.get(N('DW'))); const DW = dw == null ? 1000 : dw;
      const W = new Map();
      const wArr = look(desc.get(N('W')));
      if (wArr && wArr.size) {
        for (let k = 0; k < wArr.size();) {
          const c1 = num(wArr.get(k)); const nx = look(wArr.get(k + 1));
          if (nx && typeof nx.size === 'function') { for (let q = 0; q < nx.size(); q++) W.set(c1 + q, num(nx.get(q))); k += 2; }
          else { const c2 = num(nx), w = num(wArr.get(k + 2)); for (let c = c1; c <= c2 && c - c1 < 65536; c++) W.set(c, w); k += 3; }
        }
      }
      info.width = (c) => (W.has(c) ? W.get(c) : DW);
      return info;
    }
    // simple font
    const first = num(fontDict.get(N('FirstChar')));
    const widths = look(fontDict.get(N('Widths')));
    const fd = look(fontDict.get(N('FontDescriptor')));
    const missing = fd ? num(fd.get(N('MissingWidth'))) : null;
    if (widths && first != null && widths.size) {
      info.width = (c) => { const k = c - first; if (k >= 0 && k < widths.size()) { const w = num(widths.get(k)); if (w != null) return w; } return missing != null ? missing : 0; };
    } else {
      const base = look(fontDict.get(N('BaseFont')));
      const std = STD(base && base.encodedName ? base.encodedName.slice(1) : '');
      if (std && tmpDocRef) {
        try {
          const f = await tmpDocRef.embedFont(std); const cache = new Map();
          info.width = (c) => { if (!cache.has(c)) { let w = 500; try { w = f.widthOfTextAtSize(String.fromCharCode(c), 1000); } catch (e) { /* keep 500 */ } cache.set(c, w); } return cache.get(c); };
        } catch (e) { info.approx = true; }
      } else info.approx = true;
    }
    return info;
  }

  // ------------------------------------------------------------ interpreter
  /**
   * Walks one content stream, appending to `shows` every text-showing operator with per-glyph geometry.
   * stream ctx: { key, str, ops, ref, replace:[] }
   */
  async function walk(env, sc, res, ctm0, depth) {
    const L = env.L, N = (s) => L.PDFName.of(s);
    const look = (o) => (o instanceof L.PDFRef ? env.ctx.lookup(o) : o);
    const ops = sc.ops;
    let ctm = ctm0.slice(); const stack = [];
    let tm = I(), tlm = I();
    let st = { font: null, fs: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
    const fonts = res ? look(res.get(N('Font'))) : null;
    const xobjs = res ? look(res.get(N('XObject'))) : null;
    const fontCache = env.fontCache;

    async function fontFor(name) {
      if (!fonts || typeof fonts.get !== 'function') return null;
      const raw = fonts.get(N(name)); const d = look(raw);
      if (!d) return null;
      const key = raw instanceof L.PDFRef ? raw.toString() : null;
      if (key && fontCache.has(key)) return fontCache.get(key);
      const info = await makeFontInfo(env.ctx, d, L, env.tmpDoc);
      if (key) fontCache.set(key, info);
      return info;
    }

    function glyphsOf(bytes) {
      const f = st.font; const out = [];
      if (!f) return out;
      const step = f.twoByte ? 2 : 1;
      for (let k = 0; k + step <= bytes.length; k += step) {
        const code = f.twoByte ? (bytes[k] << 8) | bytes[k + 1] : bytes[k];
        const w = f.width(code);
        const trm = mul([st.fs * st.th, 0, 0, st.fs, 0, st.rise], mul(tm, ctm));
        const x1 = w / 1000;
        const pts = [apply(trm, 0, -0.2), apply(trm, x1, -0.2), apply(trm, x1, 0.85), apply(trm, 0, 0.85)];
        const c = apply(trm, x1 / 2, 0.325);
        const box = { x0: Math.min(...pts.map(p => p[0])), y0: Math.min(...pts.map(p => p[1])), x1: Math.max(...pts.map(p => p[0])), y1: Math.max(...pts.map(p => p[1])) };
        const isSp = !f.twoByte && code === 32;
        out.push({ bytes: bytes.slice(k, k + step), code, w, cx: c[0], cy: c[1], box, u: f.uni(code), fs: st.fs, adj: st.fs ? -(w + (st.tc + (isSp ? st.tw : 0)) * 1000 / st.fs) : 0, removed: false });
        const tx = (w / 1000 * st.fs + st.tc + (isSp ? st.tw : 0)) * st.th;
        tm = mul([1, 0, 0, 1, tx, 0], tm);
      }
      return out;
    }
    const num = (a, k) => (a[k] && a[k].t === 'num' ? a[k].v : 0);

    for (const o of ops) {
      const a = o.args;
      switch (o.op) {
        case 'q': stack.push({ ctm: ctm.slice(), st: { ...st } }); break;
        case 'Q': { const p = stack.pop(); if (p) { ctm = p.ctm; st = p.st; } break; }
        case 'cm': if (a.length >= 6) ctm = mul(a.slice(0, 6).map(x => x.v), ctm); break;
        case 'BT': tm = I(); tlm = I(); break;
        case 'Tf': { const nm = a[0] && a[0].t === 'name' ? a[0].v : ''; st.font = await fontFor(nm); st.fs = num(a, 1); if (st.font && !st.font.ok) env.skipped.add(st.font.why || 'font'); break; }
        case 'Tc': st.tc = num(a, 0); break;
        case 'Tw': st.tw = num(a, 0); break;
        case 'Tz': st.th = num(a, 0) / 100; break;
        case 'TL': st.tl = num(a, 0); break;
        case 'Ts': st.rise = num(a, 0); break;
        case 'Td': tlm = mul([1, 0, 0, 1, num(a, 0), num(a, 1)], tlm); tm = tlm.slice(); break;
        case 'TD': st.tl = -num(a, 1); tlm = mul([1, 0, 0, 1, num(a, 0), num(a, 1)], tlm); tm = tlm.slice(); break;
        case 'Tm': if (a.length >= 6) { tlm = a.slice(0, 6).map(x => x.v); tm = tlm.slice(); } break;
        case 'T*': tlm = mul([1, 0, 0, 1, 0, -st.tl], tlm); tm = tlm.slice(); break;
        case 'Tj': case '\'': case '"': {
          if (o.op !== 'Tj') {
            if (o.op === '"') { st.tw = num(a, 0); st.tc = num(a, 1); }
            tlm = mul([1, 0, 0, 1, 0, -st.tl], tlm); tm = tlm.slice();
          }
          const sTok = a[a.length - 1];
          if (sTok && sTok.t === 'str' && st.font && st.font.ok) env.shows.push({ sc, o, kind: o.op, elems: [{ glyphs: glyphsOf(sTok.v) }] });
          break;
        }
        case 'TJ': {
          const arr = a[0];
          if (!arr || arr.t !== 'arr' || !st.font || !st.font.ok) break;
          const elems = [];
          for (const it of arr.v) {
            if (it.t === 'str') elems.push({ glyphs: glyphsOf(it.v) });
            else if (it.t === 'num') { elems.push({ num: it.v, raw: null }); tm = mul([1, 0, 0, 1, -it.v / 1000 * st.fs * st.th, 0], tm); }
          }
          env.shows.push({ sc, o, kind: 'TJ', elems });
          break;
        }
        case 'Do': {
          if (depth >= 3 || !xobjs || !a[0] || a[0].t !== 'name') break;
          const raw = xobjs.get(N(a[0].v)); const x = look(raw);
          if (!x || !x.dict || !(raw instanceof L.PDFRef)) break;
          const sub = x.dict.get(N('Subtype'));
          if (!sub || sub.encodedName !== '/Form') break;
          const key = raw.toString();
          if (env.seenForms.has(key)) { env.skipped.add('form used more than once'); break; }
          env.seenForms.add(key);
          try {
            const body = new TextDecoder('latin1').decode(L.decodePDFRawStream(x).decode());
            const mat = look(x.dict.get(N('Matrix')));
            const m = mat && mat.size && mat.size() === 6 ? [0, 1, 2, 3, 4, 5].map(k => { const v = look(mat.get(k)); return v.asNumber(); }) : I();
            const fr = look(x.dict.get(N('Resources'))) || res;
            const sub2 = { key, str: body, ops: parse(body), ref: raw, isForm: true, dict: x.dict, edits: [] };
            env.streams.push(sub2);
            await walk(env, sub2, fr, mul(m, ctm), depth + 1);
          } catch (e) { env.skipped.add('form stream could not be read'); }
          break;
        }
        default: break;
      }
    }
  }

  // ------------------------------------------------------------ redact one document
  const foldOf = (s) => (Ex.detectUtil && Ex.detectUtil.fold ? Ex.detectUtil.fold(s) : s.toLowerCase());

  /**
   * targets: [{page, x0,y0,x1,y1, value}] ; returns { removed, unmatched, covers:[{page,x0,y0,x1,y1}], skipped:[] }
   * Edits `doc` (a pdf-lib PDFDocument) in place.
   */
  async function redactDoc(doc, targets) {
    const L = g.PDFLib; const ctx = doc.context;
    const N = (s) => L.PDFName.of(s);
    const look = (o) => (o instanceof L.PDFRef ? ctx.lookup(o) : o);
    const tmpDoc = await L.PDFDocument.create();
    const result = { removed: 0, unmatched: 0, covers: [], skipped: new Set(), pagesEdited: 0 };
    const pages = doc.getPages();
    const byPage = new Map();
    for (const t of targets) { if (!byPage.has(t.page)) byPage.set(t.page, []); byPage.get(t.page).push(t); }

    for (const [pn, tg] of byPage) {
      const page = pages[pn - 1]; if (!page) continue;
      const env = { L, ctx, tmpDoc, fontCache: new Map(), shows: [], streams: [], seenForms: new Set(), skipped: result.skipped };
      // page content (all parts joined)
      let parts;
      try {
        const c = look(page.node.get(N('Contents')));
        parts = c instanceof L.PDFArray ? Array.from({ length: c.size() }, (_, k) => look(c.get(k))) : [c];
        parts = parts.filter(Boolean);
      } catch (e) { result.skipped.add('page content could not be read'); continue; }
      let body;
      try { body = parts.map(p => new TextDecoder('latin1').decode(L.decodePDFRawStream(p).decode())).join('\n'); }
      catch (e) { result.skipped.add('content stream filter not supported'); continue; }
      const main = { key: 'page', str: body, ops: parse(body), isForm: false, edits: [] };
      env.streams.push(main);
      let res = look(page.node.get(N('Resources')));
      if (!res) { try { res = page.node.Resources(); } catch (e) { res = null; } }
      try { await walk(env, main, res, I(), 0); } catch (e) { result.skipped.add('page content could not be interpreted'); continue; }

      // find the glyphs of each target
      for (const t of tg) {
        const hit = [];
        for (const sh of env.shows) for (const el of sh.elems) if (el.glyphs) for (const gl of el.glyphs) {
          if (gl.cx >= t.x0 - 0.5 && gl.cx <= t.x1 + 0.5 && gl.cy >= t.y0 - 0.5 && gl.cy <= t.y1 + 0.5) hit.push(gl);
        }
        if (!hit.length) { result.unmatched++; continue; }
        const want = foldOf(String(t.value || '')).replace(/\s+/g, '');
        // concatenate the text of the glyphs inside the rectangle (spaces dropped) and locate the value in it
        const chars = []; hit.forEach((gl, gi) => { const u = gl.u || ''; for (const ch of u) { const f = foldOf(ch).replace(/\s+/g, ''); if (f) chars.push({ ch: f, gi }); } });
        const hay = chars.map(c => c.ch).join('');
        let chosen = null;
        if (want && hay) {
          const at = hay.indexOf(want);
          if (at !== -1) {
            // map the character range back to glyph indexes
            let pos = 0; const set = new Set();
            for (const c of chars) { const a0 = pos, a1 = pos + c.ch.length; if (a1 > at && a0 < at + want.length) set.add(c.gi); pos = a1; }
            chosen = [...set].map(gi => hit[gi]);
          }
        }
        if (!chosen) chosen = hit.filter(gl => gl.u === '' || gl.u.trim() !== '' || true); // value not found by text: remove everything in the box
        let bx = null;
        for (const gl of chosen) {
          if (gl.removed) continue;
          gl.removed = true; result.removed++;
          const b = gl.box;
          bx = bx ? { x0: Math.min(bx.x0, b.x0), y0: Math.min(bx.y0, b.y0), x1: Math.max(bx.x1, b.x1), y1: Math.max(bx.y1, b.y1) } : { ...b };
        }
        if (bx) result.covers.push({ page: pn, x0: bx.x0 - 0.7, y0: bx.y0 - 0.7, x1: bx.x1 + 0.7, y1: bx.y1 + 0.7 });
      }

      // rewrite the operators that lost glyphs
      let touched = false;
      for (const sh of env.shows) {
        if (!sh.elems.some(el => el.glyphs && el.glyphs.some(gl => gl.removed))) continue;
        touched = true;
        const parts2 = []; let run = [];
        const flush = () => { if (run.length) { const u8 = new Uint8Array(run.reduce((n, b) => n + b.length, 0)); let o = 0; for (const b of run) { u8.set(b, o); o += b.length; } parts2.push(hexOf(u8)); run = []; } };
        let pend = 0;
        const flushNum = () => { if (pend) { parts2.push(String(Math.round(pend * 1000) / 1000)); pend = 0; } };
        for (const el of sh.elems) {
          if (el.glyphs) for (const gl of el.glyphs) { if (gl.removed) { flush(); pend += gl.adj; } else { flushNum(); run.push(gl.bytes); } }
          else { flush(); pend += el.num; }
        }
        flush(); flushNum();
        const arr = '[' + parts2.join(' ') + ']';
        const a = sh.o.args;
        let text;
        if (sh.kind === 'Tj') text = arr + ' TJ';
        else if (sh.kind === 'TJ') text = arr + ' TJ';
        else if (sh.kind === '\'') text = 'T* ' + arr + ' TJ';
        else text = a[0].v + ' Tw ' + a[1].v + ' Tc T* ' + arr + ' TJ';
        sh.sc.edits.push({ s: sh.o.s, e: sh.o.e, text });
      }
      if (!touched && !result.covers.some(c => c.page === pn)) continue;

      // build the new streams
      for (const sc of env.streams) {
        if (!sc.edits.length && !(sc === main && result.covers.some(c => c.page === pn))) continue;
        let out = ''; let pos = 0;
        for (const ed of sc.edits.sort((x, y) => x.s - y.s)) { out += sc.str.slice(pos, ed.s) + ed.text; pos = ed.e; }
        out += sc.str.slice(pos);
        if (sc === main) {
          let boxes = '';
          for (const c of result.covers) if (c.page === pn) boxes += '\n' + [c.x0, c.y0, c.x1 - c.x0, c.y1 - c.y0].map(v => Math.round(v * 100) / 100).join(' ') + ' re f';
          out = 'q\n' + out + '\nQ\nq 0 g' + boxes + '\nQ\n';
          const ns = ctx.flateStream(Uint8Array.from(Array.from(out, ch => ch.charCodeAt(0) & 255)));
          page.node.set(N('Contents'), ctx.register(ns));
        } else {
          const ns = ctx.flateStream(Uint8Array.from(Array.from(out, ch => ch.charCodeAt(0) & 255)));
          for (const [k, v] of sc.dict.entries()) { const nm = k.encodedName; if (nm !== '/Length' && nm !== '/Filter' && nm !== '/DecodeParms') ns.dict.set(k, v); }
          ctx.assign(sc.ref, ns);
        }
      }
      result.pagesEdited++;
    }
    result.skipped = [...result.skipped];
    return result;
  }

  async function redactPdf(bytes, plan) {
    const targets = plan.targets || [];
    let info = null;
    const res = await Ex.adapters.pdf.sanitize.clean(bytes, plan, { pre: async (doc, ops) => {
      info = await redactDoc(doc, targets);
      ops.push(info.removed + ' piece(s) of page text taken out of the page content and covered with a black box');
      if (info.unmatched) ops.push(info.unmatched + ' area(s) held no text that could be removed');
    } });
    res.redact = info;
    return res;
  }

  Ex.adapters.pdf.sanitize.redact = redactPdf;
  Ex.pdfRedact = { parse, redactDoc };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ex;
})(typeof window !== 'undefined' ? window : globalThis);
