// js/state.js
export const PlayerState = {
  nick: '',
  pin: '',
  coins: 0,
  bestScore: 0,
  skiBestScore: 0,
  unlockedSkins: ['bobby'],
  activeSkin: 'bobby',
  stats: { jumps: 0, deaths: 0, spikesHits: 0 },

  // Funkcja pomocnicza do twardego nadpisywania stanu po zalogowaniu
  updateFromFirebase(data) {
    this.coins = data.coins ?? 0;
    this.bestScore = data.score ?? 0;
    this.skiBestScore = data.skiBestScore ?? 0;
    this.unlockedSkins = data.unlockedSkins || ['bobby'];
    this.activeSkin = this.unlockedSkins.includes(data.activeSkin) ? data.activeSkin : 'bobby';
    this.stats = data.stats || { jumps: 0, deaths: 0, spikesHits: 0 };
  }
};

// Stan sesji na potrzeby aktywnej gry (przeliczany przy starcie)
export const SessionState = {
  S_GAP: 175,
  S_SPEED: 2.55,
  S_DOUBLE: false,
  S_EXTRA: false,
  S_INTERVAL: 1750,
  extraLifeAvail: false,
  flashUntil: 0
};
