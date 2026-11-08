/*
 * Exposift – turns the user's decisions into a sanitize plan (EXP-005).
 * Nothing is planned for a finding the user did not mark "Remove". A finding the chosen method
 * cannot remove is listed as blocked instead of being silently ignored.
 */
(function (g) {
  'use strict';
  const Ex = g.Ex = g.Ex || {};

  const VALUE_TYPES = new Set(['email', 'phone', 'national_id', 'tax_id', 'iban', 'card', 'ip', 'url', 'internal_url', 'path', 'name', 'secret', 'person', 'account', 'host', 'address', 'custom']);
  const META = ['meta.author', 'meta.org', 'meta.software', 'meta.dates', 'meta.title', 'meta.custom', 'meta.path'];

  const SUPPORT = {
    // DOCX: structure edited in the XML parts
    docx: {
      struct: new Set([...META, 'hidden.comments', 'hidden.tracked', 'hidden.deleted', 'hidden.text', 'hidden.lookalike', 'hidden.custom_xml', 'hidden.vars', 'embedded', 'thumbnail', 'external_link', 'image_exif', 'image_gps']),
      note: {
        macro: 'Macro projects cannot be removed from a .docx in this version.',
        protection: 'Editing protection is left as it is.',
        signature: 'Digital signatures are not touched.'
      }
    },
    xlsx: {
      struct: new Set([...META, 'hidden.comments', 'hidden.sheet', 'hidden.cells', 'hidden.names', 'hidden.custom_xml', 'embedded', 'thumbnail', 'external_link', 'image_exif', 'image_gps']),
      note: {
        'hidden.pivot': 'A pivot table keeps its source data in a cache that cannot be removed safely in this version. Delete the pivot table in Excel first.',
        macro: 'Macro projects cannot be removed from this file type in this version.',
        protection: 'Workbook protection is left as it is.'
      }
    },
    pptx: {
      struct: new Set([...META, 'hidden.comments', 'hidden.notes', 'hidden.slide', 'hidden.text', 'hidden.offpage', 'hidden.custom_xml', 'embedded', 'thumbnail', 'external_link', 'image_exif', 'image_gps']),
      note: { macro: 'Macro projects cannot be removed from this file type in this version.' }
    },
    // PDF, "clean structure": rebuilt without metadata, notes, attachments, scripts, bookmarks and earlier versions; page content is kept as is
    pdf_clean: {
      struct: new Set([...META, 'meta.ids', 'annotation', 'embedded', 'macro', 'incremental', 'removed_text', 'hidden.outline']),
      note: {}
    },
    // PDF, "redact text": like "clean structure", and the chosen values are taken out of the page text itself
    pdf_redact: {
      struct: new Set([...META, 'meta.ids', 'annotation', 'embedded', 'macro', 'incremental', 'removed_text', 'hidden.outline']),
      note: {}
    },
    // PDF, "flatten": every page is drawn as a picture, chosen values are covered first
    pdf_flatten: { struct: null, note: {} }
  };

  const FLATTEN_NOT_NEEDED = new Set(['unsupported']);

  const OOXML = new Set(['docx', 'xlsx', 'pptx']);
  function modeKey(format, mode) { return OOXML.has(format) ? format : (mode === 'flatten' ? 'pdf_flatten' : mode === 'redact' ? 'pdf_redact' : 'pdf_clean'); }

  /**
   * decisions: {findingId: 'remove'|'keep'|'skip'}; mode (PDF only): 'clean' | 'flatten'.
   * Returns { key, chosen[], actions[], blocked[], left[], structTypes:Set, values[], rects[] }
   */
  function build(findings, decisions, format, mode) {
    const key = modeKey(format, mode);
    const sup = SUPPORT[key];
    const out = { key, chosen: [], actions: [], blocked: [], left: [], structTypes: new Set(), values: [], rects: [], targets: [] };
    const valueSet = new Map();
    const deferred = [];
    for (const f of findings) {
      if (decisions[f.id] !== 'remove') { out.left.push(f); continue; }
      out.chosen.push(f);
      if (FLATTEN_NOT_NEEDED.has(f.type)) { out.blocked.push({ f, why: 'Nothing can be removed for this item.' }); continue; }
      if (f.kind === 'ocr' && OOXML.has(format)) { out.blocked.push({ f, why: 'Text inside a picture cannot be removed in this version. Replace or delete the picture in the original application.' }); continue; }
      const isValue = (VALUE_TYPES.has(f.type) || (key === 'docx' && f.type === 'fake_redaction')) && typeof f.value === 'string' && f.value.length >= 2;
      if (key === 'pdf_flatten') {
        // a visible value can only be covered when we know where it is
        if (isValue && f.visible !== false && !f.rect) { out.blocked.push({ f, why: 'Its position on the page is unknown, so it cannot be covered.' }); continue; }
        out.actions.push(f);
        if (isValue) valueSet.set(f.value, true);
        continue;
      }
      if (sup.struct.has(f.type)) { out.structTypes.add(f.type); out.actions.push(f); continue; }
      if (isValue && OOXML.has(format)) { valueSet.set(f.value, true); out.actions.push(f); continue; }
      if (key === 'pdf_redact' && (isValue || (f.type === 'fake_redaction' && typeof f.value === 'string' && f.value.length >= 2)) && f.visible !== false && f.rect && f.kind !== 'ocr') {
        valueSet.set(f.value, true); out.targets.push({ ...f.rect, value: f.value }); out.actions.push(f); continue;
      }
      if (isValue && (key === 'pdf_clean' || key === 'pdf_redact')) { deferred.push(f); continue; }
      out.blocked.push({ f, why: sup.note[f.type] || (format === 'pdf'
        ? 'Not possible in "Clean structure" mode: this content is part of the page itself. Use "Flatten & rebuild".'
        : 'Not supported for this file type in this version.') });
    }
    // PDF "clean structure": a value that lives only in metadata, notes, scripts or old versions goes away with that part
    const COVER = { meta: META.concat(['meta.ids']), comment: ['annotation'], script: ['macro'], deleted: ['removed_text', 'incremental'] };
    for (const f of deferred) {
      const need = COVER[f.kind] || [];
      if (f.visible === false && need.some(tp => out.structTypes.has(tp))) { valueSet.set(f.value, true); out.actions.push(f); }
      else out.blocked.push({ f, why: f.visible === false && need.length ? 'Choose the item that holds it (' + need[0] + ') as well.' : 'Not possible in "Clean structure" mode: this content is part of the page itself. Use "Flatten & rebuild".' });
    }
    out.values = [...valueSet.keys()];
    if (key === 'pdf_flatten') {
      const vs = new Set(out.values);
      for (const f of findings) {
        if (!f.rect) continue;
        const chosen = decisions[f.id] === 'remove';
        if ((chosen && (VALUE_TYPES.has(f.type) || f.type === 'fake_redaction')) || (typeof f.value === 'string' && vs.has(f.value))) out.rects.push(f.rect);
      }
    }
    return out;
  }

  /** Findings that "Select all recommended" would mark for removal */
  function recommended(findings, ctx) {
    return findings.filter(f => {
      if (f.stance) return f.stance === 'remove';
      return f.cls === 'hidden' || f.cls === 'recoverable' || f.cls === 'credential';
    });
  }

  Ex.plan = { build, recommended, SUPPORT, VALUE_TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ex;
})(typeof window !== 'undefined' ? window : globalThis);
