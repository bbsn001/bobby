// js/poker.js
import { PlayerState } from './state.js';
import { updateHUD, showLobby, showPoker } from './ui.js';
import { playSound } from './audio.js';

// WBUDOWANY SYNTEZATOR (Zero zależności zewnętrznych)
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
  } catch(e) {}
}

export let socket = null;
export let PokerBetState = { minRaise: 0, maxRaise: 0, pot: 0 };

let lastPot = 0;
let lastBoardCount = 0;
let currentPokerRole = 'player';
let localTableData = null;

// --- ZEGAR ŚMIERCI (Real-Time UI Kicker) ---
setInterval(() => {
  const pokerScreen = document.getElementById('pokerScreen');
  if (!localTableData || !pokerScreen || pokerScreen.style.display === 'none') return;

  // Korekta opóźnień między serwerem a telefonem
  const serverTimeElapsed = Date.now() - localTableData.localReceivedAt;
  const currentServerTime = localTableData.serverNow + serverTimeElapsed;

  // 1. ODLICZANIE W LOBBY (IDLE)
  if (localTableData.phase === 'IDLE') {
    const me = localTableData.players.find(p => p.nick === PlayerState.nick);
    const readyBtn = document.getElementById('pokerReadyBtn');
    if (me && !me.isReady && me.idleSince && readyBtn && !readyBtn.disabled) {
      const left = Math.max(0, 30 - Math.floor((currentServerTime - me.idleSince) / 1000));
      readyBtn.textContent = `✅ JESTEM GOTÓW (${left}s)`;

      if (left <= 5) {
        readyBtn.style.background = '#dc3232'; // Panika na czerwono
        readyBtn.style.color = '#fff';
      } else {
        readyBtn.style.background = '#ffd700'; // Normalny złoty
        readyBtn.style.color = '#0f1432';
      }
    }
  }

  // 2. ODLICZANIE W TRAKCIE GRY (TURA)
  const statusEl = document.getElementById('pokerStatus');
  if (localTableData.phase !== 'IDLE' && localTableData.phase !== 'SHOWDOWN' && localTableData.lastMoveTime && statusEl) {
    const isMyTurn = localTableData.activePlayerNick === PlayerState.nick;
    const left = Math.max(0, 30 - Math.floor((currentServerTime - localTableData.lastMoveTime) / 1000));

    if (isMyTurn) {
      statusEl.textContent = `🔴 TWOJA TURA! (${left}s)`;
      statusEl.style.color = left <= 10 ? '#dc3232' : '#ff4500'; // Ostatnie 10s na czerwono
    } else {
      statusEl.textContent = `RUCH: ${localTableData.activePlayerNick} (${left}s)`;
      statusEl.style.color = '#ffd700';
    }
  }
}, 500); // Odświeżanie 2 razy na sekundę

export function connectToCasino() {
  if (socket) return;
  socket = io('https://bobby-casino.duckdns.org', { transports: ['websocket'] });

  // Natychmiast po połączeniu z Krupierem, meldujemy swoją obecność w aplikacji
  socket.on('connect', () => {
    socket.emit('hello_server', { nick: PlayerState.nick, activeSkin: PlayerState.activeSkin });
  });

  // Nasłuchiwanie na Główny Radar Online
  socket.on('online_radar', (playersList) => {
    const countEl = document.getElementById('onlineCountText');
    const listEl = document.getElementById('onlinePlayersList');
    if (countEl) countEl.textContent = `${playersList.length} ONLINE`;

    if (listEl) {
      listEl.innerHTML = '';
      playersList.forEach(p => {
        const div = document.createElement('div');
        div.style.cssText = "display:flex; align-items:center; gap:12px; background:rgba(0,0,0,0.5); padding:8px 12px; border-radius:8px; border:1px solid #333;";
        div.innerHTML = `
          <img src="assets/characters/${p.activeSkin}.png" onerror="this.src='assets/characters/bobby.png'" style="width:36px; height:36px; border-radius:6px; object-fit:cover; border:1px solid #555;">
          <div style="color:#fff; font-weight:bold; font-size:0.95rem;">${p.nick}</div>
          <div style="margin-left:auto; width:8px; height:8px; background:#22b422; border-radius:50%; box-shadow:0 0 5px #22b422;"></div>
        `;
        listEl.appendChild(div);
      });
    }
  });

  // NOWOŚĆ: Radar Kasyna wyświetlany w Lobby
  socket.on('casino_global_status', (data) => {
    const radar = document.getElementById('casinoRadar');
    if (radar) {
      if (data.playing.length === 0) {
        radar.innerHTML = '<span style="color:#aaa">STÓŁ PUSTY</span>';
      } else {
        if (data.playing.length > 2) {
          radar.innerHTML = `🔥 W GRZE: ${data.playing.length}/${data.max} (${data.playing.slice(0,2).join(', ')}...)`;
        } else {
          radar.innerHTML = `🔥 W GRZE: ${data.playing.join(', ')}`;
        }
      }
    }
  });

  socket.on('table_joined', (data) => {
    PlayerState.coins = data.newBalance;
    currentPokerRole = data.role || 'player';
    updateHUD(PlayerState.bestScore);
    showPoker(data.chips);
  });

  socket.on('seat_joined', (data) => {
    PlayerState.coins -= 500;
    currentPokerRole = 'player';
    updateHUD(PlayerState.bestScore);
    const chipsEl = document.getElementById('pokerChips');
    if (chipsEl) chipsEl.textContent = data.chips;
  });

  socket.on('left_successfully', () => {
    console.log("✅ Krupier potwierdził zwrot. Wracam do lobby.");
    PlayerState.coins += 500;
    updateHUD(PlayerState.bestScore);
    showLobby();
  });

  // ODBIERANIE TWOICH PRYWATNYCH KART
  socket.on('your_cards', (cards) => {
    console.log("Otrzymano karty od krupiera:", cards);
    renderPlayerCards(cards);
  });

  // AKTUALIZACJA STOŁU DLA WSZYSTKICH
  socket.on('table_update', (data) => {
    console.log("Synchronizacja stołu:", data);

    // Zapis do pętli odliczania na żywo
    data.localReceivedAt = Date.now();
    localTableData = data;

    // isMyTurn - potrzebne w bloku 1 i dalej
    const isMyTurn = data.activePlayerNick === PlayerState.nick;

    // 1. Inteligentny widok przycisków (Licytacja vs Gotowość vs Loża Szyderców)
    const actionContainer = document.getElementById('pokerActionContainer');
    const readyContainer = document.getElementById('pokerReadyContainer');
    const observerContainer = document.getElementById('observerContainer');
    const seat0 = document.getElementById('seat-0');
    const statusEl = document.getElementById('pokerStatus');

    if (currentPokerRole === 'observer') {
      if (seat0) seat0.style.display = 'none';
      if (actionContainer) actionContainer.style.display = 'none';
      if (readyContainer) readyContainer.style.display = 'none';
      if (observerContainer) observerContainer.style.display = 'block';

      if (statusEl) {
        statusEl.textContent = `👁️ WIDZOWIE: ${data.numObservers}`;
        statusEl.style.color = '#aaa';
      }

      const sitBtn = document.getElementById('pokerSitBtn');
      if (sitBtn) {
        if (data.players.length < data.maxPlayers) {
          sitBtn.disabled = false;
          sitBtn.textContent = '🪑 USIĄDŹ DO STOŁU (500)';
          sitBtn.style.background = '#ffd700';
          sitBtn.style.color = '#0f1432';
        } else {
          sitBtn.disabled = true;
          sitBtn.textContent = 'STÓŁ PEŁNY';
          sitBtn.style.background = '#555';
          sitBtn.style.color = '#aaa';
        }
      }
    } else {
      if (seat0) seat0.style.display = 'flex';
      if (observerContainer) observerContainer.style.display = 'none';

      if (statusEl) {
        statusEl.textContent = isMyTurn ? '🔴 TWOJA TURA!' : `RUCH: ${data.activePlayerNick}`;
        statusEl.style.color = isMyTurn ? '#ff4500' : '#ffd700';
      }

      const readyBtn = document.getElementById('pokerReadyBtn');
      if (data.phase === 'IDLE') {
        if (actionContainer) actionContainer.style.display = 'none';
        if (readyContainer) readyContainer.style.display = 'block';

        const me = data.players.find(p => p.nick === PlayerState.nick);
        if (me && me.isReady) {
          if (readyBtn) {
            readyBtn.textContent = '⏳ CZEKANIE NA INNYCH...';
            readyBtn.style.background = '#555'; readyBtn.style.color = '#aaa';
            readyBtn.style.boxShadow = 'none'; readyBtn.disabled = true;
          }
        } else {
          if (readyBtn) {
            readyBtn.textContent = '✅ JESTEM GOTÓW';
            readyBtn.style.background = '#ffd700'; readyBtn.style.color = '#0f1432';
            readyBtn.style.boxShadow = '0 4px 10px rgba(255,215,0,0.3)'; readyBtn.disabled = false;
          }
        }
      } else {
        if (actionContainer) actionContainer.style.display = 'block';
        if (readyContainer) readyContainer.style.display = 'none';
      }
    }

    // 2. Aktualizacja puli z animacją i dźwiękiem
    const potEl = document.getElementById('potContainer');
    if (potEl) {
      potEl.textContent = `Pula: ${data.pot}`;
      if (data.pot > lastPot) {
        potEl.classList.remove('anim-pot');
        void potEl.offsetWidth; // Wymuszenie resetu animacji przeglądarki
        potEl.classList.add('anim-pot');
        playPokerSound('chip');
      }
    }
    lastPot = data.pot;

    // 3. Twarde blokowanie przycisków akcji
    const btnFold  = document.getElementById('pokerFold');
    const btnCheck = document.getElementById('pokerCheck');
    const btnRaise = document.getElementById('pokerRaise');
    const activePhases = ['PRE-FLOP', 'FLOP', 'TURN', 'RIVER'];
    const canAct = isMyTurn && activePhases.includes(data.phase);
    if (btnFold)  { btnFold.disabled  = !canAct; btnFold.style.opacity  = canAct ? '1' : '0.4'; }
    if (btnCheck) { btnCheck.disabled = !canAct; btnCheck.style.opacity = canAct ? '1' : '0.4'; }
    if (btnRaise) { btnRaise.disabled = !canAct; btnRaise.style.opacity = canAct ? '1' : '0.4'; }

    // 4. Renderowanie graczy
    const otherPlayersEl = document.getElementById('otherPlayers');
    if (otherPlayersEl) {
      otherPlayersEl.innerHTML = '';
      data.players.forEach(p => {
        if (p.nick === PlayerState.nick) return;

        const isHisTurn = (p.nick === data.activePlayerNick);
        const isIdle = data.phase === 'IDLE';
        const pEl = document.createElement('div');
        pEl.className = isHisTurn ? 'my-turn' : '';
        pEl.style.cssText = "display:flex; flex-direction:column; align-items:center; gap:5px; transition:all 0.2s; position:relative;";

        const actionBubble = p.lastAction
          ? `<div style="position:absolute; top:-25px; left:50%; transform:translateX(-50%); background:#fff; color:#000; padding:2px 8px; border-radius:8px; font-weight:bold; font-size:0.75rem; box-shadow:0 2px 5px rgba(0,0,0,0.5); z-index:10; white-space:nowrap; animation: pot-bounce 0.3s ease-out;">💬 ${p.lastAction}</div>`
          : '';

        const cardsHtml = (!isIdle && data.phase !== 'SHOWDOWN')
          ? `<div style="display:flex; gap:0px; margin-top:-18px; z-index:1; position:relative;">
               <div class="playing-card-back" style="width:30px; height:45px; border-width:1px; border-radius:4px; transform: rotate(-8deg) translateX(4px); box-shadow: -2px 2px 5px rgba(0,0,0,0.5);"></div>
               <div class="playing-card-back" style="width:30px; height:45px; border-width:1px; border-radius:4px; transform: rotate(8deg) translateX(-4px); box-shadow: 2px 2px 5px rgba(0,0,0,0.5);"></div>
             </div>`
          : `<div style="height:27px;"></div>`;

        // OSTATECZNA ELIMINACJA 404!
        const safeSkin = (p.activeSkin && p.activeSkin !== 'undefined' && p.activeSkin !== 'null') ? p.activeSkin : 'bobby';

        // Logika szarego filtru i ptaszka (AFK)
        const grayFilter = (isIdle && !p.isReady) ? 'filter: grayscale(1) opacity(0.5);' : '';
        const readyBadge = (isIdle && p.isReady)
          ? `<div style="position:absolute; top:-5px; right:-5px; background:#22b422; border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; font-size:12px; border:2px solid #fff; z-index:10; box-shadow:0 2px 5px rgba(0,0,0,0.5);">✅</div>`
          : '';

        pEl.innerHTML = `
          ${actionBubble}
          <div style="font-weight:900; font-size:0.85rem; color:#fff; text-shadow:1px 1px 3px #000; background:rgba(0,0,0,0.7); padding:3px 10px; border-radius:10px; margin-bottom: 5px; z-index: 3;">${p.nick}</div>
          <div style="position:relative; z-index: 2;">
            ${readyBadge}
            <img src="assets/characters/${safeSkin}.png" onerror="this.src='assets/characters/bobby.png'" style="width: 65px; height: 65px; border-radius: 12px; border: 2px solid ${isHisTurn ? '#ff4500' : '#555'}; object-fit:cover; box-shadow:0 4px 10px rgba(0,0,0,0.7); background: #000; transition: all 0.3s; ${grayFilter}">
            <div style="position:absolute; bottom:-12px; left:50%; transform:translateX(-50%); background:#000; padding:2px 10px; border-radius:12px; border:2px solid #ffd700; font-size:0.8rem; color:#ffd700; font-weight:bold; white-space:nowrap; z-index: 4;">${p.chips}</div>
          </div>
          ${cardsHtml}
        `;
        otherPlayersEl.appendChild(pEl);
      });
    }

    // Aktualizacja własnego seat-0 z animacją tury i dymkiem
    data.players.forEach(p => {
      if (p.nick !== PlayerState.nick) return;
      const isActive = p.nick === data.activePlayerNick;
      const isIdle = data.phase === 'IDLE';
      const nickEl = document.getElementById('pokerMyNick');
      const chipsEl = document.getElementById('pokerChips');

      // ✅ przy nicku gdy gotowy
      if (nickEl) nickEl.innerHTML = (isIdle && p.isReady) ? `✅ ${p.nick}` : p.nick;
      if (chipsEl) chipsEl.textContent = p.chips;

      const mySeatWrapper = document.getElementById('seat-0')?.lastElementChild;
      if (mySeatWrapper) {
        if (isActive) mySeatWrapper.classList.add('my-turn');
        else mySeatWrapper.classList.remove('my-turn');

        // Szary filtr dla Twojej postaci
        if (isIdle && !p.isReady) {
          mySeatWrapper.style.filter = 'grayscale(1) opacity(0.7)';
        } else {
          mySeatWrapper.style.filter = 'none';
        }

        let existingBubble = document.getElementById('myActionBubble');
        if (p.lastAction) {
          if (!existingBubble) {
            existingBubble = document.createElement('div');
            existingBubble.id = 'myActionBubble';
            existingBubble.style.cssText = "position:absolute; top:-25px; left:50%; transform:translateX(-50%); background:#fff; color:#000; padding:2px 8px; border-radius:8px; font-weight:bold; font-size:0.75rem; box-shadow:0 2px 5px rgba(0,0,0,0.5); z-index:10; white-space:nowrap; animation: pot-bounce 0.3s ease-out;";
            mySeatWrapper.appendChild(existingBubble);
          }
          existingBubble.innerHTML = `💬 ${p.lastAction}`;
        } else if (existingBubble) {
          existingBubble.remove();
        }
      }
    });

    // 5. Obliczenia dla panelu licytacji
    const me = data.players.find(p => p.nick === PlayerState.nick);
    if (me) {
      const toCall = data.currentBet - (me.betInRound || 0);

      // Dynamiczna nazwa przycisku CHECK/CALL
      const btnCheck = document.getElementById('pokerCheck');
      if (btnCheck) {
        if (toCall === 0) btnCheck.textContent = 'CHECK';
        else if (toCall >= me.chips) btnCheck.textContent = 'CALL (ALL-IN)';
        else btnCheck.textContent = `CALL (${toCall})`;
      }

      // Kalkulacja limitów raise
      let minTargetBet = data.currentBet === 0 ? 20 : data.currentBet * 2;
      let maxTargetBet = (me.betInRound || 0) + me.chips; // All-In
      if (minTargetBet > maxTargetBet) minTargetBet = maxTargetBet;

      PokerBetState.minRaise = minTargetBet;
      PokerBetState.maxRaise = maxTargetBet;
      PokerBetState.pot = data.pot;
    }

    // Auto-ukrywanie panelu RAISE gdy tura przeszła na rywala
    if (!isMyTurn) {
      const rPanel = document.getElementById('raisePanel');
      if (rPanel) rPanel.style.display = 'none';
    }

    // ANIMACJA KART WSPÓLNYCH (Flop/Turn/River)
    const boardEl = document.getElementById('boardCards');
    if (boardEl && data.board) {
      if (data.board.length !== lastBoardCount) {
        boardEl.innerHTML = '';
        data.board.forEach((card, i) => {
          const cardClass = (card.suit === '♥' || card.suit === '♦') ? 'red' : 'black';
          const cDiv = document.createElement('div');
          cDiv.className = `playing-card ${cardClass} anim-card`;
          cDiv.style.animationDelay = `${i * 0.1}s`;
          cDiv.innerHTML = `
            <div class="card-corner top-left">${card.rank}<br><span style="font-size: 0.7rem">${card.suit}</span></div>
            <div class="card-center">${card.suit}</div>
            <div class="card-corner bottom-right">${card.rank}<br><span style="font-size: 0.7rem">${card.suit}</span></div>
          `;
          boardEl.appendChild(cDiv);
        });
        if (data.board.length > lastBoardCount) playPokerSound('card');
      }
      lastBoardCount = data.board.length;
    }
  });

  // REAKCJA NA KONIEC ROZDANIA (Obsługa Pul Bocznych)
  socket.on('showdown_result', (data) => {
    const overlay = document.getElementById('showdownOverlay');
    const winnerNameEl = document.getElementById('showdownWinnerName');
    const showdownCardsEl = document.getElementById('showdownCards');
    const showdownAmountEl = document.getElementById('showdownAmount');

    // 1. Dynamiczny opis wyników
    const winnerTexts = [];
    for (const [nick, amt] of Object.entries(data.payouts)) {
      winnerTexts.push(`${nick} (+${amt})`);
    }
    winnerNameEl.textContent = `👑 WYNIKI ROZDANIA`;
    showdownAmountEl.innerHTML = `Układ: <span style="color:#22b422">${data.handName}</span><br>Wypłaty: ${winnerTexts.join(', ')}`;
    showdownCardsEl.innerHTML = '';

    // 2. Odkrywamy karty wszystkich zwycięzców
    const winningNicks = Object.keys(data.payouts);
    winningNicks.forEach(nick => {
      const winnerData = data.allCards.find(p => p.nick === nick);
      if (winnerData && winnerData.cards) {
        winnerData.cards.forEach(card => {
          const cardDiv = document.createElement('div');
          cardDiv.style.cssText = `width:60px; height:85px; background:#fff; border-radius:8px; display:flex; flex-direction:column; align-items:center; justify-content:center; font-weight:bold; font-size:1.4rem; color:${card.color};`;
          cardDiv.innerHTML = `<div>${card.rank}</div><div>${card.suit}</div>`;
          showdownCardsEl.appendChild(cardDiv);
        });
      }
    });

    // 3. Pokazanie overlay i aktualizacja portfela
    overlay.style.display = 'flex';
    playSound('kaching', 0.8); // Zrzut pieniędzy za zwycięstwo!
    setTimeout(() => {
      overlay.style.display = 'none';
      const myCards = document.getElementById('myCards');
      if (myCards) myCards.innerHTML = '';

      const myWin = data.payouts[PlayerState.nick];
      if (myWin) {
        PlayerState.coins += myWin;
        updateHUD(PlayerState.bestScore);
      }
    }, 7000);
  });

  socket.on('rebuy_success', (data) => {
    PlayerState.coins -= data.amount;
    updateHUD(PlayerState.bestScore);
    console.log(`[BANK] Sukces: przeniesiono ${data.amount} monet do kasyna.`);
  });

  socket.on('error_msg', (msg) => alert('❌ ' + msg));
}

export function triggerShowdown() {
  if (socket && socket.connected) {
    socket.emit('request_showdown');
  }
}

function renderPlayerCards(cards) {
  const cardsContainer = document.getElementById('myCards');
  if (!cardsContainer) return;
  cardsContainer.innerHTML = '';

  cards.forEach((card, i) => {
    const cardClass = (card.suit === '♥' || card.suit === '♦') ? 'red' : 'black';
    const cardEl = document.createElement('div');
    cardEl.className = `playing-card ${cardClass} anim-card`;

    // Wachlarz: pierwsza karta w lewo, druga w prawo
    const rot = i === 0 ? '-6deg' : '6deg';
    const transX = i === 0 ? '6px' : '-6px';
    cardEl.style.transform = `rotate(${rot}) translate(${transX}, 0px)`;
    cardEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';

    cardEl.innerHTML = `
      <div class="card-corner top-left">${card.rank}<br><span style="font-size: 0.7rem">${card.suit}</span></div>
      <div class="card-center">${card.suit}</div>
      <div class="card-corner bottom-right">${card.rank}<br><span style="font-size: 0.7rem">${card.suit}</span></div>
    `;
    cardsContainer.appendChild(cardEl);
  });
  playPokerSound('card');
}

export function requestCards() {
  if (socket) socket.emit('deal_cards');
}

export function sendReadySignal() {
  if (socket && socket.connected) socket.emit('set_ready');
}

export function joinPokerSeat() {
  if (socket && socket.connected) socket.emit('join_seat');
}

export function joinPokerTable() {
  if (!socket || !socket.connected) return alert('Brak połączenia!');
  socket.emit('join_table', { nick: PlayerState.nick, pin: PlayerState.pin, activeSkin: PlayerState.activeSkin });
}

export function leavePokerTable() {
  console.log("🖱️ Kliknięto WYJDŹ. Wysyłam prośbę do Hetznera...");
  if (!socket || !socket.connected) return location.reload();
  socket.emit('leave_table'); // Sygnał do serwera
}

function createPlayerAvatar(nick, chips, isMyTurn, phase) {
  const div = document.createElement('div');
  const borderCol = isMyTurn ? '#ff4500' : '#555';
  const shadow = isMyTurn ? 'box-shadow: 0 0 15px #ff4500;' : '';
  div.style.cssText = `background: rgba(0,0,0,0.8); border: 2px solid ${borderCol}; border-radius: 8px; padding: 4px; ${shadow} transition: all 0.2s;`;

  const activePhases = ['PRE-FLOP', 'FLOP', 'TURN', 'RIVER'];
  const cardsHtml = activePhases.includes(phase)
    ? `<div style="display:flex; gap:2px; margin-top:2px; justify-content:center;">
         <div class="playing-card-back" style="width:22px; height:32px; border-width:1px; border-radius:3px;"></div>
         <div class="playing-card-back" style="width:22px; height:32px; border-width:1px; border-radius:3px;"></div>
       </div>`
    : '';

  div.innerHTML = `
    <img src="assets/characters/${nick.toLowerCase()}.png" onerror="this.src='assets/characters/bobby.png'" style="width: 32px; height: 32px; border-radius: 4px; object-fit: cover; margin-bottom: 2px;">
    <div style="color: #fff; font-size: 0.7rem; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${nick}</div>
    <div style="color: #ffd700; font-size: 0.7rem; font-weight: bold;">${chips}</div>
    ${cardsHtml}
  `;
  return div;
}

export function sendSkinUpdateToServer(skin) {
  if (socket && socket.connected) socket.emit('update_skin', skin);
}

export function requestRebuy(amount) {
  if (socket && socket.connected) {
    socket.emit('add_chips', { amount: amount });
  }
}

export function sendPlayerAction(actionType, amount = 0) {
  if (socket && socket.connected) {
    console.log(`[ACTION] Wysyłam akcję: ${actionType.toUpperCase()}`);
    socket.emit('player_action', { action: actionType, amount: amount });
  } else {
    console.warn("Brak połączenia z krupierem!");
  }
}
