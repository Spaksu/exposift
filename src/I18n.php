<?php
declare(strict_types=1);

/**
 * Minimal i18n (same scheme as Maskink): source strings are English; other languages are
 * dictionaries mapping the English string to its translation (lang/<code>/*.php, merged).
 * Missing entries fall back to English. Placeholders use {name}.
 */
final class I18n
{
    public const LANGS = ['en' => 'English', 'tr' => 'Türkçe'];
    public const DEFAULT = 'en';
    public const COOKIE = 'exi_lang';

    private static ?string $lang = null;
    private static array $dict = [];

    public static function lang(): string
    {
        if (self::$lang === null) {
            $c = (string)($_COOKIE[self::COOKIE] ?? '');
            self::$lang = isset(self::LANGS[$c]) ? $c : self::DEFAULT;
        }
        return self::$lang;
    }

    /** Full dictionary of the active language (empty for English) */
    public static function dict(?string $lang = null): array
    {
        $lang ??= self::lang();
        if ($lang === 'en') {
            return [];
        }
        if (!isset(self::$dict[$lang])) {
            $d = [];
            foreach (glob(EX_ROOT . '/lang/' . $lang . '/*.php') ?: [] as $f) {
                $part = require $f;
                if (is_array($part)) {
                    $d = $part + $d;
                }
            }
            self::$dict[$lang] = $d;
        }
        return self::$dict[$lang];
    }

    public static function t(string $s, array $vars = []): string
    {
        $d = self::dict();
        $out = ($d !== [] && isset($d[$s]) && $d[$s] !== '') ? $d[$s] : $s;
        if ($vars) {
            $rep = [];
            foreach ($vars as $k => $v) {
                $rep['{' . $k . '}'] = (string)$v;
            }
            $out = strtr($out, $rep);
        }
        return $out;
    }

    public static function locale(): string
    {
        return self::lang() === 'tr' ? 'tr-TR' : 'en-US';
    }
}

function t(string $s, array $vars = []): string
{
    return I18n::t($s, $vars);
}

function te(string $s, array $vars = []): string
{
    return htmlspecialchars(I18n::t($s, $vars), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
