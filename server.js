const { Hand } = require('pokersolver');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const admin = require('firebase-admin');
const cors = require('cors');

// --- TARCZA GLOBALNA ---
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Nieprzechwycony błąd (Serwer uratowany):', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Nieobsłużona obietnica (Serwer uratowany):', reason);
});

// 1. INICJALIZACJA FIREBASE
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// 2. INICJALIZACJA SERWERA
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
  allowEIO3: true
});

// 3. MAPA RANG
const RANK_VALUES = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };

function toPokerSolverFormat(card) {
  const suitMap = { '♥': 'h', '♦': 'd', '♣': 'c', '♠': 's' };
  const rank = card.rank === '10' ? 'T' : card.rank;
  return rank + suitMap[card.suit];
}

// 3. DEFINICJA TALII
const SUITS = ['♥', '♦', '♣', '♠'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function createDeck() {
  let deck = [];
  for (let s of SUITS) {
    for (let r of RANKS) {
      deck.push({ rank: r, suit: s, color: (s === '♥' || s === '♦') ? '#dc3232' : '#000' });
    }
  }
  return deck.sort(() => Math.random() - 0.5); // Proste tasowanie
}

// 4. PAMIĘĆ RAM KASYNA
const activeTables = {
  'lobby_1': {
    players: {},
    observers: {},     // Loża szyderców
    playerOrder: [],   // ID socketów w kolejności siedzenia
    pot: 0,
    currentBet: 0,
    activePlayerIndex: 0,
    dealerIndex: 0,    // Pozycja Dealera
    maxPlayers: 6,     // Twardy limit stołu
    phase: 'IDLE',     // IDLE -> PRE-FLOP -> FLOP -> TURN -> RIVER -> SHOWDOWN
    deck: [],          // Wspólna talia na to rozdanie
    board: [],         // Karty na środku stołu
    lastMoveTime: Date.now() // Zegar Szachowy — czas ostatniego ruchu
  }
};

const globalOnline = {}; // Przechowuje socket.id -> { nick, activeSkin }

// FUNKCJA: Łączy wpisy z tym samym Nickiem (deduplikacja)
function getUniqueOnlinePlayers() {
  const unique = {};
  Object.values(globalOnline).forEach(p => {
    if (p && p.nick) unique[p.nick] = p; // Nadpisuje starsze wejście z tym samym nickiem
  });
  return Object.values(unique);
}

// 4. LOGIKA POŁĄCZEŃ
io.on('connection', (socket) => {
  console.log(`[+] Nowe połączenie: ${socket.id}`);
  socket.emit('casino_global_status', getGlobalStatus());

  // 1. Zgłoszenie się do głównego radaru (Po wejściu do Lobby)
  socket.on('hello_server', (data) => {
    if (!data || !data.nick) return;
    const safeSkin = (data.activeSkin && data.activeSkin !== 'undefined') ? data.activeSkin : 'bobby';
    globalOnline[socket.id] = { nick: data.nick, activeSkin: safeSkin };
    io.emit('online_radar', getUniqueOnlinePlayers());
  });

  // 2. Aktualizacja skina (Gdy zmienisz postać w Lobby)
  socket.on('update_skin', (skin) => {
    if (globalOnline[socket.id]) {
      globalOnline[socket.id].activeSkin = (skin && skin !== 'undefined') ? skin : 'bobby';
      io.emit('online_radar', getUniqueOnlinePlayers());
    }
  });

  // DOŁĄCZANIE DO KASYNA (Sprawdzanie miejsc)
  socket.on('join_table', async (data) => {
    const { nick, pin, activeSkin } = data;
    try {
      const userRef = db.collection('leaderboard').doc(nick);
      const doc = await userRef.get();
      if (!doc.exists || doc.data().pin !== pin) return socket.emit('error_msg', 'Zły PIN!');

      const currentCoins = doc.data().coins || 0;
      const safeSkin = (activeSkin && activeSkin !== 'undefined') ? activeSkin : 'bobby';
      const table = activeTables.lobby_1;

      if (table.playerOrder.length >= table.maxPlayers) {
        // BRAK MIEJSC -> TRYB WIDZA (Nie pobieramy 500!)
        table.observers[socket.id] = { nick, activeSkin: safeSkin };
        socket.join('lobby_1');
        socket.emit('table_joined', { role: 'observer', chips: 0, newBalance: currentCoins });
        console.log(`[OBSERVER] ${nick} wchodzi do Loży Szyderców.`);
      } else {
        // SĄ MIEJSCA -> GRACZ
        if (currentCoins < 500) return socket.emit('error_msg', 'Brak kasy!');
        await userRef.update({ coins: currentCoins - 500 });
        table.players[socket.id] = { nick, activeSkin: safeSkin, chips: 500, betInRound: 0, totalInvested: 500, idleSince: Date.now() };
        table.playerOrder.push(socket.id);
        socket.join('lobby_1');
        socket.emit('table_joined', { role: 'player', chips: 500, newBalance: currentCoins - 500 });
        console.log(`[BANK] Pobrano 500 od ${nick} (Siedzi przy stole)`);
      }
      broadcastUpdate();
      broadcastGlobalStatus();
    } catch (e) { console.error(e); }
  });

  // PRZESIADKA Z WIDZA NA GRACZA
  socket.on('join_seat', async () => {
    const table = activeTables.lobby_1;
    const observer = table.observers[socket.id];

    if (!observer) return socket.emit('error_msg', 'Nie jesteś widzem!');
    if (table.playerOrder.length >= table.maxPlayers) return socket.emit('error_msg', 'Ktoś Cię ubiegł! Brak miejsc.');

    try {
      const userRef = db.collection('leaderboard').doc(observer.nick);
      let success = false;
      await db.runTransaction(async (t) => {
        const doc = await t.get(userRef);
        const currentCoins = doc.data().coins || 0;
        if (currentCoins < 500) throw new Error('Brak środków');
        t.update(userRef, { coins: currentCoins - 500 });
        success = true;
      });

      if (success) {
        const { nick, activeSkin } = observer;
        delete table.observers[socket.id]; // Usuwamy z widowni
        table.players[socket.id] = { nick, activeSkin, chips: 500, betInRound: 0, totalInvested: 500, idleSince: Date.now() };
        table.playerOrder.push(socket.id);

        socket.emit('seat_joined', { chips: 500 });
        console.log(`[BANK] Pobrano 500 od ${nick} (Zajął wolne miejsce)`);
        broadcastUpdate();
        broadcastGlobalStatus();
      }
    } catch (e) {
      if (e.message === 'Brak środków') socket.emit('error_msg', 'Brak 500 nut na wejście!');
      else console.error('Błąd siadania:', e);
    }
  });

  // DOKUPOWANIE ŻETONÓW W TRAKCIE GRY (REBUY)
  socket.on('add_chips', async (data) => {
    const table = activeTables.lobby_1;
    const player = table.players[socket.id];

    if (!player) return socket.emit('error_msg', 'Nie siedzisz przy stole!');

    const amount = parseInt(data.amount);
    if (isNaN(amount) || amount <= 0) return socket.emit('error_msg', 'Nieprawidłowa kwota!');

    console.log(`[BANK] ${player.nick} próbuje dokupić ${amount} żetonów...`);

    try {
      const userRef = db.collection('leaderboard').doc(player.nick);
      let success = false;

      // Atomowa transakcja Firebase: Sprawdza stan i pobiera w jednym kroku
      await db.runTransaction(async (t) => {
        const doc = await t.get(userRef);
        const currentCoins = doc.data().coins || 0;

        if (currentCoins < amount) {
          throw new Error('Brak środków');
        }

        t.update(userRef, { coins: currentCoins - amount });
        success = true;
      });

      if (success) {
        // BEZPIECZNIK: Sprawdzamy czy gracz nadal siedzi przy stole po weryfikacji w bazie
        const stillExists = table.players[socket.id];
        if (stillExists) {
          stillExists.chips += amount;
          stillExists.totalInvested = (stillExists.totalInvested || 0) + amount;
          socket.emit('rebuy_success', { amount });
          broadcastUpdate();
          console.log(`[BANK] ${stillExists.nick} dokupił ${amount}. Total Invested: ${stillExists.totalInvested}`);
        }
      }

    } catch (e) {
      if (e.message === 'Brak środków') {
        socket.emit('error_msg', 'Brak środków w głównym portfelu!');
      } else {
        console.error('Błąd bazy danych przy Rebuy:', e);
        socket.emit('error_msg', 'Błąd serwera. Spróbuj ponownie.');
      }
    }
  });

  // KOMPLEKSOWA OBSŁUGA AKCJI GRACZA
  socket.on('player_action', (data) => {
    try {
    const table = activeTables.lobby_1;
    const player = table.players[socket.id];
    if (!player) return;

    const validPhases = ['PRE-FLOP', 'FLOP', 'TURN', 'RIVER'];
    if (!validPhases.includes(table.phase)) return socket.emit('error_msg', 'To nie czas na licytację!');
    if (socket.id !== table.playerOrder[table.activePlayerIndex]) return socket.emit('error_msg', 'Czekaj na swoją kolej!');
    if (player.folded) return socket.emit('error_msg', 'Już spasowałeś!');

    // 1. Rejestracja ruchu
    player.hasActed = true;

    if (data.action === 'fold') {
      player.folded = true;
      player.lastAction = 'FOLD';
      console.log(`[ACTION] ${player.nick} pasuje (FOLD).`);

    } else if (data.action === 'call') {
      const toCall = table.currentBet - (player.betInRound || 0);
      const cost = Math.min(player.chips, toCall);
      player.chips -= cost;
      player.betInRound = (player.betInRound || 0) + cost;
      player.investedInHand = (player.investedInHand || 0) + cost;
      table.pot += cost;
      player.lastAction = cost === 0 ? 'CHECK' : 'CALL';
      console.log(`[ACTION] ${player.nick} -> CHECK/CALL (${cost}).`);

    } else if (data.action === 'raise') {
      const targetBet = parseInt(data.amount);

      // Walidacja: za małe przebicie?
      if (isNaN(targetBet) || targetBet <= table.currentBet) {
        return socket.emit('error_msg', 'Za małe przebicie!');
      }

      // Ile faktycznie musi dołożyć? (target - już zainwestowane)
      const additionalCost = targetBet - (player.betInRound || 0);
      if (additionalCost > player.chips) {
        return socket.emit('error_msg', 'Nie masz tyle żetonów!');
      }

      player.chips -= additionalCost;
      player.betInRound = targetBet;
      player.investedInHand = (player.investedInHand || 0) + additionalCost;
      table.pot += additionalCost;
      table.currentBet = targetBet;
      player.lastAction = 'RAISE';

      // Ktoś przebił: inni muszą znów podjąć decyzję
      table.playerOrder.forEach(id => {
        if (id !== socket.id && !table.players[id].folded && table.players[id].chips > 0) {
          table.players[id].hasActed = false;
        }
      });
      console.log(`[ACTION] ${player.nick} -> RAISE do ${targetBet}. Pula rośnie do: ${table.pot}`);
    }

    // 2. Inspektor: analiza stanu rundy
    const activeIds = table.playerOrder.filter(id => !table.players[id].folded);

    // Scenariusz A: Walkower LUB Samobójstwo Solo (<= 1)
    if (activeIds.length <= 1) {
      console.log(`[INSPEKTOR] Koniec licytacji. Zostało aktywnych graczy: ${activeIds.length}`);
      return handleShowdown('lobby_1', true);
    }

    // Scenariusz B: Wszyscy wyrównali (lub All-In)
    const isRoundOver = activeIds.every(id => {
      const p = table.players[id];
      return p.hasActed && (p.betInRound === table.currentBet || p.chips === 0);
    });

    if (isRoundOver) {
      advancePhase('lobby_1');
    } else {
      let nextIndex = (table.activePlayerIndex + 1) % table.playerOrder.length;
      let loopGuard = 0;
      while ((table.players[table.playerOrder[nextIndex]].folded || table.players[table.playerOrder[nextIndex]].chips === 0) && loopGuard < table.playerOrder.length) {
        nextIndex = (nextIndex + 1) % table.playerOrder.length;
        loopGuard++;
      }
      table.activePlayerIndex = nextIndex;
      table.lastMoveTime = Date.now(); // Gracz wykonał ruch, resetujemy stoper dla następnego
      broadcastUpdate();
    }
    } catch (err) {
      console.error('[ERROR] Błąd w player_action:', err);
    }
  });

  // SYSTEM GOTOWOŚCI (AUTOPILOT KRUPIERA)
  socket.on('set_ready', () => {
    const table = activeTables.lobby_1;
    const player = table.players[socket.id];

    // Gotowość można zgłaszać tylko w fazie przerwy (IDLE)
    if (!player || table.phase !== 'IDLE') return;

    player.isReady = true;
    console.log(`[READY] ${player.nick} zgłasza gotowość.`);

    // Sprawdzamy ilu AKTYWNYCH graczy (z pieniędzmi) jest przy stole
    const activeIds = table.playerOrder.filter(id => table.players[id].chips > 0);
    const allReady = activeIds.length >= 2 && activeIds.every(id => table.players[id].isReady);

    if (allReady) {
      console.log(`[KRUPIER] Wszyscy gotowi. Tasowanie i PRE-FLOP...`);
      const numPlayers = table.playerOrder.length;
      table.deck = createDeck();
      table.board = [];
      table.pot = 0;
      table.currentBet = 20; // Big Blind

      table.dealerIndex = (table.dealerIndex + 1) % numPlayers;
      let sbIndex = (table.dealerIndex + 1) % numPlayers;
      let bbIndex = (table.dealerIndex + 2) % numPlayers;

      if (numPlayers === 2) {
        sbIndex = table.dealerIndex;
        bbIndex = (table.dealerIndex + 1) % numPlayers;
      }

      table.playerOrder.forEach((id, index) => {
        const p = table.players[id];
        if (!p) return;
        p.betInRound = 0;
        p.investedInHand = 0;
        p.folded = false;
        p.hasActed = false;
        p.lastAction = null;
        p.isReady = false; // Reset gotowości po rozdaniu

        // Pobieranie Blindów
        if (index === sbIndex) {
          const cost = Math.min(p.chips, 10);
          p.chips -= cost; p.betInRound += cost; p.investedInHand += cost; table.pot += cost;
        }
        if (index === bbIndex) {
          const cost = Math.min(p.chips, 20);
          p.chips -= cost; p.betInRound += cost; p.investedInHand += cost; table.pot += cost;
        }

        p.cards = [table.deck.pop(), table.deck.pop()];
        io.to(id).emit('your_cards', p.cards);
      });

      table.activePlayerIndex = (bbIndex + 1) % numPlayers;
      table.phase = 'PRE-FLOP';
      table.lastMoveTime = Date.now(); // Start Zegara dla pierwszego gracza!
    }

    broadcastUpdate();
  });

  // AUTOMATYCZNE ZARZĄDZANIE DALSZYMI FAZAMI (Krupier)
  socket.on('deal_cards', () => {
    try {
    const table = activeTables.lobby_1;

    if (table.phase === 'IDLE') {
      const numPlayers = table.playerOrder.length;
      if (numPlayers < 1) return socket.emit('error_msg', 'Potrzeba graczy!');

      console.log(`[KRUPIER] Tasowanie i PRE-FLOP... Pobieranie Blinds.`);
      table.deck = createDeck();
      table.board = [];
      table.pot = 0;
      table.currentBet = 20; // Big Blind

      // 1. Przesunięcie Dealera
      table.dealerIndex = (table.dealerIndex + 1) % numPlayers;

      // 2. Kto płaci ciemne?
      let sbIndex = (table.dealerIndex + 1) % numPlayers;
      let bbIndex = (table.dealerIndex + 2) % numPlayers;

      if (numPlayers === 2) {
        // Heads-Up: Dealer płaci Small Blind
        sbIndex = table.dealerIndex;
        bbIndex = (table.dealerIndex + 1) % numPlayers;
      } else if (numPlayers === 1) {
        // Tryb testowy (1 gracz płaci BB)
        sbIndex = -1;
        bbIndex = 0;
      }

      // 3. Pobieranie kasy i rozdawanie kart
      table.playerOrder.forEach((id, index) => {
        const p = table.players[id];
        if (!p) return;
        p.betInRound = 0;
        p.investedInHand = 0;
        p.folded = false;
        p.hasActed = false;
        p.lastAction = null;

        if (index === sbIndex) {
          const cost = Math.min(p.chips, 10);
          p.chips -= cost;
          p.betInRound += cost;
          p.investedInHand += cost;
          table.pot += cost;
        }
        if (index === bbIndex) {
          const cost = Math.min(p.chips, 20);
          p.chips -= cost;
          p.betInRound += cost;
          p.investedInHand += cost;
          table.pot += cost;
        }

        p.cards = [table.deck.pop(), table.deck.pop()];
        io.to(id).emit('your_cards', p.cards);
      });

      // 4. Pierwszy ruch: gracz po Big Blindzie (UTG)
      table.activePlayerIndex = (bbIndex + 1) % numPlayers;
      table.phase = 'PRE-FLOP';

    } else if (table.phase === 'PRE-FLOP') {
      console.log(`[KRUPIER] Wykładam FLOP (3 karty)...`);
      table.deck.pop(); // Spalenie karty
      table.board.push(table.deck.pop(), table.deck.pop(), table.deck.pop());
      table.phase = 'FLOP';

    } else if (table.phase === 'FLOP') {
      console.log(`[KRUPIER] Wykładam TURN (1 karta)...`);
      table.deck.pop(); // Spalenie karty
      table.board.push(table.deck.pop());
      table.phase = 'TURN';

    } else if (table.phase === 'TURN') {
      console.log(`[KRUPIER] Wykładam RIVER (1 karta)...`);
      table.deck.pop(); // Spalenie karty
      table.board.push(table.deck.pop());
      table.phase = 'RIVER';

    } else {
      return socket.emit('error_msg', 'Koniec kart. Czas na SHOWDOWN!');
    }

    broadcastUpdate();
    } catch (err) {
      console.error('[ERROR] Błąd w deal_cards:', err);
    }
  });

  socket.on('create_bounty', async (data, callback) => {
    const { creatorNick, victimNick, mode, targetScore, reward } = data;
    try {
      await db.runTransaction(async (t) => {
        const creatorRef = db.collection('leaderboard').doc(creatorNick);
        const creatorDoc = await t.get(creatorRef);
        const currentCoins = creatorDoc.data()?.coins || 0;

        if (currentCoins < reward) throw new Error("Brak środków w bazie!");

        const newBountyRef = db.collection('bounties').doc();
        t.update(creatorRef, { coins: currentCoins - reward });

        t.set(newBountyRef, {
          creator: creatorNick, victim: victimNick, mode: mode,
          targetScore: parseInt(targetScore), reward: parseInt(reward), createdAt: Date.now()
        });
      });
      if (typeof callback === 'function') callback({ success: true });
    } catch (e) {
      if (typeof callback === 'function') callback({ error: e.message });
    }
  });

  socket.on('claim_bounty', async (data, callback) => {
    const { bountyId, claimantNick } = data;
    try {
      const reward = await db.runTransaction(async (t) => {
        const bountyRef = db.collection('bounties').doc(bountyId);
        const claimantRef = db.collection('leaderboard').doc(claimantNick);

        const bountyDoc = await t.get(bountyRef);
        if (!bountyDoc.exists) throw new Error("Zlecenie nie istnieje!");
        const bounty = bountyDoc.data();

        if (bounty.victim.toLowerCase() !== claimantNick.toLowerCase()) throw new Error("To nie na Ciebie!");

        const claimantDoc = await t.get(claimantRef);
        const claimantData = claimantDoc.data();

        // Source of Truth - sprawdzanie oficjalnego wyniku w bazie
        let currentBest = 0;
        if (bounty.mode === 'flappy') currentBest = claimantData.score || 0;
        else if (bounty.mode === 'spikes') currentBest = claimantData.spikesBestScore || 0;
        else if (bounty.mode === 'ski') currentBest = claimantData.skiBestScore || 0;
        else if (bounty.mode === 'poker') currentBest = claimantData.pokerNetProfit || 0;

        if (currentBest < bounty.targetScore) throw new Error(`Oficjalny rekord w bazie to ${currentBest}. Za mało!`);

        t.update(claimantRef, { coins: (claimantData.coins || 0) + bounty.reward });
        t.delete(bountyRef);
        return bounty.reward;
      });
      if (typeof callback === 'function') callback({ success: true, reward });
    } catch (e) {
      if (typeof callback === 'function') callback({ error: e.message });
    }
  });

  socket.on('leave_table', () => handlePlayerExit(socket.id, false));
  socket.on('disconnect', () => handlePlayerExit(socket.id, true));

}); // <--- KLUCZOWA KLAMRA DOMYKAJĄCA CONNECTION!

// ==========================================
// FUNKCJE AUTOMATYZACJI KRUPIERA (INSPEKTOR)
// ==========================================

function advancePhase(tableId) {
  const table = activeTables[tableId];

  // Reset przed nową rundą licytacji (pot zostaje)
  table.currentBet = 0;
  table.playerOrder.forEach(id => {
    if (table.players[id]) {
      table.players[id].betInRound = 0;
      table.players[id].hasActed = false;
      table.players[id].lastAction = null;
    }
  });

  if (table.phase === 'PRE-FLOP') {
    console.log(`[KRUPIER] Wszyscy wyrównali. Wykładam FLOP.`);
    table.deck.pop(); table.board.push(table.deck.pop(), table.deck.pop(), table.deck.pop());
    table.phase = 'FLOP';
  } else if (table.phase === 'FLOP') {
    console.log(`[KRUPIER] Wszyscy wyrównali. Wykładam TURN.`);
    table.deck.pop(); table.board.push(table.deck.pop());
    table.phase = 'TURN';
  } else if (table.phase === 'TURN') {
    console.log(`[KRUPIER] Wszyscy wyrównali. Wykładam RIVER.`);
    table.deck.pop(); table.board.push(table.deck.pop());
    table.phase = 'RIVER';
  } else if (table.phase === 'RIVER') {
    console.log(`[KRUPIER] Koniec licytacji na River. AUTO-SHOWDOWN!`);
    return handleShowdown(tableId, false);
  }

  // Po wyłożeniu kart, ruch zaczyna pierwszy aktywny gracz za Dealerem
  let nextIndex = (table.dealerIndex + 1) % table.playerOrder.length;
  let loopGuard = 0;
  while ((table.players[table.playerOrder[nextIndex]].folded || table.players[table.playerOrder[nextIndex]].chips === 0) && loopGuard < table.playerOrder.length) {
    nextIndex = (nextIndex + 1) % table.playerOrder.length;
    loopGuard++;
  }
  table.activePlayerIndex = nextIndex;
  table.lastMoveTime = Date.now(); // Nowa karta na stole = nowe 30 sekund na myślenie

  io.to(tableId).emit('table_update', {
    pot: table.pot,
    currentBet: table.currentBet,
    phase: table.phase,
    board: table.board,
    activePlayerNick: table.players[table.playerOrder[table.activePlayerIndex]]
      ? table.players[table.playerOrder[table.activePlayerIndex]].nick
      : '...',
    players: Object.values(table.players).map(p => ({ nick: p.nick, chips: p.chips, lastAction: p.lastAction || null }))
  });
}

async function handleShowdown(tableId, isWalkover = false) {
  const table = activeTables[tableId];
  const players = table.players;
  const playerIds = table.playerOrder;

  console.log(`[SHOWDOWN] Uruchamiam rozliczenie (Tryb Side Pots). Walkower: ${isWalkover}`);

  // 1. Budowa Puli Głównej i Pul Bocznych
  let pots = [];
  let uniqueInvestments = [...new Set(playerIds.map(id => players[id] ? (players[id].investedInHand || 0) : 0))]
                           .filter(val => val > 0)
                           .sort((a, b) => a - b);

  let previousTier = 0;
  uniqueInvestments.forEach(tier => {
    let marginalBet = tier - previousTier;
    let potAmount = 0;
    let eligibleIds = [];

    playerIds.forEach(id => {
      const p = players[id];
      if (!p) return; // Bezpiecznik: ignoruj widma
      const invested = p.investedInHand || 0;
      if (invested > previousTier) {
        potAmount += Math.min(invested - previousTier, marginalBet);
        if (!p.folded && invested >= tier) eligibleIds.push(id);
      }
    });

    if (potAmount > 0) pots.push({ amount: potAmount, eligibleIds });
    previousTier = tier;
  });

  // Bezpiecznik: jeśli po podziale nic nie ma, a kasa leży na stole
  if (pots.length === 0 && table.pot > 0) {
    pots.push({ amount: table.pot, eligibleIds: playerIds.filter(id => !players[id].folded) });
  }

  let payouts = {};
  let winningDescs = [];

  // 2. Oceniamy każdą pulę niezależnie
  for (let i = 0; i < pots.length; i++) {
    const currentPot = pots[i];
    if (currentPot.eligibleIds.length === 0) continue;

    if (isWalkover || currentPot.eligibleIds.length === 1) {
      const wId = currentPot.eligibleIds[0];
      if (!wId) continue;
      const wNick = players[wId].nick;
      payouts[wNick] = (payouts[wNick] || 0) + currentPot.amount;
      if (i === 0) winningDescs.push('Walkower (Wszyscy spasowali)');
    } else {
      const boardCards = table.board.map(toPokerSolverFormat);
      let evaluatedHands = [];

      currentPot.eligibleIds.forEach(id => {
        const p = players[id];
        if (!p || !p.cards || p.cards.length === 0) return; // Bezpiecznik: ignoruj widma
        const fullHand = p.cards.map(toPokerSolverFormat).concat(boardCards);
        const solvedHand = Hand.solve(fullHand);
        solvedHand.playerId = id;
        solvedHand.nick = p.nick;
        evaluatedHands.push(solvedHand);
      });

      if (evaluatedHands.length > 0) {
        const potWinners = Hand.winners(evaluatedHands);
        const winAmount = Math.floor(currentPot.amount / potWinners.length);
        potWinners.forEach(w => {
          payouts[w.nick] = (payouts[w.nick] || 0) + winAmount;
        });
        if (i === 0) winningDescs.push(potWinners[0].descr);
      }
    }
  }

  if (Object.keys(payouts).length === 0) {
    console.log(`[KRUPIER] Test Solo - Pusty Stół. Resetuję.`);
    table.pot = 0; table.currentBet = 0; table.phase = 'IDLE'; table.board = [];
    Object.values(table.players).forEach(p => { delete p.cards; p.folded = false; });
    io.to(tableId).emit('table_update', { pot: 0, currentBet: 0, phase: 'IDLE', board: [], activePlayerNick: '...', players: Object.values(table.players).map(p => ({ nick: p.nick, chips: p.chips })) });
    return;
  }

  const finalDesc = winningDescs[0] || 'Podział puli';
  const revealData = [];
  playerIds.forEach(id => {
    const p = players[id];
    if (p && !p.folded && p.cards) {
      revealData.push({ nick: p.nick, cards: p.cards });
    }
  });

  try {
    // 3. Wypłata przez transakcje Firebase (READ BEFORE WRITE)
    await db.runTransaction(async (t) => {
      // Faza 1: Najpierw WSZYSTKIE odczyty
      const updates = [];
      for (const [nick, amount] of Object.entries(payouts)) {
        const winnerRef = db.collection('leaderboard').doc(nick);
        const doc = await t.get(winnerRef);
        updates.push({ ref: winnerRef, currentCoins: doc.data().coins || 0, addAmount: amount });
      }

      // Faza 2: Dopiero teraz WSZYSTKIE zapisy
      for (const update of updates) {
        t.update(update.ref, { coins: update.currentCoins + update.addAmount });
      }
    });

    io.to(tableId).emit('showdown_result', {
      payouts,
      handName: finalDesc,
      allCards: revealData
    });

    console.log(`[WINNER] Rozdanie zakończone. Wypłaty:`, payouts);

    table.pot = 0; table.currentBet = 0; table.phase = 'IDLE'; table.board = [];

    // Egzorcyzmy: Fizyczne usunięcie Duchów po rozdzieleniu wygranej
    Object.keys(table.players).forEach(id => {
      const p = table.players[id];
      if (p.isDisconnected) {
        delete table.players[id];
        table.playerOrder = table.playerOrder.filter(pid => pid !== id);
      } else {
        delete p.cards;
        p.folded = false;
        p.isReady = false;
        p.betInRound = 0;
        p.investedInHand = 0;
        p.idleSince = Date.now(); // Reset stopera AFK po każdym rozdaniu
      }
    });

    setTimeout(() => {
      io.to(tableId).emit('table_update', {
        pot: 0, currentBet: 0, phase: 'IDLE', board: [],
        activePlayerNick: '...',
        players: Object.values(table.players).map(p => ({ nick: p.nick, chips: p.chips }))
      });
    }, 1500);

  } catch (e) {
    console.error('Krytyczny błąd rozliczenia:', e);
  }
}

// --- GLOBALNA FUNKCJA AKTUALIZACJI ---
function broadcastUpdate() {
  const table = activeTables.lobby_1;
  const activeId = table.playerOrder[table.activePlayerIndex];
  const activePlayer = activeId ? table.players[activeId] : null;

  io.to('lobby_1').emit('table_update', {
    pot: table.pot,
    currentBet: table.currentBet,
    phase: table.phase,
    board: table.board,
    maxPlayers: table.maxPlayers,
    numObservers: Object.keys(table.observers).length,
    activePlayerNick: activePlayer ? activePlayer.nick : '...',

    serverNow: Date.now(),
    lastMoveTime: table.lastMoveTime || null,

    players: Object.values(table.players).map(p => ({
      nick: p.nick,
      activeSkin: (p.activeSkin && p.activeSkin !== 'undefined' && p.activeSkin !== 'null') ? p.activeSkin : 'bobby',
      chips: p.chips,
      lastAction: p.lastAction || null,
      isReady: p.isReady || false,
      idleSince: p.idleSince || null
    }))
  });
}

function getGlobalStatus() {
  const table = activeTables.lobby_1;
  return {
    playing: Object.values(table.players).map(p => p.nick),
    observers: Object.values(table.observers).map(o => o.nick),
    max: table.maxPlayers
  };
}

function broadcastGlobalStatus() {
  io.emit('casino_global_status', getGlobalStatus());
}

// --- GLOBALNA FUNKCJA WYJŚCIA (Ghost Protocol & AFK) ---
async function handlePlayerExit(socketId, isDisconnect = false) {
  if (isDisconnect && globalOnline[socketId]) {
    delete globalOnline[socketId];
    io.emit('online_radar', getUniqueOnlinePlayers());
  }

  const table = activeTables.lobby_1;

  if (table.observers[socketId]) {
    delete table.observers[socketId];
    if (!isDisconnect) io.to(socketId).emit('left_successfully');
    return broadcastUpdate();
  }

  const player = table.players[socketId];
  if (!player) return;

  try {
    const userRef = db.collection('leaderboard').doc(player.nick);
    await db.runTransaction(async (t) => {
      const d = await t.get(userRef);
      const sessionProfit = player.chips - (player.totalInvested || 500);
      t.update(userRef, {
        coins: (d.data().coins || 0) + player.chips,
        pokerNetProfit: (d.data().pokerNetProfit || 0) + sessionProfit
      });
    });
  } catch (e) { console.error('Błąd zapisu:', e); }

  if (!isDisconnect) io.to(socketId).emit('left_successfully');

  if (table.phase === 'IDLE') {
    delete table.players[socketId];
    table.playerOrder = table.playerOrder.filter(id => id !== socketId);
    if (table.activePlayerIndex >= table.playerOrder.length) table.activePlayerIndex = 0;
    if (table.playerOrder.length === 0) { table.pot = 0; table.currentBet = 0; table.board = []; }
    broadcastUpdate();
  } else {
    // GHOST PROTOCOL (Wyrzucenie w trakcie partii)
    player.chips = 0; player.folded = true; player.hasActed = true; player.isDisconnected = true;
    const activeIds = table.playerOrder.filter(id => !table.players[id].folded);

    if (activeIds.length <= 1) {
      handleShowdown('lobby_1', true);
    } else {
      const isRoundOver = activeIds.every(id => {
        const p = table.players[id];
        return p.hasActed && (p.betInRound === table.currentBet || p.chips === 0);
      });
      if (isRoundOver) advancePhase('lobby_1');
      else {
        if (socketId === table.playerOrder[table.activePlayerIndex]) {
          let nextIndex = (table.activePlayerIndex + 1) % table.playerOrder.length;
          let loopGuard = 0;
          while ((table.players[table.playerOrder[nextIndex]].folded || table.players[table.playerOrder[nextIndex]].chips === 0) && loopGuard < table.playerOrder.length) {
            nextIndex = (nextIndex + 1) % table.playerOrder.length; loopGuard++;
          }
          table.activePlayerIndex = nextIndex;
          table.lastMoveTime = Date.now(); // Duch usunięty, start stopera dla następnego
        }
        broadcastUpdate();
      }
    }
  }
  broadcastGlobalStatus();
}

// --- PĘTLA AFK KICKERA (Wywala co 30 sekund z poczekalni ATAKŻE w trakcie gry) ---
setInterval(() => {
  const table = activeTables.lobby_1;
  const now = Date.now();

  if (table.phase === 'IDLE') {
    // SCENARIUSZ A: Wywalanie szarych awatarów (brak gotowości po partii)
    let changed = false;
    table.playerOrder.forEach(id => {
      const p = table.players[id];
      if (p && !p.isReady && p.idleSince && (now - p.idleSince > 30000)) {
        console.log(`[AFK] Wyrzucam gracza ${p.nick} za brak gotowości (> 30s).`);
        io.to(id).emit('error_msg', 'Za długo myślałeś. Wylatujesz z kasyna!');
        handlePlayerExit(id, false);
        changed = true;
      }
    });
    if (changed) broadcastUpdate();

  } else {
    // SCENARIUSZ B: Wyrzucanie za "spanie" w trakcie swojej tury w grze
    if (table.lastMoveTime && (now - table.lastMoveTime > 30000)) {
      const activeId = table.playerOrder[table.activePlayerIndex];
      const p = table.players[activeId];
      if (p && !p.folded && p.chips > 0) {
        console.log(`[AFK_INGAME] Wyrzucam gracza ${p.nick} za brak ruchu podczas licytacji (> 30s).`);
        io.to(activeId).emit('error_msg', 'Zasnąłeś z kartami w ręku! Automatyczny FOLD i kick.');
        handlePlayerExit(activeId, false);
      }
    }
  }
}, 2000);

// 5. START
server.listen(3000, () => console.log('[$$] KASYNO OTWARTY'));