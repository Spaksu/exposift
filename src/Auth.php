<?php
declare(strict_types=1);

/** Password for the Settings screen. The hash lives in data/settings.json; the session is a PHP session. */
final class Auth
{
    public static function hasPassword(): bool { return (string)Settings::get('admin_hash', '') !== ''; }

    public static function minutes(): int { return max(5, (int)Settings::get('session_minutes', 60)); }

    public static function check(): bool
    {
        if (empty($_SESSION['ex_admin'])) { return false; }
        if (time() - (int)($_SESSION['ex_seen'] ?? 0) > self::minutes() * 60) { self::logout(); return false; }
        $_SESSION['ex_seen'] = time();
        return true;
    }

    private static function open(): void
    {
        session_regenerate_id(true);
        $_SESSION['ex_admin'] = true;
        $_SESSION['ex_seen'] = time();
        $_SESSION['ex_fails'] = 0;
    }

    public static function setup(string $pw): void
    {
        if (self::hasPassword()) { throw new InvalidArgumentException(t('The admin password has already been set.')); }
        if (mb_strlen($pw) < 8) { throw new InvalidArgumentException(t('The password must be at least 8 characters.')); }
        Settings::set(['admin_hash' => password_hash($pw, PASSWORD_DEFAULT)]);
        self::open();
    }

    public static function login(string $pw): bool
    {
        $fails = (int)($_SESSION['ex_fails'] ?? 0);
        if ($fails >= 5 && time() - (int)($_SESSION['ex_fail_at'] ?? 0) < 300) {
            throw new InvalidArgumentException(t('Too many failed attempts. Try again in 5 minutes.'));
        }
        $hash = (string)Settings::get('admin_hash', '');
        if ($hash !== '' && password_verify($pw, $hash)) { self::open(); return true; }
        usleep(400000);
        $_SESSION['ex_fails'] = $fails + 1;
        $_SESSION['ex_fail_at'] = time();
        return false;
    }

    public static function logout(): void
    {
        unset($_SESSION['ex_admin'], $_SESSION['ex_seen']);
        session_regenerate_id(true);
    }

    public static function changePassword(string $current, string $new): void
    {
        $hash = (string)Settings::get('admin_hash', '');
        if ($hash === '' || !password_verify($current, $hash)) { throw new InvalidArgumentException(t('Current password is incorrect.')); }
        if (mb_strlen($new) < 8) { throw new InvalidArgumentException(t('The new password must be at least 8 characters.')); }
        Settings::set(['admin_hash' => password_hash($new, PASSWORD_DEFAULT)]);
    }
}
