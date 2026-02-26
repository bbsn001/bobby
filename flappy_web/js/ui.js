// js/ui.js
import { EventEmitter } from './events.js';
import { CHARACTERS, CHAR_KEYS, GAME_CONFIG } from './config.js';
import { PlayerState, SessionState } from './state.js';
import { loadPlayerData, saveProgress, getTopScores, getSkiTopScores, getSpikesTopScores, getPokerTopWinners, getPokerTopLosers } from './firebase.js';

// Usunęliśmy importy wewnętrznych stanów silnika (FlappyMode itp.) - UI już nie steruje logiką gry!
import { stopMusic, stopSpikesAudio } from './audio.js';
import { connectToCasino, joinPokerTable, leavePokerTable, sendPlayerAction, PokerBetState, requestRebuy, sendReadySignal, joinPokerSeat, sendSkinUpdateToServer } from './poker.js';

// ── Referencje DOM ────────────────────────────────────────────────────────────
const nickScreen  = document.getElementById('nickScreen');
const lobbyScreen = document.getElementById('lobbyScreen');
const shopScreen  = document.getElementById('shopScreen');
const statsScreen    = document.getElementById('statsScreen');
const bountiesScreen = document.getElementById('bountiesScreen');
const pokerScreen        = document.getElementById('pokerScreen');
const leaderboardScreen  = document.getElementById('leaderboardScreen');
const pokerChipsEl       = document.getElementById('pokerChips');
const hudEl          = document.getElementById('hud');
const shopCoinsEl    = document.getElementById('shopCoins');
const canvas      = document.getElementById('gameCanvas');

// ── SUBSKRYPCJE ZDARZEŃ (Serce nowego systemu) ────────────────────────────────
let shopReturnTo = null; // Zmienna stanu dla powrotu ze sklepu do gry

EventEmitter.on('UI_NAVIGATE', (payload) => {
  // 1. Zawsze chowaj wszystko na starcie zmiany widoku
  nickScreen.style.display = lobbyScreen.style.display =
  shopScreen.style.display = statsScreen.style.display =
  bountiesScreen.style.display = pokerScreen.style.display =
  leaderboardScreen.style.display =
  canvas.style.display = hudEl.style.display = 'none';

  // 2. Aktywuj odpowiedni widok
  switch (payload.screen) {
    case 'lobby':
      lobbyScreen.style.display = 'flex';
      updateLobbyUI();
      break;
    case 'shop':
      shopScreen.style.display = 'flex';
      shopReturnTo = payload.returnTo || null;
      renderShop();
      break;
    case 'game':
      // Ekran Game to specyficzny przypadek - silnik przechwytuje to zdarzenie i zaczyna pętlę
      canvas.style.display = 'block';
      hudEl.style.display = 'block';
      break;
    case 'stats':
      statsScreen.style.display = 'flex';
      showStatsInternal();
      break;
    case 'bounties':
      bountiesScreen.style.display = 'flex';
      break;
    case 'poker':
      pokerScreen.style.display = 'flex';
      if(payload.data) pokerChipsEl.textContent = `TWOJE ŻETONY: ${payload.data}`;
      break;
    case 'leaderboards':
      leaderboardScreen.style.display = 'flex';
      loadTab('flappy');
      break;
  }
});

// Reaktywność: Kiedy Proxy krzyczy "zmieniły się monety", UI odświeża HUD
EventEmitter.on('STATE_CHANGED:coins', () => _internalUpdateHUD());
EventEmitter.on('STATE_CHANGED:activeSkin', () => updateLobbyUI()); // Lobby odświeża się automatycznie przy zmianie skina

let _currentSessionScore = 0;
EventEmitter.on('GAME_SCORE_UPDATE', (score) => {
  _currentSessionScore = score;
  _internalUpdateHUD();
});


// ── HUD Management ────────────────────────────────────────────────────────────
const hudCoinsEl = document.getElementById('hudCoins');
const hudScoreEl = document.getElementById('hudScore');
const hudHeartEl = document.getElementById('hudHeart');
let _hud_coins = -1, _hud_score = -1, _hud_extra = null;

function _internalUpdateHUD() {
  if (_hud_coins !== PlayerState.coins) {
    _hud_coins = PlayerState.coins;
    hudCoinsEl.textContent = '\uD83C\uDFB5' + PlayerState.coins;
  }
  if (_hud_score !== _currentSessionScore) {
    _hud_score = _currentSessionScore;
    hudScoreEl.textContent = _currentSessionScore;
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

// ── Screen Routing Wewnętrzny ────────────────────────────────────────────────
function showStatsInternal() {
  const container = document.getElementById('statGridContainer');
  if (container) {
    const pnlColor = PlayerState.pokerNetProfit >= 0 ? '#22b422' : '#dc3232';
    const pnlSign = PlayerState.pokerNetProfit > 0 ? '+' : '';

    container.innerHTML = `
      <div class="stat-card"><div class="stat-icon">💀</div><div class="stat-val" style="color:#dc3232">${PlayerState.stats.deaths}</div><div class="stat-label">Zgony</div></div>
      <div class="stat-card"><div class="stat-icon">👆</div><div class="stat-val">${PlayerState.stats.jumps}</div><div class="stat-label">Kliknięcia (Skok)</div></div>
      <div class="stat-card"><div class="stat-icon">🐦</div><div class="stat-val" style="color:#ffd700">${PlayerState.bestScore}</div><div class="stat-label">Max Klasyk</div></div>
      <div class="stat-card"><div class="stat-icon">🔥</div><div class="stat-val" style="color:#ff4500">${PlayerState.spikesBestScore}</div><div class="stat-label">Max Kolce</div></div>
      <div class="stat-card"><div class="stat-icon">🏔️</div><div class="stat-val" style="color:#e0f2fe">${PlayerState.skiBestScore}</div><div class="stat-label">Max Mamut</div></div>
      <div class="stat-card"><div class="stat-icon">🎰</div><div class="stat-val" style="color:${pnlColor}">${pnlSign}${PlayerState.pokerNetProfit}</div><div class="stat-label">P&L Kasyno</div></div>
    `;
  }
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
  connectToCasino();
  EventEmitter.emit('UI_NAVIGATE', { screen: 'lobby' });
}

nickConfirm.addEventListener('click', onNickConfirm);
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

  spikesBtn.style = '';

  if (hasSpikes) {
    spikesBtn.className = 'mode-card red';
    spikesBtn.innerHTML = `
      <div class="mode-icon">🔥</div>
      <div class="mode-title">KOLCE</div>
    `;
  } else if (unlockedChars >= 5) {
    spikesBtn.className = 'mode-card yellow';
    spikesBtn.innerHTML = `
      <div class="mode-icon">🔓</div>
      <div class="mode-title">KUP KOLCE</div>
      <div class="mode-price">🎵 ${GAME_CONFIG.SPIKES_MODE_PRICE}</div>
    `;
  } else {
    spikesBtn.className = 'mode-card dark disabled';
    spikesBtn.innerHTML = `
      <div class="mode-icon">🔒</div>
      <div class="mode-title">KOLCE</div>
      <div class="mode-price">${unlockedChars}/5 postaci</div>
    `;
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
        sendSkinUpdateToServer(key);
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

// ── Bindowanie kliknięć menu (Emisja zdarzeń zamiast bezpośrednich wywołań silnika!) ──
document.getElementById('lobbyPlay').addEventListener('click', () => {
  EventEmitter.emit('GAME_START', 'flappy');
});

document.getElementById('lobbySki').addEventListener('click', () => {
  EventEmitter.emit('GAME_START', 'ski');
});

document.getElementById('lobbySpikes').addEventListener('click', async () => {
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
    // Wymuszenie nadpisania całej tablicy dla poprawnego działania Proxy
    PlayerState.unlockedSkins = [...PlayerState.unlockedSkins, 'spikes'];
    await saveProgress(true);
    updateLobbyUI();
    return;
  }
  EventEmitter.emit('GAME_START', 'spikes');
});

document.getElementById('lobbyShop').addEventListener('click', () => EventEmitter.emit('UI_NAVIGATE', {screen: 'shop'}));
document.getElementById('lobbyStats').addEventListener('click', () => EventEmitter.emit('UI_NAVIGATE', {screen: 'stats'}));
document.getElementById('statsBack').addEventListener('click', () => EventEmitter.emit('UI_NAVIGATE', {screen: 'lobby'}));
document.getElementById('lobbyBounties').addEventListener('click', () => EventEmitter.emit('UI_NAVIGATE', {screen: 'bounties'})); // loadAndRenderBounties z bounties.js obsługuje resztę
document.getElementById('bountiesBack').addEventListener('click', () => EventEmitter.emit('UI_NAVIGATE', {screen: 'lobby'}));
document.getElementById('lobbyLeaderboard').addEventListener('click', () => EventEmitter.emit('UI_NAVIGATE', {screen: 'leaderboards'}));
document.getElementById('leaderboardBack').addEventListener('click', () => EventEmitter.emit('UI_NAVIGATE', {screen: 'lobby'}));
document.getElementById('lobbyPoker').addEventListener('click', () => joinPokerTable());

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

  const now = new Date();
  const day = now.getDay();
  const isWeekend = (day === 0 || day === 6 || (day === 5 && now.getHours() >= 20));

  CHAR_KEYS.forEach(key => {
    const ch       = CHARACTERS[key];
    const owned    = PlayerState.unlockedSkins.includes(key);
    const isActive = PlayerState.activeSkin === key;
    const canBuy   = !owned && PlayerState.coins >= ch.price;
    const ui       = shopUI[key];

    ui.card.className = 'char-card' + (isActive ? ' active-card' : '') + (ch.special ? ' majka-card' : '');

    if (ch.isFomo && !owned) {
      if (isWeekend) {
        ui.card.style.borderColor = '#ff4500';
        ui.card.style.boxShadow = '0 0 15px rgba(255, 69, 0, 0.6)';
        ui.btn.className = 'cc-btn ' + (canBuy ? 'buy' : 'locked');
        ui.btn.innerHTML = canBuy ? `🔥 KUP \uD83C\uDFB5${ch.price}` : `\uD83D\uDD12 ${ch.price}\uD83C\uDFB5`;
        ui.btn.disabled = !canBuy;
      } else {
        ui.card.style.borderColor = '#2a2a6a';
        ui.card.style.boxShadow = 'none';
        ui.card.style.opacity = '0.5';
        ui.btn.className = 'cc-btn locked';
        ui.btn.innerHTML = '🔒 WRÓĆ W WEEKEND';
        ui.btn.disabled = true;
      }
    } else {
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
    // Ważne dla Proxy: Tworzymy nową tablicę
    PlayerState.unlockedSkins = [...PlayerState.unlockedSkins, key];
    PlayerState.activeSkin = key;
  }

  shopActionGuard = true;
  sendSkinUpdateToServer(key);
  // Zgłaszamy zdarzenie zmiany skina (silnik go podsłucha i załaduje nowy asset!)
  EventEmitter.emit('PLAYER_SKIN_UPDATED', key);

  renderShop();
  updateLobbyUI();
  saveProgress(true).finally(() => { shopActionGuard = false; });
}

document.getElementById('shopBack').addEventListener('click', () => {
  if (shopReturnTo) {
    const target = shopReturnTo;
    shopReturnTo = null;
    EventEmitter.emit('GAME_START', target);
  } else {
    EventEmitter.emit('UI_NAVIGATE', {screen: 'lobby'});
  }
});


// ── KASYNO (Binding) ─────────────────────────────────────────────────────────
const pokerExitBtn = document.getElementById('pokerExit');
if (pokerExitBtn) pokerExitBtn.onclick = () => leavePokerTable();

const readyBtn = document.getElementById('pokerReadyBtn');
if (readyBtn) readyBtn.onclick = () => sendReadySignal();

const pokerSitBtn = document.getElementById('pokerSitBtn');
if (pokerSitBtn) pokerSitBtn.onclick = () => joinPokerSeat();

const btnFold = document.getElementById('pokerFold');
if (btnFold) btnFold.onclick = () => sendPlayerAction('fold');

const btnCheck = document.getElementById('pokerCheck');
if (btnCheck) btnCheck.onclick = () => sendPlayerAction('call');

const btnRaise = document.getElementById('pokerRaise');
const raisePanel = document.getElementById('raisePanel');
const raiseValueDisplay = document.getElementById('raiseValueDisplay');
const confirmRaiseVal = document.getElementById('confirmRaiseVal');
const raiseMinDisplay = document.getElementById('raiseMinDisplay');
const raiseMaxDisplay = document.getElementById('raiseMaxDisplay');

let currentRaiseTarget = 0;

function updateRaiseUI(val) {
  currentRaiseTarget = Math.max(PokerBetState.minRaise, Math.min(val, PokerBetState.maxRaise));
  if (raiseValueDisplay) raiseValueDisplay.textContent = currentRaiseTarget;
  if (confirmRaiseVal) confirmRaiseVal.textContent = currentRaiseTarget;
}

function addChipsToRaise(amount) { updateRaiseUI(currentRaiseTarget + amount); }

if (btnRaise) {
  btnRaise.onclick = () => {
    if (raisePanel.style.display === 'none') {
      raisePanel.style.display = 'block';
      if (raiseMinDisplay) raiseMinDisplay.textContent = PokerBetState.minRaise;
      if (raiseMaxDisplay) raiseMaxDisplay.textContent = PokerBetState.maxRaise;
      updateRaiseUI(PokerBetState.minRaise);
    } else {
      raisePanel.style.display = 'none';
    }
  };
}

const btnRaise10    = document.getElementById('btnRaise10');
const btnRaise50    = document.getElementById('btnRaise50');
const btnRaise100   = document.getElementById('btnRaise100');
const btnRaiseAllIn = document.getElementById('btnRaiseAllIn');
const btnRaiseReset = document.getElementById('btnRaiseReset');
const btnConfirmRaise = document.getElementById('btnConfirmRaise');

if (btnRaise10)    btnRaise10.onclick    = () => addChipsToRaise(10);
if (btnRaise50)    btnRaise50.onclick    = () => addChipsToRaise(50);
if (btnRaise100)   btnRaise100.onclick   = () => addChipsToRaise(100);
if (btnRaiseAllIn) btnRaiseAllIn.onclick = () => updateRaiseUI(PokerBetState.maxRaise);
if (btnRaiseReset) btnRaiseReset.onclick = () => updateRaiseUI(PokerBetState.minRaise);

if (btnConfirmRaise) {
  btnConfirmRaise.onclick = () => {
    sendPlayerAction('raise', currentRaiseTarget);
    raisePanel.style.display = 'none';
  };
}

const btnShowRebuy = document.getElementById('btnShowRebuy');
const rebuyModal = document.getElementById('rebuyModal');
const btnCancelRebuy = document.getElementById('btnCancelRebuy');
const btnConfirmRebuy = document.getElementById('btnConfirmRebuy');
const rebuyInput = document.getElementById('rebuyInput');
const rebuyWalletBalance = document.getElementById('rebuyWalletBalance');

if (btnShowRebuy) {
  btnShowRebuy.onclick = () => {
    rebuyWalletBalance.textContent = `🎵 ${PlayerState.coins}`;
    rebuyInput.value = Math.min(500, PlayerState.coins);
    rebuyModal.style.display = 'flex';
  };
}

if (btnCancelRebuy) { btnCancelRebuy.onclick = () => { rebuyModal.style.display = 'none'; }; }

if (btnConfirmRebuy) {
  btnConfirmRebuy.onclick = () => {
    const amt = parseInt(rebuyInput.value);
    if (!isNaN(amt) && amt > 0) {
      if (amt > PlayerState.coins) return alert("Nie masz tyle monet w głównym portfelu!");
      requestRebuy(amt);
      rebuyModal.style.display = 'none';
    } else { alert("Wpisz poprawną, dodatnią kwotę!"); }
  };
}

// ── LOGIKA TABLIC LIDERÓW ────────────────────────────────────────────────────
const lbTabs = document.querySelectorAll('.lb-tab');
const lbContent = document.getElementById('lbContent');
const lbTitle = document.getElementById('lbTitle');

lbTabs.forEach(tab => {
  tab.addEventListener('click', (e) => {
    lbTabs.forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    loadTab(e.target.getAttribute('data-tab'));
  });
});

async function loadTab(tabName) {
  lbContent.innerHTML = '<div style="color:#888; text-align:center; margin-top:20px;">Trwa łączenie z satelitą...</div>';

  if (tabName === 'flappy') {
    lbTitle.textContent = "NAJWIĘCEJ ZESTRZELONYCH MONET";
    const data = await getTopScores();
    renderSimpleList(data, 'score', '🎵');
  } else if (tabName === 'spikes') {
    lbTitle.textContent = "REKORDZIŚCI TRYBU KOLCÓW";
    const data = await getSpikesTopScores();
    renderSimpleList(data, 'spikesBestScore', 'pkt');
  } else if (tabName === 'ski') {
    lbTitle.textContent = "NAJDALSZE SKOKI (MAMUT)";
    const data = await getSkiTopScores();
    renderSimpleList(data, 'skiBestScore', 'pkt');
  } else if (tabName === 'casino') {
    lbTitle.textContent = "KASYNOWE PODZIEMIE";
    const winners = await getPokerTopWinners();
    const losers = await getPokerTopLosers();

    let html = `<div style="color:#22b422; font-weight:bold; font-size:0.9rem; margin-bottom:5px;">👑 REKINY FINANSJERY (NA PLUSIE)</div>`;
    if (winners.length === 0) html += `<div style="color:#666; font-size:0.8rem; margin-bottom:15px;">Brak danych... kasyno zawsze wygrywa.</div>`;
    winners.forEach((w, i) => {
      const color = w.nick === PlayerState.nick ? '#ffd700' : '#fff';
      html += `<div class="lb-row"><div class="lb-rank">${i+1}.</div><div class="lb-nick" style="color:${color}">${w.nick}</div><div class="lb-score" style="color:#22b422">+${w.pokerNetProfit}</div></div>`;
    });

    html += `<div style="color:#dc3232; font-weight:bold; font-size:0.9rem; margin-top:15px; margin-bottom:5px;">🤡 BANKRUCI (NA MINUSIE)</div>`;
    if (losers.length === 0) html += `<div style="color:#666; font-size:0.8rem;">Brak danych... jeszcze.</div>`;
    losers.forEach((l, i) => {
      const color = l.nick === PlayerState.nick ? '#ffd700' : '#fff';
      html += `<div class="lb-row"><div class="lb-rank">${i+1}.</div><div class="lb-nick" style="color:${color}">${l.nick}</div><div class="lb-score" style="color:#dc3232">${l.pokerNetProfit}</div></div>`;
    });

    lbContent.innerHTML = html;
  }
}

function renderSimpleList(dataArray, scoreKey, suffix) {
  if (dataArray.length === 0) {
    lbContent.innerHTML = '<div style="color:#666; text-align:center; margin-top:20px;">Brak wpisów w rejestrze.</div>';
    return;
  }
  let html = '';
  dataArray.forEach((item, index) => {
    const color = item.nick === PlayerState.nick ? '#ffd700' : (index < 3 ? '#fff' : '#aaa');
    html += `
      <div class="lb-row">
        <div class="lb-rank" style="color:${index===0?'#ffd700':index===1?'#c0c0c0':index===2?'#cd7f32':'#666'}">${index+1}.</div>
        <div class="lb-nick" style="color:${color}">${item.nick}</div>
        <div class="lb-score" style="color:${color}">${item[scoreKey]} <span style="font-size:0.7rem; color:#888">${suffix}</span></div>
      </div>
    `;
  });
  lbContent.innerHTML = html;
}

// --- WSPARCIE MYSZKI DLA DESKTOPÓW (Drag to Scroll) ---
const slider = document.getElementById('charPicker');
let isDown = false, startX, scrollLeft;
if (slider) {
  slider.addEventListener('mousedown', (e) => { isDown = true; slider.style.cursor = 'grabbing'; startX = e.pageX - slider.offsetLeft; scrollLeft = slider.scrollLeft; });
  slider.addEventListener('mouseleave', () => { isDown = false; slider.style.cursor = 'auto'; });
  slider.addEventListener('mouseup',    () => { isDown = false; slider.style.cursor = 'auto'; });
  slider.addEventListener('mousemove',  (e) => { if (!isDown) return; e.preventDefault(); const x = e.pageX - slider.offsetLeft; slider.scrollLeft = scrollLeft - (x - startX) * 1.5; });
}

const onlinePinBtn = document.getElementById('onlinePinBtn');
const onlineModal = document.getElementById('onlineModal');
const closeOnlineModal = document.getElementById('closeOnlineModal');

if (onlinePinBtn) onlinePinBtn.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; onlineModal.style.display = 'flex'; });
if (closeOnlineModal) closeOnlineModal.addEventListener('pointerdown', () => { onlineModal.style.display = 'none'; });

