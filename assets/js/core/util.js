/*
 * Exposift – shared helpers: hashing, resource limits, safe unzip, EXIF reader.
 */
(function (g) {
  'use strict';
  const Ex = g.Ex = g.Ex || {};

  const LIMITS = {
    maxFileBytes: 100 * 1024 * 1024,   // refuse larger files instead of freezing the tab
    zipMaxEntries: 5000,
    zipMaxEntryBytes: 250 * 1024 * 1024,
    zipMaxTotalBytes: 600 * 1024 * 1024,
    zipMaxRatio: 300,                  // total uncompressed / compressed, applied above 5 MB
    pdfMaxPages: 300,
    pdfMaxRevisions: 6
  };

  class ExposiftError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  async function sha256(bytes) {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  /** Unzips with entry-count, size and compression-ratio limits (zip-bomb guard). */
  function safeUnzip(bytes) {
    const fflate = g.fflate;
    if (!fflate) throw new Error('fflate is not loaded');
    let entries = 0, total = 0;
    let files;
    try {
      files = fflate.unzipSync(bytes, {
        filter(f) {
          entries++;
          total += f.originalSize;
          if (entries > LIMITS.zipMaxEntries) throw new ExposiftError('zip_entries', 'The archive contains too many entries.');
          if (f.originalSize > LIMITS.zipMaxEntryBytes) throw new ExposiftError('zip_entry_size', 'An entry in the archive is too large.');
          if (total > LIMITS.zipMaxTotalBytes) throw new ExposiftError('zip_total', 'The archive expands to too much data.');
          if (bytes.length > 5 * 1048576 && total / bytes.length > LIMITS.zipMaxRatio) throw new ExposiftError('zip_ratio', 'The archive compression ratio is suspicious.');
          return true;
        }
      });
    } catch (e) {
      if (e instanceof ExposiftError) throw e;
      throw new ExposiftError('zip_bad', 'The file is not a readable ZIP-based document.');
    }
    return files;
  }

  const utf8 = new TextDecoder('utf-8');
  const utf16 = new TextDecoder('utf-16le');
  function decodeXml(u8) {
    if (u8.length > 1 && u8[0] === 0xFF && u8[1] === 0xFE) return utf16.decode(u8.subarray(2));
    return utf8.decode(u8);
  }

  /**
   * Reads the few EXIF tags that matter for sharing: GPS position, camera, software, owner, dates.
   * Works on JPEG bytes. Returns null when there is no EXIF block.
   */
  function readExif(u8) {
    if (!u8 || u8.length < 12 || u8[0] !== 0xFF || u8[1] !== 0xD8) return null;
    let p = 2;
    while (p + 4 < u8.length) {
      if (u8[p] !== 0xFF) return null;
      const marker = u8[p + 1];
      const len = (u8[p + 2] << 8) | u8[p + 3];
      if (marker === 0xE1 && u8[p + 4] === 0x45 && u8[p + 5] === 0x78 && u8[p + 6] === 0x69 && u8[p + 7] === 0x66) {
        return parseTiff(u8, p + 10, p + 2 + len);
      }
      if (marker === 0xDA) return null;
      p += 2 + len;
    }
    return null;
  }

  function parseTiff(u8, base, end) {
    const le = u8[base] === 0x49;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const u16 = o => dv.getUint16(o, le);
    const u32 = o => dv.getUint32(o, le);
    const res = { gps: false, make: '', model: '', software: '', artist: '', copyright: '', date: '' };
    const str = (off, count) => {
      const o = count > 4 ? base + u32(off + 8) : off + 8;
      let s = '';
      for (let i = 0; i < count - 1 && o + i < end; i++) s += String.fromCharCode(u8[o + i]);
      return s.trim();
    };
    try {
      let ifd = base + u32(base + 4);
      const n = u16(ifd);
      for (let i = 0; i < n && ifd + 2 + i * 12 + 12 <= end; i++) {
        const e = ifd + 2 + i * 12, tag = u16(e), count = u32(e + 4);
        if (tag === 0x8825) res.gps = true;
        else if (tag === 0x010F) res.make = str(e, count);
        else if (tag === 0x0110) res.model = str(e, count);
        else if (tag === 0x0131) res.software = str(e, count);
        else if (tag === 0x013B) res.artist = str(e, count);
        else if (tag === 0x8298) res.copyright = str(e, count);
        else if (tag === 0x0132) res.date = str(e, count);
      }
    } catch (err) { /* truncated EXIF: keep what was read */ }
    return res;
  }

  /** Escapes a value for use in an HTML text node */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  Ex.util = { LIMITS, ExposiftError, sha256, fmtBytes, safeUnzip, decodeXml, readExif, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ex;
})(typeof window !== 'undefined' ? window : globalThis);
