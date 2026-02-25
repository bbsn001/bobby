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

export async function createBountyInDb(victim, targetScore, reward) {
  try {
    await addDoc(collection(db, 'bounties'), {
      creator: PlayerState.nick,
      victim: victim,
      targetScore: Number(targetScore),
      reward: Number(reward),
      createdAt: new Date()
    });
    return true;
  } catch (e) { console.warn('Błąd createBounty:', e); return false; }
}

export async function removeBountyFromDb(bountyId) {
  try {
    await deleteDoc(doc(db, 'bounties', bountyId));
    return true;
  } catch (e) { console.warn('Błąd removeBounty:', e); return false; }
}
