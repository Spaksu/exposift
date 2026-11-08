<?php
declare(strict_types=1);

/**
 * OpenAI-compatible AI connections (vLLM gateway, Ollama, OpenAI-compatible endpoint).
 * Connections are stored in data/settings.json (key llm_connections) and managed on the Settings screen; config.php provides the defaults.
 * Model ids have the form "<connection id>:<model name>" (e.g. vllm:GPTOSS-120B).
 */
final class Llm
{
    private const CACHE_TTL = 600;

    /** config.php as written (defaults) */
    public static function fileConfig(): array
    {
        $f = EX_ROOT . '/config.php';
        $c = is_file($f) ? (require $f) : [];
        return is_array($c) ? $c : [];
    }

    public static function maxChars(): int
    {
        return max(1000, (int)(Settings::get('ai_max_chars') ?? (self::fileConfig()['max_chars'] ?? 200000)));
    }

    public static function defaultModel(): string
    {
        return (string)(Settings::get('ai_default_model') ?? (self::fileConfig()['llm']['default_model'] ?? ''));
    }

    /** Non-streaming reply (the streaming call collected into one string) */
    public static function chat(string $modelId, array $messages, int $maxTokens = 4096): array
    {
        [$c, $model] = self::resolve($modelId);
        $text = '';
        $r = self::stream($c, $model, $messages, ['max_tokens' => $maxTokens], function (string $type, array $d) use (&$text) {
            if ($type === 'content') { $text .= $d['t']; }
            return true;
        });
        return ['text' => $text, 'usage' => $r['usage'], 'finish' => $r['finish']];
    }
    public const TYPES = [
        'vllm_gateway' => 'vLLM gateway (one path per model)',
        'ollama'       => 'Ollama',
        'openai'       => 'OpenAI compatible (single endpoint)',
        'nvidia'       => 'NVIDIA API (build.nvidia.com)',
    ];

    // ------------------------------------------------------------------ connections

    /** Saved connections (the defaults if none were ever saved) */
    public static function connections(): array
    {
        $list = Settings::get('llm_connections');
        if (!is_array($list)) {
            $list = [];
            foreach ((array)(self::fileConfig()['llm']['connections'] ?? []) as $c) {
                $c['models_mode'] = 'manual';
                $c['models'] = implode("\n", (array)($c['models'] ?? []));
                $list[] = $c;
            }
        }
        return array_values(array_map([self::class, 'normalize'], $list));
    }

    /** Address without a trailing slash; NVIDIA defaults to its hosted API and drops a pasted "/v1" (the type adds it) */
    private static function normalizeBase(array $c): string
    {
        $b = rtrim((string)($c['base_url'] ?? ''), '/');
        if (($c['type'] ?? '') === 'nvidia') {
            $b = preg_replace('#/v1$#', '', $b) ?? $b;
            return $b !== '' ? $b : 'https://integrate.api.nvidia.com';
        }
        return $b;
    }

    private static function normalize(array $c): array
    {
        return [
            'id'          => (string)($c['id'] ?? ''),
            'name'        => (string)($c['name'] ?? ''),
            'type'        => isset(self::TYPES[$c['type'] ?? '']) ? $c['type'] : 'openai',
            'base_url'    => self::normalizeBase($c),
            'api_key'     => (string)($c['api_key'] ?? ''),
            'models_mode' => ($c['models_mode'] ?? 'auto') === 'manual' ? 'manual' : 'auto',
            'models'      => (string)($c['models'] ?? ''),
            'exclude'     => (string)($c['exclude'] ?? ''),
            'order'       => (string)($c['order'] ?? ''),
            'vision'      => (string)($c['vision'] ?? ''),
            'enabled'     => !empty($c['enabled']),
            'verify_ssl'  => !array_key_exists('verify_ssl', $c) || !empty($c['verify_ssl']),
            'timeout'     => max(10, (int)($c['timeout'] ?? 600)),
            'updated'     => (int)($c['updated'] ?? 0),
        ];
    }

    public static function connection(string $id): ?array
    {
        foreach (self::connections() as $c) {
            if ($c['id'] === $id) {
                return $c;
            }
        }
        return null;
    }

    /** Form sent to the Settings screen: the API key is never sent back */
    public static function forAdmin(): array
    {
        return array_map(function ($c) {
            $k = $c['api_key'];
            unset($c['api_key']);
            $c['has_key'] = $k !== '';
            $c['key_hint'] = $k !== '' ? '••••' . substr($k, -4) : '';
            return $c;
        }, self::connections());
    }

    /** Validates and saves a connection from the form; returns the saved form */
    public static function save(array $in, ?string $origId): array
    {
        $list = self::connections();
        $idx = null;
        foreach ($list as $i => $c) {
            if ($origId !== null && $c['id'] === $origId) {
                $idx = $i;
            }
        }
        if ($origId !== null && $idx === null) {
            throw new InvalidArgumentException(t('Connection not found.'));
        }
        $name = trim((string)($in['name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 60) {
            throw new InvalidArgumentException(t('The name must be 1-60 characters.'));
        }
        $url = rtrim(trim((string)($in['base_url'] ?? '')), '/');
        if (!preg_match('#^https?://[^\s/]+#i', $url)) {
            throw new InvalidArgumentException(t('The address must start with http:// or https://.'));
        }
        $type = (string)($in['type'] ?? '');
        if (!isset(self::TYPES[$type])) {
            throw new InvalidArgumentException(t('Invalid connection type.'));
        }
        $mode = ($in['models_mode'] ?? 'auto') === 'manual' ? 'manual' : 'auto';
        $models = str_replace("\r\n", "\n", trim((string)($in['models'] ?? '')));
        if ($mode === 'manual' && $models === '') {
            throw new InvalidArgumentException(t('With a manual model list, enter at least one model name.'));
        }
        $exclude = str_replace("\r\n", "\n", trim((string)($in['exclude'] ?? '')));
        $order = str_replace("\r\n", "\n", trim((string)($in['order'] ?? '')));
        $vision = str_replace("\r\n", "\n", trim((string)($in['vision'] ?? '')));
        foreach ([t('Exclude') => $exclude, t('Order') => $order, t('Vision support') => $vision] as $what => $txt) {
            foreach (self::lines($txt) as $x) {
                if (preg_match('#^/.+/[a-z]*$#', $x) && @preg_match($x, '') === false) {
                    throw new InvalidArgumentException(t('Invalid {what} regex: {x}', ['what' => $what, 'x' => $x]));
                }
            }
        }

        $old = $idx !== null ? $list[$idx] : null;
        if ($old) {
            $id = $old['id'];
        } else {
            $id = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower(strtr($name, ['ı' => 'i', 'İ' => 'i', 'ş' => 's', 'Ş' => 's', 'ğ' => 'g', 'Ğ' => 'g', 'ü' => 'u', 'Ü' => 'u', 'ö' => 'o', 'Ö' => 'o', 'ç' => 'c', 'Ç' => 'c']))), '-') ?: 'baglanti';
            $base = substr($id, 0, 30);
            $id = $base;
            for ($n = 2; self::connection($id) !== null; $n++) {
                $id = $base . '-' . $n;
            }
        }
        $key = (string)($in['api_key'] ?? '');
        if (!empty($in['clear_key'])) {
            $key = '';
        } elseif ($key === '' && $old) {
            $key = $old['api_key'];    // left empty: the current key is kept
        }
        $c = self::normalize([
            'id' => $id, 'name' => $name, 'type' => $type, 'base_url' => $url, 'api_key' => trim($key),
            'models_mode' => $mode, 'models' => $models, 'exclude' => $exclude, 'order' => $order, 'vision' => $vision,
            'enabled' => filter_var($in['enabled'] ?? true, FILTER_VALIDATE_BOOLEAN),
            'verify_ssl' => filter_var($in['verify_ssl'] ?? true, FILTER_VALIDATE_BOOLEAN),
            'timeout' => (int)($in['timeout'] ?? 600), 'updated' => time(),
        ]);
        if ($idx !== null) {
            $list[$idx] = $c;
        } else {
            $list[] = $c;
        }
        self::store($list);
        return $c;
    }

    public static function delete(string $id): void
    {
        $list = array_values(array_filter(self::connections(), fn($c) => $c['id'] !== $id));
        if (count($list) === count(self::connections())) {
            throw new InvalidArgumentException(t('Connection not found.'));
        }
        self::store($list);
    }

    /** Changes the order of the connections (the chat model list follows this order) */
    public static function reorder(array $ids): void
    {
        $list = self::connections();
        $pos = array_flip(array_values(array_map('strval', $ids)));
        if (count($pos) !== count($list) || array_diff(array_column($list, 'id'), array_keys($pos))) {
            throw new InvalidArgumentException(t('The connection list has changed; reload the page.'));
        }
        usort($list, fn($a, $b) => $pos[$a['id']] <=> $pos[$b['id']]);
        self::store($list);
    }

    private static function store(array $list): void
    {
        Settings::set(['llm_connections' => array_values($list)]);
    }

    /** A line can be a model name (case-insensitive) or a /regex/ */
    private static function matches(string $x, string $name): bool
    {
        return preg_match('#^/.+/[a-z]*$#', $x) ? (bool)@preg_match($x, $name) : strcasecmp($x, $name) === 0;
    }

    private static function lines(string $s): array
    {
        return array_values(array_filter(array_map('trim', preg_split('/[\n,]+/', $s)), fn($x) => $x !== '' && $x[0] !== '#'));
    }

    // ------------------------------------------------------------------ modeller

    /** Path segment from a vLLM model name: "Qwen3.8-27B" → "qwen3-8-27b" */
    public static function slug(string $name): string
    {
        return preg_replace('/[._\s]+/', '-', strtolower($name));
    }

    /** Chat models of all enabled connections; unreachable connections are returned in errors */
    public static function models(bool $refresh = false): array
    {
        $models = [];
        $errors = [];
        foreach (self::connections() as $c) {
            if (!$c['enabled']) {
                continue;
            }
            try {
                foreach (self::connectionModels($c, $refresh) as $m) {
                    $models[] = $m;
                }
            } catch (RuntimeException $e) {
                $errors[] = $c['name'] . ': ' . $e->getMessage();
            }
        }
        return ['models' => $models, 'errors' => $errors];
    }

    /** Does the model accept images (screenshots)? */
    public static function supportsVision(array $c, string $model): bool
    {
        try {
            foreach (self::connectionModels($c) as $m) {
                if ($m['name'] === $model) {
                    return !empty($m['vision']);
                }
            }
        } catch (RuntimeException) {
        }
        return false;
    }

    /** Models of a single connection (cached for 10 minutes in auto mode) */
    public static function connectionModels(array $c, bool $refresh = false): array
    {
        // vision support: reported by the endpoint (Ollama "vision") or listed under the connection's "Vision-capable models"
        $vis = self::lines($c['vision']);
        $wrap = fn(string $name, int $ctx = 0, bool $v = false) => ['id' => $c['id'] . ':' . $name, 'provider' => $c['name'], 'conn' => $c['id'], 'name' => $name, 'ctx' => $ctx,
            'vision' => $v || (bool)array_filter($vis, fn($x) => self::matches($x, $name))];
        if ($c['models_mode'] === 'manual') {
            return array_map(fn($n) => $wrap($n), self::lines($c['models']));   // in the order written
        }
        $file = sys_get_temp_dir() . '/exposift_models_' . md5(json_encode($c)) . '.json';
        if (!$refresh && is_file($file) && filemtime($file) > time() - self::CACHE_TTL) {
            $cached = json_decode((string)file_get_contents($file), true);
            if (is_array($cached)) {
                return $cached;
            }
        }
        $found = [];
        if ($c['type'] === 'ollama') {
            try {
                $j = self::getJson($c, $c['base_url'] . '/models');
            } catch (RuntimeException) {
                $j = self::getJson($c, $c['base_url'] . '/api/tags');
            }
            foreach ((array)($j['models'] ?? []) as $m) {
                $caps = (array)($m['capabilities'] ?? ['completion']);
                if (($m['name'] ?? '') !== '' && in_array('completion', $caps, true)) {
                    $found[] = [(string)$m['name'], (int)($m['details']['context_length'] ?? 0), in_array('vision', $caps, true)];
                }
            }
        } else {
            $j = self::getJson($c, $c['base_url'] . (in_array($c['type'], ['vllm_gateway', 'nvidia'], true) ? '/v1/models' : '/models'));
            foreach ((array)($j['data'] ?? []) as $m) {
                if (($m['id'] ?? '') !== '') {
                    $found[] = [(string)$m['id'], (int)($m['max_model_len'] ?? $m['context_length'] ?? 0), false];
                }
            }
        }
        $ex = self::lines($c['exclude']);
        $out = [];
        foreach ($found as [$name, $ctx, $v]) {
            if (preg_match('/embed|(^|[-_])e5([-_]|$)|rerank|whisper/i', $name)) {
                continue;   // sohbet modeli olmayanlar
            }
            foreach ($ex as $x) {
                if (self::matches($x, $name)) {
                    continue 2;
                }
            }
            $out[] = $wrap($name, $ctx, $v);
        }
        // Order: position of the first matching line; unmatched models go last in the endpoint's order
        $ord = self::lines($c['order']);
        if ($ord) {
            $rank = function (string $name) use ($ord) {
                foreach ($ord as $i => $x) {
                    if (self::matches($x, $name)) {
                        return $i;
                    }
                }
                return count($ord);
            };
            $keyed = array_map(fn($m, $i) => [$rank($m['name']), $i, $m], $out, array_keys($out));
            usort($keyed, fn($a, $b) => [$a[0], $a[1]] <=> [$b[0], $b[1]]);
            $out = array_column($keyed, 2);
        }
        @file_put_contents($file, json_encode($out, JSON_UNESCAPED_UNICODE));
        return $out;
    }

    /** Tests a connection before saving: fetches the model list */
    public static function test(array $in, ?string $origId): array
    {
        $old = $origId !== null ? self::connection($origId) : null;
        $key = (string)($in['api_key'] ?? '');
        if ($key === '' && $old && empty($in['clear_key'])) {
            $key = $old['api_key'];
        }
        $c = self::normalize(['id' => 'test'] + $in + ['api_key' => $key]);
        $c['api_key'] = $key;
        if ($c['models_mode'] === 'manual') {
            // with a manual list, a very short request is sent to the first model
            $names = self::lines($c['models']);
            if (!$names) {
                throw new RuntimeException(t('The model list is empty.'));
            }
            self::stream($c, $names[0], [['role' => 'user', 'content' => 'ping']], ['max_tokens' => 1], fn() => true);
            return ['models' => $names, 'vision' => array_column(array_filter(self::connectionModels($c), fn($m) => $m['vision']), 'name'), 'note' => t('{model} responded.', ['model' => $names[0]])];
        }
        $ms = self::connectionModels($c, true);
        return ['models' => array_column($ms, 'name'), 'vision' => array_column(array_filter($ms, fn($m) => $m['vision']), 'name'), 'note' => ''];
    }

    /** @return array{0:array,1:string} [connection, model name] */
    public static function resolve(string $id): array
    {
        [$cid, $name] = array_pad(explode(':', $id, 2), 2, '');
        $c = self::connection($cid);
        if (!$c || $name === '') {
            throw new InvalidArgumentException(t('The selected model is no longer defined. Refresh the model list and choose another model.'));
        }
        if (!$c['enabled']) {
            throw new InvalidArgumentException(t('The {name} connection is disabled.', ['name' => $c['name']]));
        }
        return [$c, $name];
    }

    private static function chatUrl(array $c, string $model): string
    {
        return match ($c['type']) {
            'vllm_gateway' => $c['base_url'] . '/' . self::slug($model) . '/v1/chat/completions',
            'ollama', 'nvidia' => $c['base_url'] . '/v1/chat/completions',
            default        => $c['base_url'] . '/chat/completions',
        };
    }

    // ------------------------------------------------------------------ HTTP

    private static function curl(array $c, string $url, array $headers = []): CurlHandle
    {
        $ch = curl_init($url);
        if ($c['api_key'] !== '') {
            $headers[] = 'Authorization: Bearer ' . $c['api_key'];
        }
        curl_setopt_array($ch, [
            CURLOPT_HTTPHEADER     => array_merge(['Accept: application/json'], $headers),
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_SSL_VERIFYPEER => $c['verify_ssl'],
            CURLOPT_SSL_VERIFYHOST => $c['verify_ssl'] ? 2 : 0,
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        return $ch;
    }

    private static function getJson(array $c, string $url): array
    {
        $ch = self::curl($c, $url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if ($body === false) {
            throw new RuntimeException(curl_error($ch) ?: t('connection error'));
        }
        $j = json_decode((string)$body, true);
        if ($code >= 300 || !is_array($j)) {
            throw new RuntimeException("HTTP $code" . ($code === 302 || $code === 401 || $code === 403 ? ' ' . t('(authorization required – check the API key)') : ''));
        }
        return $j;
    }

    /**
     * Streaming chat request. $emit(string $type, array $data) is called for every chunk
     * (type: content | reasoning); returning false cancels the request.
     * @return array{finish:?string, usage:?array, aborted:bool}
     */
    public static function stream(array $c, string $model, array $messages, array $params, callable $emit): array
    {
        $payload = ['model' => $model, 'messages' => $messages, 'stream' => true]
            + ($c['type'] !== 'ollama' ? ['stream_options' => ['include_usage' => true]] : [])
            + array_filter($params, fn($v) => $v !== null);

        $status = 0;
        $buf = '';
        $errBody = '';
        $finish = null;
        $usage = null;
        $aborted = false;

        $handle = function (string $line) use (&$finish, &$usage, &$aborted, $emit): void {
            $line = rtrim($line, "\r");
            if (!str_starts_with($line, 'data:')) {
                return;
            }
            $data = trim(substr($line, 5));
            if ($data === '' || $data === '[DONE]') {
                return;
            }
            $j = json_decode($data, true);
            if (!is_array($j)) {
                return;
            }
            if (isset($j['error'])) {
                throw new RuntimeException(is_array($j['error']) ? (string)($j['error']['message'] ?? t('Model error')) : (string)$j['error']);
            }
            if (!empty($j['usage'])) {
                $usage = $j['usage'];
            }
            $ch = $j['choices'][0] ?? null;
            if (!$ch) {
                return;
            }
            $d = $ch['delta'] ?? [];
            $r = (string)($d['reasoning_content'] ?? $d['reasoning'] ?? '');
            if ($r !== '' && $emit('reasoning', ['t' => $r]) === false) {
                $aborted = true;
            }
            $t = (string)($d['content'] ?? '');
            if ($t !== '' && $emit('content', ['t' => $t]) === false) {
                $aborted = true;
            }
            if (!empty($ch['finish_reason'])) {
                $finish = (string)$ch['finish_reason'];
            }
        };

        $ch = self::curl($c, self::chatUrl($c, $model), ['Content-Type: application/json', 'Accept: text/event-stream']);
        $exc = null;
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE),
            CURLOPT_TIMEOUT        => $c['timeout'],
            CURLOPT_HEADERFUNCTION => function ($h, string $line) use (&$status) {
                if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                    $status = (int)$m[1];
                }
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION  => function ($h, string $chunk) use (&$buf, &$errBody, &$status, &$aborted, &$exc, $handle) {
                if ($status >= 300) {
                    $errBody .= $chunk;
                    return strlen($chunk);
                }
                $buf .= $chunk;
                try {
                    while (($p = strpos($buf, "\n")) !== false) {
                        $line = substr($buf, 0, $p);
                        $buf = substr($buf, $p + 1);
                        $handle($line);
                    }
                } catch (RuntimeException $e) {
                    $exc = $e;
                    return 0;
                }
                return $aborted ? 0 : strlen($chunk);
            },
        ]);
        $ok = curl_exec($ch);
        $cerr = curl_error($ch);
        if ($exc) {
            throw $exc;
        }
        if ($buf !== '' && $status < 300) {
            $handle($buf);
        }
        if ($status >= 300) {
            $j = json_decode($errBody, true);
            $msg = is_array($j) ? ($j['error']['message'] ?? $j['error'] ?? $j['message'] ?? $j['detail'] ?? '') : '';
            if (is_array($msg)) {
                $msg = json_encode($msg, JSON_UNESCAPED_UNICODE);
            }
            if (in_array($status, [302, 401, 403], true)) {
                $msg = $msg ?: t('This model requires authorization (Settings → AI connections → API key).');
            }
            throw new RuntimeException(t('Model response HTTP {status}', ['status' => $status]) . ($msg !== '' ? ': ' . mb_substr((string)$msg, 0, 400) : ''));
        }
        if ($ok === false && !$aborted) {
            throw new RuntimeException(t('Model connection error:') . ' ' . $cerr);
        }
        return ['finish' => $finish, 'usage' => $usage, 'aborted' => $aborted];
    }
}
