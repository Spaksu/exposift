<?php
declare(strict_types=1);
require __DIR__ . '/src/bootstrap.php';
require __DIR__ . '/partials/layout.php';

ex_head(t('Inspect'), 'index');
?>
<div class="mx-auto max-w-[1800px] px-4 py-6">

  <!-- ============================================================ 1. Select -->
  <section id="viewHome" class="mx-auto max-w-4xl">
    <div class="mb-5 text-center">
      <img src="assets/img/logo-wordmark.png?v=<?= (int)@filemtime(__DIR__ . '/assets/img/logo-wordmark.png') ?>" alt="<?= h(EX_APP) ?>" class="mx-auto mb-1 h-20 max-w-full object-contain sm:h-24 dark:hidden">
      <img src="assets/img/logo-wordmark-dark.png?v=<?= (int)@filemtime(__DIR__ . '/assets/img/logo-wordmark-dark.png') ?>" alt="" aria-hidden="true" class="mx-auto mb-1 hidden h-20 max-w-full object-contain sm:h-24 dark:block">
      <h1 class="text-3xl font-bold tracking-tight"><?= h(t('See what is inside a file before you share it.')) ?></h1>
      <p class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300">
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        <?= h(t('The file stays in your browser. Nothing is uploaded.')) ?></p>
    </div>

    <!-- Review mode: chosen before the file, because dropping a file starts the scan. -->
    <div class="mx-auto mb-4 max-w-3xl">
      <div class="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"><?= h(t('How should the document be reviewed?')) ?></div>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="group flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 transition has-[:checked]:border-teal-600 has-[:checked]:ring-2 has-[:checked]:ring-teal-600/20 dark:border-slate-700 dark:bg-slate-900">
          <input type="radio" name="mode" value="quick" checked class="sr-only">
          <span class="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-500 group-has-[:checked]:bg-teal-600 group-has-[:checked]:text-white dark:bg-slate-800">
            <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg></span>
          <span><span class="block text-sm font-semibold"><?= h(t('Quick Scan')) ?></span>
            <span class="block text-xs text-slate-500 dark:text-slate-400"><?= h(t('Finds sensitive values, hidden content and leftovers. No questions asked.')) ?></span></span>
        </label>
        <label class="group flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 transition has-[:checked]:border-teal-600 has-[:checked]:ring-2 has-[:checked]:ring-teal-600/20 dark:border-slate-700 dark:bg-slate-900">
          <input type="radio" name="mode" value="purpose" class="sr-only">
          <span class="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-500 group-has-[:checked]:bg-teal-600 group-has-[:checked]:text-white dark:bg-slate-800">
            <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg></span>
          <span><span class="block text-sm font-semibold"><?= h(t('Purpose-Based Scan')) ?></span>
            <span class="block text-xs text-slate-500 dark:text-slate-400"><?= h(t('Tell Exposift what you are sharing, why and with whom, and it asks whether each finding is really needed.')) ?></span></span>
        </label>
      </div>
      <div id="purposeBox" class="mt-3 hidden grid gap-3 rounded-2xl border border-teal-200 bg-teal-50/50 p-3 sm:grid-cols-3 dark:border-teal-500/30 dark:bg-teal-500/5">
        <label class="text-xs font-medium"><?= h(t('What are you sharing?')) ?>
          <select id="selDoc" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"></select></label>
        <label class="text-xs font-medium"><?= h(t('Why are you sharing it?')) ?>
          <select id="selPurpose" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"></select></label>
        <label class="text-xs font-medium"><?= h(t('Who will receive it?')) ?>
          <select id="selAud" class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"></select></label>
      </div>
    </div>

    <label id="drop" class="ex-drop flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-14 text-center transition dark:border-slate-700 dark:bg-slate-900">
      <svg class="mb-3 h-10 w-10 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 17v-6M9.5 13.5 12 11l2.5 2.5"/></svg>
      <div id="dropTitle" class="text-base font-semibold"><?= h(t('Drop a PDF, Word, Excel or PowerPoint file here')) ?></div>
      <div id="dropSub" class="mt-1 text-sm text-slate-500 dark:text-slate-400"><?= h(t('or click to choose a file')) ?></div>
      <div class="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px]">
        <span class="rounded-full bg-slate-100 px-2.5 py-1 font-medium dark:bg-slate-800">PDF</span>
        <span class="rounded-full bg-slate-100 px-2.5 py-1 font-medium dark:bg-slate-800">DOCX</span>
        <span class="rounded-full bg-slate-100 px-2.5 py-1 font-medium dark:bg-slate-800">XLSX</span>
        <span class="rounded-full bg-slate-100 px-2.5 py-1 font-medium dark:bg-slate-800">PPTX</span>
      </div>
      <input id="file" type="file" class="hidden" accept=".pdf,.docx,.xlsx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation">
    </label>

    <details class="mx-auto mt-5 max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
      <summary class="cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-400"><?= h(t('Advanced options')) ?></summary>
      <div class="mt-3">
        <div>
          <div class="mb-1 text-xs font-medium"><?= h(t('Names or words to look for (optional)')) ?></div>
          <textarea id="names" rows="4" class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="<?= h(t('One per line, for example a person, a project or a customer')) ?>"></textarea>
          <p class="mt-1 text-xs text-slate-500"><?= h(t('Kept only in this page. Letters like ş/s and ı/i are treated as the same.')) ?></p>
        </div>
      </div>
    </details>

    <div class="mt-5 grid gap-3 text-xs text-slate-500 sm:grid-cols-3 dark:text-slate-400">
      <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><b class="block text-slate-700 dark:text-slate-300"><?= h(t('Local only')) ?></b><?= h(t('The file is read by your browser. Nothing is uploaded and no analytics receive its content.')) ?></div>
      <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><b class="block text-slate-700 dark:text-slate-300"><?= h(t('Findings, not verdicts')) ?></b><?= h(t('Every finding shows how sure Exposift is. A number that fits the ID format is not proof that it is a person\'s ID.')) ?></div>
      <div class="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><b class="block text-slate-700 dark:text-slate-300"><?= h(t('Nothing changes without you')) ?></b><?= h(t('Nothing is removed until you choose it. The cleaned file is reopened and checked again.')) ?></div>
    </div>
  </section>

  <!-- ============================================================ busy -->
  <section id="viewBusy" class="mx-auto hidden max-w-md py-24 text-center">
    <svg class="ex-spin mx-auto h-8 w-8 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 3a9 9 0 1 0 9 9" stroke-linecap="round"/></svg>
    <div id="busyText" class="mt-4 text-sm font-medium"></div>
    <div id="busyFile" class="mt-1 text-xs text-slate-500"></div>
  </section>

  <!-- ============================================================ error -->
  <section id="viewError" class="mx-auto hidden max-w-xl py-16">
    <div class="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
      <div class="font-semibold"><?= h(t('This file could not be inspected')) ?></div>
      <p id="errText" class="mt-1 text-sm"></p>
      <button type="button" id="errBack" class="mt-4 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"><?= h(t('Choose another file')) ?></button>
    </div>
  </section>

  <!-- ============================================================ 2-3. Workspace -->
  <section id="viewWork" class="hidden lg:flex-col">
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="min-w-0">
        <div id="wName" class="truncate text-lg font-semibold"></div>
        <div id="wMeta" class="text-xs text-slate-500 dark:text-slate-400"></div>
      </div>
      <ol class="ml-auto flex items-center gap-2 text-xs">
        <li class="rounded-full bg-teal-600 px-3 py-1 font-medium text-white">1 · <?= h(t('Inspect')) ?></li>
        <li class="rounded-full bg-teal-600 px-3 py-1 font-medium text-white">2 · <?= h(t('Review')) ?></li>
        <li class="rounded-full border border-dashed border-slate-300 px-3 py-1 text-slate-400 dark:border-slate-700">3 · <?= h(t('Sanitize')) ?></li>
        <li class="rounded-full border border-dashed border-slate-300 px-3 py-1 text-slate-400 dark:border-slate-700">4 · <?= h(t('Verify')) ?></li>
      </ol>
      <button type="button" id="btnNew" class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"><?= h(t('New file')) ?></button>
    </div>
    <div id="ocrBar" class="mb-4 hidden flex-wrap items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200">
      <span id="ocrText" class="min-w-[14rem] flex-1"></span>
      <button type="button" id="btnOcr" class="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-white hover:bg-violet-700 disabled:opacity-50"><?= h(t('Read text in pictures (OCR)')) ?></button>
    </div>
    <div id="ctxBar" class="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
      <label class="font-medium"><?= h(t('Review mode')) ?>
        <select id="wMode" class="mt-1 block rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950">
          <option value="quick"><?= h(t('Quick Scan')) ?></option><option value="purpose"><?= h(t('Purpose-Based Scan')) ?></option></select></label>
      <span id="wPurpose" class="hidden flex flex-wrap items-end gap-3">
        <label class="font-medium"><?= h(t('Document')) ?><select id="wDoc" class="mt-1 block rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"></select></label>
        <label class="font-medium"><?= h(t('Purpose')) ?><select id="wPurp" class="mt-1 block rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"></select></label>
        <label class="font-medium"><?= h(t('Recipient')) ?><select id="wAud" class="mt-1 block rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"></select></label>
      </span>
      <label class="min-w-[14rem] flex-1 font-medium"><?= h(t('Names or words to look for')) ?>
        <input id="wNames" type="text" placeholder="<?= h(t('separate with commas')) ?>" class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"></label>
      <div id="purposeNote" class="basis-full text-xs text-teal-800 dark:text-teal-300"></div>
    </div>

    <div class="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:grid-rows-[minmax(0,1fr)]">
      <!-- preview -->
      <div class="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:min-h-0">
        <div class="flex items-center gap-1 border-b border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
          <button type="button" data-tab="doc" class="tabBtn rounded-md px-3 py-1 font-medium"><?= h(t('Document')) ?></button>
          <button type="button" data-tab="checks" class="tabBtn rounded-md px-3 py-1 font-medium"><?= h(t('What was checked')) ?></button>
        </div>
        <div id="tabDoc" class="ex-scroll max-h-[calc(100vh-15rem)] min-h-[24rem] lg:max-h-none lg:min-h-0 lg:flex-1 overflow-auto bg-slate-100 p-4 text-sm dark:bg-slate-950/50"></div>
        <div id="tabChecks" class="ex-scroll hidden max-h-[calc(100vh-15rem)] min-h-[24rem] lg:max-h-none lg:min-h-0 lg:flex-1 overflow-auto p-4 text-sm"></div>
      </div>

      <!-- findings -->
      <div class="flex min-w-0 flex-col lg:min-h-0">
        <div id="sumRow" class="mb-3 grid grid-cols-3 gap-2 text-center"></div>
        <div class="mb-3 flex flex-wrap items-center gap-2">
          <div id="clsChips" class="flex flex-wrap gap-1.5"></div>
          <input id="q" type="search" placeholder="<?= h(t('Search findings')) ?>" class="ml-auto w-40 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900">
        </div>
        <div id="list" class="ex-scroll max-h-[calc(100vh-19rem)] space-y-2 lg:max-h-none lg:min-h-0 lg:flex-1 overflow-auto pr-1"></div>
        <div class="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
          <span id="decSum" class="text-slate-600 dark:text-slate-400"></span>
          <button type="button" id="btnRecommend" class="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"><?= h(t('Mark recommended for removal')) ?></button>
          <button type="button" id="btnAsk" class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"><?= h(t('Ask AI (masked)')) ?></button>
          <button type="button" id="btnReport" class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"><?= h(t('Inspection report')) ?></button>
          <button type="button" id="btnContinue" class="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700"><?= h(t('Continue: clean and verify')) ?></button>
        </div>
        <p class="mt-2 text-[11px] text-slate-500 dark:text-slate-400"><?= h(t('Nothing is removed until you press Continue and create the cleaned file. The reports never contain the sensitive values themselves.')) ?></p>
      </div>
    </div>
  </section>

  <!-- ============================================================ AI Gateway -->
  <section id="viewAI" class="mx-auto hidden max-w-4xl">
    <button type="button" id="aiBack" class="mb-3 text-sm text-teal-700 hover:underline dark:text-teal-300">&larr; <?= h(t('Back to findings')) ?></button>
    <h2 class="text-lg font-semibold"><?= h(t('Ask AI without exposing the document')) ?></h2>
    <p class="mb-4 text-sm text-slate-600 dark:text-slate-400"><?= h(t('The visible text is masked in your browser first: names, numbers, addresses and secrets become labels like <PERSON_1>. Only the masked text is sent. The answer comes back with the labels, and your browser puts the real values back.')) ?></p>
    <div id="aiNoCfg" class="hidden mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"><?= h(t('No AI connection is configured. Copy config.example.php to config.php and add one.')) ?></div>
    <div class="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2">
      <label class="block text-xs font-medium"><?= h(t('Model')) ?>
        <select id="aiModel" class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"></select></label>
      <div class="text-xs text-slate-500 dark:text-slate-400" id="aiScope"></div>
      <div class="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm sm:col-span-2" id="aiModes">
        <label class="flex items-center gap-2"><input type="radio" name="aiMode" value="ask" checked class="accent-teal-600"> <?= h(t('Ask a question')) ?></label>
        <label class="flex items-center gap-2"><input type="radio" name="aiMode" value="rewrite" id="aiModeRw" class="accent-teal-600"> <?= h(t('Rewrite the file')) ?></label>
        <span id="aiRwNote" class="text-xs text-slate-500 dark:text-slate-400"></span>
      </div>
      <label class="block text-xs font-medium sm:col-span-2"><span id="aiQLabel"><?= h(t('Your question')) ?></span>
        <textarea id="aiQ" rows="3" class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="<?= h(t('For example: summarize this document in five bullet points.')) ?>"></textarea></label>
      <label class="block text-xs font-medium sm:col-span-2"><?= h(t('Extra values to hide (one per line)')) ?>
        <textarea id="aiExtra" rows="2" class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="<?= h(t('Names, project codes, anything the automatic rules may miss')) ?>"></textarea></label>
      <div class="sm:col-span-2"><button type="button" id="aiMask" class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"><?= h(t('Mask and preview')) ?></button></div>
    </div>
    <div id="aiPrev" class="hidden space-y-3">
      <div class="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div class="mb-2 flex items-center justify-between gap-2"><div class="text-sm font-semibold"><?= h(t('What the model will receive')) ?></div><div id="aiStats" class="text-xs text-slate-500"></div></div>
        <pre id="aiMasked" class="ex-scroll max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-950"></pre>
        <div id="aiItems" class="mt-2 flex flex-wrap gap-1.5 text-[11px]"></div>
      </div>
      <div id="aiRisk" class="hidden rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"></div>
      <div id="aiLeak" class="hidden rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200"></div>
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" id="aiSend" class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"><?= h(t('Send the masked text')) ?></button>
        <span id="aiBusy" class="hidden text-sm text-slate-500"></span>
      </div>
    </div>
    <div id="aiOut" class="mt-4 hidden space-y-3"></div>
  </section>

  <!-- ============================================================ 3-4. Sanitize and verify -->
  <section id="viewOut" class="mx-auto hidden max-w-4xl">
    <div class="mb-4 flex items-center gap-3">
      <button type="button" id="outBack" class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">← <?= h(t('Back to findings')) ?></button>
      <h2 class="text-lg font-semibold"><?= h(t('Clean the file and verify the result')) ?></h2>
    </div>
    <div id="pdfModeNote" class="mb-4 hidden rounded-xl border border-teal-200 bg-teal-50 p-3 text-xs text-teal-900 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-200"></div>
    <div id="planBox" class="mb-4 space-y-3"></div>
    <div class="mb-4 flex items-center gap-3">
      <button type="button" id="btnClean" class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"><?= h(t('Create the cleaned file')) ?></button>
      <span id="cleanBusy" class="hidden text-sm text-slate-500"></span>
    </div>
    <div id="resultBox" class="hidden"></div>
  </section>
</div>
<?php ex_foot([
    'assets/vendor/fflate.js',
    'assets/js/core/util.js',
    'assets/js/core/detect.js',
    'assets/js/core/analyze.js',
    'assets/js/core/plan.js',
    'assets/js/core/rules-scan.js',
    'assets/vendor/pdf-lib.min.js',
    'assets/js/adapters/docx.js',
    'assets/js/adapters/docx-sanitize.js',
    'assets/js/adapters/ooxml.js',
    'assets/js/adapters/ooxml-sanitize.js',
    'assets/js/adapters/pdf.js',
    'assets/js/adapters/pdf-sanitize.js',
    'assets/js/adapters/pdf-redact.js',
    'assets/mask/pcre.js',
    'assets/mask/engine.js',
    'assets/mask/seed.js',
    'assets/js/mask-store.js',
    'assets/js/ocr.js',
    'assets/js/adapters/transform.js',
    'assets/js/app.js',
    'assets/js/ai.js',
]);
