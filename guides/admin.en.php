<?php // Admin guide – English content (included by admin-guide.php)
g_open(
    'Admin guide',
    'Everything in <b>Settings</b> (the gear icon) decides <b>what Exposift looks for</b> in the text of a document and <b>how it is weighed</b>. This guide explains each screen and how the pieces fit together.',
    [
        'how'        => 'How the pieces fit',
        'rules'      => 'Rules',
        'dictionary' => 'Custom dictionary',
        'categories' => 'Categories and tokens',
        'scan'       => 'Scan mapping',
        'lists'      => 'Lists and exceptions',
        'general'    => 'General settings',
        'ai'         => 'AI connections',
        'backup'     => 'Backup and restore',
        'security'   => 'Password and security',
        'tips'       => 'Good practice',
    ],
    'Admin guide'
);
?>

<?php g_section('how', 'How the pieces fit'); ?>
<p>When Exposift reads the text of a document it works in two layers:</p>
<ol>
  <li><b>Built-in checks</b> (email, phone, checksummed ID numbers, IBAN, cards, IP addresses, secrets). They run first and win when they find the same text as a rule.</li>
  <li><b>Masking rules.</b> Each rule recognizes one kind of value and belongs to a <b>category</b>. The <b>scan mapping</b> then turns a category (or a single rule) into a <b>scan type</b>, and the scan type sets the exposure class and severity you see on a finding.</li>
</ol>
<?php g_example(
    "Rule: \"Internal host name\"\nCategory: Hostname\nScan type: Host or domain name",
    "Finding: Host or domain name\nClass: Contextual Oversharing\nSeverity: Medium",
    'You edit', 'You see in a scan'
); ?>
<?php g_note('Everything on these screens is stored <b>in this browser only</b>. Nothing is sent to a server, and clearing the site data resets it to the defaults.', 'info'); ?>

<?php g_section('rules', 'Rules'); ?>
<p>Each rule defines how <b>one kind of data</b> is recognized. You can edit, disable or reset built-in rules and add your own.</p>
<ul>
  <li><b>Search and filters</b>: by name, description, pattern or key; by category, type and state (enabled, disabled, custom, built-in, broken).</li>
  <li><b>Priority</b>: when two rules match the same text the one with the higher priority wins.</li>
  <li><b>Mode</b>: some rules apply only to logs or only to scripts; "auto" guesses from the line structure.</li>
  <li><b>Scan type</b> (in the rule editor): what a match of this rule becomes in a document scan. "Follow the category" uses the category setting.</li>
  <li><b>Live test</b>: type a sample in the editor and see what the rule matches before saving.</li>
  <li><b>Bulk actions</b>: tick several rules and enable or disable them together.</li>
</ul>
<?php g_note('A built-in rule you changed can be <b>reset</b> to its original from the rule editor. A rule marked <i>Broken</i> has a pattern that cannot run; fix or disable it.', 'tip'); ?>

<?php g_section('dictionary', 'Custom dictionary'); ?>
<p>Some things cannot be recognized by a pattern: your server names, project code names, customer names. Add them here, one per line. They are matched as <b>whole words</b> and <b>without regard to case</b>, in every document.</p>
<?php g_note('For names that matter only for one file, use the <b>Names or words to look for</b> box on the start screen instead. It is kept only for that scan.', 'tip'); ?>

<?php g_section('categories', 'Categories and tokens'); ?>
<p>Categories group rules (Password, Key / Token, Hostname, Person, E-mail, Phone and so on). For each category you can set:</p>
<ul>
  <li><b>Token prefix</b> and <b>colour</b>, used when text is masked for Ask AI.</li>
  <li><b>Propagation</b>: a value found through context (for example <code>user=john</code>) is also masked elsewhere in the text without context.</li>
  <li><b>Placeholder template</b>: the shape of the masked value. Variables: <code>{CAT}</code> prefix, <code>{cat}</code> lowercase prefix, <code>{n}</code> sequence number, <code>{hash}</code>, <code>{len}</code>, <code>{stars}</code>.</li>
</ul>
<?php g_example('john.doe@example.com  →  john.doe@example.com', '<EMAIL_1>  ←  john.doe@example.com', 'Original', 'Template <{CAT}_{n}>'); ?>
<?php g_note('A template without <code>{n}</code> or <code>{hash}</code> cannot be restored afterwards, so the AI answer cannot get its real values back.', 'warn'); ?>

<?php g_section('scan', 'Scan mapping'); ?>
<p>This table decides <b>what each match becomes when a document is scanned</b>.</p>
<ul>
  <li><b>Use in document scans</b>: switch a whole category off if you do not want it to produce findings.</li>
  <li><b>Scan type</b>: the type a category becomes. The right-hand column shows the resulting class and severity.</li>
  <li><b>Rules with their own scan type</b>: a single rule can override its category. Remove the override to follow the category again.</li>
  <li><b>Field labels</b>: documents often print a label next to a value ("Full name", "Mailing address", "API token"). One line per scan type: the type, a colon, then the labels separated by commas. The value after the label, or in the next table cell, becomes that scan type.</li>
  <li><b>Try it</b>: paste a few lines and see what would be found and how it would be classed.</li>
</ul>
<?php g_shot('scan', 'Scan mapping: each category becomes a scan type, with its class and severity.'); ?>
<?php g_note('Built-in checks win over rules. If a value is found by both, the built-in check decides its type.', 'info'); ?>

<?php g_section('lists', 'Lists and exceptions'); ?>
<p>Lists that control how the engine recognizes and excludes values. They apply to <b>all rules</b> as soon as they are saved. One entry per line; leave a list empty to use the built-in defaults. Use <b>reset to default</b> on a single list to undo your edits.</p>
<?php g_note('Add a value to an exclusion list when something harmless keeps being flagged, for example a public address that is part of your letterhead.', 'tip'); ?>

<?php g_section('general', 'General settings'); ?>
<?php g_table([
    [t('Setting'), t('What it does')],
    ['<b>General placeholder template</b>', 'Default token format for categories that have no template of their own.'],
    ['<b>Propagation</b> and <b>minimum length</b>', 'Whether values found with context are masked everywhere, and the shortest value allowed to spread. Prevents "it" or "db" from being masked in all places.'],
    ['<b>Default mode</b>', 'Automatic, Log or Script. Some rules run in only one mode. Used for Ask AI and document scans.'],
    ['<b>Keep subnet masks</b>', 'Values such as 255.255.255.0 are not treated as IP addresses.'],
    ['<b>Remaining-risk keywords</b>', 'Ask AI shows a warning when this expression matches lines where nothing was masked. Empty means no warning.'],
    ['<b>Ask AI: default model, largest request</b>', 'The model preselected in Ask AI and the longest document (in characters) that is allowed to be sent. Longer ones are refused before anything leaves.'],
]); ?>

<?php g_section('ai', 'AI connections'); ?>
<p>Ask AI uses OpenAI-compatible endpoints. Add a connection with its address, key and models; the models of enabled connections appear in the Ask AI model list.</p>
<ul>
  <li>Connections and keys are stored <b>on the server</b>, in <code>data/settings.json</code>, and can be changed only from <b>this computer</b>.</li>
  <li>After saving, a key is never sent back to the browser; only its last four characters are shown as a hint. Leave the key field empty when editing to keep the current key.</li>
  <li>Only the <b>masked</b> text is ever sent to a model. You see exactly what it will receive before you send.</li>
  <li>Use <b>Test</b> on a connection to check the address and key before relying on it.</li>
</ul>
<?php g_shot('ai', 'The masked preview shows exactly what the model would receive.'); ?>

<?php g_section('backup', 'Backup and restore'); ?>
<ul>
  <li><b>Export</b> downloads all rules, categories and settings as one JSON file.</li>
  <li><b>Import</b> reads such a file. Built-in rules are matched by their key and updated; custom rules are added. You can delete the existing custom rules first.</li>
  <li><b>Add missing defaults</b> adds built-in rules introduced in a newer version. <b>Reset built-ins</b> returns every built-in rule and category to its original state; your own rules are kept.</li>
  <li><b>Change log</b> lists rule, category and settings changes.</li>
</ul>
<?php g_note('Settings live in the browser. Export a backup before clearing site data or moving to another browser.', 'warn'); ?>

<?php g_section('security', 'Password and security'); ?>
<p>The settings are protected by an <b>admin password</b>.</p>
<ul>
  <li><b>First use</b>: the first time you open Settings you are asked to set a password (at least 8 characters). Until then nobody can use the settings.</li>
  <li><b>Sign in</b> with that password; <b>Sign out</b> is under the settings menu. The session ends by itself after the timeout you choose in <b>Security</b> (default 60 minutes).</li>
  <li><b>Five wrong attempts</b> lock sign-in for five minutes.</li>
  <li><b>Change the password</b> in Security: enter the current one and the new one twice.</li>
  <li>Settings can be opened <b>only from this computer</b>; from another device the page just says so.</li>
</ul>
<?php g_note('The password locks the <b>screen and the AI connections</b> (addresses and keys, stored on the server). Masking rules live in the browser, so the password is not encryption of that data.', 'warn'); ?>
<?php g_note('If you forget the password, delete the <code>admin_hash</code> line from <code>data/settings.json</code>. The next visit to Settings asks for a new one.', 'tip'); ?>

<?php g_section('tips', 'Good practice'); ?>
<ul>
  <li>Change one thing at a time, then test with a real sample from the <b>Try it</b> box.</li>
  <li>Prefer the custom dictionary for names and the rule editor for patterns.</li>
  <li>Switch off noisy categories in the scan mapping before deleting rules; it is easy to undo.</li>
  <li>Keep a recent export. It is the only copy of your custom rules.</li>
  <li>Detections are indications, not verdicts: tune the rules to reduce noise, and still review what Exposift lists.</li>
</ul>

<?php g_close(); ?>
