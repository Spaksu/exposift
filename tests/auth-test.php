<?php
// Run: php tests/auth-test.php   (uses a temporary directory, never touches data/settings.json)
declare(strict_types=1);
$tmp = sys_get_temp_dir() . '/exposift-auth-' . bin2hex(random_bytes(4));
mkdir($tmp, 0700, true);
define('EX_ROOT', $tmp);
function t(string $s, array $v = []): string { return $s; }
require __DIR__ . '/../src/Settings.php';
require __DIR__ . '/../src/Auth.php';
$_SESSION = [];
$pass = 0; $fail = 0;
function ok(bool $c, string $m): void { global $pass, $fail; if ($c) { $pass++; echo "  ok  $m\n"; } else { $fail++; echo "  FAIL $m\n"; } }
function throws(callable $f): bool { try { $f(); return false; } catch (InvalidArgumentException $e) { return true; } }
// session_regenerate_id needs a started session; run in a CLI-safe way
if (session_status() !== PHP_SESSION_ACTIVE) { @session_start(); }

ok(!Auth::hasPassword(), 'no password at first');
ok(throws(fn() => Auth::setup('short')), 'short password rejected');
Auth::setup('correct horse battery');
ok(Auth::hasPassword(), 'password stored');
ok(strpos((string)file_get_contents($tmp . '/data/settings.json'), 'correct horse') === false, 'plain password is not stored');
ok(Auth::check(), 'setup opens the session');
ok(throws(fn() => Auth::setup('another password 1')), 'setup cannot run twice');
Auth::logout();
ok(!Auth::check(), 'logout closes the session');
$_SESSION['ex_fails'] = 0;
ok(Auth::login('wrong password!') === false, 'wrong password refused');
ok(Auth::login('correct horse battery') === true && Auth::check(), 'right password opens the session');
ok(throws(fn() => Auth::changePassword('nope nope nope', 'new password 123')), 'change needs the current password');
Auth::changePassword('correct horse battery', 'new password 123');
Auth::logout();
ok(Auth::login('new password 123') === true, 'new password works');
$_SESSION['ex_seen'] = time() - 99999;
ok(!Auth::check(), 'idle session expires');
Auth::logout();
$_SESSION['ex_fails'] = 5; $_SESSION['ex_fail_at'] = time();
ok(throws(fn() => Auth::login('new password 123')), 'five failures lock login for a while');
array_map('unlink', glob($tmp . '/data/*')); @rmdir($tmp . '/data'); @rmdir($tmp);
echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
