// Builds the synthetic test corpus (tests/corpus/). No real person's data: every name, number and
// address below is made up. Usage: EXPOSIFT_NM=/path/to/node_modules node tests/make-corpus.mjs
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const NM = process.env.EXPOSIFT_NM;
if (!NM) { console.error('Set EXPOSIFT_NM to a node_modules folder containing pdf-lib and fflate.'); process.exit(2); }
const require = createRequire(join(NM, 'x.js'));
const { PDFDocument, StandardFonts, rgb, PDFName, PDFString } = require('pdf-lib');
const fflate = require('fflate');

const out = join(here, 'corpus');
mkdirSync(out, { recursive: true });

// ---- made-up identifiers that pass the real checksums
const tckn = (() => { // 10000000146 is a well-known synthetic example
  const d = [1, 0, 0, 0, 0, 0, 0, 0, 1];
  const d10 = (((d[0] + d[2] + d[4] + d[6] + d[8]) * 7 - (d[1] + d[3] + d[5] + d[7])) % 10 + 10) % 10;
  const d11 = (d.reduce((a, b) => a + b, 0) + d10) % 10;
  return d.join('') + d10 + d11;
})();
const vkn = (() => {
  const base = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  let sum = 0;
  base.forEach((x, i) => { const tmp = (x + (9 - i)) % 10; let v = (tmp * Math.pow(2, 9 - i)) % 9; if (tmp !== 0 && v === 0) v = 9; sum += v; });
  return base.join('') + ((10 - (sum % 10)) % 10);
})();
const IBAN = 'TR330006100519786457841326';
const EMAIL = 'ayse.demir@example.org';

// ================================================================== PDF
async function pdfWith(draw, setup) {
  const doc = await PDFDocument.create();
  doc.setProducer('Exposift test corpus'); doc.setCreator('Exposift test corpus');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  if (setup) setup(doc);
  draw({ doc, page, font });
  return doc;
}

// 1. fake redaction: black box drawn over the national ID
{
  const doc = await pdfWith(({ page, font }) => {
    page.drawText('Personnel record', { x: 50, y: 780, size: 18, font });
    page.drawText('Name: Ayse Demir', { x: 50, y: 740, size: 12, font });
    page.drawText('National ID: ' + tckn, { x: 50, y: 710, size: 12, font });
    page.drawRectangle({ x: 125, y: 704, width: 100, height: 16, color: rgb(0, 0, 0) });
    page.drawText('Contact: ' + EMAIL, { x: 50, y: 680, size: 12, font });
  });
  writeFileSync(join(out, 'fake-redaction.pdf'), await doc.save());
}

// 2. metadata + annotation + attachment + script + hidden off-page text
{
  const doc = await pdfWith(({ doc: d, page, font }) => {
    page.drawText('Quarterly summary', { x: 50, y: 780, size: 18, font });
    page.drawText('Payments go to ' + IBAN.replace(/(.{4})/g, '$1 ').trim(), { x: 50, y: 740, size: 12, font });
    page.drawText('floor-price-internal 40000', { x: -400, y: 700, size: 12, font }); // off the page
    d.setAuthor('Mehmet Kaya'); d.setTitle('Q3 summary'); d.setSubject('internal'); d.setKeywords(['draft', 'confidential']);
    const ctx = d.context;
    const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [300, 700, 320, 720], Contents: PDFString.of('Check: do not tell them our price floor is 40k'), T: PDFString.of('Reviewer Can'), F: 4 }));
    page.node.set(PDFName.of('Annots'), ctx.obj([annot]));
    const js = ctx.register(ctx.obj({ S: 'JavaScript', JS: PDFString.of('app.alert("hello from intranet.corp");') }));
    d.catalog.set(PDFName.of('OpenAction'), js);
  }, null);
  await doc.attach(new TextEncoder().encode('secret attachment'), 'notes.txt', { mimeType: 'text/plain', description: 'private notes' });
  writeFileSync(join(out, 'traps.pdf'), await doc.save({ useObjectStreams: false }));
}

// 3. clean file (false-positive check)
{
  const doc = await pdfWith(({ page, font }) => {
    page.drawText('Meeting agenda', { x: 50, y: 780, size: 18, font });
    page.drawText('1. Welcome   2. Roadmap   3. Questions', { x: 50, y: 740, size: 12, font });
    page.drawText('Version 1.2.3.4 shipped in week 12; invoice number 20240017.', { x: 50, y: 710, size: 12, font });
    page.drawRectangle({ x: 50, y: 640, width: 300, height: 22, color: rgb(0, 0, 0) });          // dark table header bar
    page.drawText('Header text on a dark bar', { x: 56, y: 646, size: 12, font, color: rgb(1, 1, 1) });  // drawn on top: not a redaction
  });
  doc.setProducer(''); doc.setCreator('');
  writeFileSync(join(out, 'clean.pdf'), await doc.save({ useObjectStreams: false }));
}

// 4. incremental update: the second version removes a sentence, the first version stays in the file
{
  const enc = new TextEncoder();
  const parts = []; let pos = 0; const offs = {};
  const push = (s) => { const b = typeof s === 'string' ? enc.encode(s) : s; parts.push(b); pos += b.length; };
  const content = (t) => { const s = 'BT /F1 12 Tf 50 750 Td (' + t + ') Tj ET'; return '<< /Length ' + s.length + ' >>\nstream\n' + s + '\nendstream'; };
  push('%PDF-1.4\n');
  const objs = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    4: content('Offer letter. Salary offered is 52000 per year, negotiable up to 61000.'),
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  };
  for (const n of [1, 2, 3, 4, 5]) { offs[n] = pos; push(n + ' 0 obj\n' + objs[n] + '\nendobj\n'); }
  const xref1 = pos;
  push('xref\n0 6\n0000000000 65535 f \n' + [1, 2, 3, 4, 5].map(n => String(offs[n]).padStart(10, '0') + ' 00000 n \n').join(''));
  push('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref1 + '\n%%EOF\n');
  // update: replace object 4
  const off4 = pos;
  push('4 0 obj\n' + content('Offer letter. Details to be agreed.') + '\nendobj\n');
  const xref2 = pos;
  push('xref\n4 1\n' + String(off4).padStart(10, '0') + ' 00000 n \n');
  push('trailer\n<< /Size 6 /Root 1 0 R /Prev ' + xref1 + ' >>\nstartxref\n' + xref2 + '\n%%EOF\n');
  const total = parts.reduce((a, b) => a + b.length, 0); const buf = new Uint8Array(total); let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  writeFileSync(join(out, 'incremental.pdf'), buf);
}

// ================================================================== DOCX
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const z = (obj) => fflate.zipSync(Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' ? fflate.strToU8(v) : v])));
const rels = (items) => '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + items.join('') + '</Relationships>';
const CT = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const R = (t) => '<w:r><w:t xml:space="preserve">' + t + '</w:t></w:r>';

// tiny JPEG with an EXIF block that has GPS + camera model + software
function exifJpeg() {
  const le = (n, b) => (b === 2 ? [n & 255, n >> 8] : [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]);
  const model = Array.from(new TextEncoder().encode('TestCam X1\0'));
  const software = Array.from(new TextEncoder().encode('PhotoTool 3\0'));
  // TIFF: header(8) + IFD0 with 3 entries (Model, Software, GPS pointer) + data
  const ifdStart = 8, entries = 3, ifdLen = 2 + entries * 12 + 4;
  const dataStart = ifdStart + ifdLen;
  const ent = (tag, type, cnt, val) => [...le(tag, 2), ...le(type, 2), ...le(cnt, 4), ...le(val, 4)];
  const tiff = [0x49, 0x49, 0x2A, 0, ...le(ifdStart, 4), ...le(entries, 2),
    ...ent(0x0110, 2, model.length, dataStart),
    ...ent(0x0131, 2, software.length, dataStart + model.length),
    ...ent(0x8825, 4, 1, 0),
    0, 0, 0, 0, ...model, ...software];
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  return new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, len >> 8, len & 255, ...app1, 0xFF, 0xD9]);
}

// 5. DOCX full of traps
{
  const body = [
    '<w:p>' + R('Employment offer for ') + '<w:r><w:t>Ah</w:t></w:r><w:r><w:t>met Yilmaz</w:t></w:r></w:p>',
    '<w:p>' + R('Contact: ' + EMAIL + ' · pay to ' + IBAN) + '</w:p>',
    '<w:p>' + R('Salary is 52000. ') + '<w:del w:id="1" w:author="Reviewer Can" w:date="2026-01-02T10:00:00Z"><w:r><w:delText>Our budget floor is 40000, internal only.</w:delText></w:r></w:del><w:ins w:id="2" w:author="Reviewer Can" w:date="2026-01-02T10:01:00Z"><w:r><w:t>Final figure to be agreed.</w:t></w:r></w:ins></w:p>',
    '<w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>internal-only: see https://intranet.corp/wiki/salary-bands</w:t></w:r></w:p>',
    '<w:p><w:r><w:rPr><w:color w:val="FFFFFF"/></w:rPr><w:t>TCKN ' + tckn + '</w:t></w:r></w:p>',
    '<w:p>' + R('Tax number: vergi no ' + vkn + '. api_key = sk-test-1234567890abcdefghijklmnopqrstuv') + '</w:p>'
  ].join('');
  const files = {
    '[Content_Types].xml': CT,
    '_rels/.rels': rels(['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>']),
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + '><w:body>' + body + '</w:body></w:document>',
    'word/_rels/document.xml.rels': rels([
      '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://wiki.corp.local/hr/offers" TargetMode="External"/>',
      '<Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpeg"/>'
    ]),
    'word/_rels/settings.xml.rels': rels(['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///C:/Users/ayse.demir/Templates/offer.dotm" TargetMode="External"/>']),
    'word/settings.xml': '<?xml version="1.0"?><w:settings ' + NS + '><w:docVars><w:docVar w:name="ReviewStatus" w:val="legal approved by Mehmet"/></w:docVars></w:settings>',
    'word/comments.xml': '<?xml version="1.0"?><w:comments ' + NS + '><w:comment w:id="0" w:author="Reviewer Can" w:date="2026-01-02T09:00:00Z" w:initials="RC"><w:p><w:r><w:t>Do not mention the bonus plan to the candidate.</w:t></w:r></w:p></w:comment></w:comments>',
    'word/media/image1.jpeg': exifJpeg(),
    'word/embeddings/oleObject1.bin': new Uint8Array(2048).fill(7),
    'customXml/item1.xml': '<?xml version="1.0"?><root><approvedBy>Zeynep Arslan</approvedBy></root>',
    'docProps/thumbnail.jpeg': new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]),
    'docProps/core.xml': '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>Offer</dc:title><dc:creator>Ayse Demir</dc:creator><cp:lastModifiedBy>Mehmet Kaya</cp:lastModifiedBy><dcterms:created>2026-01-01T08:00:00Z</dcterms:created></cp:coreProperties>',
    'docProps/app.xml': '<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application><AppVersion>16.0000</AppVersion><Company>Acme Corp</Company><Manager>Zeynep Arslan</Manager><TotalTime>412</TotalTime></Properties>'
  };
  writeFileSync(join(out, 'traps.docx'), z(files));
}

// 6. clean DOCX
{
  const files = {
    '[Content_Types].xml': CT,
    '_rels/.rels': rels(['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>']),
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8"?><w:document ' + NS + '><w:body><w:p>' + R('Meeting agenda. Version 1.2.3.4 shipped in week 12.') + '</w:p></w:body></w:document>'
  };
  writeFileSync(join(out, 'clean.docx'), z(files));
}

// 7. hostile inputs
writeFileSync(join(out, 'not-a-pdf.pdf'), new TextEncoder().encode('this is not a pdf at all'));
writeFileSync(join(out, 'not-a-zip.docx'), new TextEncoder().encode('PK but not really'));
{ // zip bomb-ish: many entries
  const big = {};
  for (let i = 0; i < 5200; i++) big['f' + i + '.txt'] = new Uint8Array(1);
  writeFileSync(join(out, 'many-entries.docx'), z(big));
}

// ================================================================== XLSX
{
  const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', RN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const ctx = (extra) => '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' + extra + '</Types>';
  const ov = (part, type) => '<Override PartName="/' + part + '" ContentType="application/vnd.openxmlformats-officedocument.' + type + '+xml"/>';
  const rel = (id, type, target, ext) => '<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + type + '" Target="' + target + '"' + (ext ? ' TargetMode="External"' : '') + '/>';
  const strings = ['Quarterly budget', 'Owner', 'Ayşe Demir', EMAIL, 'Internal only', IBAN, 'Secret sheet note', 'Hidden row note'];
  const sst = '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="' + M + '" count="8" uniqueCount="8">' + strings.map(x => '<si><t>' + x + '</t></si>').join('') + '</sst>';
  const sheet1 = '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="' + M + '" xmlns:r="' + RN + '"><cols><col min="4" max="4" width="10" hidden="1"/></cols><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c><c r="D2" t="s"><v>5</v></c></row>'
    + '<row r="3"><c r="A3"><v>' + tckn + '</v></c></row>'
    + '<row r="4" hidden="1"><c r="A4" t="s"><v>7</v></c></row>'
    + '</sheetData><legacyDrawing r:id="rId1"/></worksheet>';
  const sheet2 = '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="' + M + '"><sheetData><row r="1"><c r="A1" t="s"><v>6</v></c></row></sheetData></worksheet>';
  const wb = '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="' + M + '" xmlns:r="' + RN + '"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" state="hidden" r:id="rId2"/></sheets><definedNames><definedName name="SecretKey">"sk-test-0123456789abcdef"</definedName></definedNames></workbook>';
  const files = {
    '[Content_Types].xml': ctx(ov('xl/workbook.xml', 'spreadsheetml.sheet.main') + ov('xl/worksheets/sheet1.xml', 'spreadsheetml.worksheet') + ov('xl/worksheets/sheet2.xml', 'spreadsheetml.worksheet') + ov('xl/sharedStrings.xml', 'spreadsheetml.sharedStrings') + ov('xl/comments1.xml', 'spreadsheetml.comments') + ov('docProps/core.xml', 'package.core-properties').replace('officedocument.package', 'package')),
    '_rels/.rels': rels([rel('rId1', 'officeDocument', 'xl/workbook.xml'), '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>']),
    'docProps/core.xml': '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Ayşe Demir</dc:creator><cp:lastModifiedBy>Mert Kaya</cp:lastModifiedBy></cp:coreProperties>',
    'xl/workbook.xml': wb,
    'xl/_rels/workbook.xml.rels': rels([rel('rId1', 'worksheet', 'worksheets/sheet1.xml'), rel('rId2', 'worksheet', 'worksheets/sheet2.xml'), rel('rId3', 'sharedStrings', 'sharedStrings.xml')]),
    'xl/sharedStrings.xml': sst,
    'xl/worksheets/sheet1.xml': sheet1,
    'xl/worksheets/sheet2.xml': sheet2,
    'xl/worksheets/_rels/sheet1.xml.rels': rels([rel('rId1', 'vmlDrawing', '../drawings/vmlDrawing1.vml'), rel('rId2', 'comments', '../comments1.xml')]),
    'xl/comments1.xml': '<?xml version="1.0" encoding="UTF-8"?><comments xmlns="' + M + '"><authors><author>Mert Kaya</author></authors><commentList><comment ref="B2" authorId="0"><text><r><t>Check this before sending to the bank</t></r></text></comment></commentList></comments>',
    'xl/drawings/vmlDrawing1.vml': '<xml></xml>'
  };
  writeFileSync(join(out, 'traps.xlsx'), z(files));
}

// ================================================================== PPTX
{
  const A = 'http://schemas.openxmlformats.org/drawingml/2006/main', P = 'http://schemas.openxmlformats.org/presentationml/2006/main', RN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const ctx = (extra) => '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' + extra + '</Types>';
  const ov = (part, type) => '<Override PartName="/' + part + '" ContentType="application/vnd.openxmlformats-officedocument.presentationml.' + type + '+xml"/>';
  const rel = (id, type, target, ext) => '<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + type + '" Target="' + target + '"' + (ext ? ' TargetMode="External"' : '') + '/>';
  const shape = (id, name, x, y, text, hidden) => '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + name + '"' + (hidden ? ' hidden="1"' : '') + '/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="3000000" cy="500000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>' + text + '</a:t></a:r></a:p></p:txBody></p:sp>';
  const slide = (shapes, hide) => '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="' + A + '" xmlns:p="' + P + '" xmlns:r="' + RN + '"' + (hide ? ' show="0"' : '') + '><p:cSld><p:spTree>' + shapes + '</p:spTree></p:cSld></p:sld>';
  const notes = (t) => '<?xml version="1.0" encoding="UTF-8"?><p:notes xmlns:a="' + A + '" xmlns:p="' + P + '"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>' + t + '</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>';
  const files = {
    '[Content_Types].xml': ctx(ov('ppt/presentation.xml', 'presentation.main') + ov('ppt/slides/slide1.xml', 'slide') + ov('ppt/slides/slide2.xml', 'slide') + ov('ppt/notesSlides/notesSlide1.xml', 'notesSlide') + ov('ppt/commentAuthors.xml', 'commentAuthors') + ov('ppt/comments/comment1.xml', 'comments')),
    '_rels/.rels': rels([rel('rId1', 'officeDocument', 'ppt/presentation.xml')]),
    'ppt/presentation.xml': '<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:a="' + A + '" xmlns:p="' + P + '" xmlns:r="' + RN + '"><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels([rel('rId1', 'slide', 'slides/slide1.xml'), rel('rId2', 'slide', 'slides/slide2.xml'), rel('rId3', 'commentAuthors', 'commentAuthors.xml')]),
    'ppt/slides/slide1.xml': slide(shape(2, 'Title', 500000, 400000, 'Roadmap review') + shape(3, 'Contact', 500000, 1200000, 'Contact ' + EMAIL) + shape(4, 'Off', 12000000, 400000, 'Parked text: password is Winter2024!') + shape(5, 'Ghost', 500000, 2000000, 'Ghost shape with IBAN ' + IBAN, true)),
    'ppt/slides/_rels/slide1.xml.rels': rels([rel('rId1', 'notesSlide', '../notesSlides/notesSlide1.xml'), rel('rId2', 'comments', '../comments/comment1.xml')]),
    'ppt/notesSlides/notesSlide1.xml': notes('Say that Ayşe Demir approved the budget'),
    'ppt/comments/comment1.xml': '<?xml version="1.0" encoding="UTF-8"?><p:cmLst xmlns:p="' + P + '"><p:cm authorId="0" dt="2024-01-01T10:00:00"><p:pos x="10" y="10"/><p:text>Do not show the customer list</p:text></p:cm></p:cmLst>',
    'ppt/commentAuthors.xml': '<?xml version="1.0" encoding="UTF-8"?><p:cmAuthorLst xmlns:p="' + P + '"><p:cmAuthor id="0" name="Mert Kaya" initials="MK" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>',
    'ppt/slides/slide2.xml': slide(shape(2, 'Title', 500000, 400000, 'Draft pricing for Acme'), true)
  };
  writeFileSync(join(out, 'traps.pptx'), z(files));
}
console.log('corpus written to', out, '· tckn', tckn, '· vkn', vkn);
