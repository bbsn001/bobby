// js/bounties.js
import { EventEmitter } from './events.js';
import { PlayerState } from './state.js';
import { getAllPlayerNicks } from './firebase.js';
import { socket } from './poker.js';

const bountiesList = document.getElementById('bountiesList');
const btnShowBountyForm = document.getElementById('btnShowBountyForm');
const bountyForm = document.getElementById('bountyForm');
const bountyError = document.getElementById('bountyError');

const vNick = document.getElementById('bountyVictim');
const vMode = document.getElementById('bountyMode');
const vScore = document.getElementById('bountyScore');
const vReward = document.getElementById('bountyReward');

// ── REAKTYWNY NASŁUCH ZDARZEŃ (Inwersja Kontroli) ─────────────────────────────
EventEmitter.on('BOUNTIES_UPDATED', (bountiesArray) => {
  renderBountiesList(bountiesArray);
});

EventEmitter.on('UI_NAVIGATE', (payload) => {
  // Resetujemy formularz przy wejściu w widok
  if (payload.screen === 'bounties') {
    bountyForm.style.display = 'none';
    btnShowBountyForm.style.display = 'block';
    bountyError.style.display = 'none';
  }
});

// ── RENDEROWANIE WIDOKU ───────────────────────────────────────────────────────
function renderBountiesList(list) {
  bountiesList.innerHTML = '';

  if (list.length === 0) {
    bountiesList.innerHTML = '<div style="color:#666; text-align:center;">Nikt nie ma kosy. Cicho tu.</div>';
    return;
  }

  list.forEach(b => {
    const isMe = b.victim.toLowerCase() === PlayerState.nick.toLowerCase();
    const div = document.createElement('div');
    div.style.cssText = `background:#0f1432; border:1px solid ${isMe ? '#dc3232' : '#333'}; border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:6px;`;

    const modeLabels = { flappy: '🐦 Klasyk', spikes: '🔥 Kolce', ski: '🏔️ Skoki', poker: '🎰 Kasyno' };
    const mLabel = modeLabels[b.mode] || b.mode;

    let html = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span style="color:#fff; font-weight:bold; font-size:1.1rem;">CEL: <span style="color:${isMe ? '#dc3232' : '#ffd700'}">${b.victim}</span></span>
        <span style="color:#8be; font-size:0.8rem;">Zleca: ${b.creator}</span>
      </div>
      <div style="color:#aaa; font-size:0.85rem; display:flex; justify-content:space-between;">
        <span>Tryb: <span style="color:#fff">${mLabel}</span></span>
        <span>Wymaga: <span style="color:#fff">${b.targetScore}</span></span>
      </div>
      <div style="color:#ffd700; font-weight:bold; font-size:1rem; text-align:center; margin-top:4px;">NAGRODA: 🎵 ${b.reward}</div>
    `;

    if (isMe) {
      // Przygotowujemy nasz aktualny wynik w danym trybie dla celów wizualnych
      let currentBest = 0;
      if (b.mode === 'flappy') currentBest = PlayerState.bestScore;
      else if (b.mode === 'spikes') currentBest = PlayerState.spikesBestScore;
      else if (b.mode === 'ski') currentBest = PlayerState.skiBestScore;
      else if (b.mode === 'poker') currentBest = PlayerState.pokerNetProfit;

      const progressColor = currentBest >= b.targetScore ? '#22b422' : '#dc3232';
      html += `<div style="text-align:center; font-size:0.8rem; color:${progressColor}; margin-bottom:5px;">Twój rekord: ${currentBest} / ${b.targetScore}</div>`;

      const btn = document.createElement('button');
      btn.className = 'btn btn-yellow btn-sm';
      btn.style.width = '100%'; btn.style.height = '35px';
      btn.textContent = currentBest >= b.targetScore ? 'ZGARNIJ NAGRODĘ' : 'WYNIK ZA SŁABY';
      btn.disabled = currentBest < b.targetScore;

      // LOGIKA ODBIORU (Transakcja Backendowa przez Socket)
      btn.onclick = () => {
        btn.disabled = true;
        btn.textContent = 'Autoryzacja...';
        socket.emit('claim_bounty', { bountyId: b.id, claimantNick: PlayerState.nick }, (res) => {
          if (res.error) {
            alert('Odrzucono: ' + res.error);
            btn.textContent = 'BŁĄD WERYFIKACJI';
          } else {
            PlayerState.coins += res.reward; // Proxy odświeży UI automatycznie!
            btn.textContent = 'NAGRODA ODEBRANA!';
          }
        });
      };

      div.innerHTML = html;
      div.appendChild(btn);
    } else {
      div.innerHTML = html;
    }

    bountiesList.appendChild(div);
  });
}

// ── LOGIKA TWORZENIA ZLECENIA ─────────────────────────────────────────────────
btnShowBountyForm.addEventListener('click', async () => {
  btnShowBountyForm.disabled = true;
  btnShowBountyForm.textContent = 'Szukanie ofiar w okolicy...';

  const nicks = await getAllPlayerNicks();
  vNick.innerHTML = '<option value="">Wybierz ofiarę z listy...</option>';
  nicks.forEach(n => {
    if (n.toLowerCase() !== PlayerState.nick.toLowerCase()) {
      const opt = document.createElement('option');
      opt.value = n; opt.textContent = n;
      vNick.appendChild(opt);
    }
  });

  btnShowBountyForm.style.display = 'none';
  bountyForm.style.display = 'block';
  btnShowBountyForm.disabled = false;
  btnShowBountyForm.textContent = '➕ WYCEŃ CZYJĄŚ GŁOWĘ';
});

document.getElementById('btnSubmitBounty').addEventListener('click', async () => {
  const victim = vNick.value;
  const mode = vMode.value;
  const score = parseInt(vScore.value);
  const reward = parseInt(vReward.value);

  if (!victim || isNaN(score) || score <= 0 || isNaN(reward) || reward <= 0) {
    bountyError.textContent = 'Wypełnij poprawnie wszystkie pola!';
    bountyError.style.display = 'block';
    return;
  }
  if (reward > PlayerState.coins) {
    bountyError.textContent = 'Jesteś spłukany! Nie stać Cię na zlecenie.';
    bountyError.style.display = 'block';
    return;
  }

  bountyError.style.display = 'none';
  document.getElementById('btnSubmitBounty').disabled = true;

  socket.emit('create_bounty', {
    creatorNick: PlayerState.nick, victimNick: victim, mode, targetScore: score, reward
  }, (res) => {
    if (res.error) {
      bountyError.textContent = res.error;
      bountyError.style.display = 'block';
    } else {
      PlayerState.coins -= reward; // Proxy odświeży UI automatycznie!
      vNick.value = ''; vScore.value = ''; vReward.value = '';
      bountyForm.style.display = 'none';
      btnShowBountyForm.style.display = 'block';
    }
    document.getElementById('btnSubmitBounty').disabled = false;
  });
});
