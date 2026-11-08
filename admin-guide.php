<?php
declare(strict_types=1);
require __DIR__ . '/src/bootstrap.php';
require __DIR__ . '/partials/layout.php';
require __DIR__ . '/partials/guide.php';

ex_head(t('Admin guide'), 'guide');

// Separate content file per language (guides/admin.<lang>.php)
require __DIR__ . '/guides/admin.' . (I18n::lang() === 'tr' ? 'tr' : 'en') . '.php';

ex_foot();
