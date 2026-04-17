const CACHE_NAME = 'shizuku-v1';
// キャッシュするファイルのリスト（パスに注意！）
const urlsToCache = [
  './',
  './index.html',
  './qr/qrcode.js',
  './qr/qrcode_UTF8.js',
  './app.js',
  './style.css' // CSSファイルがあれば
];

// インストール時にファイルをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

// オフライン時のリクエスト処理
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
