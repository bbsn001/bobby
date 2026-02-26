// js/state.js
import { EventEmitter } from './events.js';

/**
 * Prywatny, "surowy" stan. Nigdy nie jest modyfikowany bezpośrednio z zewnątrz.
 */
const rawState = {
  nick: '',
  pin: '',
  coins: 0,
  bestScore: 0,
  skiBestScore: 0,
  spikesBestScore: 0,
  pokerNetProfit: 0,
  unlockedSkins: ['bobby'],
  activeSkin: 'bobby',
  stats: { jumps: 0, deaths: 0, spikesHits: 0 }
};

/**
 * PlayerState jako PROXY.
 * Z zewnątrz zachowuje się jak zwykły obiekt, ale każde przypisanie (set)
 * przechodzi przez poniższą funkcję.
 */
export const PlayerState = new Proxy(rawState, {
  set(target, property, value) {
    const oldValue = target[property];

    // Zmieniamy wartość wewnątrz prywatnego stanu
    target[property] = value;

    // Emitujemy zdarzenie TYLKO, jeśli wartość faktycznie uległa zmianie.
    // (Zapobiega to pętlom renderowania, gdy ktoś zrobi coins = coins)
    if (oldValue !== value) {
      // Globalne zdarzenie dla analityki/debugowania
      EventEmitter.emit('PLAYER_STATE_CHANGED', { property, value, oldValue });

      // Skrócone zdarzenie dla UI, np. 'STATE_CHANGED:coins'
      EventEmitter.emit(`STATE_CHANGED:${property}`, value);
    }

    return true; // Proxy wymaga zwrócenia true przy sukcesie
  }
});

/**
 * Funkcja do twardego nadpisywania stanu po zalogowaniu.
 * Zmodyfikowana, by przypisywać zmienne po kolei – co wyzwoli odpowiednie Eventy!
 */
export function updateStateFromFirebase(data) {
  if (data.coins !== undefined) PlayerState.coins = data.coins;
  if (data.score !== undefined) PlayerState.bestScore = data.score;
  if (data.skiBestScore !== undefined) PlayerState.skiBestScore = data.skiBestScore;
  if (data.spikesBestScore !== undefined) PlayerState.spikesBestScore = data.spikesBestScore;
  if (data.pokerNetProfit !== undefined) PlayerState.pokerNetProfit = data.pokerNetProfit;

  if (data.unlockedSkins) PlayerState.unlockedSkins = data.unlockedSkins;
  if (data.activeSkin && (data.unlockedSkins || ['bobby']).includes(data.activeSkin)) {
    PlayerState.activeSkin = data.activeSkin;
  }

  // W przypadku zagnieżdżonego obiektu proxy nie zadziała automatycznie na jego dzieciach,
  // więc nadpisujemy cały obiekt 'stats'.
  if (data.stats) {
    PlayerState.stats = { ...rawState.stats, ...data.stats };
  }
}

// Stan sesji na potrzeby aktywnej gry (tutaj proxy nie jest na razie konieczne,
// bo to zmienne nietrwałe, niewymagające reakcji UI poza samą pętlą gry)
export const SessionState = {
  S_GAP: 175,
  S_SPEED: 2.55,
  S_DOUBLE: false,
  S_EXTRA: false,
  S_INTERVAL: 1750,
  extraLifeAvail: false,
  flashUntil: 0
};
