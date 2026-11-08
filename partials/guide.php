<?php
declare(strict_types=1);

// Helpers for the guide page (guide.php), in the same style as the other SecAIQ guides.

$GLOBALS['ex_guide_toc'] = [];

/** @param array<string,string> $toc section id => title */
function g_open(string $title, string $lead, array $toc, string $badge = ''): void
{
    $GLOBALS['ex_guide_toc'] = array_flip(array_keys($toc));
    $badge = $badge !== '' ? $badge : t('User guide');
    ?>
<div class="mx-auto flex max-w-[1800px] gap-8 px-4 py-6">
  <aside class="hidden w-60 flex-none lg:block">
    <nav class="sticky top-20 text-sm" id="guideToc">
      <div class="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><?= h(t('Contents')) ?></div>
      <div class="space-y-0.5">
        <?php $i = 0; foreach ($toc as $id => $label): $i++; ?>
          <a href="#<?= h($id) ?>" data-toc="<?= h($id) ?>" class="mk-toc-link"><span class="mk-toc-num"><?= $i ?></span><?= h(t($label)) ?></a>
        <?php endforeach; ?>
      </div>
      <a href="index.php" class="mt-5 flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2.5 text-xs font-semibold text-teal-800 hover:bg-teal-100 dark:border-teal-900/60 dark:bg-teal-500/10 dark:text-teal-300"><?= h(t('Inspect a file')) ?> <span>→</span></a>
    </nav>
  </aside>
  <article class="mk-guide min-w-0 max-w-5xl flex-1">
    <header class="mk-hero">
      <div class="flex items-start gap-4">
        <?= ex_logo('h-12 w-12 flex-none rounded-xl bg-white p-1 shadow') ?>
        <div class="min-w-0">
          <span class="mk-hero-badge"><?= h($badge) ?></span>
          <h1 class="mt-1.5 text-[26px] font-bold leading-tight tracking-tight"><?= h(t($title)) ?></h1>
          <p class="mt-2 max-w-3xl text-[15px] leading-relaxed text-white/85"><?= $lead ?></p>
          <a href="index.php" class="mt-3 inline-block text-sm font-semibold text-white underline-offset-4 hover:underline lg:hidden"><?= h(t('Inspect a file')) ?> →</a>
        </div>
      </div>
    </header>
<?php
}

function g_close(): void
{
    ?>
  </article>
</div>
<script>
  // Contents: highlight the section being read
  (function () {
    var links = {}, heads = document.querySelectorAll('.mk-guide h2[id]');
    document.querySelectorAll('[data-toc]').forEach(function (a) { links[a.dataset.toc] = a; });
    if (!('IntersectionObserver' in window) || !heads.length) return;
    var seen = {};
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { seen[e.target.id] = e.isIntersecting ? e.boundingClientRect.top : undefined; });
      var cur = null;
      heads.forEach(function (h) { if (seen[h.id] !== undefined && cur === null) cur = h.id; });
      if (cur === null) heads.forEach(function (h) { if (h.getBoundingClientRect().top < 120) cur = h.id; });
      Object.keys(links).forEach(function (k) { links[k].classList.toggle('is-active', k === cur); });
    }, { rootMargin: '-64px 0px -55% 0px' });
    heads.forEach(function (h) { io.observe(h); });
  })();
</script>
<?php
}

function g_section(string $id, string $title): void
{
    $n = ($GLOBALS['ex_guide_toc'][$id] ?? 0) + 1;
    echo '<h2 id="' . h($id) . '"><span class="mk-h2-num">' . str_pad((string)$n, 2, '0', STR_PAD_LEFT) . '</span><span>' . h($title) . '</span></h2>';
}

/** Note box: $kind = tip | warn | info */
function g_note(string $html, string $kind = 'info'): void
{
    $label = ['tip' => t('Tip'), 'warn' => t('Caution'), 'info' => t('Note')][$kind] ?? t('Note');
    $icon = [
        'tip'  => '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
        'warn' => '<path d="M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
        'info' => '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    ][$kind] ?? '';
    echo '<div class="mk-note mk-note-' . h($kind) . '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' . $icon . '</svg><div><b>' . $label . '</b> ' . $html . '</div></div>';
}

/** Small coloured chip, e.g. for severities or tokens */
function g_tok(string $text, string $color = '#0d9488'): string
{
    return '<span class="mk-tok mk-code text-[13px]" style="color:' . h($color) . ';background:' . h($color) . '1f">' . h($text) . '</span>';
}

/** Before / after example */
function g_example(string $before, string $after, string $l1 = '', string $l2 = ''): void
{
    echo '<div class="mk-example">'
        . '<div><div class="mk-example-label">' . h($l1 !== '' ? $l1 : t('Before')) . '</div><pre class="mk-pre mk-code">' . h($before) . '</pre></div>'
        . '<div class="mk-example-arrow" aria-hidden="true">→</div>'
        . '<div><div class="mk-example-label mk-example-label-out">' . h($l2 !== '' ? $l2 : t('After')) . '</div><pre class="mk-pre mk-code">' . h($after) . '</pre></div>'
        . '</div>';
}

/** Simple table from rows (first row = header). Cells may contain HTML. */
function g_table(array $rows): void
{
    $head = array_shift($rows);
    echo '<div class="mk-table"><table><thead><tr>';
    foreach ($head as $c) { echo '<th>' . h($c) . '</th>'; }
    echo '</tr></thead><tbody>';
    foreach ($rows as $r) { echo '<tr>'; foreach ($r as $c) { echo '<td>' . $c . '</td>'; } echo '</tr>'; }
    echo '</tbody></table></div>';
}

/** Screenshot figure: assets/img/guide/<name>-<lang>.(png|jpg) */
function g_shot(string $name, string $caption): void
{
    $lang = I18n::lang();
    foreach (['png', 'jpg'] as $ext) {
        $rel = 'assets/img/guide/' . $name . '-' . $lang . '.' . $ext;
        if (is_file(__DIR__ . '/../' . $rel)) {
            echo '<figure class="mk-shot"><a href="' . h($rel) . '" target="_blank" rel="noopener"><img src="' . h($rel) . '" alt="' . h($caption) . '" loading="lazy"></a><figcaption>' . h($caption) . '</figcaption></figure>';
            return;
        }
    }
}
