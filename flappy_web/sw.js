const CACHE_NAME = 'bobby-bird-v3';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './assets/characters/bobby.png',
  './assets/characters/bialek.png',
  './assets/characters/deadman.png',
  './assets/characters/krystian.png',
  './assets/characters/johnny.png',
  './assets/characters/kolin.png',
  './assets/characters/kutasa.png',
  './assets/characters/majka.png',
  './assets/characters/reczu.png',
  './assets/characters/szpachl.png',
  './assets/characters/tom.png',
  './assets/collectibles/soundcloud.png',
  './assets/collectibles/nina.png',
  './assets/collectibles/grammy.png',
  './assets/collectibles/diormind.png',
  './assets/collectibles/joint.png',
  './assets/collectibles/strzykawka.png',
  './assets/collectibles/dziecko.png',
  './assets/collectibles/onlyfans.png',
  './assets/collectibles/kutas.png',
  './assets/collectibles/scat.png',
  './assets/collectibles/wozek.png',
  './assets/sounds/music.mp3',
  './assets/sounds/kaching.wav',
  './assets/sounds/mumia.mp3',
  './assets/sounds/7.mp3',
  './assets/sounds/krystian.mp3',
  './assets/sounds/jeopardy.mp3',
  './assets/sounds/voice.mp3',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => Promise.all(
      keyList.map((key) => { if (key !== CACHE_NAME) return caches.delete(key); })
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const networked = fetch(req).then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
          return res;
        }).catch(() => {});
        return cached || networked;
      })
    );
    return;
  }

  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  event.respondWith(
    caches.match(req).then((response) => response || fetch(req))
  );
});
