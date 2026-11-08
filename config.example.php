<?php
// Exposift configuration. Copy to config.php (never commit it).
// The browser sends only masked text to api.php, which relays it to the connection chosen here.
return [
    'llm' => [
        'connections' => [
            [
                'id' => 'nvidia', 'name' => 'NVIDIA API', 'type' => 'nvidia',   // nvidia | openai | ollama
                'base_url' => 'https://integrate.api.nvidia.com',
                'api_key' => 'YOUR_KEY',
                'models' => ['nvidia/nemotron-3-ultra-550b-a55b'],
                'timeout' => 300, 'enabled' => true, 'verify_ssl' => true,
            ],
        ],
        'default_model' => 'nvidia:nvidia/nemotron-3-ultra-550b-a55b',
    ],
    'max_chars' => 200000,
];
