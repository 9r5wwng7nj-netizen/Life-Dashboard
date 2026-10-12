// Offline app shell for the hosted Life Dashboard (index.html registers this on https only).
// Personal data never passes through here: it stays in IndexedDB, and requests to other
// origins (Bible downloads, food search, embeds) are left to the browser.
const CACHE = 'ld-shell-v1';
const SHELL = [
  './index.html',
  './assets/app.css',
  './manifest.webmanifest',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './vendor/lucide/lucide-1.55.0.min.js',
  './vendor/sheetjs/xlsx-0.20.3.full.min.js',
];
const SCOPE = new URL('./', self.location).href, INDEX = SCOPE + 'index.html';
// The app itself changes with every update, so these are fetched fresh when online.
const FRESH = /\/(assets\/app\.css|manifest\.webmanifest)$/;
// Pinned, versioned files never change under the same name.
const PINNED = /\/(vendor|assets\/icons)\//;
const NETWORK_WAIT_MS = 3000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'no-cache' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('ld-shell-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function store(key, res) {
  if (res.ok && res.type === 'basic') await (await caches.open(CACHE)).put(key, res.clone());
  return res;
}

// Latest copy when the network answers in time, otherwise the last copy that loaded.
async function freshFirst(e, key) {
  const cached = await caches.match(key);
  const network = fetch(key, { cache: 'no-cache' }).then(res => store(key, res));
  if (!cached) return network;
  e.waitUntil(network.catch(() => {})); // a slow answer still refreshes the cache for next time
  const late = new Promise(resolve => setTimeout(resolve, NETWORK_WAIT_MS, cached));
  return Promise.race([network.then(res => (res.ok ? res : cached), () => cached), late]);
}

async function cacheFirst(req) {
  return (await caches.match(req)) || fetch(req).then(res => store(req, res));
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const page = url.origin + url.pathname;
  if (page === SCOPE || page === INDEX) e.respondWith(freshFirst(e, INDEX));
  else if (FRESH.test(url.pathname)) e.respondWith(freshFirst(e, page));
  else if (PINNED.test(url.pathname)) e.respondWith(cacheFirst(req));
});
