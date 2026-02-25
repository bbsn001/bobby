const CACHE_NAME = 'bobby-bird-v8';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',

  './js/config.js',
  './js/state.js',
  './js/firebase.js',
  './js/audio.js',
  './js/ui.js',
  './js/engine.js',
  './js/bounties.js',

  // Grafiki postaci
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
  './assets/characters/cwel.png',

  // Grafiki znajdziek
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
  './assets/collectibles/cwel_col.png',

  // Dźwięki Tła
  './assets/sounds/music.mp3',
  './assets/sounds/music2.mp3',
  './assets/sounds/jeopardy.mp3',
  './assets/sounds/voice.mp3',
  './assets/sounds/kaching.wav',
  './assets/sounds/7.mp3',

  // UNIKALNE DŹWIĘKI POSTACI (NOWE)
  './assets/sounds/bobby.mp3',
  './assets/sounds/bialek.mp3',
  './assets/sounds/deadman.mp3',
  './assets/sounds/johnny.mp3',
  './assets/sounds/kutasa.mp3',
  './assets/sounds/majka.mp3',
  './assets/sounds/reczu.mp3',
  './assets/sounds/szpachl.mp3',
  './assets/sounds/tom.mp3',
  './assets/sounds/krystian.mp3',
  './assets/sounds/mumia.mp3',
  './assets/sounds/cwel.mp3',

  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',

  './assets/sounds/leci_kurwa.mp3',
  './assets/sounds/wyladowal.mp3',
  './assets/sounds/brawo.mp3',
  './assets/characters/skier_body.png'
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
