/* sw.js — Pusingan Panen: cache app-shell + CDN libs (offline-first) */
const VERSION = 'pp2-sw-v1.0.4';
const APP_SHELL = [
  './',
  './index.html',
  './assets/style.css',

  // core
  './core/utils.js',
  './core/storage.js',
  './core/router.js',
  './core/api.js',
  './core/sync.js',
  './core/theme.js',
  './core/progress.js',

  // features
  './features/input.js',
  './features/report.js',
  './features/settings.js',
  './features/stats.js',
  './features/sync-view.js',
  './features/users.js',

  // ui (jika ada)
  './ui/toast.js',
  './ui/spinner.js',

  // CDN libs (akan disimpan sebagai opaque response—boleh gagal, kita toleransi)
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
];

// Helper: simpan aman (abaikan jika gagal karena CORS/opaque)
async function safeAddAll(cache, urls){
  for (const u of urls){
    try { await cache.add(u); } catch(e){ /* ignore per item */ }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await safeAddAll(cache, APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => (n !== VERSION ? caches.delete(n) : Promise.resolve())));
    await self.clients.claim();
  })());
});

// Strategi:
// 1) Aset statis (origin yang sama): Cache First, fallback ke network lalu cache.
// 2) CDN (jsdelivr): Stale-While-Revalidate — layani dari cache bila ada; update di belakang.
// 3) API GAS (/exec): Network First; kalau offline → biarkan error asli (supaya UI tahu “offline”).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCDN = /(^|\.)jsdelivr\.net$/.test(url.hostname);

  // Jangan cache panggilan API (Google Apps Script)
  if (/script\.google\.com\/macros\//.test(url.href)) {
    return; // network as-is
  }

  if (isSameOrigin) {
    // Cache First untuk file statis aplikasi
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        // hanya cache sukses
        if (resp && resp.status === 200) cache.put(req, resp.clone());
        return resp;
      } catch (e) {
        // fallback minimal: jika minta HTML root, kembalikan index.html dari cache
        if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
          const indexCached = await cache.match('./index.html');
          if (indexCached) return indexCached;
        }
        throw e;
      }
    })());
    return;
  }

  if (isCDN) {
    // Stale-While-Revalidate untuk CDN
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then((resp) => {
        if (resp && resp.status === 200) cache.put(req, resp.clone());
        return resp;
      }).catch(() => null);
      return cached || fetchPromise || fetch(req);
    })());
    return;
  }

  // default: biarkan request berjalan normal
});

// Terima perintah SKIP_WAITING dari halaman
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
