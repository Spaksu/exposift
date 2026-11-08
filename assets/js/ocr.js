/*
 * Exposift – reads text inside pictures (OCR) with Tesseract running in this browser.
 * Nothing leaves the computer: the engine and the language data are served by this site (assets/vendor/tesseract).
 * Ex.ocr.segment() turns a recognised picture into a segment that the normal detectors can scan; when the
 * picture is a PDF page the words keep their position so a chosen value can be covered when the page is rebuilt.
 */
(function (g) {
  'use strict';
  const Ex = g.Ex = g.Ex || {};
  const abs = (p) => new URL(p, g.document ? g.document.baseURI : 'http://localhost/').href;
  let worker = null, loading = null;

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (g.Tesseract) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('The OCR engine could not be loaded.'));
      document.head.appendChild(s);
    });
  }

  /** Starts the engine once (English + Turkish). onStatus(text) receives short progress messages. */
  async function start(onStatus) {
    if (worker) return worker;
    if (loading) return loading;
    loading = (async () => {
      await loadScript(abs('assets/vendor/tesseract/tesseract.min.js'));
      if (onStatus) onStatus('Loading the OCR engine…');
      const w = await g.Tesseract.createWorker(['eng', 'tur'], 1, {
        workerPath: abs('assets/vendor/tesseract/worker.min.js'),
        corePath: abs('assets/vendor/tesseract/'),
        langPath: abs('assets/vendor/tesseract/lang'),
        gzip: true, cacheMethod: 'none'
      });
      worker = w;
      return w;
    })();
    try { return await loading; } finally { loading = null; }
  }

  async function stop() { if (worker) { try { await worker.terminate(); } catch (e) { /* ignore */ } worker = null; } }

  /** Recognises one image (Blob, canvas or URL). Returns { text, spans:[{start,end,x0,y0,x1,y1}] } in pixels. */
  async function read(image, onStatus) {
    const w = await start(onStatus);
    const { data } = await w.recognize(image, {}, { blocks: true });
    let text = '';
    const spans = [];
    const lines = (data.lines && data.lines.length) ? data.lines.map(l => l.words || []) : [data.words || []];
    for (const words of lines) {
      for (const wd of words) {
        if (!wd.text || !wd.text.trim() || (wd.confidence != null && wd.confidence < 30)) continue;
        const start = text.length;
        text += wd.text;
        spans.push({ start, end: text.length, x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1 });
        text += ' ';
      }
      if (text && !text.endsWith('\n')) text = text.replace(/ $/, '') + '\n';
    }
    return { text, spans };
  }

  /**
   * Builds a segment. For a PDF page pass { page, view, scale }: pixel boxes are converted to PDF user space
   * (origin bottom-left) so the existing "cover before rebuilding" step can use them.
   */
  function segment(res, where, opts = {}) {
    const seg = { visible: true, kind: 'ocr', text: res.text, where };
    if (opts.page) {
      seg.page = opts.page;
      const v = opts.view, s = opts.scale;
      seg.rectOf = (a, b) => {
        const hit = res.spans.filter(x => x.end > a && x.start < b);
        if (!hit.length) return null;
        const px0 = Math.min(...hit.map(x => x.x0)), px1 = Math.max(...hit.map(x => x.x1)), py0 = Math.min(...hit.map(x => x.y0)), py1 = Math.max(...hit.map(x => x.y1));
        const pad = 2;
        return { page: opts.page, x0: v[0] + (px0 - pad) / s, x1: v[0] + (px1 + pad) / s, y0: v[3] - (py1 + pad) / s, y1: v[3] - (py0 - pad) / s };
      };
    }
    return seg;
  }

  Ex.ocr = { start, stop, read, segment };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ex;
})(typeof window !== 'undefined' ? window : globalThis);
