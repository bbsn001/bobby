// js/firebase.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, collection, doc, getDoc, setDoc, getDocs, query, orderBy, limit, addDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { PlayerState } from './state.js';

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

let saveTimeout = null;

export async function loadPlayerData(nick, pin) {
  try {
    const snap = await getDoc(doc(db, 'leaderboard', nick));
    if (snap.exists()) {
      const d = snap.data();
      if (d.pin && d.pin !== pin) return { error: 'invalid_pin' };
      if (!d.pin) await setDoc(doc(db, 'leaderboard', nick), { pin }, { merge: true });

      // Aktualizacja centralnego stanu z chmury
      PlayerState.updateFromFirebase(d);
      PlayerState.nick = nick;
      PlayerState.pin = pin;
      return { success: true };
    } else {
      // Rejestracja nowego gracza w pamięci RAM i bazie
      PlayerState.updateFromFirebase({}); // Inicjalizuje zera i postać 'bobby'
      PlayerState.nick = nick;
      PlayerState.pin = pin;

      await setDoc(doc(db, 'leaderboard', nick), {
        nick, score: 0, coins: 0, unlockedSkins: ['bobby'], activeSkin: 'bobby', pin, date: new Date(),
        stats: PlayerState.stats
      });
      return { success: true };
    }
  } catch(e) {
    console.warn('Błąd loadPlayerData:', e);
    return { error: 'network_error' };
  }
}

export async function saveProgress(immediate = false) {
  const executeSave = async () => {
    try {
      const ref = doc(db, 'leaderboard', PlayerState.nick);
      await setDoc(ref, {
        nick: PlayerState.nick,
        score: PlayerState.bestScore,
        skiBestScore: PlayerState.skiBestScore,
        spikesBestScore: PlayerState.spikesBestScore,
        date: new Date(),
        coins: PlayerState.coins,
        unlockedSkins: PlayerState.unlockedSkins,
        activeSkin: PlayerState.activeSkin,
        pin: PlayerState.pin,
        stats: PlayerState.stats
      }, { merge: true });
    } catch(e) { console.warn('Błąd saveProgress:', e); }
  };

  if (immediate) {
    if (saveTimeout) { clearTimeout(saveTimeout); saveTimeout = null; }
    await executeSave();
  } else {
    if (!saveTimeout) {
      saveTimeout = setTimeout(() => { executeSave(); saveTimeout = null; }, 5000);
    }
  }
}

export async function getTopScores() {
  try {
    const snap = await getDocs(query(collection(db, 'leaderboard'), orderBy('score','desc'), limit(10)));
    return snap.docs.map(d => d.data());
  } catch(e) { console.warn('Błąd getTopScores:', e); return []; }
}

export async function fetchActiveBounties() {
  try {
    const snap = await getDocs(query(collection(db, 'bounties'), orderBy('createdAt', 'desc')));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn('Błąd fetchActiveBounties:', e); return []; }
}

export async function createBountyInDb(victim, targetScore, reward, mode = 'flappy') {
  try {
    await addDoc(collection(db, 'bounties'), {
      creator: PlayerState.nick,
      victim: victim,
      targetScore: Number(targetScore),
      reward: Number(reward),
      mode: mode,
      createdAt: new Date()
    });
    return true;
  } catch (e) { console.warn('Błąd createBounty:', e); return false; }
}

export async function syncPlayerState() {
  try {
    if (!PlayerState.nick) return;
    const snap = await getDoc(doc(db, 'leaderboard', PlayerState.nick));
    if (snap.exists()) PlayerState.updateFromFirebase(snap.data());
  } catch(e) { console.warn('Błąd syncPlayerState:', e); }
}

export async function removeBountyFromDb(bountyId) {
  try {
    await deleteDoc(doc(db, 'bounties', bountyId));
    return true;
  } catch (e) { console.warn('Błąd removeBounty:', e); return false; }
}

export async function getSkiTopScores() {
  try {
    const snap = await getDocs(query(collection(db, 'leaderboard'), orderBy('skiBestScore','desc'), limit(10)));
    return snap.docs.map(d => d.data()).filter(d => (d.skiBestScore || 0) > 0);
  } catch(e) { console.warn('Błąd getSkiTopScores:', e); return []; }
}

export async function getSpikesTopScores() {
  try {
    const snap = await getDocs(query(collection(db, 'leaderboard'), orderBy('spikesBestScore','desc'), limit(10)));
    return snap.docs.map(d => d.data()).filter(d => (d.spikesBestScore || 0) > 0);
  } catch(e) { console.warn('Błąd getSpikesTopScores:', e); return []; }
}

export async function getAllPlayerNicks() {
  try {
    // Pobiera do 100 aktywnych graczy z bazy
    const snap = await getDocs(query(collection(db, 'leaderboard'), orderBy('score','desc'), limit(100)));
    return snap.docs.map(d => d.data().nick);
  } catch(e) { console.warn('Błąd pobierania listy graczy:', e); return []; }
}

export async function getPokerTopWinners() {
  try {
    // Pobiera top 5 graczy z największym plusem
    const snap = await getDocs(query(collection(db, 'leaderboard'), orderBy('pokerNetProfit','desc'), limit(5)));
    return snap.docs.map(d => d.data()).filter(d => (d.pokerNetProfit || 0) > 0);
  } catch(e) { console.warn('Błąd getPokerTopWinners:', e); return []; }
}

export async function getPokerTopLosers() {
  try {
    // Pobiera top 5 graczy z największym minusem (rosnąco, czyli od największego minusa w dół)
    const snap = await getDocs(query(collection(db, 'leaderboard'), orderBy('pokerNetProfit','asc'), limit(5)));
    return snap.docs.map(d => d.data()).filter(d => (d.pokerNetProfit || 0) < 0);
  } catch(e) { console.warn('Błąd getPokerTopLosers:', e); return []; }
}
