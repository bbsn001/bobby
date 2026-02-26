// js/poker.js
import { EventEmitter } from './events.js';
import { PlayerState } from './state.js';
import { playSound } from './audio.js';

// WBUDOWANY SYNTEZATOR (Zero zależności zewnętrznych - zostawiamy ten świetny patent!)
function playPokerSound(type) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);

    if (type === 'card') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.start(); osc.stop(ctx.currentTime + 0.1);
    } else if (type === 'chip') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2200, ctx.currentTime);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
      osc.start(); osc.stop(ctx.currentTime + 0.05);
    }
  } catch (e) { /* silent fail dla starych przeglądarek */ }
}

// ── STAN LOKALNY KASYNA ───────────────────────────────────────────────────────
export let socket = null;
export const PokerBetState = { minRaise: 0, maxRaise: 0 };
let currentRole = 'none'; // 'none' | 'player' | 'observer'

// ── DOM REFERENCES (Tylko sub-drzewo pokera) ──────────────────────────────────
const pokerStatus = document.getElementById('pokerStatus');
const otherPlayers = document.getElementById('otherPlayers');
const boardCards = document.getElementById('boardCards');
const potContainer = document.getElementById('potContainer');
const myCards = document.getElementById('myCards');
const pokerChips = document.getElementById('pokerChips');
const pokerMyNick = document.getElementById('pokerMyNick');
const actionContainer = document.getElementById('pokerActionContainer');
const readyContainer = document.getElementById('pokerReadyContainer');
const observerContainer = document.getElementById('observerContainer');
const pokerSitBtn = document.getElementById('pokerSitBtn');
const casinoRadar = document.getElementById('casinoRadar');

// Pokazanie wyniku rozdania
const showdownOverlay = document.getElementById('showdownOverlay');
const showdownWinnerName = document.getElementById('showdownWinnerName');
const showdownCards = document.getElementById('showdownCards');
const showdownAmount = document.getElementById('showdownAmount');

// ── LOGIKA SIECIOWA (WebSockets) ──────────────────────────────────────────────
export function connectToCasino() {
  if (socket && socket.connected) return;

  // Zakładamy, że serwer Node.js działa na tym samym IP, port 3000
  const serverUrl = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : `${window.location.protocol}//${window.location.hostname}:3000`;

  socket = io(serverUrl);

  socket.on('connect', () => {
    socket.emit('hello_server', { nick: PlayerState.nick, activeSkin: PlayerState.activeSkin });
    if (casinoRadar) casinoRadar.textContent = '🟢 Kasyno Otwarte';
  });

  socket.on('disconnect', () => {
    if (casinoRadar) casinoRadar.textContent = '🔴 Brak połączenia';
  });

  socket.on('online_radar', (players) => {
    const btnText = document.getElementById('onlineCountText');
    const list = document.getElementById('onlinePlayersList');
    if (btnText) btnText.textContent = `${players.length} ONLINE`;

    if (list) {
      list.innerHTML = players.map(p => `
        <div style="display:flex; align-items:center; gap:10px; background:#131340; padding:8px 12px; border-radius:10px; border:1px solid #2a2a6a;">
          <div style="width:8px; height:8px; background:#22b422; border-radius:50%; box-shadow:0 0 5px #22b422;"></div>
          <img src="assets/characters/${p.activeSkin || 'bobby'}.png" style="width:24px; height:24px; border-radius:4px; object-fit:cover;">
          <div style="color:#fff; font-weight:bold; font-size:0.9rem;">${p.nick}</div>
        </div>
      `).join('');
    }
  });

  socket.on('casino_global_status', (data) => {
    if (!casinoRadar) return;
    casinoRadar.textContent = `Graczy: ${data.playing.length}/${data.max} | Loża: ${data.observers.length}`;
    if (pokerSitBtn) {
      const canSit = data.playing.length < data.max;
      pokerSitBtn.disabled = !canSit;
      pokerSitBtn.textContent = canSit ? 'ZASIĄDŹ DO STOŁU (500 🎵)' : 'BRAK MIEJSC';
    }
  });

  socket.on('table_joined', (data) => {
    currentRole = data.role;
    // Ważne: Zmniejszamy lokalny stan monet, Proxy odświeży HUD!
    if (data.role === 'player') {
      PlayerState.coins = data.newBalance;
    }
    EventEmitter.emit('UI_NAVIGATE', { screen: 'poker', data: data.chips });
  });

  socket.on('seat_joined', (data) => {
    currentRole = 'player';
    PlayerState.coins -= 500; // Opłata za krzesło
    pokerChips.textContent = data.chips;
    observerContainer.style.display = 'none';
    readyContainer.style.display = 'block';
  });

  socket.on('rebuy_success', (data) => {
    PlayerState.coins -= data.amount; // Pobranie lokalne po sukcesie transakcji na backendzie
    playPokerSound('chip');
  });

  socket.on('error_msg', (msg) => {
    alert('KASYNO: ' + msg); // Prosty fallback, można zamienić na własny modal
  });

  socket.on('left_successfully', () => {
    currentRole = 'none';
    EventEmitter.emit('UI_NAVIGATE', { screen: 'lobby' });
  });

  socket.on('your_cards', (cards) => {
    playPokerSound('card');
    myCards.innerHTML = cards.map(c => renderCard(c, true)).join('');
  });

  socket.on('table_update', (data) => {
    renderTable(data);
  });

  socket.on('showdown_result', (data) => {
    handleShowdown(data);
  });
}

// ── WYSYŁANIE ZDARZEŃ DO SERWERA ──────────────────────────────────────────────
export function joinPokerTable() {
  if (!socket || !socket.connected) return alert('Brak połączenia z kasynem!');
  socket.emit('join_table', {
    nick: PlayerState.nick,
    pin: PlayerState.pin,
    activeSkin: PlayerState.activeSkin
  });
}

export function leavePokerTable() {
  if (socket) socket.emit('leave_table');
}

export function joinPokerSeat() {
  if (socket) socket.emit('join_seat');
}

export function requestRebuy(amount) {
  if (socket && socket.connected) {
    socket.emit('add_chips', { amount });
  }
}

export function sendReadySignal() {
  if (socket) socket.emit('set_ready');
}

export function sendPlayerAction(action, amount = 0) {
  if (socket) {
    socket.emit('player_action', { action, amount });
    playPokerSound(action === 'fold' ? 'card' : 'chip');
    actionContainer.style.display = 'none';
  }
}

export function sendSkinUpdateToServer(skin) {
  if (socket && socket.connected) socket.emit('update_skin', skin);
}

// ── RENDEROWANIE WIDOKU KASYNA ──────────────────────────────────────────────
function renderTable(data) {
  pokerStatus.textContent = `FAZA: ${data.phase}`;
  potContainer.textContent = `Pula: ${data.pot}`;
  potContainer.classList.remove('anim-pot');
  void potContainer.offsetWidth; // Force reflow
  potContainer.classList.add('anim-pot');

  if (currentRole === 'observer') {
    observerContainer.style.display = 'block';
    readyContainer.style.display = 'none';
    actionContainer.style.display = 'none';
    pokerMyNick.textContent = PlayerState.nick + ' (WIDZ)';
    pokerChips.textContent = '---';
  } else {
    observerContainer.style.display = 'none';
    pokerMyNick.textContent = PlayerState.nick;
  }

  // Przeciwnicy
  otherPlayers.innerHTML = '';
  const isMyTurn = (data.activePlayerNick === PlayerState.nick);

  data.players.forEach(p => {
    if (p.nick === PlayerState.nick) {
      if (currentRole === 'player') pokerChips.textContent = p.chips;

      if (data.phase === 'IDLE') {
        actionContainer.style.display = 'none';
        readyContainer.style.display = p.isReady ? 'none' : 'block';
        if (p.isReady) pokerStatus.textContent = 'Czekamy na resztę...';
        myCards.innerHTML = '';
      } else {
        readyContainer.style.display = 'none';
        if (isMyTurn && !p.folded && p.chips > 0) {
          actionContainer.style.display = 'block';
          PokerBetState.minRaise = data.currentBet + 10;
          PokerBetState.maxRaise = p.chips;
        } else {
          actionContainer.style.display = 'none';
        }
      }
    } else {
      otherPlayers.appendChild(createPlayerAvatar(p.nick, p.chips, data.activePlayerNick === p.nick, data.phase, p.activeSkin));
    }
  });

  // Karty na stole
  const oldBoardCount = boardCards.children.length;
  if (data.board.length > oldBoardCount) playPokerSound('card');
  boardCards.innerHTML = data.board.map(c => renderCard(c)).join('');
}

function renderCard(c, anim = false) {
  const isRed = c.color === '#dc3232';
  return `
    <div class="playing-card ${isRed ? 'red' : 'black'} ${anim ? 'anim-card' : ''}">
      <div class="card-corner top-left">${c.rank}<br>${c.suit}</div>
      <div class="card-center">${c.suit}</div>
      <div class="card-corner bottom-right">${c.rank}<br>${c.suit}</div>
    </div>
  `;
}

function createPlayerAvatar(nick, chips, isActive, phase, skin) {
  const div = document.createElement('div');
  div.style.cssText = `
    display:flex; flex-direction:column; align-items:center; justify-content:flex-end;
    width: 60px; height: 80px; background: rgba(0,0,0,0.6);
    border: 2px solid ${isActive ? '#ff4500' : '#333'};
    border-radius: 8px; padding: 4px; position: relative;
    transition: all 0.2s;
  `;
  if (isActive) div.classList.add('my-turn');

  const activePhases = ['PRE-FLOP', 'FLOP', 'TURN', 'RIVER'];
  const cardsHtml = activePhases.includes(phase)
    ? `<div style="display:flex; gap:2px; margin-top:2px; justify-content:center;">
         <div class="playing-card-back" style="width:22px; height:32px; border-width:1px; border-radius:3px;"></div>
         <div class="playing-card-back" style="width:22px; height:32px; border-width:1px; border-radius:3px;"></div>
       </div>`
    : '';

  div.innerHTML = `
    <img src="assets/characters/${skin || 'bobby'}.png" onerror="this.src='assets/characters/bobby.png'" style="width: 32px; height: 32px; border-radius: 4px; object-fit: cover; margin-bottom: 2px;">
    <div style="color: #fff; font-size: 0.7rem; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width:100%;">${nick}</div>
    <div style="color: #ffd700; font-size: 0.7rem; font-weight: bold;">${chips}</div>
    ${cardsHtml}
  `;
  return div;
}

function handleShowdown(data) {
  showdownCards.innerHTML = '';
  showdownWinnerName.textContent = data.handName;

  // Rysujemy karty zwycięzców (lub wszystkich do wglądu)
  data.allCards.forEach(playerHand => {
    const handDiv = document.createElement('div');
    handDiv.style.cssText = "background: rgba(255,255,255,0.1); padding: 5px; border-radius: 8px; margin: 0 5px;";
    handDiv.innerHTML = `<div style="color:#fff; font-size:0.8rem; margin-bottom:3px;">${playerHand.nick}</div>
                         <div style="display:flex; gap:3px;">${playerHand.cards.map(c => renderCard(c)).join('')}</div>`;
    showdownCards.appendChild(handDiv);
  });

  const myWin = data.payouts[PlayerState.nick];
  if (myWin) {
    showdownAmount.innerHTML = `<span style="color:#22b422; font-weight:bold; font-size:1.5rem;">+ ${myWin} 🎵</span>`;
    playSound('kaching', 0.8);
    // Sukces! Aktualizujemy portfel. Wcześniej zajmował się tym serwer w Firestore.
    // Teraz też się tym zajmuje, ale my aktualizujemy stan lokalny dla błyskawicznego efektu (Optimistic UI).
    PlayerState.coins += myWin;
  } else {
    showdownAmount.innerHTML = `<span style="color:#aaa;">Brak wygranej</span>`;
  }

  showdownOverlay.style.display = 'flex';

  setTimeout(() => {
    showdownOverlay.style.display = 'none';
  }, 4000);
}
