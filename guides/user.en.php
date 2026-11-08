<?php // User guide – English content (included by guide.php)
g_open(
    'How it works',
    'Exposift looks inside a file <b>before you share it</b>: not only at what the page shows, but at what the file really contains. It weighs what it finds against <b>why</b> you are sharing and <b>with whom</b>, lets you decide, cleans the file, and then <b>checks the result with a separate reader</b>. Your file never leaves this browser.',
    [
        'overview' => 'The four steps',
        'start'    => 'Starting a scan',
        'findings' => 'Reading the findings',
        'inspect'  => 'What is inspected',
        'clean'    => 'Cleaning the file',
        'verify'   => 'Verification',
        'ai'       => 'Ask AI without exposing it',
        'settings' => 'Settings and rules',
        'privacy'  => 'Privacy',
        'limits'   => 'What Exposift is not',
        'faq'      => 'Frequently asked questions',
    ]
);
?>

<?php g_section('overview', 'The four steps'); ?>
<ol>
  <li><b>Inspect.</b> The file is opened in your browser and examined from the inside: properties, comments, tracked changes, hidden text, attachments, form fields, earlier versions, text hidden under black boxes, and the visible text.</li>
  <li><b>Review.</b> Every finding says how serious it may be and how sure Exposift is. You mark what should go: <i>Remove</i>, <i>Keep</i> or <i>Decide later</i>. Nothing is changed yet.</li>
  <li><b>Clean.</b> The findings you approved are removed from the file structure itself, never just painted over. Anything that cannot be removed is listed, not skipped silently.</li>
  <li><b>Verify.</b> The cleaned file is opened again by an independent reader and searched for the values you removed. Only then does it get a "Verified" label.</li>
</ol>
<?php g_example(
    "Author: Jane Doe\nComment: \"ask Ahmet about the price\"\nTracked deletion: \"budget 120,000\"\nPhone: +90 555 000 11 22",
    "Author: (removed)\nComment: (removed)\nTracked deletion: (gone)\nPhone: ████",
    'Shared as it was', 'After Exposift'
); ?>
<?php g_note('The cleaned file is a <b>new file</b>. Your original is never modified.', 'info'); ?>

<?php g_section('start', 'Starting a scan'); ?>
<?php g_shot('home', 'The start screen: drop a file, choose Quick Scan or Purpose-Based Scan.'); ?>
<p>On the first screen you choose how to scan, then drop a file (or click to pick one).</p>
<h3>Quick scan or purpose-based scan</h3>
<ul>
  <li><b>Quick scan</b> reports what is there and how serious it may be. It does not know your situation.</li>
  <li><b>Purpose-based scan</b> asks what kind of document it is, why you are sharing it and who will receive it (a colleague, an outside organization or anyone). The same phone number is fine for a colleague and questionable on a public page, so findings are weighed accordingly and Exposift can recommend what to remove.</li>
</ul>
<h3>Names to watch for</h3>
<p>You can type names (yours, your family's, a client's) one per line. Wherever one appears, even inside longer text, it becomes a finding. Capitalization and Turkish letters are ignored (<code>Çağlar</code> finds <code>caglar</code>).</p>
<h3>Supported files</h3>
<p><b>PDF</b>, <b>Word (.docx)</b>, <b>Excel (.xlsx)</b> and <b>PowerPoint (.pptx)</b>. Password-protected files, older <code>.doc</code>, <code>.xls</code> and <code>.ppt</code> files and other formats are refused with a clear message instead of being half-read.</p>

<?php g_section('findings', 'Reading the findings'); ?>
<?php g_shot('findings', 'Findings are grouped by exposure class, with the document on the left.'); ?>
<p>The document appears on the left with findings marked in place; the list is on the right. Click a card to jump to the spot.</p>
<h3>Six kinds of exposure</h3>
<?php g_table([
    [t('Class'), t('What it means'), t('Examples')],
    ['<b>' . h(t('Hidden Exposure')) . '</b>', h(t('Present in the file but not visible when reading')), h(t('Comments, author names, hidden text, attachments, layers, IP addresses'))],
    ['<b>' . h(t('Personal Data')) . '</b>', h(t('Information about a person')), h(t('Names, email, phone, ID numbers, IBAN, addresses'))],
    ['<b>' . h(t('Credential Exposure')) . '</b>', h(t('Something that grants access')), h(t('Passwords, API tokens, keys'))],
    ['<b>' . h(t('Contextual Oversharing')) . '</b>', h(t('Fine in itself, too much for this purpose')), h(t('Internal host names, full addresses in a job application'))],
    ['<b>' . h(t('Recoverable Redaction')) . '</b>', h(t('Looks removed but can be recovered')), h(t('Text under a black box, tracked deletions, earlier PDF versions'))],
    ['<b>' . h(t('Unverified Content')) . '</b>', h(t('Cannot be judged by Exposift')), h(t('Macros, custom XML data'))],
]); ?>
<h3>Severity and confidence</h3>
<p>Each card carries a severity (<?= g_tok('High', '#e11d48') ?> <?= g_tok('Medium', '#d97706') ?> <?= g_tok('Low', '#64748b') ?>) and a confidence (<i>Sure</i>, <i>Fairly sure</i>, <i>Unsure</i>). A detection is an indication, not proof: a number that passes the ID checksum is probably an ID, but a string that merely looks like an IP address may be a version number. Low-confidence findings never outrank their evidence.</p>
<h3>The stance for your purpose</h3>
<p>In a purpose-based scan every card also says what Exposift thinks about it for this recipient:</p>
<ul>
  <li><b>Normally needed</b>: expected in this kind of document.</li>
  <li><b>Check that it is needed</b>: the recipient may not need it.</li>
  <li><b>Rarely needed</b>: look carefully before keeping it.</li>
  <li><b>Recommended to remove</b>: hidden traces that serve no purpose for the recipient.</li>
</ul>
<?php g_note('<b>Mark recommended for removal</b> ticks the recommended ones for you. Look through them before you continue; the choice is yours.', 'tip'); ?>

<?php g_section('inspect', 'What is inspected'); ?>
<h3>Word (.docx)</h3>
<ul>
  <li>Document properties (author, organization, dates, software, custom properties, template paths).</li>
  <li>Comments, tracked insertions and deletions, hidden text, white or 1-point text, and text covered only by a <b>black highlight</b>.</li>
  <li>Headers, footers, footnotes, field codes, document variables, custom XML.</li>
  <li>Links that point outside, embedded objects and files, the preview thumbnail, and photo metadata (EXIF, GPS) inside pictures.</li>
  <li>The visible text, scanned for personal data, credentials and your names.</li>
</ul>
<h3>PDF</h3>
<ul>
  <li>Info and XMP metadata, annotations and notes, attachments, scripts and actions, layers, bookmarks.</li>
  <li>Text positioned outside the page, and text under black boxes (a <b>fake redaction</b>: the box is only painted over the text).</li>
  <li>Earlier revisions inside the same file (incremental saves), reopened and compared.</li>
  <li>The visible text of every page.</li>
</ul>
<?php g_note('Text drawn inside <b>pictures</b> (scans, screenshots) is not read in this version. It is reported as <i>not analyzed</i> so you know what was not checked.', 'warn'); ?>

<?php g_section('clean', 'Cleaning the file'); ?>
<?php g_shot('result', 'After cleaning, the file is reopened and checked; the report lists every check.'); ?>
<p>Press <b>Continue: clean and verify</b>. Exposift shows a plan first: what will be removed, what cannot be removed with this method and why, and what you chose to leave. Then press <b>Create the cleaned file</b>.</p>
<h3>Excel (.xlsx)</h3>
<ul>
  <li>Hidden sheets, hidden rows and columns: their cells are stored in the file and can be unhidden by anyone.</li>
  <li>Comments (also threaded comments), defined names, external workbook links, pivot table caches and the saved folder path.</li>
  <li>Document properties, embedded objects, macros, thumbnail and photo metadata, plus every cell value scanned for personal data and credentials.</li>
</ul>
<h3>PowerPoint (.pptx)</h3>
<ul>
  <li>Speaker notes, comments and their authors.</li>
  <li>Hidden slides, hidden shapes and text placed outside the slide.</li>
  <li>Document properties, embedded objects, external references, thumbnail and photo metadata, plus all slide text scanned for personal data.</li>
</ul>
<h3>Word files</h3>
<p>For Word, Excel and PowerPoint the parts of the package are edited directly (in a workbook a hidden sheet is emptied rather than deleted so formulas keep working; pivot table caches cannot be removed yet): comments removed, tracked changes accepted, hidden and white runs removed, properties cleared, embedded files and thumbnail deleted, links neutralized. A chosen value is replaced with a block (<code>████</code>) even when Word split it across several runs.</p>
<h3>PDF files: three methods (chosen for you)</h3>
<ul>
  <li><b>Clean structure</b> rewrites the file without metadata, notes, attachments, scripts, bookmarks and earlier versions. Page text stays searchable. It <b>cannot</b> remove text that is part of the page itself.</li>
  <li><b>Redact text</b> is used when you chose values that are part of the page. The characters of those values are taken out of the page itself (not just hidden), a black box is drawn in their place and the rest of the page stays as it is: text search and copying still work. The result is reopened and searched; if a value is still found (for example an unusual font), Exposift falls back to the next method automatically. Text found by OCR or without a known position cannot be redacted this way.</li>
  <li><b>Flatten &amp; rebuild</b> covers the chosen values with black boxes, then draws every page as a picture and rebuilds the PDF. Everything hidden is gone, but text search, copying, accessibility, forms and signatures are lost.</li>
</ul>
<?php g_note('If something cannot be removed with the method you picked, it is listed as <b>not removed</b> with the reason. It is never skipped silently.', 'info'); ?>

<?php g_section('verify', 'Verification'); ?>
<p>The result opens in a different reader than the one that produced it and is searched again:</p>
<ul>
  <li>The file opens as a valid document; relationships and XML are intact (Word) or the page count is unchanged (PDF).</li>
  <li>The removed values are not found anywhere: raw bytes, decoded text, tag-stripped text, nested archives, extracted PDF text, metadata, notes, attachments, raw streams.</li>
  <li>A new inspection finds none of the selected hidden content types.</li>
  <li>After flattening: the covered areas are fully black in the output.</li>
</ul>
<?php g_table([
    [t('Result'), t('Meaning')],
    ['<b>' . h(t('Verified')) . '</b>', h(t('Every check passed.'))],
    ['<b>' . h(t('Partly verified')) . '</b>', h(t('Passed, but some things could not be checked or were left by your choice.'))],
    ['<b>' . h(t('Failed')) . '</b>', h(t('A removed value or content was still found. Do not share the file; the report says where.'))],
]); ?>
<p>The <b>Privacy Receipt</b> is a JSON file with what was done and checked, plus hashes of the input and output. It never contains the sensitive values themselves.</p>

<?php g_section('ai', 'Ask AI without exposing it'); ?>
<?php g_shot('ai', 'The masked preview shows exactly what the model would receive.'); ?>
<p>From the findings screen, <b>Ask AI (masked)</b> lets you ask a question about the document without handing it over.</p>
<ol>
  <li><b>Mask.</b> Only the <i>visible</i> text is used. Your browser replaces names, numbers, addresses and secrets with labels such as <?= g_tok('<PERSON_1>', '#db2777') ?> <?= g_tok('<EMAIL_1>', '#0d9488') ?> <?= g_tok('<IBAN_1>', '#2563eb') ?>.</li>
  <li><b>Preview.</b> You see exactly what the model will receive. If anything still looks sensitive, sending is blocked until you mask it too or confirm you checked.</li>
  <li><b>Send.</b> Only the masked text goes to the model you chose.</li>
  <li><b>Restore.</b> The answer comes back with the labels; your browser puts the real values back. Labels the model invented are flagged and left alone.</li>
</ol>
<?php g_example(
    "Ask: who should I contact?\n\nContact Ayşe Yılmaz at ayse@acme.com, IBAN TR33 0006 1005 1978 6457 8413 26.",
    "Ask: who should I contact?\n\nContact <PERSON_1> at <USER_1>@acme.com, IBAN <IBAN_1>.",
    'Your document', 'What the model receives'
); ?>
<?php g_note('Hidden content, comments and metadata are <b>never</b> sent. Each request is recorded in the Privacy Receipt (model, sizes, categories), without any content.', 'info'); ?>

<h3>Rewrite the file with AI</h3>
<p>In the same window, switch from <b>Ask a question</b> to <b>Rewrite the file</b> for Word, Excel and PowerPoint files, for example to fix spelling, make the tone formal or translate. The same masking is used, so the model only sees labels. You get a list of proposed changes (original struck through, new text below); choose what to apply and download the rewritten file.</p>
<ul>
  <li>Only plain paragraphs and text cells can be rewritten. Hidden content, comments, formulas, fields and text with tabs or line breaks are left alone.</li>
  <li>The rest of the file, its pictures, tables and layout are not touched. In a changed paragraph the formatting of the first run is used for the whole paragraph.</li>
  <li>If the model drops or invents a label, that change is flagged and not selected by default.</li>
  <li>The rewritten file is reopened to check that it is still valid. This was tested with a simulated model; check the result in Word, Excel or PowerPoint before sharing. PDF files cannot be rewritten.</li>
</ul>

<?php g_section('settings', 'Settings and rules'); ?>
<?php g_shot('scan', 'Scan mapping: choose what each rule category becomes in a document scan.'); ?>
<p>The gear icon at the top right opens the settings.</p>
<ul>
  <li><b>Rules</b>: every masking rule can be edited, duplicated, disabled or reset; you can add your own (regex, key = value, or a dictionary) and test it live.</li>
  <li><b>Categories &amp; tokens</b>, <b>Lists &amp; exceptions</b> and <b>General settings</b>: token format, values never to mask, domains, name stopwords and more.</li>
  <li><b>Scan mapping</b>: decides what each rule's match becomes when a document is scanned. A category (or one rule) is matched to a <i>scan type</i>, and the scan type sets the exposure class, the severity and how it is weighed for the purpose and recipient. Exposift's own checks (checksummed IDs, IBAN, cards, IPs, secrets) run first and win on overlaps; the rules add passwords, names, hosts and your own patterns.</li>
  <li><b>Field labels</b>: a label next to a value ("Full name", "Mailing address", "API token") turns that value into the matching scan type, on the same line or in the next table cell. The list is yours to edit.</li>
  <li><b>AI connections</b>: add the endpoints and keys Ask AI uses. Only the last four characters of a saved key are shown.</li>
  <li><b>Backup / restore</b>: export and import all rules, categories, lists and the mapping. The admin password is never part of an export.</li>
  <li><b>Security</b>: the settings are protected by a password you choose on first use; you can change it here. Installation and recovering access are covered in the <a href="admin-guide.php">Admin guide</a>.</li>
</ul>
<?php g_note('Rules, categories and lists are stored in <b>this browser</b>; use Backup to move them. AI connections are stored on this computer and can only be changed from it.', 'tip'); ?>

<?php g_section('privacy', 'Privacy'); ?>
<ul>
  <li>Files are opened, analyzed, cleaned and verified <b>inside your browser</b>. They are not uploaded and not stored.</li>
  <li>The page may only talk to its own server (a content security policy enforces this). Only Ask AI sends anything, and only masked text.</li>
  <li>Reports and receipts contain counts, types, hashes and checks, never the values.</li>
  <li>Nothing is collected: no accounts, no analytics.</li>
</ul>

<?php g_section('limits', 'What Exposift is not'); ?>
<ul>
  <li>It is not an antivirus and not a full data-loss-prevention system.</li>
  <li>It gives no legal advice. "Check that it is needed" is a question, not a ruling.</li>
  <li>Text inside pictures is read only when you ask: the <b>Read text in pictures (OCR)</b> button runs Tesseract in your browser (English and Turkish) on scanned PDF pages and on pictures in Word, Excel and PowerPoint files. OCR can be wrong, so treat the result as a hint. In a PDF, values found this way can be covered when the pages are rebuilt as pictures; inside Office files the picture itself has to be replaced or deleted.</li>
  <li>It never promises that a file is safe. Reducing what a file reveals is the goal; look at the result before you send it.</li>
</ul>

<?php g_section('faq', 'Frequently asked questions'); ?>
<h3>Is my original changed?</h3>
<p>No. You download a separate cleaned file.</p>
<h3>Why is a finding marked "Unsure"?</h3>
<p>Because the evidence is weak, for example a number that only looks like an IP address. Check it yourself; you decide.</p>
<h3>Why can't "Clean structure" remove a phone number on the page?</h3>
<p>That method keeps the page content as it is. Choose <b>Flatten &amp; rebuild</b> to cover values drawn on the page.</p>
<h3>The result says "Partly verified". Can I share it?</h3>
<p>Read the report: it names what could not be checked or what you chose to keep. If those are acceptable for this recipient, yes.</p>
<h3>Does Ask AI keep my document?</h3>
<p>Exposift stores nothing. The model provider receives only the masked text you previewed; check their terms for what they do with it.</p>
<?php g_close(); ?>
