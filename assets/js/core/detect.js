/*
 * Exposift – sensitive data detectors (EXP-002).
 * Pure functions: text in, matches out. Runs in the browser and in Node (tests).
 * A match is never a verdict: every match carries a confidence level and a note
 * explaining why it was flagged (a number that passes the national-ID check is not
 * proof that it belongs to a person).
 */
(function (g) {
  'use strict';
  const Ex = g.Ex = g.Ex || {};

  // Priority when two matches overlap: the higher one wins.
  const PRIORITY = { secret: 9, iban: 8, card: 8, email: 7, url: 6, internal_url: 6, national_id: 5, tax_id: 4, ip: 3, phone: 2, path: 2, name: 1 };

  // Same length, folded: lets "Şahin" find "SAHIN"/"sahin" without shifting offsets.
  const FOLD = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'i̇': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'Ç': 'c', 'Ğ': 'g', 'İ': 'i', 'I': 'i', 'Ö': 'o', 'Ş': 's', 'Ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u', 'Â': 'a', 'Î': 'i', 'Û': 'u' };
  const fold = s => s.replace(/[çğıöşüÇĞİIÖŞÜâîûÂÎÛ]/g, c => FOLD[c]).toLowerCase();

  // ------------------------------------------------------------------ checksums
  const digitsOf = s => s.replace(/\D/g, '');

  /** T.C. kimlik numarası: 11 digits, first non-zero, two check digits */
  function validTckn(s) {
    if (!/^[1-9]\d{10}$/.test(s)) return false;
    const d = s.split('').map(Number);
    const odd = d[0] + d[2] + d[4] + d[6] + d[8];
    const even = d[1] + d[3] + d[5] + d[7];
    if (((odd * 7 - even) % 10 + 10) % 10 !== d[9]) return false;
    return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10];
  }

  /** Vergi kimlik numarası: 10 digits with a check digit */
  function validVkn(s) {
    if (!/^\d{10}$/.test(s)) return false;
    const d = s.split('').map(Number);
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      const tmp = (d[i] + (9 - i)) % 10;
      let v = (tmp * Math.pow(2, 9 - i)) % 9;
      if (tmp !== 0 && v === 0) v = 9;
      sum += v;
    }
    return (10 - (sum % 10)) % 10 === d[9];
  }

  const IBAN_LEN = {
    AL: 28, AD: 24, AT: 20, AZ: 28, BH: 22, BE: 16, BA: 20, BG: 22, HR: 21, CY: 28, CZ: 24, DK: 18, EE: 20, FO: 18, FI: 18, FR: 27, GE: 22,
    DE: 22, GI: 23, GR: 27, GL: 18, HU: 28, IS: 26, IE: 22, IL: 23, IT: 27, JO: 30, KZ: 20, XK: 20, KW: 30, LV: 21, LB: 28, LI: 21, LT: 20,
    LU: 20, MT: 31, MR: 27, MU: 30, MD: 24, MC: 27, ME: 22, NL: 18, MK: 19, NO: 15, PK: 24, PS: 29, PL: 28, PT: 25, QA: 29, RO: 24, SM: 27,
    SA: 24, RS: 22, SK: 24, SI: 19, ES: 24, SE: 24, CH: 21, TN: 24, TR: 26, AE: 23, GB: 22, VA: 22, VG: 24
  };

  function validIban(raw) {
    const s = raw.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
    if (IBAN_LEN[s.slice(0, 2)] !== s.length) return false;
    const re = s.slice(4) + s.slice(0, 4);
    let rem = 0;
    for (const ch of re) {
      const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
      for (const c of v) rem = (rem * 10 + Number(c)) % 97;
    }
    return rem === 1;
  }

  function luhn(s) {
    if (!/^\d{13,19}$/.test(s)) return false;
    let sum = 0, alt = false;
    for (let i = s.length - 1; i >= 0; i--) {
      let n = s.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }

  function entropy(s) {
    const f = {};
    for (const c of s) f[c] = (f[c] || 0) + 1;
    return -Object.values(f).reduce((a, n) => a + (n / s.length) * Math.log2(n / s.length), 0);
  }

  function parseIPv4(s) {
    const p = s.split('.');
    if (p.length !== 4) return null;
    const n = p.map(x => (/^(0|[1-9]\d{0,2})$/.test(x) ? Number(x) : NaN));
    return n.every(x => x >= 0 && x <= 255) ? n : null;
  }
  const isPrivateV4 = n => n[0] === 10 || (n[0] === 172 && n[1] >= 16 && n[1] <= 31) || (n[0] === 192 && n[1] === 168) || n[0] === 127 || (n[0] === 169 && n[1] === 254);

  function validIPv6(s) {
    if (!/^[0-9a-fA-F:.]+$/.test(s) || s.includes(':::')) return false;
    const dbl = s.split('::').length - 1;
    if (dbl > 1) return false;
    const parts = s.split(':').filter((x, i, a) => !(x === '' && (i === 0 || i === a.length - 1 || dbl)));
    if (parts.some(p => !/^[0-9a-fA-F]{1,4}$/.test(p) && !parseIPv4(p))) return false;
    return dbl ? parts.length <= 7 : parts.length === 8;
  }

  // ------------------------------------------------------------------ patterns
  const RE = {
    email: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}/g,
    url: /\b(?:https?|ftp):\/\/[^\s<>"'\\^`{|}]+/gi,
    ipv4: /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w]|\.\d)/g,
    ipv6: /(?<![\w:])(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?![\w:])/g,
    iban: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{1,5}){3,9}\b/g,
    card: /(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g,
    digits11: /(?<!\d|\d[.,])\d{11}(?!\d|[.,]\d)/g,
    digits10: /(?<!\d|\d[.,])\d{10}(?!\d|[.,]\d)/g,
    phoneTR: /(?<![\w+])(?:(?:\+|00)90[\s.-]?|0[\s.-]?)\(?[2-5]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\d)/g,
    phoneIntl: /(?<![\w+])\+(?!90)[1-9]\d{0,2}(?:[\s.-]?\(?\d{1,4}\)?){2,5}(?!\d)/g,
    winPath: /\b[A-Za-z]:\\(?:Users|Documents and Settings)\\([^\\/:*?"<>|\r\n\s]+)(?:\\[^\\/:*?"<>|\r\n]*)*/g,
    unixPath: /(?<![\w.])\/(?:Users|home)\/([A-Za-z0-9._-]+)(?:\/[^\s"'<>]*)?/g,
    unc: /\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9._$-]+(?:\\[^\\/:*?"<>|\r\n\s]*)*/g,
    kv: /\b(api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|auth[_-]?token|token|passw(?:or)?d|pwd|parola|şifre|sifre|bearer)\b["']?\s*[:=]\s*["']?([^\s"',;]{6,})/gi
  };

  const KEY_PATTERNS = [
    ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
    ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/g],
    ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
    ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
    ['Stripe key', /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g],
    ['NVIDIA API key', /\bnvapi-[A-Za-z0-9_-]{20,}\b/g],
    ['OpenAI-style key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g],
    ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
    ['Private key block', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g]
  ];

  const trimUrl = u => u.replace(/[.,;:!?)\]]+$/, '');

  /**
   * Finds sensitive values in a text.
   * opts.names: user-defined names to look for; opts.skip: Set of types to skip.
   * Returns [{type, value, start, end, conf, note, sub}] sorted by position, overlaps resolved.
   */
  function detect(text, opts = {}) {
    const out = [];
    const skip = opts.skip || new Set();
    const add = (type, m, extra = {}) => {
      if (skip.has(type)) return;
      out.push({ type, value: extra.value ?? m[0], start: extra.start ?? m.index, end: (extra.start ?? m.index) + (extra.value ?? m[0]).length, conf: extra.conf || 'medium', note: extra.note || '', sub: extra.sub || '' });
    };
    const ctx = (idx, len, words) => {
      const near = text.slice(Math.max(0, idx - 40), idx) + text.slice(idx + len, idx + len + 12);
      return words.test(near);
    };

    // secrets first: they decide a lot
    for (const [label, re] of KEY_PATTERNS) {
      for (const m of text.matchAll(re)) add('secret', m, { conf: 'high', note: label, sub: label });
    }
    for (const m of text.matchAll(RE.kv)) {
      const val = m[2];
      if (/^(true|false|null|none|yok|your[_-]?|example|xxx+|\*+|<.*>|\{.*\})/i.test(val)) continue;
      const hi = val.length >= 16 && entropy(val) >= 3.2;
      const start = m.index + m[0].length - val.length;
      add('secret', m, { value: val, start, conf: hi ? 'high' : 'medium', note: 'Value next to "' + m[1] + '"', sub: m[1].toLowerCase() });
    }

    for (const m of text.matchAll(RE.email)) add('email', m, { conf: 'high', note: 'Email address format' });

    for (const m of text.matchAll(RE.url)) {
      const v = trimUrl(m[0]);
      let host = '', cred = false, tokenQ = false;
      try {
        const u = new URL(v); host = u.hostname; cred = !!(u.username || u.password);
        tokenQ = /[?&](token|key|api_key|apikey|access_token|sig|signature|password)=/i.test(u.search);
      } catch (e) { /* not a valid URL */ }
      const v4 = parseIPv4(host);
      const internal = host && (host === 'localhost' || !host.includes('.') || /\.(local|lan|internal|corp|intranet|home|test)$/i.test(host) || (v4 && isPrivateV4(v4)));
      if (cred || tokenQ) add('secret', m, { value: v, conf: 'high', note: cred ? 'Credentials inside a URL' : 'Token-like query parameter in a URL', sub: 'url' });
      else if (internal) add('internal_url', m, { value: v, conf: 'high', note: 'Address of an internal system (' + host + ')' });
      else add('url', m, { value: v, conf: 'high', note: 'Link to ' + (host || 'an external address'), sub: host });
    }

    for (const m of text.matchAll(RE.iban)) {
      if (validIban(m[0])) add('iban', m, { conf: 'high', note: 'Passes the IBAN length and MOD-97 check', sub: m[0].replace(/\s/g, '').slice(0, 2) });
    }
    for (const m of text.matchAll(RE.card)) {
      const d = digitsOf(m[0]);
      if (luhn(d) && !/^(\d)\1+$/.test(d)) add('card', m, { conf: ctx(m.index, m[0].length, /kart|card|visa|master|amex|cvv|cvc/i) ? 'high' : 'medium', note: 'Passes the card-number (Luhn) check' });
    }

    for (const m of text.matchAll(RE.digits11)) {
      if (!validTckn(m[0])) continue;
      const withCtx = ctx(m.index, 11, /t\.?\s?c\.?|kimlik|tckn|vatanda|nüfus|nufus|national id|identity/i);
      add('national_id', m, { conf: withCtx ? 'high' : 'low', note: 'Passes the Turkish national ID checksum' + (withCtx ? '' : '; any random 11-digit number passes about 1% of the time') });
    }
    for (const m of text.matchAll(RE.digits10)) {
      if (!validVkn(m[0])) continue;
      const withCtx = ctx(m.index, 10, /vergi|vkn|tax|v\.?\s?d\.?/i);
      if (withCtx) add('tax_id', m, { conf: 'high', note: 'Passes the Turkish tax ID check, next to a tax keyword' });
      else if (opts.looseTaxId) add('tax_id', m, { conf: 'low', note: 'Passes the tax ID check; about 10% of random 10-digit numbers do' });
    }

    for (const m of text.matchAll(RE.ipv4)) {
      const n = parseIPv4(m[0]);
      if (!n || (n[0] === 0) || /^\d+\.\d+\.\d+\.\d+$/.test(m[0]) === false) continue;
      // version-number-like strings (1.2.3.4) are common; keep them low unless context says IP
      const priv = isPrivateV4(n);
      const hasCtx = ctx(m.index, m[0].length, /\bip\b|adres|address|host|server|sunucu|gateway|subnet/i);
      add('ip', m, { conf: priv || hasCtx ? 'high' : 'low', note: priv ? 'Private network address' : hasCtx ? 'Public IP address' : 'Looks like an IPv4 address (could be a version number)', sub: priv ? 'private' : 'public' });
    }
    for (const m of text.matchAll(RE.ipv6)) {
      if (m[0].length >= 6 && validIPv6(m[0])) add('ip', m, { conf: 'medium', note: 'IPv6 address', sub: 'ipv6' });
    }

    for (const m of text.matchAll(/(?<![\d-])(\d{3})-(\d{2})-(\d{4})(?![\d-])/g)) {
      const area = +m[1];
      if (area === 0 || area === 666 || area >= 900 || m[2] === '00' || m[3] === '0000') continue;
      add('national_id', m, { conf: ctx(m.index, m[0].length, /ssn|social security|national id|tax id/i) ? 'high' : 'medium', note: 'US Social Security number pattern', sub: 'ssn' });
    }
    for (const m of text.matchAll(RE.phoneTR)) add('phone', m, { conf: 'medium', note: 'Turkish phone number pattern' });
    for (const m of text.matchAll(RE.phoneIntl)) {
      const d = digitsOf(m[0]);
      if (d.length >= 9 && d.length <= 15) add('phone', m, { conf: 'low', note: 'International phone number pattern' });
    }

    for (const m of text.matchAll(RE.winPath)) add('path', m, { conf: 'high', note: 'Local path containing the account name "' + m[1] + '"', sub: m[1] });
    for (const m of text.matchAll(RE.unixPath)) add('path', m, { conf: 'high', note: 'Local path containing the account name "' + m[1] + '"', sub: m[1] });
    for (const m of text.matchAll(RE.unc)) add('path', m, { conf: 'high', note: 'Network share path', sub: 'unc' });

    if (opts.names && opts.names.length) {
      const hay = fold(text);
      for (const raw of opts.names) {
        const needle = fold(String(raw).trim());
        if (needle.length < 2) continue;
        let i = 0;
        while ((i = hay.indexOf(needle, i)) !== -1) {
          const before = hay[i - 1], after = hay[i + needle.length];
          if (!(before && /[a-z0-9]/.test(before)) && !(after && /[a-z0-9]/.test(after))) {
            out.push({ type: 'name', value: text.slice(i, i + needle.length), start: i, end: i + needle.length, conf: 'high', note: 'Matches a name from your list', sub: String(raw).trim() });
          }
          i += needle.length;
        }
      }
    }

    // resolve overlaps: highest priority first, then longest
    out.sort((a, b) => (PRIORITY[b.type] || 0) - (PRIORITY[a.type] || 0) || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const kept = [];
    for (const m of out) {
      if (!kept.some(k => m.start < k.end && m.end > k.start)) kept.push(m);
    }
    return kept.sort((a, b) => a.start - b.start);
  }

  Ex.detect = detect;
  Ex.detectUtil = { validTckn, validVkn, validIban, luhn, entropy, fold, parseIPv4, isPrivateV4, validIPv6 };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ex;
})(typeof window !== 'undefined' ? window : globalThis);
