/*
 * Browser port of src/Engine.php. demo/test/parity.mjs runs both on the same inputs
 * and fails on any difference, so change them together.
 * Offsets are UTF-16 here (bytes in PHP); byte lengths are computed where PHP's ordering depends on them.
 */
(function (root) {
  'use strict';
  const P = root.MaskinkPcre;
  const D = '\x01';
  const BT = '`';
  const KV_VALUE = '(?:"((?:[^"\\\\\\r\\n]|\\\\.)*)"|\'((?:[^\'\\\\\\r\\n]|\\\\.)*)\'|' + BT + '([^' + BT + '\\r\\n]*)' + BT
    + '|(?![A-Za-z_][\\w.\\-]*=[^=\\s])((?>[^\\s,;"\'' + BT + '&<>()\\[\\]{}|]+))(?!\\(|[ \\t]+["\'(\\[{$\\-]))';
  const SECRET_CATS = ['PASSWORD', 'SECRET'];
  const LETTER_START = '^[\\p{L}\\p{N}_]', LETTER_END = '[\\p{L}\\p{N}_]$';

  // ---- PHP string helpers
  const empty = v => v === undefined || v === null || v === false || v === '' || v === 0 || v === '0'
    || (Array.isArray(v) && v.length === 0);
  const phpTrim = (s, chars = ' \t\n\r\0\x0B') => {
    let a = 0, b = s.length;
    while (a < b && chars.includes(s[a])) a++;
    while (b > a && chars.includes(s[b - 1])) b--;
    return s.slice(a, b);
  };
  const lower = s => String(s).split('İ').join('i').toLowerCase();
  const asciiLower = s => s.replace(/[A-Z]/g, c => c.toLowerCase());
  const asciiUpper = s => s.replace(/[a-z]/g, c => c.toUpperCase());
  function byteLen(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }
  function mbLen(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) i++;
      n++;
    }
    return n;
  }
  const mbSubstr = (s, start, len) => Array.from(s).slice(start, len === undefined ? undefined : start + len).join('');
  const utf8 = s => new TextEncoder().encode(s);
  const isDigits = s => /^[0-9]+$/.test(s);
  const pregQuote = s => s.replace(/[.\\+*?[^\]$(){}=!<>|:\-#\x01]/g, '\\$&').replace(/\0/g, '\\000');
  /** usort by strlen desc; sort is stable as in PHP 8 */
  function byBytesDesc(list) {
    return list.map(v => [v, byteLen(v)]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  }
  /** strtok($s, '.') */
  const firstLabel = s => { const m = /^\.*([^.]*)/.exec(s); return m ? m[1] : ''; };
  const countOf = (s, needle) => s.split(needle).length - 1;
  const afterLastDot = s => { const i = s.lastIndexOf('.'); return i < 0 ? '' : s.slice(i + 1); };
  function bytePrefix(s, max) {
    if (s.length * 3 <= max) return s;
    let n = 0, i = 0;
    for (; i < s.length && n < max; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
      else n += 3;
    }
    return s.slice(0, i);
  }

  // ---- HMAC-SHA256 (sync: WebCrypto is async, tokens are assigned in a synchronous loop)
  const K256 = (() => {
    const out = [];
    for (let c = 2; out.length < 64; c++) {
      let prime = true;
      for (let d = 2; d * d <= c; d++) if (c % d === 0) { prime = false; break; }
      if (prime) out.push(Math.floor((Math.cbrt(c) % 1) * 2 ** 32));
    }
    return out;
  })();
  function sha256(bytes) {
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total);
    m.set(bytes);
    m[len] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000));
    dv.setUint32(total - 4, (len << 3) >>> 0);
    const w = new Uint32Array(64);
    const rr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        w[i] = (w[i - 16] + (rr(a, 7) ^ rr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rr(b, 17) ^ rr(b, 19) ^ (b >>> 10))) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (hh + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
        const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      [a, b, c, d, e, f, g, hh].forEach((v, i) => { h[i] = (h[i] + v) | 0; });
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    h.forEach((v, i) => odv.setUint32(i * 4, v >>> 0));
    return out;
  }
  function hmacSha256Hex(msg, key) {
    let k = utf8(key);
    if (k.length > 64) k = sha256(k);
    const ipad = new Uint8Array(64).fill(0x36), opad = new Uint8Array(64).fill(0x5c);
    k.forEach((b, i) => { ipad[i] ^= b; opad[i] ^= b; });
    const m = utf8(msg);
    const inner = new Uint8Array(64 + m.length);
    inner.set(ipad); inner.set(m, 64);
    const outer = new Uint8Array(96);
    outer.set(opad); outer.set(sha256(inner), 64);
    return Array.from(sha256(outer), b => b.toString(16).padStart(2, '0')).join('');
  }

  // ---- validators
  const IPV4 = /^(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}$/;
  const isIPv4 = v => IPV4.test(v);
  /** filter_var(FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) */
  function isIPv6(str) {
    if (!str.includes(':')) return false;
    let blocks = 8;
    let end = str.length;
    const dot = str.indexOf('.');
    if (dot >= 0) {
      let v4 = dot;
      while (v4 > 0 && str[v4 - 1] !== ':') v4--;
      if (!isIPv4(str.slice(v4))) return false;
      if (v4 < 2) return false;
      end = str[v4 - 2] !== ':' ? v4 - 1 : v4;
      blocks = 6;
    }
    let i = 0, compressed = false;
    while (i < end) {
      if (str[i] === ':') {
        if (++i >= end) return false;
        if (str[i] === ':') {
          if (compressed) return false;
          compressed = true;
          if (++i === end) return blocks >= 1;
        } else if (i - 1 === 0) {
          return false;
        }
      }
      let n = 0;
      while (i < end && /[0-9a-fA-F]/.test(str[i])) { n++; i++; }
      if (n === 0 || n > 4) return false;
      if (--blocks < 0) return false;
    }
    return compressed ? blocks >= 1 : blocks === 0;
  }
  function isNetmask(ip) {
    const first = parseInt(ip, 10);
    if (first !== 255 && first !== 0) return false;
    const bin = ip.split('.').map(o => parseInt(o, 10).toString(2).padStart(8, '0')).join('');
    return /^(?:1*0*|0*1*)$/.test(bin);
  }
  const ip2long = ip => isIPv4(ip) ? ip.split('.').reduce((a, o) => a * 256 + parseInt(o, 10), 0) : false;
  function inCidr(ip, cidr) {
    if (!cidr.includes('/')) return ip === cidr;
    const i = cidr.indexOf('/');
    const net = cidr.slice(0, i), bits = parseInt(cidr.slice(i + 1), 10) || 0;
    const a = ip2long(ip), b = ip2long(net);
    if (a === false || b === false || bits < 0 || bits > 32) return false;
    const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
    return ((a & mask) >>> 0) === ((b & mask) >>> 0);
  }
  function luhn(v) {
    const d = v.replace(/[^0-9]/g, '');
    const n = d.length;
    if (n < 13 || n > 19 || /^(\d)\1+$/.test(d)) return false;
    if (!/^(?:4|5[1-5]|2[2-7]|3[47]|6(?:011|5)|9792|35)/.test(d)) return false;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      let x = +d[n - 1 - i];
      if (i % 2 === 1) { x *= 2; if (x > 9) x -= 9; }
      sum += x;
    }
    return sum % 10 === 0;
  }
  function tckn(v) {
    if (!/^[1-9][0-9]{10}$/.test(v)) return false;
    const d = Array.from(v, Number);
    const odd = d[0] + d[2] + d[4] + d[6] + d[8], even = d[1] + d[3] + d[5] + d[7];
    if ((((odd * 7 - even) % 10) + 10) % 10 !== d[9]) return false;
    return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
  }
  function iban(v) {
    let s = asciiUpper(v.replace(/[ \t\n\x0B\f\r]+/g, ''));
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(s)) return false;
    s = s.slice(4) + s.slice(0, 4);
    let mod = 0;
    for (const ch of s) {
      const num = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
      for (const dg of num) mod = (mod * 10 + +dg) % 97;
    }
    return mod === 1;
  }
  function entropy(v) {
    const b = utf8(v);
    if (!b.length) return 0;
    const count = new Array(256).fill(0);
    b.forEach(x => count[x]++);
    let h = 0;
    for (const c of count) {
      if (!c) continue;
      const p = c / b.length;
      h -= p * Math.log2(p);
    }
    return h;
  }
  /** sprintf('%.2f'): exact ties go to the even digit, where toFixed rounds up */
  function fixed2(x) {
    const h = x * 100;
    if (h % 1 === 0.5 && Math.floor(h) % 2 === 0) return (Math.floor(h) / 100).toFixed(2);
    return x.toFixed(2);
  }
  const VAR_REF = '^(?:\\$\\{[^}]*\\}|\\$\\([^)]*\\)|\\$[A-Za-z_][\\w:.]*|%[A-Za-z_]\\w*%|\\{\\{[^}]*\\}\\}|<[^<>]*>|\\[[^\\[\\]]*\\]|@\\w+|:\\w+|\\?|\\*{2,}|x{3,}|X{3,}|#{3,}|•+|\\.{3,}|-{2,})$';
  const isVariableRef = v => P.test(VAR_REF, 'u', v);

  function lines(s, commas = true) {
    const out = new Set();
    for (const raw of String(s).split(/\r\n|\r|\n/)) {
      const line = phpTrim(raw);
      if (line === '' || line[0] === '#') continue;
      for (const part of commas ? line.split(',') : [line]) {
        const l = phpTrim(part);
        if (l !== '') out.add(l);
      }
    }
    return [...out];
  }
  function scrub(s) {
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '?');
  }
  const SCRIPT_RE = '^\\s*(?:#!|function\\s+[\\w-]+|def\\s+\\w+\\s*\\(|class\\s+\\w+|param\\s*\\(|import\\s+[\\w.]+|from\\s+[\\w.]+\\s+import|\\$[\\w:]+\\s*=|[\\w.]+\\s*=\\s*["\'\\[{(]|if\\s*\\[|if\\s*\\(|for\\s+\\w+\\s+in\\s|foreach\\s*\\(|while\\s|try\\s*[:{]|except\\b|catch\\b|echo\\s|Write-(?:Host|Output|Verbose)|(?:Get|Set|New|Remove|Invoke|Import|Export)-[A-Z]\\w+|export\\s+\\w+=|local\\s+\\w+=|\\#\\s*requires|Set-StrictMode|<\\?php|\\}\\s*$|fi\\s*$|done\\s*$)';
  const LOG_RE = '^\\s*(?:<\\d{1,3}>|\\d{4}-\\d\\d-\\d\\d[T ]\\d\\d:\\d\\d|[A-Z][a-z]{2}\\s+\\d{1,2}\\s+\\d\\d:\\d\\d:\\d\\d|\\d\\d[\\/.]\\d\\d[\\/.]\\d{4}|\\[\\d{4}-\\d\\d-\\d\\d|\\*?[A-Z][a-z]{2}\\s+\\d{1,2}\\s|\\d+:\\s+\\*?[A-Z][a-z]{2}|%[A-Z_]+-\\d-|\\d{10}(?:\\.\\d+)?\\s)';
  function detectMode(text) {
    const sample = bytePrefix(text, 200000);
    const script = P.matchAll(SCRIPT_RE, 'mi', sample).matches.length;
    const log = P.matchAll(LOG_RE, 'm', sample).matches.length;
    return script > log ? 'script' : 'log';
  }

  const has = (m, k) => m.has(k);
  const setOf = list => new Set(list);

  class Engine {
    constructor(rules, cats, settings, secret, t) {
      this.rules = rules;
      this.cats = {};
      for (const c of cats) this.cats[c.code] = c;
      this.set = settings;
      this.secret = secret !== '' && secret != null ? secret : 'maskink';
      this.t = t || ((s, a) => { if (a) for (const k in a) s = s.split('{' + k + '}').join(String(a[k])); return s; });
      const low = k => lines(settings[k] ?? '').map(lower);
      this.keepValues = setOf(low('keep_values'));
      this.keepCidrs = lines(settings.keep_cidrs ?? '');
      this.keepDomains = low('keep_domains');
      this.denyExt = setOf(low('dotted_deny'));
      this.codeDeny = setOf(low('code_deny'));
      this.fqdnDenyFirst = setOf(low('fqdn_deny_first'));
      this.stopwords = setOf(low('person_stopwords'));
      this.tlds = low('tlds');
      this.firstNames = low('first_names');
      this.compiled = new Map();
      this.termCats = {};
      this.errors = [];
    }

    expand(p) {
      if (p.includes('{{TLD}}')) {
        const t = byBytesDesc(this.tlds.length ? this.tlds : ['com', 'net', 'org', 'local']);
        p = p.split('{{TLD}}').join(t.map(pregQuote).join('|'));
      }
      if (p.includes('{{FIRSTNAME_CAP}}')) p = p.split('{{FIRSTNAME_CAP}}').join(this.nameAlt(true));
      if (p.includes('{{FIRSTNAME}}')) p = p.split('{{FIRSTNAME}}').join(this.nameAlt(false));
      return p;
    }

    nameAlt(cap) {
      const key = cap ? '_altCap' : '_alt';
      if (this[key]) return this[key];
      const fold = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
      const folded = n => Array.from(n, c => fold[c] ?? c).join('');
      const set = new Set();
      for (const n of this.firstNames) {
        if (mbLen(n) < 3) continue;
        for (const v of [n, folded(n)]) {
          if (!cap) { set.add(v); continue; }
          const first = mbSubstr(v, 0, 1), rest = mbSubstr(v, 1);
          set.add(first.toUpperCase() + rest);
          if (first === 'i') set.add('İ' + rest);
          set.add(v.toUpperCase());
          set.add(Array.from(v, c => c === 'i' ? 'İ' : c === 'ı' ? 'I' : c).join('').toUpperCase());
        }
      }
      return this[key] = set.size ? byBytesDesc([...set]).map(pregQuote).join('|') : '(?!)';
    }

    static cleanFlags(flags) {
      return [...new Set(String(flags).replace(/[^imsxU]/g, ''))].sort().join('') + 'u';
    }

    /** [[{src, flags}, {group: category}], ...]; throws on a compile error */
    compile(r) {
      const key = String(r.id ?? '') + ':' + JSON.stringify(r);
      if (this.compiled.has(key)) return this.compiled.get(key);
      const o = r.options || {};
      const flags = Engine.cleanFlags(r.flags ?? '');
      const cat = String(r.category);
      let out = [];
      const t = this.t;
      switch (r.type) {
        case 'regex': {
          const pattern = phpTrim(String(r.pattern ?? ''));
          if (pattern === '') throw new Error(t('The regex pattern is empty.'));
          if (pattern.includes(D)) throw new Error(t('The pattern contains an invalid character.'));
          const g = r.groups || {};
          out.push([{ src: this.expand(pattern), flags }, Object.keys(g).length ? g : { 0: cat }]);
          break;
        }
        case 'keyvalue':
          out = this.compileKv(r, o);
          break;
        case 'keyword': {
          const alts = [], map = {};
          for (let line of lines(String(r.keys_text ?? ''), false)) {
            let termCat = cat;
            const mm = P.match('^(.+?)\\s*\\|\\s*([A-Z][A-Z0-9_]{1,31})\\s*$', 'u', line);
            if (mm) { line = mm[1]; termCat = mm[2]; }
            line = phpTrim(line);
            if (line === '') continue;
            map[lower(line)] = termCat;
            alts.push((P.test(LETTER_START, 'u', line) ? '(?<![\\p{L}\\p{N}_])' : '') + pregQuote(line)
              + (P.test(LETTER_END, 'u', line) ? '(?![\\p{L}\\p{N}_])' : ''));
          }
          if (alts.length) {
            out.push([{ src: '(?:' + byBytesDesc(alts).join('|') + ')', flags: empty(o.case_sensitive) ? 'iu' : 'u' }, { 0: cat }]);
            this.termCats[String(r.id ?? 'x')] = map;
          }
          break;
        }
        default:
          throw new Error(t('Unknown rule type: {type}', { type: r.type }));
      }
      for (const [re] of out) {
        try { P.compile(re.src, re.flags); } catch (e) { throw new Error('Regex could not be compiled: ' + e.message); }
      }
      if (!empty(o.skip_regex)) {
        try { P.compile(String(o.skip_regex), 'iu'); } catch (e) {
          throw new Error(t('The exclude regex could not be compiled: {error}', { error: e.message }));
        }
      }
      this.compiled.set(key, out);
      return out;
    }

    compileKv(r, o) {
      const cat = String(r.category);
      let alts = [];
      for (const k of lines(String(r.keys_text ?? ''))) {
        const parts = lower(k).split(/[\p{Z}\t\n\x0B\f\r\x85_.\-]+/u).filter(x => x !== '');
        if (parts.length) alts.push(parts.map(pregQuote).join('[ _.\\-]?'));
      }
      if (!alts.length) return [];
      alts = byBytesDesc(alts);
      const key = '(?:' + alts.join('|') + ')';
      const affix = o.affix ?? 'none';
      let pre = '(?<![\\p{L}\\p{N}_/\\\\])';
      if (affix === 'prefix' || affix === 'both') pre += '(?:[\\p{L}\\p{N}]+[_.\\-])*';
      const suf = affix === 'both' ? '(?:[_.\\-][\\p{L}\\p{N}]+)*' : '';
      const sep = {
        eq: '[ \\t]*=[ \\t]*',
        space: '(?:[ \\t]*(?:=>|:=|={1,3}|:(?!:))[ \\t]*|[ \\t]+)'
      }[o.seps ?? 'std'] ?? '[ \\t]*(?:=>|:=|={1,3}|:(?!:))[ \\t]*';
      let val, groups;
      if (!empty(o.value_regex)) {
        val = '["\'' + BT + ']?(?![A-Za-z_][\\w.\\-]*=[^=\\s])(' + this.expand(String(o.value_regex)) + ')';
        groups = { 1: cat };
      } else {
        val = KV_VALUE;
        groups = { 1: cat, 2: cat, 3: cat, 4: cat };
      }
      const out = [[{ src: pre + key + suf + '(?![\\p{L}\\p{N}])["\']?\\]?' + sep + val, flags: 'iu' }, groups]];
      if (!empty(o.xml)) {
        const xmlVal = !empty(o.value_regex) ? '(' + this.expand(String(o.value_regex)) + ')' : '([^<\\r\\n]{1,512}?)';
        out.push([{ src: '<(?:[\\p{L}\\p{N}]+[_.\\-:])*' + key + suf + '(?![\\p{L}\\p{N}])(?:\\s[^<>]*)?>[ \\t]*' + xmlVal + '[ \\t]*</', flags: 'iu' }, { 1: cat }]);
      }
      return out;
    }

    run(text, opt = {}) {
      const t0 = (root.performance || Date).now();
      const t = this.t;
      text = scrub(text);
      const detected = detectMode(text);
      const mode = opt.mode ?? 'auto';
      this.mode = mode === 'log' || mode === 'script' ? mode : detected;
      this.offCats = new Set(opt.disabled_cats || []);
      this.debug = !empty(opt.debug);
      this.cands = []; this.rejects = []; this.wordCount = new Map();
      const ruleHits = new Map();
      const hit = rn => ruleHits.set(rn, (ruleHits.get(rn) || 0) + 1);
      this.text = text;

      for (const r of this.rules) {
        if (empty(r.enabled)) continue;
        const modes = r.modes ?? 'all';
        if (modes !== 'all' && modes !== this.mode) continue;
        let compiled;
        try { compiled = this.compile(r); } catch (e) {
          this.errors.push({ rule_id: r.id ?? null, rule: t(r.name), error: e.message });
          continue;
        }
        for (const [re, gmap] of compiled) {
          const { matches, groupMap } = P.matchAll(re.src, re.flags, text);
          const pairs = Object.keys(gmap).map(Number).sort((a, b) => a - b).map(g => [groupMap[g], gmap[g]]);
          for (const m of matches) {
            for (const [gi, cat] of pairs) {
              if (gi === undefined || m[gi] === undefined || m[gi] === '') continue;
              this.consider(r, String(cat), m[gi], m.indices[gi][0]);
            }
          }
        }
      }

      this.cands.sort((a, b) => (b.p - a.p) || (b.bl - a.bl) || (a.s - b.s));
      const occ = new Uint8Array(text.length);
      const free = (s, e) => { for (let i = s; i < e; i++) if (occ[i]) return false; return true; };
      const sel = [];
      const allow = new Set();
      for (const a of opt.allow || []) if (typeof a === 'string' && a !== '') allow.add(lower(a));
      for (const c of this.cands) {
        if (allow.size && allow.has(lower(c.v))) { this.reject(c, 'The user asked not to mask it'); continue; }
        if (!free(c.s, c.e)) { this.reject(c, 'Overlaps a higher-priority match'); continue; }
        occ.fill(1, c.s, c.e);
        sel.push(c);
        hit(c.rn);
      }

      const minLenOf = () => Math.max(1, parseInt(this.set.propagate_min_len ?? 4, 10) || 0);
      const knownTok = new Map();
      const knownVal = new Map();
      const addVal = (map, code, v) => { if (!map.has(code)) map.set(code, new Set()); map.get(code).add(v); };
      const labelOk = (label, ll, min) => mbLen(label) >= min && !this.tlds.includes(ll)
        && !this.codeDeny.has(ll) && !this.keepValues.has(ll) && !isDigits(label);
      for (const k of opt.known || []) {
        const code = String(k.category ?? ''), tok = String(k.token ?? '');
        if (code === '' || tok === '' || !this.cats[code]) continue;
        const ci = empty(this.cats[code].case_sensitive);
        for (const v0 of [String(k.original ?? ''), ...(k.variants || []).map(String)]) {
          if (v0 === '' || mbLen(v0) < 2) continue;
          knownTok.set(code + '\0' + (ci ? lower(v0) : v0), tok);
          addVal(knownVal, code, v0);
          if (code === 'FQDN' && !empty(this.cats.HOST?.propagate)) {
            const label = firstLabel(v0);
            if (labelOk(label, lower(label), minLenOf())) addVal(knownVal, 'HOST', label);
          }
        }
      }

      const hintVal = new Map();
      for (const h of opt.hints || []) {
        const code = String(h.category ?? ''), v = phpTrim(String(h.value ?? ''));
        if (this.cats[code] && mbLen(v) >= 2 && !allow.has(lower(v))) {
          addVal(hintVal, code, v);
          addVal(knownVal, code, v);
        }
      }

      const propOn = (opt.propagate ?? true) && !empty(this.set.propagate);
      const byCatVals = knownVal;
      if (propOn) {
        const minLen = minLenOf();
        for (const c of sel) {
          const cat = this.cats[c.c];
          if (!cat || empty(cat.propagate) || !c.prop || mbLen(c.v) < minLen) continue;
          addVal(byCatVals, c.c, c.v);
          if (c.c === 'FQDN' && !empty(this.cats.HOST?.propagate)) {
            const label = firstLabel(c.v);
            if (labelOk(label, lower(label), minLen)) addVal(byCatVals, 'HOST', label);
          }
        }
      }
      for (const [code, valSet] of byCatVals) {
        const ci = empty(this.cats[code]?.case_sensitive);
        const vals = byBytesDesc([...valSet]);
        for (let i = 0; i < vals.length; i += 250) {
          const alts = vals.slice(i, i + 250).map(v =>
            (P.test(LETTER_START, 'u', v) ? '(?<![\\p{L}\\p{N}_])' : '') + pregQuote(v) + (P.test(LETTER_END, 'u', v) ? '(?![\\p{L}\\p{N}_])' : ''));
          let found;
          try { found = P.matchAll('(?:' + alts.join('|') + ')', ci ? 'iu' : 'u', text).matches; } catch (e) { continue; }
          for (const mm of found) {
            const v = mm[0], s = mm.index, l = v.length;
            if (!free(s, s + l) || (allow.size && allow.has(lower(v)))) continue;
            if (s > 0 && (text[s - 1] === '/' || text[s - 1] === '\\')) continue;
            occ.fill(1, s, s + l);
            const hv = hintVal.get(code);
            const rn = knownTok.has(code + '\0' + (ci ? lower(v) : v)) ? 'Chat mapping (earlier message)'
              : (hv && [...hv].some(x => lower(x) === lower(v)) ? 'Marked manually' : 'Propagation (repeated value)');
            sel.push({ s, e: s + l, v, c: code, r: 0, rn, p: 0, prop: false });
            hit(rn);
          }
        }
      }

      sel.sort((a, b) => a.s - b.s);
      const tokens = new Map(), counter = {}, items = new Map();
      const usedTok = new Set(knownTok.values());
      const newItem = (tok, c, cat) => ({
        token: tok, category: c.c, label: t(String(cat.label ?? c.c)), original: c.v,
        variants: new Set(), count: 0, rules: new Set()
      });
      for (const c of sel) {
        const cat = this.cats[c.c] ?? { code: c.c, token: c.c, label: c.c, case_sensitive: 0, placeholder: null };
        const key = c.c + '\0' + (empty(cat.case_sensitive) ? lower(c.v) : c.v);
        if (!tokens.has(key) && knownTok.has(key)) {
          tokens.set(key, knownTok.get(key));
          items.set(key, newItem(knownTok.get(key), c, cat));
        }
        if (!tokens.has(key)) {
          const tpl = String((cat.placeholder ?? '') !== '' ? cat.placeholder : (this.set.placeholder_template ?? '<{CAT}_{n}>'));
          let guard = 0, tok, clash;
          do {
            const n = (counter[c.c] || 0) + 1;
            counter[c.c] = n;
            tok = this.token(tpl, cat, n, c.v);
            clash = tpl.includes('{n}') && (usedTok.has(tok) || text.includes(tok));
          } while (clash && ++guard < 10000);
          usedTok.add(tok);
          tokens.set(key, tok);
          items.set(key, newItem(tok, c, cat));
        }
        c.tok = tokens.get(key);
        const it = items.get(key);
        it.count++;
        it.variants.add(c.v);
        it.rules.add(c.rn);
      }

      let out = '';
      const segs = [];
      let pos = 0, line = 1;
      const maskedLines = new Set();
      for (const c of sel) {
        if (c.s > pos) {
          const plain = text.slice(pos, c.s);
          out += plain;
          segs.push({ t: plain });
          line += countOf(plain, '\n');
        }
        out += c.tok;
        segs.push({ m: c.tok, o: c.v, c: c.c, r: t(c.rn) });
        maskedLines.add(line);
        line += countOf(c.v, '\n');
        pos = c.e;
      }
      if (pos < text.length) {
        segs.push({ t: text.slice(pos) });
        out += text.slice(pos);
      }

      const warnings = [];
      const risk = phpTrim(String(this.set.risk_keywords ?? ''));
      if (risk !== '') {
        out.split('\n').some((ln, i) => {
          if (warnings.length >= 50) return true;
          if (!maskedLines.has(i + 1)) {
            let km = null;
            try { km = P.match(risk, 'iu', ln); } catch (e) { km = null; }
            if (km) warnings.push({ line: i + 1, keyword: km[0], text: mbSubstr(phpTrim(ln), 0, 220) });
          }
          return false;
        });
      }

      const byCat = {};
      for (const it of items.values()) {
        const b = byCat[it.category] || (byCat[it.category] = {});
        b.unique = (b.unique || 0) + 1;
        b.count = (b.count || 0) + it.count;
      }
      const itemList = [...items.values()].map(it => ({ ...it, variants: [...it.variants], rules: [...it.rules].map(r => t(r)) }));
      const byRule = {};
      [...ruleHits.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => { byRule[k] = v; });

      const res = {
        masked: out,
        segments: segs,
        items: itemList,
        warnings,
        errors: this.errors,
        stats: {
          mode: this.mode,
          detected,
          ms: Math.round(((root.performance || Date).now() - t0) * 10) / 10,
          chars_in: mbLen(text),
          chars_out: mbLen(out),
          lines: countOf(text, '\n') + 1,
          matches: sel.length,
          unique: itemList.length,
          by_category: byCat,
          by_rule: byRule,
          propagated: !!propOn
        }
      };
      if (this.debug) {
        res.rejects = this.rejects.slice(0, 500);
        res.candidates = this.cands.length;
      }
      return res;
    }

    token(tpl, cat, n, v) {
      const prefix = String(cat.token ?? cat.code);
      const map = {
        '{CAT}': prefix, '{cat}': asciiLower(prefix), '{n}': String(n), '{len}': String(mbLen(v)),
        '{hash}': () => hmacSha256Hex(lower(v), this.secret).slice(0, 8),
        '{stars}': '*'.repeat(Math.max(3, Math.min(32, mbLen(v))))
      };
      return tpl.replace(/\{CAT\}|\{cat\}|\{n\}|\{len\}|\{hash\}|\{stars\}/g, m => typeof map[m] === 'function' ? map[m]() : map[m]);
    }

    reject(c, why) {
      if (this.debug) {
        this.rejects.push({ value: c.v, category: c.c, rule: this.t(c.rn), offset: byteLen(this.text.slice(0, c.s)), reason: this.t(why) });
      }
    }

    consider(r, cat, val, off) {
      const o = r.options || {};
      const base = { r: r.id ?? 0, rn: r.name, p: parseInt(r.priority, 10), prop: (o.propagate ?? true) !== false };
      if (r.type === 'keyword') cat = this.termCats[String(r.id ?? 'x')]?.[lower(val)] ?? cat;
      if (!SECRET_CATS.includes(cat)) [val, off] = Engine.trimValue(val, off);
      if (val === '') return;
      const list = (!empty(o.reclassify) || !empty(o.split_domain)) ? this.reclassify(cat, val, off, o) : [[cat, val, off]];
      const prev = off > 0 ? this.text[off - 1] : '';
      const quoted = prev === '"' || prev === "'" || prev === BT;
      for (const [c, v, s] of list) {
        const cand = { ...base, s, e: s + v.length, bl: byteLen(v), v, c };
        const why = this.why(r, o, c, v, quoted);
        if (why !== null) { this.reject(cand, why); continue; }
        this.cands.push(cand);
      }
    }

    static trimValue(v, off) {
      const LEAD = '"\'' + BT + '([<{ \t', TAIL = '.,:;!?"\'' + BT + ')]>} \t';
      let lead = 0;
      while (lead < v.length && LEAD.includes(v[lead])) lead++;
      if (lead) { v = v.slice(lead); off += lead; }
      let end = v.length;
      while (end > 0 && TAIL.includes(v[end - 1])) end--;
      return [v.slice(0, end), off];
    }

    reclassify(cat, v, off, o) {
      if (isIPv4(v)) return [['IP', v, off]];
      if (v.includes(':') && isIPv6(phpTrim(v, '[]'))) return [['IP6', v, off]];
      if (P.test('^(?:[0-9A-Fa-f]{2}[:\\-]){5}[0-9A-Fa-f]{2}$|^[0-9A-Fa-f]{4}\\.[0-9A-Fa-f]{4}\\.[0-9A-Fa-f]{4}$', '', v)) return [['MAC', v, off]];
      if (P.test('^S-1-\\d+(?:-\\d+)+$', '', v)) return P.test('^S-1-(?:5-21|12-1)(?:-\\d+){3,4}$', '', v) ? [['SID', v, off]] : [];
      if (['USER', 'HOST', 'DOMAIN', 'PERSON'].includes(cat) && P.test('^[^@\\s]+@[^@\\s]+\\.[A-Za-z]{2,}$', '', v)) return [];
      if (!empty(o.split_domain) || cat === 'USER') {
        const m = P.match('^([^\\\\\\s]+)\\\\{1,2}([^\\\\\\s]+)$', '', v);
        if (m) {
          const uOff = off + v.length - m[2].length;
          const dCat = m[1].includes('.') ? 'FQDN' : 'DOMAIN';
          return [[dCat, m[1], off], ...this.reclassify('USER', m[2], uOff, {})];
        }
      }
      if (cat === 'USER') {
        const m = P.match('^([A-Za-z0-9][\\w.\\-]*)\\$$', '', v);
        if (m) return [['HOST', m[1], off]];
      }
      if (cat === 'USER' && P.test('^\\p{L}[\\p{L}\'’\\-]*(?:[ \\t]+\\p{L}[\\p{L}\'’\\-]*)+$', 'u', v)) return [['PERSON', v, off]];
      if ((cat === 'HOST' || cat === 'DOMAIN') && P.test('^[A-Za-z0-9\\-_]+(?:\\.[A-Za-z0-9\\-_]+)+$', '', v) && /[A-Za-z]/.test(afterLastDot(v))) return [['FQDN', v, off]];
      return [[cat, v, off]];
    }

    why(r, o, cat, v, quoted) {
      const t = this.t;
      const catRow = this.cats[cat];
      if (catRow && empty(catRow.enabled)) return t('Category disabled ({cat})', { cat });
      if (this.offCats.has(cat)) return t('Category disabled for this run ({cat})', { cat });
      const lv = lower(v);
      if (this.keepValues.has(lv)) return 'Tutma listesinde (keep_values)';
      if (!empty(o.skip_vars ?? true) && isVariableRef(v)) return t('Variable / placeholder reference');
      if (!empty(o.skip_numeric) && isDigits(v)) return t('Numbers only');
      const len = mbLen(v);
      if (!empty(o.min_len) && len < parseInt(o.min_len, 10)) return t('Below the minimum length ({n})', { n: parseInt(o.min_len, 10) });
      if (!empty(o.max_len) && len > parseInt(o.max_len, 10)) return t('Above the maximum length ({n})', { n: parseInt(o.max_len, 10) });
      if (!empty(o.skip_regex)) {
        let skip = false;
        try { skip = P.test(String(o.skip_regex), 'iu', v); } catch (e) { skip = false; }
        if (skip) return t('Matched the exclude regex');
      }
      if (cat === 'PASSWORD' && P.test('^\\d{1,3}$', '', v)) return t('Short numeric value (may be a setting value)');
      if (this.mode === 'script' && !quoted && r.type === 'keyvalue') {
        if (P.test('^[A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)+$', '', v)) {
          if (!this.tlds.includes(lower(afterLastDot(v)))) return t('Code reference (object.property)');
        }
        if (P.test('^[A-Za-z_][A-Za-z0-9_]*$', '', v) && this.wordOccurrences(v) >= 2) return t('Script variable (also appears elsewhere in the text)');
      }
      if (this.mode === 'script' && cat === 'FQDN' && countOf(v, '.') === 1 && this.codeDeny.has(lower(firstLabel(v)))) return t('Code reference ({v})', { v });

      if (cat === 'IP') {
        if (!isIPv4(v)) return t('Invalid IPv4');
        if (!empty(this.set.keep_netmasks) && isNetmask(v)) return t('Subnet mask / wildcard');
        for (const cidr of this.keepCidrs) if (inCidr(v, cidr)) return t('In a kept IP range ({cidr})', { cidr });
      } else if (cat === 'IP6') {
        if (!isIPv6(phpTrim(v, '[]'))) return t('Invalid IPv6');
      } else if (cat === 'FQDN' || cat === 'EMAIL') {
        const at = lv.lastIndexOf('@');
        const dom = cat === 'EMAIL' ? (at < 0 ? '' : lv.slice(at + 1)) : lv;
        for (const kd of this.keepDomains) if (dom === kd || dom.endsWith('.' + kd)) return t('Kept domain ({d})', { d: kd });
        if (cat === 'FQDN') {
          const first = firstLabel(lv);
          if (this.fqdnDenyFirst.has(first)) return t('Code namespace ({ns}.)', { ns: first });
          if (P.test('^[\\d.]+$', '', lv)) return t('Numeric');
        }
      }

      switch (o.validate ?? '') {
        case 'luhn': if (!luhn(v)) return t('Luhn check failed'); break;
        case 'tckn': if (!tckn(v)) return t('TCKN checksum does not match'); break;
        case 'iban': if (!iban(v)) return t('IBAN mod-97 check failed'); break;
        case 'phone': {
          const d = v.replace(/[^0-9]/g, '').length;
          if (d < 10 || d > 13) return t('Wrong number of phone digits');
          break;
        }
        case 'entropy': {
          const min = parseFloat(o.entropy_min ?? 4.0), e = entropy(v);
          if (e < min) return t('Low entropy ({e} < {min})', { e: fixed2(e), min: fixed2(min) });
          break;
        }
        case 'dotted': {
          const parts = lv.split('.');
          for (const p of parts) if (this.denyExt.has(p) || this.codeDeny.has(p)) return t('File extension / code token ({p})', { p });
          if (this.tlds.includes(parts[parts.length - 1])) return t('Looks like a domain name');
          break;
        }
        case 'person': {
          const words = lv.split(/[ \t]+/);
          words.shift();
          for (const w of words) if (this.stopwords.has(w)) return t('The second word is a common word ({w})', { w });
          break;
        }
      }
      return null;
    }

    wordOccurrences(w) {
      if (!this.wordCount.has(w)) {
        this.wordCount.set(w, P.matchAll('(?<![\\p{L}\\p{N}_$])' + pregQuote(w) + '(?![\\p{L}\\p{N}_])', 'u', this.text).matches.length);
      }
      return this.wordCount.get(w);
    }
  }

  Engine.lines = lines;
  Engine.lower = lower;
  root.MaskinkEngine = Engine;
  root.MaskinkValidators = { isIPv4, isIPv6, isNetmask, inCidr, luhn, tckn, iban, entropy, hmacSha256Hex, isVariableRef, detectMode };
})(typeof globalThis !== 'undefined' ? globalThis : this);
