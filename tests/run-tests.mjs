// Runs the detectors and both adapters headlessly against tests/corpus/.
// Usage: EXPOSIFT_NM=/path/to/node_modules node tests/run-tests.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const NM = process.env.EXPOSIFT_NM;
if (!NM) { console.error('Set EXPOSIFT_NM'); process.exit(2); }
const require = createRequire(join(NM, 'x.js'));
const cjs = createRequire(join(root, 'x.js'));

globalThis.fflate = require('fflate');
globalThis.PDFLib = require('pdf-lib');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const pdfjs = await import(pathToFileURL(join(NM, 'pdfjs-dist/legacy/build/pdf.mjs')).href);
const Ex = (globalThis.Ex = {});
Ex.env = { parseXml: (s) => new DOMParser().parseFromString(s, 'application/xml'), serialize: (n) => new XMLSerializer().serializeToString(n) };
for (const f of ['core/util.js', 'core/detect.js', 'core/analyze.js', 'core/plan.js', 'adapters/docx.js', 'adapters/docx-sanitize.js', 'adapters/ooxml.js', 'adapters/ooxml-sanitize.js', 'ocr.js', 'adapters/transform.js', 'adapters/pdf.js', 'adapters/pdf-sanitize.js', 'adapters/pdf-redact.js']) cjs(join(root, 'assets/js', f));

let pass = 0, fail = 0;
{
  const ssn = Ex.detect('SSN: 123-45-6789 and 000-12-3456 and 666-12-3456');
  globalThis.__ssn = ssn.filter(h => h.type === 'national_id').map(h => h.value);
}
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + msg); } };
const section = (s) => console.log('\n# ' + s);
const load = (n) => new Uint8Array(readFileSync(join(here, 'corpus', n)));
const has = (fs, type, pred = () => true) => fs.some(f => f.type === type && pred(f));

// ---------------------------------------------------------------- detectors
section('detectors');
{
  const D = Ex.detectUtil;
  ok(D.validTckn('10000000146'), 'TCKN 10000000146 valid');
  ok(!D.validTckn('10000000147'), 'TCKN with wrong check digit rejected');
  ok(!D.validTckn('00000000000'), 'TCKN zeros rejected');
  ok(D.validIban('TR33 0006 1005 1978 6457 8413 26'), 'TR IBAN valid');
  ok(D.validIban('DE89 3704 0044 0532 0130 00'), 'DE IBAN valid');
  ok(!D.validIban('TR33 0006 1005 1978 6457 8413 27'), 'IBAN with bad check rejected');
  ok(D.luhn('4111111111111111'), 'Luhn test card');
  const d = (t, o) => Ex.detect(t, o);
  ok(d('mail me: a.b+c@example.co.uk now').some(m => m.type === 'email' && m.value === 'a.b+c@example.co.uk'), 'email');
  ok(d('+90 532 123 45 67').some(m => m.type === 'phone'), 'TR mobile with +90');
  ok(d('0532 123 45 67').some(m => m.type === 'phone'), 'TR mobile with 0');
  ok(d('0 (212) 555 12 34').some(m => m.type === 'phone'), 'TR landline');
  ok(d('call +44 20 7946 0958').some(m => m.type === 'phone'), 'intl phone');
  ok(!d('order 20240017 confirmed').some(m => m.type === 'phone'), 'plain number is not a phone');
  ok(d('server 10.20.30.40 down').some(m => m.type === 'ip' && m.conf === 'high'), 'private IPv4 high');
  ok(d('v1.2.3.4 released').every(m => m.type !== 'ip' || m.conf === 'low'), 'version-like string is low confidence at most');
  ok(!d('999.1.1.1').some(m => m.type === 'ip'), 'invalid IPv4 rejected');
  ok(d('addr 2001:db8::1 ok').some(m => m.type === 'ip'), 'IPv6');
  ok(d('see https://intranet.corp/wiki').some(m => m.type === 'internal_url'), 'internal URL (no dot TLD? .corp)');
  ok(d('see https://example.com/a?token=abcd1234').some(m => m.type === 'secret'), 'token in URL');
  ok(d('see https://example.com/page.').some(m => m.type === 'url' && m.value === 'https://example.com/page'), 'URL trailing dot trimmed');
  ok(d('key AKIAIOSFODNN7EXAMPLE end').some(m => m.type === 'secret'), 'AWS key');
  ok(d('password = Tr0ub4dor&3xx').some(m => m.type === 'secret'), 'password kv');
  ok(!d('password = ********').some(m => m.type === 'secret'), 'masked password ignored');
  ok(d('C:\\Users\\ayse.demir\\Documents\\x.docx').some(m => m.type === 'path' && m.sub === 'ayse.demir'), 'windows user path');
  ok(d('Şahin Yılmaz yazdı', { names: ['sahin yilmaz'] }).some(m => m.type === 'name'), 'name list is Turkish-fold tolerant');
  ok(!d('Kemal Kemalettin', { names: ['Kemal'] }).some(m => m.start > 0), 'name must match whole words');
  ok(d('TCKN: 10000000146').some(m => m.type === 'national_id' && m.conf === 'high'), 'TCKN with context high');
  ok(d('no 10000000146 here').some(m => m.type === 'national_id' && m.conf === 'low'), 'TCKN without context low');
  const vk = (() => { const b = [1, 2, 3, 4, 5, 6, 7, 8, 9]; let s = 0; b.forEach((x, i) => { const t = (x + (9 - i)) % 10; let v = (t * 2 ** (9 - i)) % 9; if (t && !v) v = 9; s += v; }); return b.join('') + ((10 - (s % 10)) % 10); })();
  ok(d('Vergi No: ' + vk).some(m => m.type === 'tax_id'), 'VKN with context');
  ok(!d('Ref ' + vk).some(m => m.type === 'tax_id'), 'VKN without context is not reported');
}

// ---------------------------------------------------------------- DOCX
section('docx: traps.docx');
{
  const doc = await Ex.adapters.docx.read(load('traps.docx'), 'traps.docx');
  const fs = Ex.analyze(doc, null, []);
  const T = (t, p) => has(fs, t, p);
  ok(T('meta.author'), 'author names found');
  ok(T('meta.author', f => /Ayse Demir/.test(f.value) && /Mehmet Kaya/.test(f.value) && /Reviewer Can/.test(f.value)), 'authors from core, lastModifiedBy and comments');
  ok(T('meta.org', f => /Acme Corp/.test(f.value) && /Zeynep Arslan/.test(f.value)), 'company and manager');
  ok(T('meta.software'), 'software');
  ok(T('hidden.comments', f => /bonus plan/.test(f.value)), 'comment text');
  ok(T('hidden.deleted', f => /budget floor is 40000/.test(f.value)), 'tracked deletion text');
  ok(T('hidden.tracked'), 'tracked changes counted');
  ok(T('hidden.text', f => /intranet\.corp/.test(f.value)), 'vanish text');
  ok(T('hidden.lookalike', f => /TCKN/.test(f.value)), 'white text');
  ok(T('embedded'), 'embedded object');
  ok(T('thumbnail'), 'thumbnail');
  ok(T('image_gps'), 'GPS in photo');
  ok(T('hidden.custom_xml'), 'custom xml');
  ok(T('hidden.vars'), 'document variable');
  ok(T('external_link', f => /offer\.dotm/.test(f.value)), 'attached template path');
  ok(T('path', f => f.sub === 'ayse.demir'), 'user name inside the template path');
  ok(T('email', f => f.value === 'ayse.demir@example.org'), 'email in body');
  ok(T('iban', f => f.visible), 'IBAN in body');
  ok(T('national_id', f => f.visible === false && f.conf === 'high'), 'TCKN in white text is flagged as hidden with context');
  ok(T('tax_id'), 'tax id');
  ok(T('secret', f => /sk-test/.test(f.value)), 'api key in body');
  ok(T('internal_url', f => /intranet\.corp/.test(f.value)), 'internal URL inside hidden text');
  ok(doc.segments.some(s => /Ahmet Yilmaz/.test(s.text)), 'name split across runs is rejoined');
  ok(doc.unsupported.some(u => u.id === 'images.text'), 'image text is reported as not analyzed');
  ok(doc.checks.every(c => c.status), 'every check has a status');
  const withCtx = Ex.analyze(doc, { docType: 'contract', purpose: 'draft_review', audience: 'external' }, []);
  ok(withCtx.find(f => f.type === 'hidden.comments').stance === 'strong', 'contract/external: comments need careful check');
  ok(withCtx.find(f => f.type === 'email').stance === 'expected' && withCtx.find(f => f.type === 'email').sev === 'low', 'contract/external: email expected → low');
}
section('docx: clean.docx');
{
  const doc = await Ex.adapters.docx.read(load('clean.docx'), 'clean.docx');
  const fs = Ex.analyze(doc, null, []);
  ok(fs.filter(f => f.sev === 'high').length === 0, 'no high findings in a clean file (' + fs.map(f => f.type).join(',') + ')');
  ok(!fs.some(f => f.type === 'ip' && f.conf !== 'low'), 'version number is not a confident IP');
}

// ---------------------------------------------------------------- PDF
section('pdf: fake-redaction.pdf');
{
  const doc = await Ex.adapters.pdf.read(load('fake-redaction.pdf'), 'fake-redaction.pdf', pdfjs);
  const fs = Ex.analyze(doc, null, []);
  ok(has(fs, 'fake_redaction', f => /10000000146/.test(f.value)), 'text under black box found: ' + JSON.stringify(fs.filter(f => f.type === 'fake_redaction').map(f => f.value)));
  ok(has(fs, 'email', f => f.visible), 'visible email still found');
  ok(has(fs, 'national_id'), 'national id detected in extracted text');
  const fr = fs.find(f => f.type === 'fake_redaction');
  ok(fr && fr.rect && fr.rect.page === 1, 'fake redaction has a rect for the preview');
  ok(fr && fr.sev === 'high' && fr.cls === 'recoverable', 'classified as recoverable redaction, high');
}
section('pdf: traps.pdf');
{
  const doc = await Ex.adapters.pdf.read(load('traps.pdf'), 'traps.pdf', pdfjs);
  const fs = Ex.analyze(doc, null, []);
  ok(has(fs, 'meta.author', f => /Mehmet Kaya/.test(f.value)), 'author');
  ok(has(fs, 'meta.title'), 'title/keywords');
  ok(has(fs, 'embedded', f => /notes\.txt/.test(f.value)), 'attachment');
  ok(has(fs, 'macro'), 'javascript');
  ok(has(fs, 'annotation', f => /price floor/.test(f.value)), 'annotation with author');
  ok(has(fs, 'hidden.offpage', f => /floor-price-internal/.test(f.value)), 'off-page text');
  ok(has(fs, 'iban'), 'IBAN in page text');
}
section('pdf: incremental.pdf');
{
  const doc = await Ex.adapters.pdf.read(load('incremental.pdf'), 'incremental.pdf', pdfjs);
  const fs = Ex.analyze(doc, null, []);
  ok(has(fs, 'incremental'), 'incremental update noticed');
  ok(has(fs, 'removed_text', f => /61000/.test(f.value)), 'removed text recovered from the earlier version: ' + JSON.stringify(fs.filter(f => f.type === 'removed_text').map(f => f.value)));
}
section('pdf: clean.pdf');
{
  const doc = await Ex.adapters.pdf.read(load('clean.pdf'), 'clean.pdf', pdfjs);
  const fs = Ex.analyze(doc, null, []);
  ok(fs.filter(f => f.sev === 'high').length === 0, 'no high findings in a clean PDF (' + fs.map(f => f.type + ':' + f.sev).join(',') + ')');
  ok(!has(fs, 'fake_redaction'), 'white text on a dark bar is not a fake redaction');
  ok(!has(fs, 'incremental'), 'no false incremental');
}

// ---------------------------------------------------------------- DOCX sanitize + verify
section('docx: sanitize traps.docx');
{
  const src = load('traps.docx');
  const doc = await Ex.adapters.docx.read(src, 'traps.docx');
  const fs = Ex.analyze(doc, null, []);
  const dec = Object.fromEntries(fs.map(f => [f.id, 'remove']));
  const plan = Ex.plan.build(fs, dec, 'docx');
  ok(plan.blocked.length === 0, 'nothing blocked for docx: ' + plan.blocked.map(b => b.f.type).join(','));
  const res = Ex.adapters.docx.sanitize(src, plan);
  const ver = await Ex.adapters.docx.verify(res.bytes, plan, {});
  for (const c of ver.checks) if (c.status === 'fail') console.log('   check failed:', c.label, c.detail);
  ok(ver.status === 'verified', 'sanitized file verifies (status ' + ver.status + ')');
  const out = await Ex.adapters.docx.read(res.bytes, 'out.docx');
  const all = out.segments.map(s => s.text).join('\n');
  for (const needle of ['budget floor', 'bonus plan', 'intranet.corp', 'ayse.demir@example.org', 'TR330006100519786457841326', '10000000146', 'sk-test-1234567890', 'Ayse Demir', 'Mehmet Kaya', 'Acme Corp', 'Zeynep Arslan', 'Reviewer Can']) {
    ok(!all.includes(needle), 'no "' + needle + '" left in extracted text');
  }
  ok(all.includes('Final figure to be agreed'), 'accepted insertion survives');
  ok(all.includes('Salary is 52000'), 'untouched text survives');
  const raw = Object.keys(globalThis.fflate.unzipSync(res.bytes));
  ok(!raw.some(n => /comments|embeddings|thumbnail|customXml|people/.test(n)), 'parts removed from the package: ' + raw.join(','));
  // selective: only comments + a value, everything else stays
  const only = Object.fromEntries(fs.filter(f => f.type === 'hidden.comments' || f.type === 'email').map(f => [f.id, 'remove']));
  const plan2 = Ex.plan.build(fs, only, 'docx');
  const res2 = Ex.adapters.docx.sanitize(src, plan2);
  const out2 = await Ex.adapters.docx.read(res2.bytes, 'out2.docx');
  const all2 = out2.segments.map(s => s.text).join('\n');
  ok(!all2.includes('bonus plan') && !all2.includes('ayse.demir@example.org'), 'selected items removed');
  ok(all2.includes('budget floor'), 'unselected deletion is left alone');
  const ver2 = await Ex.adapters.docx.verify(res2.bytes, plan2, {});
  ok(ver2.status === 'verified', 'selective output verifies');
  // a sanitizer that forgot something must be caught by the verifier
  const bad = Ex.adapters.docx.sanitize(src, Ex.plan.build(fs, only, 'docx'));
  const planWithMore = { ...plan2, values: [...plan2.values, '10000000146'] };
  const ver3 = await Ex.adapters.docx.verify(bad.bytes, planWithMore, {});
  ok(ver3.status === 'failed', 'verifier fails when a value is still present');
}

// ---------------------------------------------------------------- PDF clean structure + verify
section('pdf: clean structure');
{
  const src = load('traps.pdf');
  const doc = await Ex.adapters.pdf.read(src, 'traps.pdf', pdfjs);
  const fs = Ex.analyze(doc, null, []);
  const pick = (types) => Object.fromEntries(fs.filter(f => types.includes(f.type)).map(f => [f.id, 'remove']));
  const plan = Ex.plan.build(fs, pick(['meta.author', 'meta.title', 'embedded', 'macro', 'annotation']), 'pdf', 'clean');
  ok(plan.blocked.length === 0, 'structural choices are all possible: ' + plan.blocked.map(b => b.f.type).join(','));
  const res = await Ex.adapters.pdf.sanitize.clean(src, plan);
  const ver = await Ex.adapters.pdf.verify(res.bytes, plan, pdfjs, { pageCount: 1 });
  for (const c of ver.checks) if (c.status === 'fail') console.log('   check failed:', c.label, c.detail);
  ok(ver.status === 'verified', 'cleaned PDF verifies (' + ver.status + ')');
  const out = await Ex.adapters.pdf.read(res.bytes, 'out.pdf', pdfjs);
  const fo = Ex.analyze(out, null, []);
  ok(!has(fo, 'meta.author') && !has(fo, 'embedded') && !has(fo, 'macro') && !has(fo, 'annotation'), 'chosen structure gone after reopening');
  ok(out.segments.some(s => /Quarterly summary/.test(s.text)), 'page text is untouched');
  ok(has(fo, 'hidden.offpage'), 'unselected off-page text is honestly still reported');
  // a content value cannot be removed in clean mode: it must be blocked, not skipped
  const ibanF = fs.find(f => f.type === 'iban');
  const p2 = Ex.plan.build(fs, { [ibanF.id]: 'remove' }, 'pdf', 'clean');
  ok(p2.blocked.length === 1 && p2.actions.length === 0, 'visible value is blocked in clean mode');
  const r2 = await Ex.adapters.pdf.sanitize.clean(src, p2);
  const v2 = await Ex.adapters.pdf.verify(r2.bytes, { ...p2, values: [ibanF.value] }, pdfjs, {});
  ok(v2.status === 'failed', 'verifier catches a value that is still on the page');
}
section('pdf: earlier versions');
{
  const src = load('incremental.pdf');
  const doc = await Ex.adapters.pdf.read(src, 'incremental.pdf', pdfjs);
  const fs = Ex.analyze(doc, null, []);
  const dec = Object.fromEntries(fs.filter(f => f.type === 'incremental' || f.type === 'removed_text').map(f => [f.id, 'remove']));
  const plan = Ex.plan.build(fs, dec, 'pdf', 'clean');
  const res = await Ex.adapters.pdf.sanitize.clean(src, plan);
  const latin = new TextDecoder('latin1').decode(res.bytes);
  ok(!latin.includes('61000') && !latin.includes('52000'), 'old salary figures are no longer in the bytes');
  const out = await Ex.adapters.pdf.read(res.bytes, 'out.pdf', pdfjs);
  ok(!has(Ex.analyze(out, null, []), 'incremental'), 'no earlier versions after rewrite');
  ok(out.segments.some(s => /Details to be agreed/.test(s.text)), 'current text survives');
}

section('pdf: method follows the chosen items');
{
  const src = load('traps.pdf');
  const doc = await Ex.adapters.pdf.read(src, 'traps.pdf', pdfjs);
  const fs = Ex.analyze(doc, null, []);
  const structural = Object.fromEntries(fs.filter(f => ['meta.author', 'meta.title', 'embedded'].includes(f.type)).map(f => [f.id, 'remove']));
  ok(Ex.plan.build(fs, structural, 'pdf', 'clean').blocked.length === 0, 'structure-only choices need no rebuild');
  const iban = fs.find(f => f.type === 'iban');
  ok(Ex.plan.build(fs, { ...structural, [iban.id]: 'remove' }, 'pdf', 'clean').blocked.length === 1, 'a value on the page forces the rebuild path');
  const flat = Ex.plan.build(fs, { ...structural, [iban.id]: 'remove' }, 'pdf', 'flatten');
  ok(flat.blocked.length === 0, 'flatten covers page values');
  ok(Ex.plan.build(fs, { [iban.id]: 'keep' }, 'pdf', 'clean').actions.length === 0, 'kept items produce no action');
}

section('pdf: redact text (vector pages kept)');
{
  const doRedact = async (name, types) => {
    const src = load(name);
    const doc = await Ex.adapters.pdf.read(src, name, pdfjs);
    const fs = Ex.analyze(doc, null, []);
    const dec = {}; for (const f of fs) if (f.rect && types.includes(f.type)) dec[f.id] = 'remove';
    const plan = Ex.plan.build(fs, dec, 'pdf', 'redact');
    const res = await Ex.adapters.pdf.sanitize.redact(src, plan);
    const ver = await Ex.adapters.pdf.verify(res.bytes, plan, pdfjs, { pageCount: doc.meta.pages });
    const out = await Ex.adapters.pdf.read(res.bytes, 'o.pdf', pdfjs);
    return { plan, res, ver, text: out.segments.map(x => x.text).join(' '), before: doc.segments.map(x => x.text).join(' ') };
  };
  const a = await doRedact('traps.pdf', ['iban']);
  ok(a.plan.blocked.length === 0 && a.plan.targets.length === 1, 'a visible value with a position is a redaction target');
  ok(a.ver.status === 'verified', 'simple font: redaction verified (' + a.ver.status + ')');
  ok(!a.text.includes('TR33') && !a.text.replace(/\s/g, '').includes('0006100519786457'), 'simple font: IBAN is gone from the extracted text');
  ok(a.text.includes('Payments go to') && a.text.includes('Quarterly summary'), 'simple font: the rest of the page text is kept');
  const b = await doRedact('cid.pdf', ['iban', 'email']);
  ok(b.ver.status === 'verified', 'embedded CID font: redaction verified (' + b.ver.status + ')');
  ok(!/acme-corp|TR33/.test(b.text), 'CID font: chosen email addresses and IBAN are gone');
  ok(/Name: Ayşe Yılmaz/.test(b.text) && /Employee record/.test(b.text) && /salary account/.test(b.text), 'CID font: untouched text keeps its characters');
  ok(b.res.redact.removed > 50 && b.res.redact.skipped.length === 0, 'CID font: glyphs removed, nothing skipped');
  ok(b.res.redact.covers.length === 4, 'a black box is drawn for every redacted value (' + b.res.redact.covers.length + ')');
  ok(/acme-corp/.test(b.before), 'the source file did contain the values');
  // picture text and unknown positions are not redactable: they force the rebuild
  const fakeOcr = { id: 'o', type: 'iban', kind: 'ocr', value: 'TR33 0006 1005 1978 6457 8413 26', visible: true, rect: { page: 1, x0: 0, y0: 0, x1: 5, y1: 5 } };
  ok(Ex.plan.build([fakeOcr], { o: 'remove' }, 'pdf', 'redact').blocked.length === 1, 'text found by OCR is not redactable');
  const noPos = { id: 'p', type: 'iban', kind: 'text', value: 'TR33 0006 1005 1978 6457 8413 26', visible: true };
  ok(Ex.plan.build([noPos], { p: 'remove' }, 'pdf', 'redact').blocked.length === 1, 'a value without a position is not redactable');
}

section('xlsx: traps.xlsx');
{
  const src = load('traps.xlsx');
  const doc = await Ex.adapters.office.read(src, 'traps.xlsx');
  ok(doc.format === 'xlsx', 'recognized as a workbook');
  const fs = Ex.analyze(doc, null, []);
  ok(has(fs, 'hidden.sheet'), 'hidden sheet found');
  ok(has(fs, 'hidden.cells'), 'hidden row and column found');
  ok(has(fs, 'hidden.comments'), 'comment found');
  ok(has(fs, 'hidden.names'), 'defined name found');
  ok(has(fs, 'meta.author'), 'author found');
  ok(has(fs, 'email') && has(fs, 'iban'), 'visible and hidden-column values found');
  ok(has(fs, 'national_id'), 'ID number stored as a number found');
  const mark = fs.filter(f => ['hidden.sheet', 'hidden.cells', 'hidden.comments', 'hidden.names', 'meta.author', 'email', 'iban', 'national_id'].includes(f.type));
  const dec = Object.fromEntries(mark.map(f => [f.id, 'remove']));
  const plan = Ex.plan.build(fs, dec, 'xlsx');
  ok(plan.blocked.length === 0, 'everything chosen can be done: ' + plan.blocked.map(b => b.f.type).join(','));
  const res = Ex.adapters.xlsx.sanitize(src, plan);
  const ver = await Ex.adapters.xlsx.verify(res.bytes, plan, {});
  for (const c of ver.checks) if (c.status === 'fail') console.log('   check failed:', c.label, c.detail);
  ok(ver.status === 'verified', 'cleaned workbook verifies (' + ver.status + ')');
  const out = await Ex.adapters.office.read(res.bytes, 'out.xlsx');
  const fo = Ex.analyze(out, null, []);
  ok(!has(fo, 'hidden.sheet') && !has(fo, 'hidden.cells') && !has(fo, 'hidden.comments') && !has(fo, 'hidden.names') && !has(fo, 'meta.author'), 'chosen structure gone after reopening');
  ok(out.segments.some(sg => /Quarterly budget/.test(sg.text)), 'visible content survives');
  const raw = new TextDecoder('latin1').decode(res.bytes);
  const unz = Object.values(Ex.util.safeUnzip(res.bytes)).map(b => new TextDecoder().decode(b)).join('\n');
  ok(!unz.includes('Secret sheet note') && !unz.includes('Hidden row note') && !unz.includes('ayse.demir') && !unz.includes('Check this before'), 'removed text is not in any part');
  ok(!has(fo, 'email') && !has(fo, 'iban') && !has(fo, 'national_id'), 'removed values are not found again');
}
section('pptx: traps.pptx');
{
  const src = load('traps.pptx');
  const doc = await Ex.adapters.office.read(src, 'traps.pptx');
  ok(doc.format === 'pptx', 'recognized as a presentation');
  const fs = Ex.analyze(doc, null, []);
  ok(has(fs, 'hidden.slide'), 'hidden slide found');
  ok(has(fs, 'hidden.notes'), 'speaker notes found');
  ok(has(fs, 'hidden.comments'), 'comment found');
  ok(has(fs, 'hidden.offpage'), 'off-slide text found');
  ok(has(fs, 'hidden.text'), 'hidden shape found');
  ok(has(fs, 'meta.author'), 'comment author found');
  const types = ['hidden.slide', 'hidden.notes', 'hidden.comments', 'hidden.offpage', 'hidden.text', 'meta.author', 'email', 'iban'];
  const dec = Object.fromEntries(fs.filter(f => types.includes(f.type)).map(f => [f.id, 'remove']));
  const plan = Ex.plan.build(fs, dec, 'pptx');
  ok(plan.blocked.length === 0, 'everything chosen can be done: ' + plan.blocked.map(b => b.f.type).join(','));
  const res = Ex.adapters.pptx.sanitize(src, plan);
  const ver = await Ex.adapters.pptx.verify(res.bytes, plan, {});
  for (const c of ver.checks) if (c.status === 'fail') console.log('   check failed:', c.label, c.detail);
  ok(ver.status === 'verified', 'cleaned presentation verifies (' + ver.status + ')');
  const out = await Ex.adapters.office.read(res.bytes, 'out.pptx');
  const fo = Ex.analyze(out, null, []);
  ok(!has(fo, 'hidden.slide') && !has(fo, 'hidden.notes') && !has(fo, 'hidden.comments') && !has(fo, 'hidden.offpage') && !has(fo, 'hidden.text'), 'chosen structure gone after reopening');
  ok(out.segments.some(sg => /Roadmap review/.test(sg.text)), 'visible slide text survives');
  const unz = Object.values(Ex.util.safeUnzip(res.bytes)).map(b => new TextDecoder().decode(b)).join('\n');
  ok(!unz.includes('Draft pricing') && !unz.includes('Winter2024') && !unz.includes('approved the budget') && !unz.includes('ayse.demir'), 'removed text is not in any part');
}

section('ocr: positions of read words');
{
  const res = { text: 'Mail ayse@example.org now\n', spans: [{ start: 0, end: 4, x0: 10, y0: 20, x1: 60, y1: 50 }, { start: 5, end: 20, x0: 70, y0: 20, x1: 400, y1: 50 }, { start: 21, end: 24, x0: 410, y0: 20, x1: 460, y1: 50 }] };
  const sg = Ex.ocr.segment(res, 'Page 1 · read from the page picture', { page: 1, view: [0, 0, 595, 842], scale: 2 });
  const r = sg.rectOf(5, 20);
  ok(r && r.page === 1 && r.x0 < 36 && r.x1 > 199 && r.y1 > 831 && r.y1 <= 833 && r.y0 < r.y1, 'pixel box becomes a PDF-space box (origin bottom-left)');
  ok(Ex.ocr.segment(res, 'x').rectOf === undefined, 'a picture inside an Office file has no page position');
  const fs = Ex.analyze({ format: 'pdf', segments: [{ id: 'o1', ...sg }], findings: [], checks: [], unsupported: [], meta: {} }, null, []);
  const em = fs.find(f => f.type === 'email');
  ok(em && em.rect && em.kind === 'ocr', 'an address read by OCR becomes a finding with a position');
  const pl = Ex.plan.build(fs, { [em.id]: 'remove' }, 'pdf', 'flatten');
  ok(pl.rects.length === 1 && pl.blocked.length === 0, 'it is covered when the pages are rebuilt');
  const fo = Ex.analyze({ format: 'docx', segments: [{ id: 'o1', ...Ex.ocr.segment(res, 'word/media/a.png · text inside the picture') }], findings: [], checks: [], unsupported: [], meta: {} }, null, []);
  ok(Ex.plan.build(fo, { [fo[0].id]: 'remove' }, 'docx').blocked.length === 1, 'text inside an Office picture is reported as not removable');
}

section('transform: rewritten text goes back into the original file');
{
  for (const [name, fmt] of [['traps.docx', 'docx'], ['traps.xlsx', 'xlsx'], ['traps.pptx', 'pptx']]) {
    const src = load(name);
    const doc = await Ex.adapters.office.read(src, name);
    const segs = doc.segments.filter(s => s.loc && s.visible && s.text.trim());
    ok(segs.length > 0, fmt + ': has paragraphs or cells that can be rewritten (' + segs.length + ')');
    const target = segs[0];
    const edits = [{ ...target.loc, text: 'REWRITTEN ' + fmt }];
    const res = Ex.transform.apply(src, fmt, edits);
    ok(res.changed === 1 && res.skipped === 0, fmt + ': one change applied');
    const out = await Ex.adapters.office.read(res.bytes, 'out.' + fmt);
    ok(out.segments.some(s => s.text === 'REWRITTEN ' + fmt), fmt + ': the new text is in the file');
    ok(!out.segments.some(s => s.visible && s.text === target.text && s.where === target.where), fmt + ': the old text of that place is gone');
    ok(out.segments.filter(s => s.visible).length >= doc.segments.filter(s => s.visible).length - 1, fmt + ': the other text is untouched');
    const unz = Object.values(Ex.util.safeUnzip(res.bytes)).map(b => new TextDecoder().decode(b)).join('\n');
    ok(!unz.includes('>' + target.text + '<'), fmt + ': the old wording is not left in any part');
  }
}

// ---------------------------------------------------------------- hostile input
section('hostile input');
{
  const reject = async (fn, code) => { try { await fn(); return false; } catch (e) { return e.code === code || (console.log('   got', e.code, e.message), false); } };
  ok(await reject(() => Ex.adapters.pdf.read(load('not-a-pdf.pdf'), 'x.pdf', pdfjs), 'bad_pdf'), 'garbage PDF rejected with a clear code');
  ok(await reject(() => Ex.adapters.docx.read(load('not-a-zip.docx'), 'x.docx'), 'zip_bad'), 'garbage DOCX rejected');
  ok(await reject(() => Ex.adapters.docx.read(load('many-entries.docx'), 'x.docx'), 'zip_entries'), 'too many ZIP entries rejected');
}

section('us ssn');
ok(globalThis.__ssn.length === 1 && globalThis.__ssn[0] === '123-45-6789', 'US SSN accepted; invalid areas rejected');
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
