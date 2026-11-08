<?php
declare(strict_types=1);
require __DIR__ . '/src/bootstrap.php';
require __DIR__ . '/partials/layout.php';
require __DIR__ . '/partials/guide.php';

ex_head(t('How it works'), 'guide');

// The guide text is a separate file per language (guides/user.<lang>.php)
require __DIR__ . '/guides/user.' . (I18n::lang() === 'tr' ? 'tr' : 'en') . '.php';

ex_foot();
