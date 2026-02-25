// js/audio.js
// ── Strumienie Tła ───────────────────────────────────────────────────────────
const bgTracks = [
  new Audio('assets/sounds/music.mp3'),
  new Audio('assets/sounds/music2.mp3')
];
bgTracks.forEach(t => { t.volume = 0.3; });
let currentTrack = -1;

bgTracks[0].onended = () => { currentTrack = 1; bgTracks[1].currentTime = 0; bgTracks[1].play().catch(() => {}); };
bgTracks[1].onended = () => { currentTrack = 0; bgTracks[0].currentTime = 0; bgTracks[0].play().catch(() => {}); };

export function startMusic() {
  if (currentTrack !== -1) bgTracks[currentTrack].pause();
  currentTrack = (currentTrack + 1) % bgTracks.length;
  bgTracks[currentTrack].currentTime = 0;
  bgTracks[currentTrack].play().catch(e => console.warn('music blocked:', e));
}
export function stopMusic() { bgTracks.forEach(t => t.pause()); }
export function resumeMusic() { if (currentTrack >= 0) bgTracks[currentTrack].play().catch(() => {}); }

// ── Tryb Spikes ──────────────────────────────────────────────────────────────
const spikesMusic = new Audio('assets/sounds/jeopardy.mp3');
spikesMusic.loop = true; spikesMusic.volume = 0.25;
const spikesVoice = new Audio('assets/sounds/voice.mp3');
spikesVoice.loop = true; spikesVoice.volume = 1.0;

export function startSpikesAudio() {
  spikesMusic.currentTime = 0; spikesMusic.play().catch(() => {});
  spikesVoice.currentTime = 0; spikesVoice.play().catch(() => {});
}
export function stopSpikesAudio() { spikesMusic.pause(); spikesVoice.pause(); }
export function resumeSpikesAudio() { spikesMusic.play().catch(()=>{}); spikesVoice.play().catch(()=>{}); }

// ── Web Audio API (Sfx) ──────────────────────────────────────────────────────
const _AudioContext = window.AudioContext || window.webkitAudioContext;
export const audioCtx = new _AudioContext();
const audioBuffers = {};

export async function loadAudioBuffer(key, url) {
  try {
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    audioBuffers[key] = await audioCtx.decodeAudioData(arr);
  } catch(e) { console.warn('Audio load error:', key, e); }
}

export function playSound(key, vol = 1.0) {
  if (!audioBuffers[key]) return;
  const src = audioCtx.createBufferSource();
  src.buffer = audioBuffers[key];
  const gain = audioCtx.createGain();
  gain.gain.value = vol;
  src.connect(gain);
  gain.connect(audioCtx.destination);
  src.start(0);
}

export const playKaching  = () => playSound('kaching',  0.5);
export const playMumia    = () => playSound('mumia',    1.0);
export const playDzwiek7  = () => playSound('dzwiek7',  1.0);
export const playKrystian = () => playSound('krystian', 1.0);

export function playSpecialSound(sc) {
  if (sc <= 0) return;
  if      (sc % 100 === 0) playKrystian();
  else if (sc % 10  === 0) playMumia();
  else if (sc % 10  === 7) playDzwiek7();
}

// ── Inicjalizacja buforów pamięci RAM (SFX) ──────────────────────────────────
(async function initAudioBuffers() {
  await Promise.all([
    // Fallbacki i stare dźwięki (w razie czego)
    loadAudioBuffer('kaching',  'assets/sounds/kaching.wav'),
    loadAudioBuffer('dzwiek7',  'assets/sounds/7.mp3'),

    // Nowy potężny arsenał dźwiękowy
    loadAudioBuffer('bobby',    'assets/sounds/bobby.mp3'),
    loadAudioBuffer('bialek',   'assets/sounds/bialek.mp3'),
    loadAudioBuffer('deadman',  'assets/sounds/deadman.mp3'),
    loadAudioBuffer('johnny',   'assets/sounds/johnny.mp3'),
    loadAudioBuffer('kutasa',   'assets/sounds/kutasa.mp3'),
    loadAudioBuffer('majka',    'assets/sounds/majka.mp3'),
    loadAudioBuffer('reczu',    'assets/sounds/reczu.mp3'),
    loadAudioBuffer('szpachl',  'assets/sounds/szpachl.mp3'),
    loadAudioBuffer('tom',      'assets/sounds/tom.mp3'),
    loadAudioBuffer('krystian', 'assets/sounds/krystian.mp3'),
    loadAudioBuffer('mumia',    'assets/sounds/mumia.mp3'),
    loadAudioBuffer('cwel',     'assets/sounds/cwel.mp3')
  ]);
  console.log('Audio buffers loaded.');
})();
