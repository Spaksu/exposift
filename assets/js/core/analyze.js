/*
 * Exposift – finding model, classification (EXP-003) and purpose-based review (EXP-004).
 *
 * An adapter (PDF, DOCX…) returns a "doc":
 *   { format, name, size, sha256, segments[], findings[], checks[], unsupported[], meta{} }
 * analyze(doc, ctx) turns the content segments into findings with the detectors, adds the
 * purpose stance of every finding and returns the final, sorted list.
 *
 * The wording of a stance is deliberately soft ("verify necessity"): Exposift does not decide
 * what you may share, it asks whether the recipient really needs it.
 */
(function (g) {
  'use strict';
  const Ex = g.Ex = g.Ex || {};

  // Exposure classes
  const CLASSES = {
    hidden: 'Hidden Exposure',
    personal: 'Personal Data',
    credential: 'Credential Exposure',
    oversharing: 'Contextual Oversharing',
    recoverable: 'Recoverable Redaction',
    unverified: 'Unverified Content'
  };

  // type -> [class, base severity, label]
  const TYPES = {
    // content (found by the detectors)
    email: ['personal', 'low', 'Email address'],
    phone: ['personal', 'low', 'Phone number'],
    national_id: ['personal', 'high', 'National ID number'],
    tax_id: ['personal', 'medium', 'Tax ID number'],
    iban: ['personal', 'medium', 'IBAN'],
    card: ['personal', 'high', 'Payment card number'],
    ip: ['hidden', 'medium', 'IP address'],
    url: ['oversharing', 'low', 'Web link'],
    internal_url: ['oversharing', 'medium', 'Internal address'],
    path: ['hidden', 'medium', 'Local or network path'],
    name: ['personal', 'medium', 'Name from your list'],
    secret: ['credential', 'high', 'Secret or credential'],
    person: ['personal', 'medium', 'Person name'],
    account: ['personal', 'medium', 'Username or account'],
    host: ['oversharing', 'medium', 'Host or domain name'],
    address: ['personal', 'medium', 'Address or location'],
    custom: ['oversharing', 'medium', 'Custom rule match'],
    // structure (found by the adapters)
    'meta.author': ['hidden', 'medium', 'Author or editor name'],
    'meta.org': ['hidden', 'medium', 'Organization or manager'],
    'meta.software': ['hidden', 'low', 'Software that made the file'],
    'meta.dates': ['hidden', 'low', 'Creation and edit dates'],
    'meta.title': ['hidden', 'low', 'Title, subject or keywords'],
    'meta.custom': ['hidden', 'medium', 'Custom properties'],
    'meta.path': ['hidden', 'medium', 'Template or file path'],
    'meta.ids': ['hidden', 'low', 'Document identifiers'],
    'hidden.comments': ['hidden', 'medium', 'Comments'],
    'hidden.tracked': ['hidden', 'medium', 'Tracked changes'],
    'hidden.deleted': ['recoverable', 'high', 'Deleted text still in the file'],
    'hidden.text': ['hidden', 'medium', 'Hidden text'],
    'hidden.lookalike': ['hidden', 'low', 'Text that is hard to see'],
    'hidden.layer': ['hidden', 'medium', 'Hidden layer'],
    'hidden.offpage': ['hidden', 'medium', 'Text outside the page'],
    'hidden.outline': ['hidden', 'low', 'Bookmarks'],
    'hidden.custom_xml': ['unverified', 'medium', 'Custom XML data'],
    'hidden.vars': ['hidden', 'medium', 'Document variables'],
    'hidden.sheet': ['hidden', 'high', 'Hidden sheets'],
    'hidden.cells': ['hidden', 'medium', 'Hidden rows and columns'],
    'hidden.names': ['hidden', 'medium', 'Defined names'],
    'hidden.pivot': ['hidden', 'medium', 'Pivot table source data'],
    'hidden.notes': ['hidden', 'medium', 'Speaker notes'],
    'hidden.slide': ['hidden', 'high', 'Hidden slides'],
    annotation: ['hidden', 'medium', 'Annotations and notes'],
    form_field: ['hidden', 'medium', 'Form field values'],
    embedded: ['hidden', 'high', 'Embedded files'],
    external_link: ['hidden', 'medium', 'External reference'],
    macro: ['unverified', 'high', 'Macros or scripts'],
    thumbnail: ['hidden', 'medium', 'Preview thumbnail'],
    image_exif: ['hidden', 'medium', 'Photo metadata'],
    image_gps: ['hidden', 'high', 'Photo location (GPS)'],
    fake_redaction: ['recoverable', 'high', 'Hidden under a black box'],
    redact_annot: ['recoverable', 'high', 'Redaction not applied'],
    incremental: ['recoverable', 'medium', 'Earlier versions inside the file'],
    removed_text: ['recoverable', 'high', 'Text removed in a later version'],
    signature: ['unverified', 'low', 'Digital signature'],
    protection: ['unverified', 'low', 'Document protection'],
    unsupported: ['unverified', 'medium', 'Not analyzed']
  };

  const SEV = ['low', 'medium', 'high'];
  const bump = (s, n) => SEV[Math.max(0, Math.min(2, SEV.indexOf(s) + n))];

  // ------------------------------------------------------------------ purpose-based review
  const DOC_TYPES = {
    generic: 'Other / not sure',
    resume: 'Resume / CV',
    contract: 'Contract or agreement',
    invoice: 'Invoice or statement',
    report: 'Report or presentation',
    id_copy: 'ID or official document copy'
  };
  const PURPOSES = {
    generic: { other: 'General sharing' },
    resume: { job_application: 'Job application', recruiter: 'Recruiter or agency', public_profile: 'Public profile or website' },
    contract: { draft_review: 'Draft sent to the other side', signed_copy: 'Signed copy for the record', publication: 'Publication' },
    invoice: { accountant: 'Accountant or bookkeeping', customer: 'Customer or supplier', authority: 'Tax office or authority' },
    report: { colleague: 'Colleagues', client: 'Client or partner', publication: 'Publication or website' },
    id_copy: { institution: 'Application to an institution', service: 'Rental, bank or service provider' }
  };
  const AUDIENCES = { internal: 'Internal colleague', external: 'External organization', public: 'Public / anyone' };

  // Stances: expected (normally needed) · verify (is it needed?) · strong (rarely needed, check carefully) · remove (recommend removing)
  const BY_AUD = (i, e, p) => ({ internal: i, external: e, public: p });
  const DEFAULT_STANCE = {
    email: BY_AUD('expected', 'verify', 'verify'),
    phone: BY_AUD('expected', 'verify', 'verify'),
    national_id: BY_AUD('verify', 'strong', 'strong'),
    tax_id: BY_AUD('verify', 'verify', 'strong'),
    iban: BY_AUD('verify', 'strong', 'strong'),
    card: BY_AUD('strong', 'strong', 'strong'),
    ip: BY_AUD('verify', 'strong', 'strong'),
    url: BY_AUD('expected', 'expected', 'expected'),
    internal_url: BY_AUD('verify', 'strong', 'strong'),
    path: BY_AUD('verify', 'strong', 'strong'),
    name: BY_AUD('verify', 'verify', 'verify'),
    secret: BY_AUD('strong', 'strong', 'strong'),
    person: BY_AUD('expected', 'verify', 'verify'),
    account: BY_AUD('verify', 'strong', 'strong'),
    host: BY_AUD('verify', 'strong', 'strong'),
    address: BY_AUD('verify', 'strong', 'strong'),
    custom: BY_AUD('verify', 'verify', 'verify'),
    'meta.author': BY_AUD('verify', 'remove', 'remove'),
    'meta.org': BY_AUD('verify', 'remove', 'remove'),
    'meta.software': BY_AUD('expected', 'verify', 'verify'),
    'meta.dates': BY_AUD('expected', 'verify', 'verify'),
    'meta.title': BY_AUD('expected', 'verify', 'verify'),
    'meta.custom': BY_AUD('verify', 'remove', 'remove'),
    'meta.path': BY_AUD('verify', 'remove', 'remove'),
    'meta.ids': BY_AUD('expected', 'verify', 'verify'),
    'hidden.comments': BY_AUD('verify', 'remove', 'remove'),
    'hidden.tracked': BY_AUD('verify', 'remove', 'remove'),
    'hidden.deleted': BY_AUD('remove', 'remove', 'remove'),
    'hidden.text': BY_AUD('verify', 'remove', 'remove'),
    'hidden.layer': BY_AUD('verify', 'remove', 'remove'),
    'hidden.offpage': BY_AUD('verify', 'remove', 'remove'),
    'hidden.sheet': BY_AUD('verify', 'remove', 'remove'),
    'hidden.cells': BY_AUD('verify', 'remove', 'remove'),
    'hidden.names': BY_AUD('verify', 'strong', 'remove'),
    'hidden.pivot': BY_AUD('verify', 'strong', 'remove'),
    'hidden.notes': BY_AUD('verify', 'remove', 'remove'),
    'hidden.slide': BY_AUD('verify', 'remove', 'remove'),
    annotation: BY_AUD('verify', 'remove', 'remove'),
    form_field: BY_AUD('verify', 'verify', 'strong'),
    embedded: BY_AUD('verify', 'remove', 'remove'),
    external_link: BY_AUD('verify', 'verify', 'remove'),
    macro: BY_AUD('verify', 'remove', 'remove'),
    thumbnail: BY_AUD('verify', 'remove', 'remove'),
    image_exif: BY_AUD('verify', 'remove', 'remove'),
    image_gps: BY_AUD('remove', 'remove', 'remove'),
    fake_redaction: BY_AUD('remove', 'remove', 'remove'),
    redact_annot: BY_AUD('remove', 'remove', 'remove'),
    removed_text: BY_AUD('remove', 'remove', 'remove'),
    incremental: BY_AUD('verify', 'remove', 'remove')
  };

  // Document-type specific overrides: docType -> type -> {audience: stance} | stance
  const OVERRIDES = {
    resume: {
      email: 'expected', phone: 'expected', url: 'expected',
      national_id: 'strong', iban: 'strong', tax_id: 'strong',
      name: 'verify'
    },
    invoice: {
      iban: BY_AUD('expected', 'expected', 'strong'), tax_id: 'expected', email: 'expected', phone: 'expected',
      national_id: BY_AUD('verify', 'verify', 'strong')
    },
    contract: {
      national_id: BY_AUD('verify', 'verify', 'strong'), iban: BY_AUD('verify', 'verify', 'strong'),
      email: BY_AUD('expected', 'expected', 'verify'), phone: BY_AUD('expected', 'expected', 'verify'),
      'hidden.comments': BY_AUD('verify', 'strong', 'remove'), 'hidden.tracked': BY_AUD('verify', 'strong', 'remove')
    },
    report: {
      email: BY_AUD('expected', 'verify', 'verify'), internal_url: BY_AUD('verify', 'strong', 'remove'),
      ip: BY_AUD('verify', 'remove', 'remove'), annotation: BY_AUD('verify', 'remove', 'remove')
    },
    id_copy: {
      national_id: BY_AUD('expected', 'expected', 'strong'), name: 'expected',
      email: 'verify', phone: 'verify', iban: 'strong'
    }
  };
  // Purposes that tighten the audience: signing copy for the record keeps comments irrelevant, etc.
  const PURPOSE_NOTES = {
    'resume/job_application': 'A full home address or ID number is rarely needed at the application stage.',
    'resume/public_profile': 'On a public profile, phone numbers and addresses reach anyone, including scrapers.',
    'contract/draft_review': 'Internal negotiation notes in comments or tracked changes are easy to forget in a draft.',
    'invoice/accountant': 'An accountant usually needs the invoice figures and tax IDs, not unrelated accounts.',
    'invoice/customer': 'A customer needs your payment details, but not other customers or internal references.',
    'report/client': 'Speaker notes, internal links and comments are written for your own team.',
    'id_copy/institution': 'Many institutions accept a copy marked with the purpose and date; consider a watermark.',
    'id_copy/service': 'Only the fields the service is legally allowed to ask for need to remain visible.'
  };

  const STANCE_LABEL = {
    expected: 'Usually expected for this purpose',
    verify: 'Verify that it is needed',
    strong: 'Rarely needed — check carefully',
    remove: 'Removal recommended'
  };

  function stanceFor(type, ctx) {
    if (!ctx || !ctx.audience) return null;
    const doc = OVERRIDES[ctx.docType] && OVERRIDES[ctx.docType][type];
    const rule = doc || DEFAULT_STANCE[type];
    if (!rule) return null;
    return typeof rule === 'string' ? rule : rule[ctx.audience];
  }

  function severityFor(f, ctx) {
    let sev = f.sev || (TYPES[f.type] ? TYPES[f.type][1] : 'medium');
    const st = f.stance;
    if (st === 'expected') sev = 'low';
    else if (st === 'strong' || st === 'remove') sev = bump(sev, sev === 'low' ? 1 : 0);
    // low-confidence detections never outrank their evidence
    if (f.conf === 'low' && sev === 'high') sev = 'medium';
    // personal data and hidden traces weigh more when anyone can read the file
    if (ctx && ctx.audience === 'public' && (f.cls === 'personal' || String(f.type).startsWith('meta.')) && st !== 'expected') sev = bump(sev, 1);
    return sev;
  }

  // ------------------------------------------------------------------ analysis
  let seq = 0;
  const nextId = () => 'f' + (++seq);

  const mask = (v) => {
    const s = String(v);
    if (s.length <= 4) return '•'.repeat(s.length);
    return s.slice(0, 2) + '•'.repeat(Math.min(10, s.length - 4)) + s.slice(-2);
  };

  /**
   * Turns segments into content findings (via the detectors), merges them with the adapter's
   * structural findings, applies stances and severities.
   * ctx: {docType, purpose, audience} or null (Quick Scan); names: user-defined names.
   */
  function analyze(doc, ctx, names) {
    seq = 0;
    if (Ex.scanBegin) Ex.scanBegin();
    const list = [];
    for (const f of doc.findings) list.push({ ...f });

    const cellText = new Map();
    for (const seg of doc.segments) if (seg.row && seg.visible !== false && seg.text) { const k = seg.part + '|' + seg.row + '|' + seg.col; cellText.set(k, (cellText.get(k) ? cellText.get(k) + ' ' : '') + seg.text); }
    for (const seg of doc.segments) {
      if (!seg.text) continue;
      const hits = (Ex.detectAll || Ex.detect)(seg.text, { names: names || [] });
      if (seg.row && seg.col > 0 && Ex.labelledCell) hits.push(...Ex.labelledCell(seg, cellText.get(seg.part + '|' + seg.row + '|' + (seg.col - 1)), hits));
      for (const h of hits) {
        const t = TYPES[h.type];
        let cls = t[0];
        // content that is not visible to the reader is a hidden exposure first
        if (seg.visible === false && cls !== 'credential') cls = seg.kind === 'deleted' ? 'recoverable' : 'hidden';
        list.push({
          type: h.type, cls, sev: t[1], conf: h.conf, value: h.value, note: h.note, sub: h.sub,
          visible: seg.visible !== false, where: seg.where, page: seg.page, segId: seg.id,
          start: h.start, end: h.end, kind: seg.kind || 'text',
          rect: seg.rectOf ? seg.rectOf(h.start, h.end) : null,
          title: t[2]
        });
      }
    }

    for (const f of list) {
      const t = TYPES[f.type];
      f.id = nextId();
      f.cls = f.cls || (t ? t[0] : 'unverified');
      f.title = f.title || (t ? t[2] : f.type);
      f.conf = f.conf || 'high';
      f.stance = stanceFor(f.type, ctx);
      f.sev = severityFor(f, ctx);
      f.preview = f.value != null && f.value !== '' ? mask(f.value) : '';
    }

    const order = { high: 0, medium: 1, low: 2 };
    list.sort((a, b) => order[a.sev] - order[b.sev] || (a.page || 0) - (b.page || 0) || a.id.localeCompare(b.id, 'en', { numeric: true }));
    return list;
  }

  function summarize(findings) {
    const byClass = {}, bySev = { high: 0, medium: 0, low: 0 };
    for (const f of findings) {
      byClass[f.cls] = (byClass[f.cls] || 0) + 1;
      bySev[f.sev]++;
    }
    return { total: findings.length, byClass, bySev };
  }

  Ex.analyze = analyze;
  Ex.summarize = summarize;
  Ex.model = { CLASSES, TYPES, DOC_TYPES, PURPOSES, AUDIENCES, PURPOSE_NOTES, STANCE_LABEL, stanceFor, mask };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ex;
})(typeof window !== 'undefined' ? window : globalThis);
