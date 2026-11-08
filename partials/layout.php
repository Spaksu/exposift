<?php
declare(strict_types=1);

function ex_logo(string $cls = 'h-8 w-8'): string
{
    return '<img src="assets/img/logo-icon.png" class="' . h($cls) . ' object-contain" alt="" aria-hidden="true">';
}

function ex_lang_switch(): string
{
    $other = I18n::lang() === 'en' ? 'tr' : 'en';
    return '<button type="button" id="langToggle" data-lang="' . $other . '" title="' . h(I18n::LANGS[$other]) . '" aria-label="' . h(I18n::LANGS[$other]) . '"'
        . ' class="rounded-md px-2 py-1.5 text-xs font-semibold tracking-wide text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">'
        . strtoupper($other) . '</button>';
}

function ex_head(string $title, string $active): void
{
    $i18n = ['lang' => I18n::lang(), 'locale' => I18n::locale(), 'dict' => (object)I18n::dict()];
    ?>
<!doctype html>
<html lang="<?= h(I18n::lang()) ?>" class="h-full">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= h($title) ?> · <?= EX_APP ?></title>
<link rel="icon" type="image/png" href="assets/img/favicon.png">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">
<script>
  (function () {
    try {
      var t = localStorage.getItem('exi-theme');
      if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
    } catch (e) {}
  })();
  window.EX_I18N = <?= json_encode($i18n, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) ?>;
</script>
<script src="assets/js/tailwind.js"></script>
<script>
  tailwind.config = {
    darkMode: 'class',
    theme: { extend: {
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'Roboto', 'sans-serif'],
        mono: ['Cascadia Code', 'JetBrains Mono', 'Consolas', 'ui-monospace', 'SFMono-Regular', 'monospace']
      }
    } }
  };
</script>
<link rel="stylesheet" href="assets/css/app.css?v=<?= (int)@filemtime(EX_ROOT . '/assets/css/app.css') ?>">
</head>
<body class="h-full bg-slate-50 text-slate-800 dark:bg-slate-950 dark:text-slate-200 antialiased">
<div class="min-h-full flex flex-col">
<header class="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-900/85">
  <div class="mx-auto flex h-14 max-w-[1800px] items-center gap-2 px-3 sm:gap-4 sm:px-4">
    <a href="index.php" class="flex items-center gap-2.5">
      <?= ex_logo('h-9 w-9') ?>
      <div class="hidden leading-tight sm:block">
        <div class="text-[15px] font-bold tracking-tight"><?= EX_APP ?></div>
        <div class="text-[11px] text-slate-500 dark:text-slate-400"><?= h(t('Know what’s exposed.')) ?></div>
      </div>
    </a>
    <nav class="ml-1 flex items-center gap-0.5 whitespace-nowrap text-sm sm:ml-4 sm:gap-1">
      <?php foreach (['index' => ['index.php', t('Inspect')], 'guide' => ['guide.php', t('How it works')]] as $k => [$href, $label]): ?>
        <a href="<?= $href ?>" class="rounded-md px-2 py-1.5 font-medium sm:px-3 <?= $active === $k ? 'bg-teal-50 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800' ?>"><?= h($label) ?></a>
      <?php endforeach; ?>
    </nav>
    <div class="ml-auto flex items-center gap-2">
      <span class="hidden items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-medium text-teal-800 sm:inline-flex dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        <?= h(t('Files stay in this browser')) ?>
      </span>
      <?= ex_lang_switch() ?>
      <a href="settings.php" title="<?= h(t('Settings')) ?>" aria-label="<?= h(t('Settings')) ?>" class="rounded-md p-2 <?= $active === 'settings' ? 'bg-teal-50 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800' ?>">
        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </a>
      <button type="button" id="themeToggle" class="rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" title="<?= h(t('Toggle theme')) ?>">
        <svg class="h-5 w-5 dark:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        <svg class="hidden h-5 w-5 dark:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      </button>
    </div>
  </div>
</header>
<main class="flex-1">
<?php
}

function ex_foot(array $scripts = []): void
{
    ?>
</main>
<footer class="border-t border-slate-200 py-3 text-center text-xs text-slate-400 dark:border-slate-800">
  <?= EX_APP ?> v<?= h(EX_VERSION) ?> · © 2026 Spaksu · <?= h(t('Documents are opened in your browser and never uploaded. Exposift reduces risk; it does not guarantee that a file is safe to share.')) ?>
</footer>
</div>
<div id="toasts" class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"></div>
<script src="assets/js/common.js?v=<?= (int)@filemtime(EX_ROOT . '/assets/js/common.js') ?>"></script>
<?php foreach ($scripts as $s): ?>
<script src="<?= h($s) ?>?v=<?= (int)@filemtime(EX_ROOT . '/' . $s) ?>"></script>
<?php endforeach; ?>
</body>
</html>
<?php
}
