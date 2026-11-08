<?php
declare(strict_types=1);

/** Local settings in data/settings.json (never committed). Only this computer may change them. */
final class Settings
{
    private static ?array $cache = null;
    private static function file(): string { return EX_ROOT . '/data/settings.json'; }

    public static function all(): array
    {
        if (self::$cache === null) {
            $j = is_file(self::file()) ? json_decode((string)file_get_contents(self::file()), true) : null;
            self::$cache = is_array($j) ? $j : [];
        }
        return self::$cache;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return self::all()[$key] ?? $default;
    }

    public static function set(array $kv): void
    {
        $s = array_merge(self::all(), $kv);
        $dir = dirname(self::file());
        if (!is_dir($dir)) { mkdir($dir, 0700, true); }
        file_put_contents(self::file(), json_encode($s, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), LOCK_EX);
        @chmod(self::file(), 0600);
        self::$cache = $s;
    }

    public static function isLocal(): bool
    {
        return in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
    }
}
