/*
 * Translates the PCRE dialect Maskink rules are written in to JavaScript RegExp.
 *
 * PHP's /u turns on UCP, so \w \d \s \b are Unicode-aware there and ASCII-only in JS;
 * `.`, `^` and `$` also treat line ends differently. Those semantics are rewritten here
 * rather than passed through. Without `u` in the flags the ASCII (byte-mode) meaning is kept.
 * PCRE also keeps a capture from an earlier iteration of a repeated group while JS clears it, so
 * such loops get a span capture and are walked again after the match (see restoreLoops).
 * Constructs with no equivalent (recursion, conditionals, \K, \G, POSIX classes) throw.
 */
(function (root) {
  'use strict';

  const OPEN = '\uE002', OPEN_END = '\uE003', REF = '\uE004', REF_END = '\uE005';
  const ANY = '[\\s\\S]';
  const CLS = {
    ucp: { w: '\\p{L}\\p{N}\\p{Mn}\\p{Pc}', d: '\\p{Nd}', s: '\\p{Z}\\t\\n\\x0B\\f\\r\\x85' },
    ascii: { w: 'A-Za-z0-9_', d: '0-9', s: ' \\t\\n\\x0B\\f\\r' },
    h: '\\t \\xA0\\u1680\\u180E\\u2000-\\u200A\\u202F\\u205F\\u3000',
    v: '\\n\\x0B\\f\\r\\x85\\u2028\\u2029'
  };
  const GC = /^(?:C[cfnos]?|L[lmotu&C]?|M[cen]?|N[dlo]?|P[cdefios]?|S[ckmo]?|Z[lps]?|Any)$/;

  /** Number of capturing groups, needed up front to tell \\12 (reference) from \\101 (octal) */
  function countGroups(p) {
    let count = 0, inClass = false;
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === '\\') { if (p.startsWith('\\Q', i)) { const e = p.indexOf('\\E', i); i = e < 0 ? p.length : e + 1; } else i++; continue; }
      if (inClass) { if (c === ']') inClass = false; continue; }
      if (c === '[') { inClass = true; if (p[i + 1] === '^') i++; if (p[i + 1] === ']') i++; continue; }
      if (c === '(' && (p[i + 1] !== '?' || /^\(\?(?:P?<[A-Za-z_]|')/.test(p.slice(i, i + 6)))) count++;
    }
    return count;
  }

  function translate(p, flags) {
    const ucp = flags.includes('u');
    const base = {
      i: flags.includes('i'), m: flags.includes('m'), s: flags.includes('s'),
      x: flags.includes('x'), U: flags.includes('U')
    };
    const baseI = base.i;
    const set = ucp ? CLS.ucp : CLS.ascii;
    const n = p.length;
    let pos = 0, realGroups = 0, synth = 0;
    const names = {};
    const loops = [];
    const totalGroups = countGroups(p);

    const bad = msg => { throw new Error(msg + ' at offset ' + pos); };
    const unsupported = what => { throw new Error(what + ' is not supported by the browser demo'); };
    const cpAt = i => p.codePointAt(i);
    const hex = cp => ucp ? '\\u{' + cp.toString(16) + '}' : '\\u' + cp.toString(16).padStart(4, '0');
    const leaf = (s, fl) => fl.i === baseI ? s : (fl.i ? '(?i:' : '(?-i:') + s + ')';
    const wb = set.w;
    const boundary = neg => ucp
      ? (neg ? `(?:(?<=[${wb}])(?=[${wb}])|(?<![${wb}])(?![${wb}]))` : `(?:(?<=[${wb}])(?![${wb}])|(?<![${wb}])(?=[${wb}]))`)
      : (neg ? '\\B' : '\\b');

    function literal(cp) {
      if (cp < 0x20 || (cp >= 0xE000 && cp <= 0xF8FF) || cp === 0x7F) return hex(cp);
      const c = String.fromCodePoint(cp);
      return /[\\^$.*+?()[\]{}|/]/.test(c) ? '\\' + c : c;
    }
    function classLiteral(cp) {
      if (cp < 0x20 || (cp >= 0xE000 && cp <= 0xF8FF) || cp === 0x7F) return hex(cp);
      const c = String.fromCodePoint(cp);
      return /[\\\]\[^-]/.test(c) ? '\\' + c : c;
    }

    function property(neg, fl) { // pos is just after \p or \P
      let name;
      if (p[pos] === '{') {
        const e = p.indexOf('}', pos);
        if (e < 0) bad('Malformed \\p');
        name = p.slice(pos + 1, e); pos = e + 1;
      } else { name = p[pos++]; }
      if (name[0] === '^') { neg = !neg; name = name.slice(1); }
      if (name === 'L&' || (fl.i && /^L[ult]$/.test(name))) name = 'LC';
      if (/^X[a-z]{2}$/.test(name)) unsupported('\\p{' + name + '}');
      if (!ucp) unsupported('\\p without the u flag');
      const body = GC.test(name) || name === 'LC' ? name : 'Script_Extensions=' + name;
      return (neg ? '\\P{' : '\\p{') + body + '}';
    }

    /** Character value of an escape shared by classes and plain context, or -1. pos is after the letter. */
    function charEscape(c) {
      switch (c) {
        case 'n': return 10; case 'r': return 13; case 't': return 9; case 'f': return 12;
        case 'e': return 27; case 'a': return 7;
        case 'x': {
          if (p[pos] === '{') {
            const e = p.indexOf('}', pos);
            if (e < 0) bad('Malformed \\x');
            const v = parseInt(p.slice(pos + 1, e), 16); pos = e + 1; return v;
          }
          const m = /^[0-9a-fA-F]{0,2}/.exec(p.slice(pos, pos + 2))[0];
          pos += m.length; return m ? parseInt(m, 16) : 0;
        }
        case 'c': { const v = p.charCodeAt(pos++); return (v >= 97 && v <= 122 ? v - 32 : v) ^ 64; }
        case '0': {
          const m = /^[0-7]{0,2}/.exec(p.slice(pos, pos + 2))[0];
          pos += m.length; return m ? parseInt(m, 8) : 0;
        }
      }
      return -1;
    }

    function parseClass(fl) { // pos is just after '['
      let neg = false;
      if (p[pos] === '^') { neg = true; pos++; }
      let items = '';
      const negs = [];
      let first = true;
      const shorthand = c => {
        switch (c) {
          case 'd': return { s: set.d };
          case 'w': return { s: set.w };
          case 's': return { s: set.s };
          case 'h': return { s: CLS.h };
          case 'v': return { s: CLS.v };
          case 'D': return ucp ? { s: '\\P{Nd}' } : { n: `[^${set.d}]` };
          case 'W': return { n: `[^${set.w}]` };
          case 'S': return { n: `[^${set.s}]` };
          case 'H': return { n: `[^${CLS.h}]` };
          case 'V': return { n: `[^${CLS.v}]` };
        }
        return null;
      };
      /** Reads one member: {cp} for a single char, {s}/{n} for a set */
      const member = () => {
        const c = p[pos];
        if (c === '\\') {
          pos++;
          const e = p[pos++];
          if (e === undefined) bad('Trailing backslash');
          const sh = shorthand(e);
          if (sh) return sh;
          if (e === 'p' || e === 'P') return { s: property(e === 'P', fl) };
          if (e === 'b') return { cp: 8 };
          if (e === 'Q') {
            const end = p.indexOf('\\E', pos);
            const lit = end < 0 ? p.slice(pos) : p.slice(pos, end);
            pos = end < 0 ? n : end + 2;
            return { s: Array.from(lit, x => classLiteral(x.codePointAt(0))).join('') };
          }
          if (e === 'E') return { s: '' };
          if (/[1-7]/.test(e)) { // octal in a class
            const m = /^[0-7]{0,2}/.exec(p.slice(pos, pos + 2))[0];
            pos += m.length; return { cp: parseInt(e + m, 8) };
          }
          const v = charEscape(e);
          if (v >= 0) return { cp: v };
          pos--;
          const cp = cpAt(pos); pos += cp > 0xFFFF ? 2 : 1;
          return { cp };
        }
        const cp = cpAt(pos); pos += cp > 0xFFFF ? 2 : 1;
        return { cp };
      };
      for (;;) {
        if (pos >= n) bad('Missing terminating ] for character class');
        const c = p[pos];
        if (c === ']' && !first) { pos++; break; }
        first = false;
        if (c === '[' && /^\[[:.=]/.test(p.slice(pos, pos + 2)) && p.indexOf(p[pos + 1] + ']', pos + 2) > 0) unsupported('POSIX class');
        const a = member();
        if (a.n) { negs.push(a.n); continue; }
        if (a.s !== undefined) { items += a.s; continue; }
        if (p[pos] === '-' && pos + 1 < n && p[pos + 1] !== ']') {
          const save = pos;
          pos++;
          const b = member();
          if (b.cp !== undefined) {
            if (b.cp < a.cp) bad('Range out of order in character class');
            items += classLiteral(a.cp) + '-' + classLiteral(b.cp);
          } else {
            pos = save + 1; // a set after '-': the '-' is literal
            items += classLiteral(a.cp) + '\\-';
          }
          continue;
        }
        items += classLiteral(a.cp);
      }
      if (!negs.length) return leaf(`[${neg ? '^' : ''}${items}]`, fl);
      const alts = (items ? [`[${items}]`] : []).concat(negs).join('|');
      return leaf(neg ? `(?:(?!${alts})${ANY})` : `(?:${alts})`, fl);
    }

    function backref(num) { return REF + 'o' + num + REF_END; }

    function parseEscape(fl) { // pos is just after '\'
      const c = p[pos++];
      if (c === undefined) bad('Trailing backslash');
      switch (c) {
        case 'd': return leaf(`[${set.d}]`, fl);
        case 'D': return leaf(`[^${set.d}]`, fl);
        case 'w': return leaf(`[${set.w}]`, fl);
        case 'W': return leaf(`[^${set.w}]`, fl);
        case 's': return leaf(`[${set.s}]`, fl);
        case 'S': return leaf(`[^${set.s}]`, fl);
        case 'h': return `[${CLS.h}]`;
        case 'H': return `[^${CLS.h}]`;
        case 'v': return `[${CLS.v}]`;
        case 'V': return `[^${CLS.v}]`;
        case 'N': return '[^\\n]';
        case 'R': return '(?:\\r\\n|(?!\\r\\n)[\\n\\x0B\\f\\r\\x85\\u2028\\u2029])';
        case 'b': return boundary(false);
        case 'B': return boundary(true);
        case 'A': return '^';
        case 'z': return '$';
        case 'Z': return '(?=\\n?$)';
        case 'G': unsupported('\\G'); break;
        case 'K': unsupported('\\K'); break;
        case 'X': unsupported('\\X'); break;
        case 'C': unsupported('\\C'); break;
        case 'p': case 'P': return leaf(property(c === 'P', fl), fl);
        case 'Q': {
          const end = p.indexOf('\\E', pos);
          const lit = end < 0 ? p.slice(pos) : p.slice(pos, end);
          pos = end < 0 ? n : end + 2;
          return lit ? leaf('(?:' + Array.from(lit, x => literal(x.codePointAt(0))).join('') + ')', fl) : '';
        }
        case 'E': return '';
        case 'g': {
          const m = /^(?:\{(-?\d+|\w+)\}|(-?\d+))/.exec(p.slice(pos));
          if (!m) unsupported('\\g');
          pos += m[0].length;
          const v = m[1] || m[2];
          if (/^-\d+$/.test(v)) return backref(realGroups + 1 + parseInt(v, 10));
          if (/^\d+$/.test(v)) return backref(parseInt(v, 10));
          return REF + 'n' + v + REF_END;
        }
        case 'k': {
          const m = /^(?:<(\w+)>|\{(\w+)\}|'(\w+)')/.exec(p.slice(pos));
          if (!m) bad('Malformed \\k');
          pos += m[0].length;
          return REF + 'n' + (m[1] || m[2] || m[3]) + REF_END;
        }
      }
      if (/[1-9]/.test(c)) {
        const m = /^\d*/.exec(p.slice(pos))[0];
        const num = parseInt(c + m, 10);
        if (num < 10 || num <= totalGroups) { pos += m.length; return backref(num); }
        if (c > '7') bad('Reference to non-existent subpattern');
        const oct = /^[0-7]{0,2}/.exec(p.slice(pos))[0];
        pos += oct.length;
        return leaf(literal(parseInt(c + oct, 8)), fl);
      }
      const v = charEscape(c);
      if (v >= 0) return leaf(literal(v), fl);
      if (/[A-Za-z]/.test(c)) bad('Unrecognized escape \\' + c);
      pos--;
      const cp = cpAt(pos); pos += cp > 0xFFFF ? 2 : 1;
      return leaf(literal(cp), fl);
    }

    function applyFlags(str, fl) {
      let on = true;
      for (const ch of str) {
        if (ch === '-') on = false;
        else if ('imsxU'.includes(ch)) fl[ch] = on;
        else if (ch === 'J' || ch === 'n') unsupported('The (?' + ch + ') option');
        else bad('Unknown option ' + ch);
      }
    }

    function parseGroup(fl) { // pos is just after '('
      const close = body => {
        if (p[pos] !== ')') bad('Missing closing parenthesis');
        pos++;
        return body;
      };
      if (p[pos] === '*') unsupported('A (*VERB)');
      if (p[pos] !== '?') {
        const no = ++realGroups;
        return close(OPEN + 'o' + no + OPEN_END + parseAlt({ ...fl }) + ')');
      }
      pos++;
      const c = p[pos];
      if (c === '#') {
        const e = p.indexOf(')', pos);
        if (e < 0) bad('Missing ) after comment');
        pos = e + 1;
        return '';
      }
      if (c === ':') { pos++; return close('(?:' + parseAlt({ ...fl }) + ')'); }
      if (c === '=' || c === '!') { pos++; return close('(?' + c + parseAlt({ ...fl }) + ')'); }
      if (c === '>') { pos++; return close(atomic(parseAlt({ ...fl }))); }
      if (c === '<' && (p[pos + 1] === '=' || p[pos + 1] === '!')) {
        const k = p[pos + 1]; pos += 2;
        return close('(?<' + k + parseAlt({ ...fl }) + ')');
      }
      const nm = /^(?:P?<(\w+)>|'(\w+)')/.exec(p.slice(pos, pos + 80));
      if (nm) {
        pos += nm[0].length;
        const no = ++realGroups;
        names[nm[1] || nm[2]] = no;
        return close(OPEN + 'o' + no + OPEN_END + parseAlt({ ...fl }) + ')');
      }
      const pr = /^P=(\w+)\)/.exec(p.slice(pos, pos + 80));
      if (pr) { pos += pr[0].length; return REF + 'n' + pr[1] + REF_END; }
      if (c === '|') unsupported('A branch-reset group');
      if (c === '(') unsupported('A conditional group');
      if (c === 'R' || c === '&' || c === '+' || /\d/.test(c) || (c === 'P' && p[pos + 1] === '>')) unsupported('Recursion');
      const fm = /^([a-zA-Z-]*)([:)])/.exec(p.slice(pos, pos + 20));
      if (!fm) bad('Unrecognized character after (?');
      pos += fm[0].length;
      if (fm[2] === ')') { applyFlags(fm[1], fl); return ''; } // applies to the rest of the enclosing group
      const inner = { ...fl };
      applyFlags(fm[1], inner);
      return close('(?:' + parseAlt(inner) + ')');
    }

    function atomic(body) {
      const id = 's' + (++synth);
      return '(?=' + OPEN + id + OPEN_END + body + '))' + REF + id + REF_END;
    }

    function skipExtended(fl) {
      if (!fl.x) return;
      for (;;) {
        const c = p[pos];
        if (c !== undefined && /[ \t\n\r\f\x0B]/.test(c)) pos++;
        else if (c === '#') { const e = p.indexOf('\n', pos); pos = e < 0 ? n : e + 1; }
        else return;
      }
    }

    function quantifierAt() {
      const c = p[pos];
      if (c === '*' || c === '+' || c === '?') return c;
      if (c === '{') {
        const m = /^\{(?:\d+(?:,\d*)?|,\d+)\}/.exec(p.slice(pos, pos + 24));
        if (m) return m[0];
      }
      return null;
    }

    function parseAlt(fl) {
      const parts = [];
      let cur = '';
      for (;;) {
        skipExtended(fl);
        if (pos >= n) break;
        const c = p[pos];
        if (c === ')') break;
        if (c === '|') { pos++; parts.push(cur); cur = ''; continue; }
        if (quantifierAt() && c !== '{') bad('Quantifier does not follow a repeatable item');
        let atom;
        const groupsBefore = realGroups;
        if (c === '(') { pos++; atom = parseGroup(fl); }
        else if (c === '[') { pos++; atom = parseClass(fl); }
        else if (c === '\\') { pos++; atom = parseEscape(fl); }
        else if (c === '.') { pos++; atom = fl.s ? ANY : '[^\\n]'; }
        else if (c === '^') { pos++; atom = fl.m ? '(?:^|(?<=\\n)(?!$))' : '^'; }
        else if (c === '$') { pos++; atom = fl.m ? '(?=\\n|$)' : '(?=\\n?$)'; }
        else {
          const cp = cpAt(pos); pos += cp > 0xFFFF ? 2 : 1;
          atom = leaf(literal(cp), fl);
        }
        skipExtended(fl);
        const q = quantifierAt();
        if (q && atom !== '') {
          pos += q.length;
          let lazy = false, poss = false;
          if (p[pos] === '?') { lazy = true; pos++; } else if (p[pos] === '+') { poss = true; pos++; }
          if (fl.U && !poss) lazy = !lazy;
          const qq = q.replace(/^\{,/, '{0,');
          const repeats = q !== '?' && !/^\{(?:0,)?[01]\}$/.test(qq);
          if (poss) atom = atomic('(?:' + atom + ')' + qq);
          else if (repeats && realGroups > groupsBefore) {
            const id = 's' + (++synth);
            loops.push({ id, body: atom, first: groupsBefore + 1, last: realGroups });
            atom = OPEN + id + OPEN_END + '(?:' + atom + ')' + qq + (lazy ? '?' : '') + ')';
          } else atom = '(?:' + atom + ')' + qq + (lazy ? '?' : '');
        }
        cur += atom;
      }
      parts.push(cur);
      return parts.join('|');
    }

    const body = parseAlt({ ...base });
    if (pos < n) bad('Unmatched closing parenthesis');

    // JS numbers capture groups by position, so synthetic atomic groups are only numbered now
    const render = text => {
      const number = {};
      let next = 0;
      const groupMap = { 0: 0 };
      let source = text.replace(new RegExp(OPEN + '([os]\\d+)' + OPEN_END, 'g'), (_, id) => {
        next++;
        number[id] = next;
        if (id[0] === 'o') groupMap[+id.slice(1)] = next;
        return '(';
      });
      source = source.replace(new RegExp(REF + '([osn])(\\w+)' + REF_END, 'g'), (_, kind, id) => {
        const key = kind === 'n' ? 'o' + names[id] : kind + id;
        if (!(key in number)) throw new Error('Reference to non-existent subpattern ' + id);
        return '(?:\\' + number[key] + ')';
      });
      return { source, groupMap, number };
    };
    const main = render(body);
    const jsFlags = (baseI ? 'i' : '') + (ucp ? 'u' : '');
    return {
      source: main.source, flags: jsFlags, groupMap: main.groupMap,
      loops: loops.map(l => {
        let r;
        try { r = render(l.body); } catch (e) { return null; } // refers to a group outside the loop
        const groups = [];
        for (let g = l.first; g <= l.last; g++) if (main.groupMap[g] !== undefined && r.groupMap[g] !== undefined) groups.push([main.groupMap[g], r.groupMap[g]]);
        return { span: main.number[l.id], source: r.source, groups };
      }).filter(Boolean),
      // PCRE's second try after an empty match: must match here and must not be empty
      notEmpty: () => render('(?=' + OPEN + 's0' + OPEN_END + ANY + '*))(?:' + body + ')(?!' + REF + 's0' + REF_END + '$)')
    };
  }

  const cache = new Map();
  /** Compiled form of a PCRE pattern: {re (global, with indices), groupMap}. Throws when it cannot compile. */
  function compile(pattern, flags) {
    const key = flags + '\u0001' + pattern;
    let hit = cache.get(key);
    if (hit) {
      if (hit.error) throw hit.error;
      return hit;
    }
    try {
      const t = translate(pattern, flags);
      hit = {
        re: new RegExp(t.source, 'gd' + t.flags), groupMap: t.groupMap, t, retry: null,
        loops: t.loops.map(l => ({ ...l, re: new RegExp(l.source, 'yd' + t.flags) }))
      };
    } catch (e) {
      cache.set(key, { error: e });
      throw e;
    }
    if (cache.size >= 400) cache.clear(); // propagation builds a new pattern per text
    cache.set(key, hit);
    return hit;
  }

  /** preg_match: the first match array or null. */
  function match(pattern, flags, s) {
    const c = compile(pattern, flags);
    c.re.lastIndex = 0;
    return c.re.exec(s);
  }
  function test(pattern, flags, s) { return match(pattern, flags, s) !== null; }

  /** Walks each repeated group again and puts back captures from earlier iterations, as PCRE reports them */
  function restoreLoops(c, m, s) {
    for (const l of c.loops) {
      if (m[l.span] === undefined) continue;
      const [start, end] = m.indices[l.span];
      let at = start;
      while (at < end) {
        l.re.lastIndex = at;
        const b = l.re.exec(s);
        if (!b || b[0] === '' || b.index + b[0].length > end) break;
        for (const [main, inner] of l.groups) {
          if (b[inner] !== undefined) { m[main] = b[inner]; m.indices[main] = b.indices[inner]; }
        }
        at = b.index + b[0].length;
      }
    }
    return m;
  }

  /** preg_match_all: every match, each with .indices. Follows PCRE's handling of empty matches. */
  function matchAll(pattern, flags, s) {
    const c = compile(pattern, flags);
    const re = c.re, out = [];
    let at = 0;
    const midPair = i => i > 0 && i < s.length && (s.charCodeAt(i) & 0xFC00) === 0xDC00 && (s.charCodeAt(i - 1) & 0xFC00) === 0xD800;
    const step = i => i + (re.unicode && s.codePointAt(i) > 0xFFFF ? 2 : 1);
    while (at <= s.length) {
      re.lastIndex = at;
      const m = re.exec(s);
      if (!m) break;
      if (re.unicode && m[0] === '' && midPair(m.index)) { at = m.index + 1; continue; }
      out.push(c.loops.length ? restoreLoops(c, m, s) : m);
      if (m[0] !== '') { at = m.index + m[0].length; continue; }
      if (!c.retry) {
        const r = c.t.notEmpty();
        c.retry = { re: new RegExp(r.source, 'yd' + c.t.flags), groupMap: r.groupMap };
      }
      c.retry.re.lastIndex = m.index;
      const again = m.index < s.length ? c.retry.re.exec(s) : null;
      if (again) {
        // report it with the main pattern's group numbers
        const fixed = [again[0]];
        fixed.index = again.index;
        fixed.indices = [again.indices[0]];
        for (const [o, n] of Object.entries(c.groupMap)) {
          if (+o === 0) continue;
          fixed[n] = again[c.retry.groupMap[o]];
          fixed.indices[n] = again.indices[c.retry.groupMap[o]];
        }
        out.push(fixed);
        at = again.index + again[0].length;
      } else {
        at = m.index < s.length ? step(m.index) : s.length + 1;
      }
    }
    re.lastIndex = 0;
    return { matches: out, groupMap: c.groupMap };
  }

  root.MaskinkPcre = { translate, compile, match, test, matchAll };
})(typeof globalThis !== 'undefined' ? globalThis : this);
