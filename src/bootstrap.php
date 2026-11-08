<?php
declare(strict_types=1);

define('EX_ROOT', dirname(__DIR__));
define('EX_VERSION', '1.0.0');
define('EX_APP', 'Exposift');

mb_internal_encoding('UTF-8');
date_default_timezone_set('Europe/Istanbul');

require_once __DIR__ . '/I18n.php';

function h(mixed $s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
