<?php
declare(strict_types=1);
require __DIR__ . '/src/bootstrap.php';
require __DIR__ . '/src/Settings.php';
require __DIR__ . '/src/Auth.php';
require __DIR__ . '/partials/layout.php';

session_name('exposift');
session_set_cookie_params(['httponly' => true, 'samesite' => 'Strict', 'path' => dirname($_SERVER['SCRIPT_NAME']) ?: '/']);
session_start();
if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}
ex_head(t('Settings'), 'settings');
?>
<meta name="csrf-token" content="<?= h($_SESSION['csrf']) ?>">
<?php if (!Settings::isLocal()): ?>
  <div class="mx-auto mt-6 max-w-xl rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"><?= h(t('Settings can only be used from this computer.')) ?></div>
<?php ex_foot(); return; endif; ?>
<?php if (!Auth::check()): $hasPw = Auth::hasPassword(); ?>
<div class="flex min-h-[60vh] items-center justify-center p-4">
  <form id="authForm" class="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900" data-mode="<?= $hasPw ? 'login' : 'setup' ?>">
    <div class="mb-5 flex items-center gap-3">
      <?= ex_logo('h-10 w-10') ?>
      <div>
        <h1 class="text-base font-semibold"><?= h($hasPw ? t('Admin sign-in') : t('First use: admin password')) ?></h1>
        <p class="text-xs text-slate-500 dark:text-slate-400"><?= h($hasPw ? t('Sign in to manage rules and settings.') : t('Set an admin password to protect the settings (at least 8 characters).')) ?></p>
      </div>
    </div>
    <label class="block text-xs font-medium text-slate-600 dark:text-slate-300"><?= h(t('Password')) ?></label>
    <input type="password" name="password" required minlength="<?= $hasPw ? 1 : 8 ?>" autofocus autocomplete="<?= $hasPw ? 'current-password' : 'new-password' ?>"
      class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-400/30 dark:border-slate-700 dark:bg-slate-800">
    <?php if (!$hasPw): ?>
    <label class="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300"><?= h(t('Password (again)')) ?></label>
    <input type="password" name="password2" required minlength="8" autocomplete="new-password"
      class="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-400/30 dark:border-slate-700 dark:bg-slate-800">
    <?php endif; ?>
    <p id="authErr" class="mt-3 hidden text-xs text-rose-600"></p>
    <button class="mt-5 w-full rounded-lg bg-teal-600 py-2 text-sm font-semibold text-white hover:bg-teal-700"><?= h($hasPw ? t('Sign in') : t('Save password and continue')) ?></button>
  </form>
</div>
<?php ex_foot(['assets/js/auth.js']); return; endif; ?>
<div class="mx-auto flex max-w-[1800px] gap-4 px-4 py-6">
  <aside class="hidden w-52 flex-none lg:block">
    <div class="sticky top-20">
      <nav id="sideNav" class="space-y-0.5 text-sm"></nav>
      <a href="admin-guide.php" class="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><svg class="h-4 w-4 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/></svg><?= h(t('Admin guide')) ?></a>
      <button type="button" id="logoutBtn" class="mt-2 w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"><?= h(t('Sign out')) ?></button>
    </div>
  </aside>
  <div class="min-w-0 flex-1">
    <div class="mb-3 lg:hidden"><select id="mobileNav" class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"></select></div>
    <div id="view" class="min-h-[60vh]"><div class="p-8 text-sm text-slate-400"><?= h(t('Loading…')) ?></div></div>
  </div>
</div>


<!-- Rule editor -->
<dialog id="ruleDlg" class="w-[min(1400px,96vw)] max-w-none rounded-2xl bg-white p-0 text-slate-800 shadow-2xl dark:bg-slate-900 dark:text-slate-200">
  <form method="dialog" id="ruleForm" class="flex max-h-[92vh] flex-col">
    <div class="flex items-center gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
      <h3 id="ruleDlgTitle" class="text-base font-semibold"><?= h(t('Rule')) ?></h3>
      <span id="ruleDlgBadge"></span>
      <button type="button" data-close class="ml-auto rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">✕</button>
    </div>
    <div class="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-2">
      <div id="ruleFields" class="ex-scroll space-y-4 overflow-y-auto border-slate-100 p-5 dark:border-slate-800 lg:border-r"></div>
      <div class="ex-scroll flex min-h-0 flex-col overflow-y-auto p-5">
        <div class="mb-2 flex items-center gap-2">
          <h4 class="text-sm font-semibold"><?= h(t('Live test')) ?></h4>
          <select id="testMode" class="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800">
            <option value="auto"><?= h(t('Mode: auto')) ?></option><option value="log"><?= h(t('Mode: log')) ?></option><option value="script"><?= h(t('Mode: script')) ?></option>
          </select>
          <span id="testStatus" class="ml-auto text-xs text-slate-400"></span>
        </div>
        <textarea id="testSample" spellcheck="false" class="mk-code ex-scroll h-40 w-full flex-none rounded-lg border border-slate-200 bg-slate-50 p-3 focus:border-teal-400 focus:outline-none dark:border-slate-700 dark:bg-slate-800/60" placeholder="<?= h(t('Type sample text to try the rule…')) ?>"></textarea>
        <div id="testOut" class="mt-3 space-y-3 text-xs"></div>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
      <p id="ruleErr" class="hidden text-xs text-rose-600"></p>
      <button type="button" id="ruleResetBtn" class="hidden rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><?= h(t('Restore default')) ?></button>
      <div class="ml-auto flex gap-2">
        <button type="button" data-close class="rounded-md border border-slate-200 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"><?= h(t('Cancel')) ?></button>
        <button type="button" id="ruleSaveBtn" class="rounded-md bg-teal-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-700"><?= h(t('Save')) ?></button>
      </div>
    </div>
  </form>
</dialog>


<?php ex_foot(['assets/mask/pcre.js', 'assets/mask/engine.js', 'assets/mask/seed.js', 'assets/js/core/util.js', 'assets/js/core/detect.js', 'assets/js/core/analyze.js', 'assets/js/core/rules-scan.js', 'assets/js/mask-shim.js', 'assets/js/mask-store.js', 'assets/js/auth.js', 'assets/js/settings.js']);
