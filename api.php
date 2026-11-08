<?php
declare(strict_types=1);
// JSON API. Ask AI receives MASKED text only (the browser masks and restores). llm.* manage the AI connections.
// Masking rules and lists are not handled here: they live in the browser (assets/js/mask-store.js).
require __DIR__ . '/src/bootstrap.php';
require __DIR__ . '/src/Settings.php';
require __DIR__ . '/src/Auth.php';
require __DIR__ . '/src/Llm.php';

session_name('exposift');
session_set_cookie_params(['httponly' => true, 'samesite' => 'Strict', 'path' => dirname($_SERVER['SCRIPT_NAME']) ?: '/']);
session_start();
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function out(array $d, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function ok(mixed $data): never { out(['ok' => true, 'data' => $data]); }
function fail(string $msg, int $code = 400): never { out(['ok' => false, 'error' => $msg, 'data' => null], $code); }

if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}
$action = (string)($_GET['action'] ?? '');
$in = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $in = (array)json_decode((string)file_get_contents('php://input'), true);
}
function require_csrf(): void
{
    $sent = (string)($_SERVER['HTTP_X_CSRF'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !hash_equals($_SESSION['csrf'], $sent)) {
        fail(t('Invalid request token. Reload the page.'), 403);
    }
}
function require_local(): void
{
    if (!Settings::isLocal()) { fail(t('Settings can only be changed from this computer.'), 403); }
    require_csrf();
}
/** Settings actions: this computer only, with a valid token, and signed in with the admin password. */
function require_admin(): void
{
    require_local();
    if (!Auth::check()) { fail(t('Sign in to use the settings.'), 401); }
}

try {
    switch ($action) {
        case 'ai.models':
            $r = Llm::models(false);
            out(['csrf' => $_SESSION['csrf'], 'models' => $r['models'], 'errors' => $r['errors'], 'default' => Llm::defaultModel() ?: ($r['models'][0]['id'] ?? '')]);

        case 'ai.chat':
            require_csrf();
            $model = (string)($in['model'] ?? '');
            $system = (string)($in['system'] ?? '');
            $messages = [];
            $total = mb_strlen($system);
            foreach ((array)($in['messages'] ?? []) as $m) {
                $content = (string)($m['content'] ?? '');
                $total += mb_strlen($content);
                $messages[] = ['role' => ($m['role'] ?? '') === 'assistant' ? 'assistant' : 'user', 'content' => $content];
            }
            if (!$messages) { fail('Nothing to send.'); }
            if ($total > Llm::maxChars()) { fail('The text is too long for the AI request (' . $total . ' > ' . Llm::maxChars() . ' characters).', 413); }
            if ($system !== '') { array_unshift($messages, ['role' => 'system', 'content' => $system]); }
            session_write_close();
            out(Llm::chat($model, $messages, min(8192, max(256, (int)($in['max_tokens'] ?? 4096)))));

        case 'chat.models':   // settings screen: default model drop-down
            require_admin();
            $r = Llm::models(!empty($in['refresh']));
            ok(['models' => $r['models'], 'errors' => $r['errors'], 'default' => Llm::defaultModel()]);

        case 'llm.list':
            require_admin();
            ok(['connections' => Llm::forAdmin(), 'types' => array_map('t', Llm::TYPES)]);

        case 'llm.save':
            require_admin();
            Llm::save((array)($in['connection'] ?? []), isset($in['id']) && $in['id'] !== '' ? (string)$in['id'] : null);
            ok(['connections' => Llm::forAdmin()]);

        case 'llm.delete':
            require_admin();
            Llm::delete((string)($in['id'] ?? ''));
            ok(['connections' => Llm::forAdmin()]);

        case 'llm.reorder':
            require_admin();
            Llm::reorder((array)($in['ids'] ?? []));
            ok(['connections' => Llm::forAdmin()]);

        case 'llm.test':
            require_admin();
            try {
                ok(Llm::test((array)($in['connection'] ?? []), isset($in['id']) && $in['id'] !== '' ? (string)$in['id'] : null));
            } catch (RuntimeException $e) {
                fail(t('Connection test failed:') . ' ' . $e->getMessage(), 502);
            }

        case 'ai.settings':   // default model and request limit
            require_admin();
            Settings::set(['ai_default_model' => (string)($in['default_model'] ?? ''), 'ai_max_chars' => max(1000, min(2000000, (int)($in['max_chars'] ?? 200000)))]);
            ok(['default_model' => Llm::defaultModel(), 'max_chars' => Llm::maxChars()]);

        case 'admin.setup':   // first use: set the password (only while none exists)
            require_local();
            Auth::setup((string)($in['password'] ?? ''));
            ok(['signed_in' => true]);

        case 'login':
            require_local();
            if (!Auth::login((string)($in['password'] ?? ''))) { fail(t('Wrong password.'), 401); }
            ok(['signed_in' => true]);

        case 'logout':
            require_csrf();
            Auth::logout();
            ok([]);

        case 'password.change':
            require_admin();
            Auth::changePassword((string)($in['current'] ?? ''), (string)($in['new'] ?? ''));
            ok([]);

        case 'security.get':
            require_admin();
            ok(['session_minutes' => Auth::minutes()]);

        case 'security.save':
            require_admin();
            Settings::set(['session_minutes' => max(5, min(1440, (int)($in['session_minutes'] ?? 60)))]);
            ok(['session_minutes' => Auth::minutes()]);

        case 'ai.settings.read':
            require_admin();
            ok(['default_model' => Llm::defaultModel(), 'max_chars' => Llm::maxChars()]);
    }
    fail('Unknown action.', 404);
} catch (InvalidArgumentException $e) {
    fail($e->getMessage(), 400);
} catch (Throwable $e) {
    fail($e->getMessage(), 502);
}
