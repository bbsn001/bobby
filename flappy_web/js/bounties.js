// js/bounties.js
import { PlayerState } from './state.js';
import { fetchActiveBounties, createBountyInDb, removeBountyFromDb, saveProgress, getAllPlayerNicks } from './firebase.js';
import { showLobby, showBounties, updateHUD } from './ui.js';

const bountiesList = document.getElementById('bountiesList');
const btnShowBountyForm = document.getElementById('btnShowBountyForm');
const bountyForm = document.getElementById('bountyForm');
const bountyError = document.getElementById('bountyError');

const vNick = document.getElementById('bountyVictim');
const vScore = document.getElementById('bountyScore');
const vReward = document.getElementById('bountyReward');

let isFetching = false;

// ── Renderowanie Tablicy ──────────────────────────────────────────────────────
export async function loadAndRenderBounties() {
  if (isFetching) return;
  isFetching = true;
  bountiesList.innerHTML = '<div style="color:#8be; text-align:center;">Szukanie frajerów...</div>';

  const list = await fetchActiveBounties();
  bountiesList.innerHTML = '';

  if (list.length === 0) {
    bountiesList.innerHTML = '<div style="color:#666; text-align:center;">Nikt nie ma kosy. Cicho tu.</div>';
    isFetching = false; return;
  }

  list.forEach(b => {
    const isMeVictim = b.victim.toLowerCase() === PlayerState.nick.toLowerCase();
    const isMeCreator = b.creator === PlayerState.nick;

    const card = document.createElement('div');
    card.style.cssText = 'background:#0f1432; border:1px solid #333; border-radius:8px; padding:10px; text-align:left; position:relative;';

    let html = `
      <div style="font-size:0.75rem; color:#888;">Zleceniodawca: <span style="color:#fff">${b.creator}</span></div>
      <div style="font-size:0.9rem; color:#aaa; margin-top:4px;">Ofiara: <span style="color:#dc3232; font-weight:bold;">${b.victim}</span></div>
      <div style="font-size:0.85rem; color:#ffd700; margin-top:4px;">Wymóg: <span style="color:#fff; font-weight:bold;">Wbij ${b.targetScore} pkt</span></div>
      <div style="font-size:0.85rem; color:#22b422; margin-top:4px;">Nagroda: <span style="font-weight:bold;">\uD83C\uDFB5 ${b.reward}</span></div>
    `;

    // Logika przycisków akcji (Ochrona przed oszustwem)
    if (isMeVictim) {
      const canClaim = PlayerState.bestScore >= b.targetScore;
      if (canClaim) {
        html += `<button class="btn btn-sm" style="position:absolute; right:10px; top:50%; transform:translateY(-50%); background:#22b422; color:#fff;" data-claim="${b.id}" data-reward="${b.reward}">ZGARNIJ</button>`;
      } else {
        html += `<div style="position:absolute; right:10px; top:50%; transform:translateY(-50%); color:#666; font-size:0.75rem; text-align:center;">Twój max<br>to ${PlayerState.bestScore}</div>`;
      }
    } else if (isMeCreator) {
      html += `<button class="btn btn-sm btn-dark" style="position:absolute; right:10px; top:50%; transform:translateY(-50%);" data-cancel="${b.id}" data-reward="${b.reward}">ANULUJ</button>`;
    }

    card.innerHTML = html;
    bountiesList.appendChild(card);
  });

  // Podpięcie eventów pod wygenerowane przyciski
  bountiesList.querySelectorAll('button[data-claim]').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = '...';
      const id = btn.getAttribute('data-claim');
      const rew = parseInt(btn.getAttribute('data-reward'));

      PlayerState.coins += rew;
      await removeBountyFromDb(id);
      await saveProgress(true);
      updateHUD(PlayerState.bestScore);
      loadAndRenderBounties();
    };
  });

  bountiesList.querySelectorAll('button[data-cancel]').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = '...';
      const id = btn.getAttribute('data-cancel');
      const rew = parseInt(btn.getAttribute('data-reward'));

      PlayerState.coins += rew; // Zwrot kasy
      await removeBountyFromDb(id);
      await saveProgress(true);
      updateHUD(PlayerState.bestScore);
      loadAndRenderBounties();
    };
  });

  isFetching = false;
}

// ── Tworzenie Zlecenia ────────────────────────────────────────────────────────
document.getElementById('btnSubmitBounty').addEventListener('click', async () => {
  const victim = vNick.value.trim();
  const score = parseInt(vScore.value);
  const reward = parseInt(vReward.value);

  if (!victim || !score || !reward || score <= 0 || reward <= 0) {
    bountyError.textContent = 'Wypełnij to porządnie!'; bountyError.style.display = 'block'; return;
  }
  if (victim.toLowerCase() === PlayerState.nick.toLowerCase()) {
    bountyError.textContent = 'Nie możesz wycenić własnej głowy!'; bountyError.style.display = 'block'; return;
  }
  if (PlayerState.coins < reward) {
    bountyError.textContent = 'Nie stać Cię na taki kontrakt biedaku.'; bountyError.style.display = 'block'; return;
  }

  bountyError.style.display = 'none';
  document.getElementById('btnSubmitBounty').disabled = true;

  // Pobranie kasy z góry
  PlayerState.coins -= reward;
  await saveProgress(true);
  updateHUD(PlayerState.bestScore);

  const success = await createBountyInDb(victim, score, reward);
  if (success) {
    vNick.value = ''; vScore.value = ''; vReward.value = '';
    bountyForm.style.display = 'none';
    btnShowBountyForm.style.display = 'block';
    loadAndRenderBounties();
  } else {
    // W razie błędu bazy, oddajemy monety (Antifragile)
    PlayerState.coins += reward;
    await saveProgress(true);
    updateHUD(PlayerState.bestScore);
    bountyError.textContent = 'Błąd serwera. Hajs zwrócony.'; bountyError.style.display = 'block';
  }
  document.getElementById('btnSubmitBounty').disabled = false;
});

// ── Bindowanie Głównego UI ────────────────────────────────────────────────────
document.getElementById('lobbyBounties').addEventListener('click', () => {
  showBounties();
  loadAndRenderBounties(); // Lazy Load odpalany TYLKO przy wejściu w ekran
});
document.getElementById('bountiesBack').addEventListener('click', showLobby);

btnShowBountyForm.addEventListener('click', async () => {
  btnShowBountyForm.disabled = true;
  btnShowBountyForm.textContent = 'Szukanie ofiar w okolicy...';

  const nicks = await getAllPlayerNicks();

  // Budowanie opcji do selecta
  vNick.innerHTML = '<option value="">Wybierz ofiarę z listy...</option>';
  nicks.forEach(n => {
    if (n.toLowerCase() !== PlayerState.nick.toLowerCase()) {
      const opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      vNick.appendChild(opt);
    }
  });

  btnShowBountyForm.textContent = '➕ WYCEŃ CZYJĄŚ GŁOWĘ';
  btnShowBountyForm.disabled = false;

  btnShowBountyForm.style.display = 'none';
  bountyForm.style.display = 'block';
});
