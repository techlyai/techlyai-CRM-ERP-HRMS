<?php
/**
 * Orbit MMC site switch — put this at the top of index.php, or save it as
 * wp-content/mu-plugins/orbit-site-status.php on WordPress.
 * Caches for 5 minutes, times out after 3 seconds, keeps the last known status on errors.
 */
if (!function_exists('orbit_site_status_check')) {
  function orbit_site_status_check() {
    if (PHP_SAPI === 'cli') return;
    $env = function ($name, $fallback) {
      $v = getenv($name);
      if ($v === false || $v === '') $v = $_SERVER[$name] ?? $_ENV[$name] ?? '';
      return $v !== '' ? $v : $fallback;
    };
    $endpoint = $env('ORBIT_STATUS_URL', 'https://your-orbit-domain.example/api/site-status');
    $key = $env('ORBIT_SITE_KEY', '');
    if ($key === '') return; // not configured: stay online
    $cache = sys_get_temp_dir() . '/orbit-site-status-' . md5($key) . '.json';
    $state = is_readable($cache) ? json_decode((string) @file_get_contents($cache), true) : null;
    if (!is_array($state) || (time() - (int) ($state['at'] ?? 0)) > 300) {
      $ctx = stream_context_create(['http' => [
        'method' => 'GET', 'timeout' => 3, 'ignore_errors' => true,
        'header' => "x-site-key: $key\r\nAccept: application/json\r\n",
      ]]);
      $body = @file_get_contents($endpoint, false, $ctx);
      $code = 0;
      if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) $code = (int) $m[1];
      $json = $body ? json_decode($body, true) : null;
      if ($code === 200 && is_array($json) && array_key_exists('active', $json)) {
        $state = ['active' => (bool) $json['active'], 'at' => time()];
      } else {
        // Fail open: keep the last known status (or stay online) and retry in 5 minutes.
        $state = ['active' => is_array($state) ? (bool) ($state['active'] ?? true) : true, 'at' => time()];
      }
      @file_put_contents($cache, json_encode($state), LOCK_EX);
    }
    if (empty($state['active'])) {
      http_response_code(503);
      header('Retry-After: 3600');
      header('Content-Type: text/html; charset=utf-8');
      header('Cache-Control: no-store');
      echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Site Suspended</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f5fb;color:#1d1b2c}main{max-width:440px;margin:24px;padding:36px 28px;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(40,20,90,.08);text-align:center}h1{margin:0 0 12px;font-size:24px}p{line-height:1.6;color:#555}a{color:#552daa}</style></head><body><main><h1>Site Suspended</h1><p>Site suspended due to pending maintenance payment. Please contact admin.</p><p></p></main></body></html>';
      exit;
    }
  }
  if (!(defined('WP_CLI') && WP_CLI) && !(function_exists('is_admin') && is_admin())) orbit_site_status_check();
}
