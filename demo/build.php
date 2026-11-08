<?php
// Builds the static GitHub Pages demo into _site/ (php demo/build.php [outdir]).
// The real pages are rendered by PHP (from a temporary copy in which the sign-in is replaced by a stand-in) so the demo
// always shows the current interface. Documents are never uploaded. The settings screen runs in the browser: rules,
// categories and backup live in localStorage; the few server-only actions are answered by demo/src/runtime.js.
declare(strict_types=1);
$root = dirname(__DIR__);
$out = $argv[1] ?? "$root/_site";
$php = PHP_BINARY;

function rrmdir(string $d): void
{
    if (!is_dir($d)) { return; }
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $f) {
        $f->isDir() ? rmdir($f->getPathname()) : unlink($f->getPathname());
    }
    rmdir($d);
}
function rcopy(string $from, string $to): void
{
    @mkdir($to, 0777, true);
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($from, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST) as $f) {
        $dest = $to . '/' . substr($f->getPathname(), strlen($from) + 1);
        $f->isDir() ? @mkdir($dest, 0777, true) : copy($f->getPathname(), $dest);
    }
}

rrmdir($out);
mkdir($out, 0777, true);
$tmp = sys_get_temp_dir() . '/exposift-demo-' . getmypid();
mkdir($tmp, 0777, true);
foreach (['src', 'partials', 'guides', 'lang'] as $d) { rcopy("$root/$d", "$tmp/$d"); }
foreach (['index', 'settings', 'guide', 'admin-guide'] as $p) { copy("$root/$p.php", "$tmp/$p.php"); }
mkdir("$tmp/assets", 0777, true);
rcopy("$root/assets/css", "$tmp/assets/css");
file_put_contents("$tmp/src/Auth.php", <<<'PHP'
<?php
final class Auth
{
    public static function check(): bool { return true; }
    public static function hasPassword(): bool { return true; }
    public static function minutes(): int { return 60; }
}
PHP);
$prepend = "$tmp/prepend.php";
file_put_contents($prepend, "<?php \$_COOKIE['exi_lang'] = getenv('EX_LANG'); \$_SERVER['REMOTE_ADDR'] = '127.0.0.1'; ob_start();\n");
// connection types as the settings screen lists them (translated per language)
$typesCode = '<?php define("EX_ROOT", getenv("EX_TMP")); require EX_ROOT . "/src/bootstrap.php"; require EX_ROOT . "/src/Llm.php"; echo json_encode(array_map("t", Llm::TYPES), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG);';
file_put_contents("$tmp/types.php", $typesCode);

$pages = ['index', 'settings', 'guide', 'admin-guide'];
$note = ['en' => 'Demo: your files are opened and cleaned in this browser tab and never uploaded. Settings are kept only in this browser; the AI features and the admin password need a server and are switched off here.',
         'tr' => 'Demo: dosyalarınız bu tarayıcı sekmesinde açılır ve temizlenir, hiçbir yere yüklenmez. Ayarlar yalnızca bu tarayıcıda tutulur; yapay zekâ özellikleri ve yönetici parolası sunucu gerektirdiği için burada kapalıdır.'];
$resetLabel = ['en' => 'Reset demo', 'tr' => 'Demoyu sıfırla'];
foreach (['en' => '', 'tr' => '.tr'] as $lang => $suffix) {
    $other = $lang === 'en' ? '.tr' : '';
    foreach ($pages as $p) {
        $cmd = 'cd ' . escapeshellarg($tmp) . ' && EX_LANG=' . $lang . ' ' . escapeshellarg($php) . ' -d display_errors=stderr -d auto_prepend_file=' . escapeshellarg($prepend)
            . ' -d session.save_path=' . escapeshellarg($tmp) . ' ' . escapeshellarg("$tmp/$p.php");
        $o = []; $code = 0;
        exec($cmd, $o, $code);
        $html = implode("\n", $o);
        if ($code !== 0 || !str_contains($html, '</html>')) { fwrite(STDERR, "render failed: $p ($lang)\n" . substr($html, 0, 400) . "\n"); exit(1); }
        $html = preg_replace_callback('/href="(index|settings|guide|admin-guide)\.php(#[^"]*)?"/', fn($m) => 'href="' . $m[1] . $suffix . '.html' . ($m[2] ?? '') . '"', $html);
        // the language switch becomes a link to the same page in the other language
        $html = preg_replace('~<button type="button" id="langToggle"([^>]*)>(.*?)</button>~s', '<a id="langLink" href="' . $p . $other . '.html"$1>$2</a>', $html, 1);
        $html = str_replace(' data-lang="', ' data-x="', $html);
        $types = trim((string)shell_exec('cd ' . escapeshellarg($tmp) . ' && EX_TMP=' . escapeshellarg($tmp) . ' EX_LANG=' . $lang . ' ' . escapeshellarg($php) . ' -d auto_prepend_file=' . escapeshellarg($prepend) . ' ' . escapeshellarg("$tmp/types.php")));
        json_decode($types, false, 512, JSON_THROW_ON_ERROR);
        // the demo runtime goes in front of the app scripts; the AI button, the sign-out and password parts are not shown
        $html = str_replace('</head>', '<style>#btnAsk,#logoutBtn{display:none!important}</style><meta name="description" content="Exposift: see what is inside a PDF, Word, Excel or PowerPoint file before you share it. Runs entirely in your browser."></head>', $html);
        $html = preg_replace('~<script src="assets/js/common\.js~', '<script>window.EX_DEMO={types:' . $types . '};</script><script src="assets/demo/runtime.js"></script><script src="assets/js/common.js', $html, 1, $nRt);
        if ($nRt !== 1) { fwrite(STDERR, "no common.js in $p ($lang)\n"); exit(1); }
        $html = preg_replace('~(</header>)~', '$1<div class="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">' . htmlspecialchars($note[$lang]) . ' <button type="button" id="demoReset" class="ml-2 underline hover:no-underline">' . htmlspecialchars($resetLabel[$lang]) . '</button></div>', $html, 1);
        $html = preg_replace('/\?v=\d+/', '?v=' . substr(sha1((string)time()), 0, 8), $html);
        file_put_contents("$out/$p$suffix.html", $html);
    }
}
rrmdir($tmp);

rcopy("$root/assets", "$out/assets");
mkdir("$out/assets/demo", 0777, true);
copy(__DIR__ . '/src/runtime.js', "$out/assets/demo/runtime.js");
file_put_contents("$out/.nojekyll", '');
file_put_contents("$out/robots.txt", "User-agent: *\nAllow: /\n");
$size = 0;
foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($out, FilesystemIterator::SKIP_DOTS)) as $f) { $size += $f->getSize(); }
printf("built %s (%.1f MB)\n", $out, $size / 1e6);
