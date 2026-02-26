// js/firebase.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, doc, getDoc, setDoc, getDocs, query, orderBy, limit, onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { PlayerState, updateStateFromFirebase } from './state.js';
import { EventEmitter } from './events.js';

const firebaseConfig = {
  apiKey:            "AIzaSyCv02h10zIVw8DhrBhryiDnFIa_peZklKQ",
  authDomain:        "flappy-bobby.firebaseapp.com",
  projectId:         "flappy-bobby",
  storageBucket:     "flappy-bobby.firebasestorage.app",
  messagingSenderId: "79131027037",
  appId:             "1:79131027037:web:2224f6d16ef4f7e6a88fb4"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// --- CACHE STRUMIENIOWY (Eliminacja śmieciowych odczytów) ---
let cacheFlappy = [];
let cacheSpikes = [];
let cacheSki = [];
let cachePokerWinners = [];
let cachePokerLosers = [];

let saveTimeout = null;

// ── BAZA TLENOWA (Real-time Snapshots) ────────────────────────────────────────
export function initRealtimeStreams() {
  // Zamiast pytać bazy co 60 sekund, otwieramy tunel. Baza sama wyśle dane, gdy coś się zmieni.
  onSnapshot(query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(10)), (snap) => {
    cacheFlappy = snap.docs.map(d => d.data());
  });

  onSnapshot(query(collection(db, 'leaderboard'), orderBy('spikesBestScore', 'desc'), limit(10)), (snap) => {
    cacheSpikes = snap.docs.map(d => d.data()).filter(d => (d.spikesBestScore || 0) > 0);
  });

  onSnapshot(query(collection(db, 'leaderboard'), orderBy('skiBestScore', 'desc'), limit(10)), (snap) => {
    cacheSki = snap.docs.map(d => d.data()).filter(d => (d.skiBestScore || 0) > 0);
  });

  onSnapshot(query(collection(db, 'leaderboard'), orderBy('pokerNetProfit', 'desc'), limit(5)), (snap) => {
    cachePokerWinners = snap.docs.map(d => d.data()).filter(d => (d.pokerNetProfit || 0) > 0);
  });

  onSnapshot(query(collection(db, 'leaderboard'), orderBy('pokerNetProfit', 'asc'), limit(5)), (snap) => {
    cachePokerLosers = snap.docs.map(d => d.data()).filter(d => (d.pokerNetProfit || 0) < 0);
  });

  // Strumień Zleceń na Głowy (Bounties) - Reaktywny UI
  onSnapshot(query(collection(db, 'bounties'), orderBy('createdAt', 'desc')), (snap) => {
    const bounties = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    EventEmitter.emit('BOUNTIES_UPDATED', bounties);
  });
}

// Interfejsy dla starego kodu (Zwracają dane natychmiastowo z Cache'u RAM!)
export async function getTopScores()       { return cacheFlappy; }
export async function getSpikesTopScores() { return cacheSpikes; }
export async function getSkiTopScores()    { return cacheSki; }
export async function getPokerTopWinners() { return cachePokerWinners; }
export async function getPokerTopLosers()  { return cachePokerLosers; }

export async function getAllPlayerNicks() {
  try {
    const snap = await getDocs(query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(100)));
    return snap.docs.map(d => d.data().nick);
  } catch(e) { return []; }
}

// ── LOGOWANIE I ZAPIS ────────────────────────────────────────────────────────
export async function loadPlayerData(nick, pin) {
  try {
    const snap = await getDoc(doc(db, 'leaderboard', nick));
    if (snap.exists()) {
      const d = snap.data();
      if (d.pin && d.pin !== pin) return { error: 'invalid_pin' };
      if (!d.pin) await setDoc(doc(db, 'leaderboard', nick), { pin }, { merge: true });
      updateStateFromFirebase(d);
    } else {
      await setDoc(doc(db, 'leaderboard', nick), {
        nick, pin, score: 0, coins: 0, activeSkin: 'bobby', unlockedSkins: ['bobby'],
        stats: { jumps: 0, deaths: 0, spikesHits: 0 }
      });
      updateStateFromFirebase({ nick, pin });
    }
    PlayerState.nick = nick;
    PlayerState.pin = pin;

    // Inicjacja strumieni dopiero po udanym logowaniu
    initRealtimeStreams();
    return { success: true };
  } catch (e) {
    console.error('Błąd logowania:', e);
    return { error: 'db_error' };
  }
}

export async function saveProgress(force = false) {
  if (!PlayerState.nick) return;
  if (saveTimeout) clearTimeout(saveTimeout);

  const doSave = async () => {
    try {
      await setDoc(doc(db, 'leaderboard', PlayerState.nick), {
        score: PlayerState.bestScore,
        spikesBestScore: PlayerState.spikesBestScore,
        skiBestScore: PlayerState.skiBestScore,
        coins: PlayerState.coins,
        activeSkin: PlayerState.activeSkin,
        unlockedSkins: PlayerState.unlockedSkins,
        stats: PlayerState.stats
      }, { merge: true });
    } catch(e) { console.error('Błąd zapisu:', e); }
  };

  if (force) doSave();
  else saveTimeout = setTimeout(doSave, 2500);
}

// ── ATOMOWE TRANSAKCJE BAZY DANYCH (Backend Authority) ────────────────────────
export async function createBountySecurely(creatorNick, victimNick, mode, targetScore, reward) {
  return await runTransaction(db, async (t) => {
    const creatorRef = doc(db, 'leaderboard', creatorNick);
    const creatorDoc = await t.get(creatorRef);
    const currentCoins = creatorDoc.data()?.coins || 0;

    if (currentCoins < reward) throw new Error("Nie masz tyle monet!");

    const newBountyRef = doc(collection(db, 'bounties'));
    t.update(creatorRef, { coins: currentCoins - reward }); // Pobranie z konta

    t.set(newBountyRef, {
      creator: creatorNick,
      victim: victimNick,
      mode: mode,
      targetScore: targetScore,
      reward: reward,
      createdAt: Date.now()
    });
    return true;
  });
}

export async function claimBountySecurely(bountyId, claimantNick) {
  return await runTransaction(db, async (t) => {
    const bountyRef = doc(db, 'bounties', bountyId);
    const claimantRef = doc(db, 'leaderboard', claimantNick);

    const bountyDoc = await t.get(bountyRef);
    if (!bountyDoc.exists()) throw new Error("Zlecenie nie istnieje lub ktoś Cię ubiegł!");
    const bounty = bountyDoc.data();

    // Weryfikacja tożsamości
    if (bounty.victim.toLowerCase() !== claimantNick.toLowerCase()) {
      throw new Error("To nie jest zlecenie na Twoją głowę!");
    }

    const claimantDoc = await t.get(claimantRef);
    const claimantData = claimantDoc.data();

    // BEZPIECZEŃSTWO: Source of Truth. Sprawdzamy wynik zapisany w BAZIE, nie u klienta.
    let currentBest = 0;
    if (bounty.mode === 'flappy') currentBest = claimantData.score || 0;
    else if (bounty.mode === 'spikes') currentBest = claimantData.spikesBestScore || 0;
    else if (bounty.mode === 'ski') currentBest = claimantData.skiBestScore || 0;
    else if (bounty.mode === 'poker') currentBest = claimantData.pokerNetProfit || 0;

    if (currentBest < bounty.targetScore) {
      throw new Error(`Oficjalny wynik w bazie to ${currentBest}. Za mało!`);
    }

    // Przelew nagrody i usunięcie kontraktu
    t.update(claimantRef, { coins: (claimantData.coins || 0) + bounty.reward });
    t.delete(bountyRef);

    return bounty.reward;
  });
}
