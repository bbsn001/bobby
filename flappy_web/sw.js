const CACHE_NAME = 'bobby-bird-v20'; // Wymuszenie naprawy przycisku po zmianach wypchnij na git

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
  './assets/characters/skier_body.png',

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

  './assets/sounds/music.mp3',
  './assets/sounds/music2.mp3',
  './assets/sounds/jeopardy.mp3',
  './assets/sounds/voice.mp3',
  './assets/sounds/kaching.wav',
  './assets/sounds/7.mp3',
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
  './assets/sounds/kolin.mp3',
  './assets/sounds/cwel.mp3',
  './assets/sounds/leci_kurwa.mp3',
  './assets/sounds/wyladowal.mp3',
  './assets/sounds/brawo.mp3',

  './assets/icons/playboy_back.jpg',
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

  // FILTR BEZPIECZEŃSTWA: Ignorujemy wszystko co nie jest GET (np. POST z Socket.io/Firebase)
  if (req.method !== 'GET') {
    return;
  }

  // FILTR HETZNER/FIREBASE: Ignorujemy zapytania do Socket.io i Google APIs
  if (req.url.includes(':3000') || req.url.includes('googleapis')) {
    return;
  }

  // TARCZA NA iOS SAFARI: Jeśli przeglądarka prosi o kawałek pliku audio/video (Range),
  // całkowicie omijamy Service Workera i pozwalamy serwerowi na bezpośrednią obsługę.
  if (req.headers.has('range')) {
    return;
  }

  const url = new URL(req.url);

  // ASSETY ŁADUJEMY Z PAMIĘCI
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

  // KOD GRY Z SIECI
  event.respondWith(
    fetch(req).then((res) => {
      // Klonujemy odpowiedź synchronicznie, zanim powróci do przeglądarki
      const resToCache = res.clone();
      caches.open(CACHE_NAME).then((cache) => {
        cache.put(req, resToCache);
      });
      return res;
    }).catch(() => {
      return caches.match(req);
    })
  );
});
