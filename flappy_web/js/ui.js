// js/ui.js
import { CHARACTERS, CHAR_KEYS, GAME_CONFIG } from './config.js';
import { PlayerState, SessionState } from './state.js';
import { loadPlayerData, saveProgress } from './firebase.js';

// Zaimportujemy te funkcje z silnika w następnym kroku
import { SceneManager, FlappyMode, SpikesMode, SkiJumpMode, applyActiveSkin, computeSessionParams, showGame } from './engine.js';
import { stopMusic, stopSpikesAudio } from './audio.js';

// ── Referencje DOM ────────────────────────────────────────────────────────────
const nickScreen  = document.getElementById('nickScreen');
const lobbyScreen = document.getElementById('lobbyScreen');
const shopScreen  = document.getElementById('shopScreen');
const statsScreen    = document.getElementById('statsScreen');
const bountiesScreen = document.getElementById('bountiesScreen');
const hudEl          = document.getElementById('hud');
const shopCoinsEl    = document.getElementById('shopCoins');
const canvas      = document.getElementById('gameCanvas');

// ── HUD Management ────────────────────────────────────────────────────────────
const hudCoinsEl = document.getElementById('hudCoins');
const hudScoreEl = document.getElementById('hudScore');
const hudHeartEl = document.getElementById('hudHeart');
let _hud_coins = -1, _hud_score = -1, _hud_extra = null;

export function updateHUD(currentScore) {
  if (_hud_coins !== PlayerState.coins) {
    _hud_coins = PlayerState.coins;
    hudCoinsEl.textContent = '\uD83C\uDFB5' + PlayerState.coins;
  }
  if (_hud_score !== currentScore) {
    _hud_score = currentScore;
    hudScoreEl.textContent = currentScore;
    hudScoreEl.style.transform = 'scale(1.3)';
    setTimeout(() => { hudScoreEl.style.transform = 'scale(1)'; }, 100);
  }
  const heartState = SessionState.S_EXTRA ? (SessionState.extraLifeAvail ? '\u2665' : '\u2661') : '';
  if (_hud_extra !== heartState) {
    _hud_extra = heartState;
    hudHeartEl.textContent = heartState;
    hudHeartEl.style.color = (SessionState.S_EXTRA && SessionState.extraLifeAvail) ? '#dc3232' : '#444';
  }
}

// ── Screen Routing ────────────────────────────────────────────────────────────
export function hideAll() {
  nickScreen.style.display = lobbyScreen.style.display =
  shopScreen.style.display = statsScreen.style.display = bountiesScreen.style.display = canvas.style.display =
  hudEl.style.display = 'none';
}

export function showLobby() {
  hideAll();
  lobbyScreen.style.display = 'flex';
  updateLobbyUI();
}

export function showShop() {
  hideAll();
  shopScreen.style.display = 'flex';
  renderShop();
}

export function showStats() {
  hideAll();
  statsScreen.style.display = 'flex';
  document.getElementById('statDeaths').textContent = PlayerState.stats.deaths;
  document.getElementById('statJumps').textContent = PlayerState.stats.jumps;
  document.getElementById('statSpikes').textContent = PlayerState.stats.spikesHits;
}

export function showBounties() {
  hideAll();
  bountiesScreen.style.display = 'flex';
}

// ── Nick Screen Logic ─────────────────────────────────────────────────────────
const nickInput   = document.getElementById('nickInput');
const pinInput    = document.getElementById('pinInput');
const loginError  = document.getElementById('loginError');
const nickConfirm = document.getElementById('nickConfirm');
let nickDone = false;

async function onNickConfirm() {
  if (nickDone) return;
  const val = nickInput.value.trim();
  const pin = pinInput.value.trim();

  if (!val) { nickInput.classList.add('error'); return; }
  if (!pin || pin.length < 4) { pinInput.classList.add('error'); return; }

  nickInput.classList.remove('error');
  pinInput.classList.remove('error');
  loginError.style.display = 'none';

  const res = await loadPlayerData(val, pin);
  if (res.error) { loginError.style.display = 'block'; return; }

  nickDone = true;
  await applyActiveSkin(PlayerState.activeSkin);
  showLobby();
}

nickConfirm.addEventListener('click', onNickConfirm);
nickConfirm.addEventListener('touchend', e => { e.preventDefault(); onNickConfirm(); });
nickInput.addEventListener('keydown', e => { if (e.key === 'Enter') onNickConfirm(); e.stopPropagation(); });

// ── Lobby Logic ───────────────────────────────────────────────────────────────
function updateLobbyUI() {
  document.getElementById('lobbyNick').textContent        = PlayerState.nick;
  document.getElementById('lobbyCoins').textContent       = '\uD83C\uDFB5 ' + PlayerState.coins + ' coin\xF3w';
  document.getElementById('charPreviewName').textContent  = CHARACTERS[PlayerState.activeSkin].name;
  document.getElementById('charPreviewBonus').textContent = CHARACTERS[PlayerState.activeSkin].desc;
  document.getElementById('charPreviewImg').src           = `assets/characters/${CHARACTERS[PlayerState.activeSkin].img || PlayerState.activeSkin+'.png'}`;

  renderCharPicker();

  const spikesBtn = document.getElementById('lobbySpikes');
  const unlockedChars = PlayerState.unlockedSkins.filter(k => CHAR_KEYS.includes(k)).length;
  const hasSpikes = PlayerState.unlockedSkins.includes('spikes');

  spikesBtn.style.display = 'flex';
  if (hasSpikes) {
    spikesBtn.style.background = '#dc3232'; spikesBtn.style.color = '#fff';
    spikesBtn.style.borderColor = '#ff5555'; spikesBtn.style.boxShadow = '0 0 15px #dc323288';
    spikesBtn.textContent = '🔥 GRAJ W TRYB KOLCÓW'; spikesBtn.disabled = false;
  } else if (unlockedChars >= 5) {
    spikesBtn.style.background = '#ffd700'; spikesBtn.style.color = '#0f1432';
    spikesBtn.style.borderColor = '#cca100'; spikesBtn.style.boxShadow = 'none';
    spikesBtn.textContent = `🔓 KUP TRYB KOLCÓW (\uD83C\uDFB5 ${GAME_CONFIG.SPIKES_MODE_PRICE})`; spikesBtn.disabled = false;
  } else {
    spikesBtn.style.background = '#1e1e4a'; spikesBtn.style.color = '#666';
    spikesBtn.style.borderColor = '#333'; spikesBtn.style.boxShadow = 'none';
    spikesBtn.textContent = `🔒 TRYB KOLCÓW (${unlockedChars}/5 postaci)`; spikesBtn.disabled = true;
  }

  const skiBtn = document.getElementById('lobbySki');
  const hasSki = PlayerState.unlockedSkins.includes('skijump');

  skiBtn.style.display = 'flex';
  if (hasSki) {
    skiBtn.style.background = '#e0f2fe'; skiBtn.style.color = '#1e3a8a';
    skiBtn.style.borderColor = '#7dd3fc'; skiBtn.style.boxShadow = '0 0 15px #7dd3fc88';
    skiBtn.textContent = '🏔️ GRAJ W IGRZYSKA';
  } else {
    skiBtn.style.background = '#1e1e4a'; skiBtn.style.color = '#666';
    skiBtn.style.borderColor = '#333'; skiBtn.style.boxShadow = 'none';
    skiBtn.textContent = `🔒 KUP IGRZYSKA (\uD83C\uDFB5 ${GAME_CONFIG.SKI_MODE_PRICE})`;
  }
}

let charPickerInitialized = false;
const charPickerUI = {};

function renderCharPicker() {
  const bar = document.getElementById('charPicker');
  if (!bar) return;

  if (!charPickerInitialized) {
    bar.innerHTML = '';
    CHAR_KEYS.forEach(key => {
      const ch = CHARACTERS[key];
      const wrap = document.createElement('div');
      wrap.style.cssText = 'flex-shrink:0;position:relative;border-radius:8px;touch-action:manipulation;';

      const img = document.createElement('img');
      img.src = `assets/characters/${ch.img || key + '.png'}`;
      img.style.cssText = 'width:50px;height:50px;object-fit:cover;border-radius:6px;display:block;background:#0f1432';

      const lock = document.createElement('div');
      lock.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:16px;pointer-events:none;border-radius:6px;background:rgba(0,0,0,.35)';
      lock.textContent = '\uD83D\uDD12';

      wrap.append(img, lock);

      let pGuard = false;
      async function pickChar(e) {
        if (e) e.preventDefault();
        if (pGuard || PlayerState.activeSkin === key || !PlayerState.unlockedSkins.includes(key)) return;
        pGuard = true;
        PlayerState.activeSkin = key;
        await applyActiveSkin(key);
        updateLobbyUI();
        saveProgress(true).finally(() => { pGuard = false; });
      }
      wrap.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; pickChar(e); });

      bar.appendChild(wrap);
      charPickerUI[key] = { wrap, lock };
    });
    charPickerInitialized = true;
  }

  CHAR_KEYS.forEach(key => {
    const ch     = CHARACTERS[key];
    const owned  = PlayerState.unlockedSkins.includes(key);
    const active = PlayerState.activeSkin === key;
    const ui     = charPickerUI[key];

    // Anty-Clutter: Ukrywamy postacie FOMO w Lobby, jeśli ich nie kupiłeś
    if (ch.isFomo && !owned) {
      ui.wrap.style.display = 'none';
      return;
    } else {
      ui.wrap.style.display = 'block';
    }

    ui.wrap.style.border  = `2px solid ${active ? '#ffd700' : 'transparent'}`;
    ui.wrap.style.opacity = owned ? '1' : '0.4';
    ui.wrap.style.cursor  = owned ? 'pointer' : 'default';
    ui.lock.style.display = owned ? 'none' : 'flex';
  });
}

let lobbyPlayGuard = false;
async function onLobbyPlay() {
  if (lobbyPlayGuard) return;
  lobbyPlayGuard = true;
  computeSessionParams();
  await applyActiveSkin(PlayerState.activeSkin);
  SceneManager.changeScene(FlappyMode);
  showGame();
  setTimeout(() => { lobbyPlayGuard = false; }, 500);
}

async function onLobbySpikes() {
  if (lobbyPlayGuard) return;
  const hasSpikes = PlayerState.unlockedSkins.includes('spikes');
  const unlockedChars = PlayerState.unlockedSkins.filter(k => CHAR_KEYS.includes(k)).length;

  if (!hasSpikes) {
    if (unlockedChars < 5) return;
    if (PlayerState.coins < GAME_CONFIG.SPIKES_MODE_PRICE) {
      document.getElementById('lobbySpikes').style.background = '#dc3232';
      setTimeout(() => updateLobbyUI(), 300);
      return;
    }
    PlayerState.coins -= GAME_CONFIG.SPIKES_MODE_PRICE;
    PlayerState.unlockedSkins.push('spikes');
    await saveProgress(true);
    updateLobbyUI();
    return;
  }

  lobbyPlayGuard = true;
  computeSessionParams();
  await applyActiveSkin(PlayerState.activeSkin);
  SceneManager.changeScene(SpikesMode);
  showGame();
  setTimeout(() => { lobbyPlayGuard = false; }, 500);
}

document.getElementById('lobbyPlay').addEventListener('click', onLobbyPlay);
document.getElementById('lobbyPlay').addEventListener('touchend', e => { e.preventDefault(); onLobbyPlay(); });
document.getElementById('lobbyShop').addEventListener('click', () => showShop());
document.getElementById('lobbyShop').addEventListener('touchend', e => { e.preventDefault(); showShop(); });
document.getElementById('lobbySpikes').addEventListener('click', onLobbySpikes);
document.getElementById('lobbySpikes').addEventListener('touchend', e => { e.preventDefault(); onLobbySpikes(); });

async function onLobbySki() {
  if (lobbyPlayGuard) return;
  const hasSki = PlayerState.unlockedSkins.includes('skijump');

  if (!hasSki) {
    if (PlayerState.coins < GAME_CONFIG.SKI_MODE_PRICE) {
      document.getElementById('lobbySki').style.background = '#dc3232';
      setTimeout(() => updateLobbyUI(), 300);
      return;
    }
    PlayerState.coins -= GAME_CONFIG.SKI_MODE_PRICE;
    PlayerState.unlockedSkins.push('skijump');
    await saveProgress(true);
    updateLobbyUI();
    return;
  }

  lobbyPlayGuard = true;
  computeSessionParams();
  await applyActiveSkin(PlayerState.activeSkin);
  SceneManager.changeScene(SkiJumpMode);
  showGame();
  setTimeout(() => { lobbyPlayGuard = false; }, 500);
}

document.getElementById('lobbySki').addEventListener('click', onLobbySki);
document.getElementById('lobbySki').addEventListener('touchend', e => { e.preventDefault(); onLobbySki(); });
document.getElementById('lobbyStats').addEventListener('click', showStats);
document.getElementById('lobbyStats').addEventListener('touchend', e => { e.preventDefault(); showStats(); });
document.getElementById('statsBack').addEventListener('click', showLobby);
document.getElementById('statsBack').addEventListener('touchend', e => { e.preventDefault(); showLobby(); });

// ── Shop Logic ────────────────────────────────────────────────────────────────
let shopInitialized = false;
const shopUI = {};
let shopActionGuard = false;

function renderShop() {
  shopCoinsEl.textContent = '🎵 ' + PlayerState.coins;
  const grid = document.getElementById('shopGrid');
  if (!grid) return;

  if (!shopInitialized) {
    grid.innerHTML = '';
    CHAR_KEYS.forEach(key => {
      const ch = CHARACTERS[key];
      const card = document.createElement('div');
      const img = document.createElement('img');
      img.src = `assets/characters/${ch.img || key + '.png'}`;
      img.onerror = () => { img.style.opacity = '.3'; };

      const name = document.createElement('div');
      name.className = 'cc-name'; name.textContent = ch.name;

      const bonuses = document.createElement('div');
      bonuses.className = 'cc-bonuses'; bonuses.textContent = ch.desc;

      const btn = document.createElement('button');
      btn.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault(); handleShopAction(key);
      });

      card.append(img, name, bonuses, btn);
      grid.appendChild(card);
      shopUI[key] = { card, btn };
    });
    shopInitialized = true;
  }

  // Definicja Okna Czasowego FOMO (Piątek 20:00 - Niedziela 23:59)
  const now = new Date();
  const day = now.getDay(); // 0 = Niedziela, 5 = Piątek, 6 = Sobota
  const isWeekend = (day === 0 || day === 6 || (day === 5 && now.getHours() >= 20));

  CHAR_KEYS.forEach(key => {
    const ch       = CHARACTERS[key];
    const owned    = PlayerState.unlockedSkins.includes(key);
    const isActive = PlayerState.activeSkin === key;
    const canBuy   = !owned && PlayerState.coins >= ch.price;
    const ui       = shopUI[key];

    ui.card.className = 'char-card' + (isActive ? ' active-card' : '') + (ch.special ? ' majka-card' : '');

    // Logika wyłączności FOMO
    if (ch.isFomo && !owned) {
      if (isWeekend) {
        // Okno otwarte: Agresywne wizualia
        ui.card.style.borderColor = '#ff4500';
        ui.card.style.boxShadow = '0 0 15px rgba(255, 69, 0, 0.6)';
        ui.btn.className = 'cc-btn ' + (canBuy ? 'buy' : 'locked');
        ui.btn.innerHTML = canBuy ? `🔥 KUP \uD83C\uDFB5${ch.price}` : `\uD83D\uDD12 ${ch.price}\uD83C\uDFB5`;
        ui.btn.disabled = !canBuy;
      } else {
        // Okno zamknięte: Twarda blokada
        ui.card.style.borderColor = '#2a2a6a';
        ui.card.style.boxShadow = 'none';
        ui.card.style.opacity = '0.5';
        ui.btn.className = 'cc-btn locked';
        ui.btn.innerHTML = '🔒 WRÓĆ W WEEKEND';
        ui.btn.disabled = true;
      }
    } else {
      // Standardowa logika dla reszty postaci (i kupionych FOMO)
      if (ch.isFomo) { ui.card.style.borderColor = isActive ? '#22b422' : '#ff4500'; ui.card.style.boxShadow = 'none'; ui.card.style.opacity = '1'; }
      ui.btn.className  = 'cc-btn ' + (isActive ? 'active' : owned ? 'select' : canBuy ? 'buy' : 'locked');
      ui.btn.textContent = isActive ? '✓ AKTYWNA' : owned ? 'WYBIERZ' : canBuy ? `KUP \uD83C\uDFB5${ch.price}` : `\uD83D\uDD12 ${ch.price}\uD83C\uDFB5`;
      ui.btn.disabled = isActive || (!owned && !canBuy);
    }
  });
}

function handleShopAction(key) {
  if (shopActionGuard) return;
  const ch = CHARACTERS[key];
  const owned = PlayerState.unlockedSkins.includes(key);

  if (owned) {
    if (PlayerState.activeSkin === key) return;
    PlayerState.activeSkin = key;
  } else {
    if (PlayerState.coins < ch.price) return;
    PlayerState.coins -= ch.price;
    PlayerState.unlockedSkins.push(key);
    PlayerState.activeSkin = key;
  }

  shopActionGuard = true;
  applyActiveSkin(key).then(() => {
    renderShop();
    updateLobbyUI();
    saveProgress(true).finally(() => { shopActionGuard = false; });
  });
}

export let shopFromWaiting = false;
export function setShopFromWaiting(val) { shopFromWaiting = val; }

document.getElementById('shopBack').addEventListener('click', () => {
  if (shopFromWaiting) {
    shopFromWaiting = false;
    computeSessionParams(); SceneManager.changeScene(FlappyMode);
    showGame();
  } else { showLobby(); }
});
document.getElementById('shopBack').addEventListener('touchend', e => {
  e.preventDefault();
  if (shopFromWaiting) { shopFromWaiting = false; computeSessionParams(); SceneManager.changeScene(FlappyMode); showGame(); }
  else showLobby();
});
