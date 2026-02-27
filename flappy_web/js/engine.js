// js/engine.js
import { GAME_CONFIG, CHARACTERS } from './config.js';
import { PlayerState, SessionState } from './state.js';
import { startMusic, stopMusic, startSpikesAudio, stopSpikesAudio, resumeMusic, resumeSpikesAudio, playSound, playSpecialSound, audioCtx, startWind, updateWind, stopWind } from './audio.js';
import { updateHUD, hideAll, showLobby, showShop, setShopFromWaiting } from './ui.js';
import { saveProgress, getTopScores, getSpikesTopScores } from './firebase.js';

const { GW, GH, GRAVITY, JUMP_FORCE, PIPE_SPEED, PIPE_WIDTH, BIRD_SIZE, COL_W } = GAME_CONFIG;

// ── Canvas & Setup ────────────────────────────────────────────────────────────
export const canvas = document.getElementById('gameCanvas');
export const ctx = canvas.getContext('2d');
const isMobile = window.innerWidth < 600;
const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
canvas.width = Math.round(GW * dpr);
canvas.height = Math.round(GH * dpr);
canvas.style.imageRendering = 'auto';
ctx.scale(dpr, dpr);

let canvasRect = { left: 0, top: 0, width: GW, height: GH };
window.addEventListener('resize', () => {
  const s = Math.min(window.innerWidth / GW, window.innerHeight / GH);
  canvas.style.width = (GW * s) + 'px'; canvas.style.height = (GH * s) + 'px';
  setTimeout(() => { canvasRect = canvas.getBoundingClientRect(); }, 0);
});
window.dispatchEvent(new Event('resize'));

let isGameCanvasVisible = false;
export function showGame() {
  hideAll();
  canvas.style.display = document.getElementById('hud').style.display = 'block';
  isGameCanvasVisible = true;
  window.dispatchEvent(new Event('resize'));
  startGameLoop();
}

// ── Obliczenia Sesji ──────────────────────────────────────────────────────────
export function computeSessionParams() {
  const b = CHARACTERS[PlayerState.activeSkin].bonuses;
  SessionState.S_GAP = GAME_CONFIG.PIPE_GAP + (b.includes('gap+30') ? 30 : b.includes('gap+20') ? 20 : b.includes('gap+10') ? 10 : 0);
  SessionState.S_SPEED = GAME_CONFIG.PIPE_SPEED * (b.includes('speed-15') ? 0.85 : b.includes('speed-10') ? 0.90 : b.includes('speed-5') ? 0.95 : 1);
  SessionState.S_DOUBLE = b.includes('double');
  SessionState.S_EXTRA = b.includes('extralife');
  SessionState.S_INTERVAL = GAME_CONFIG.PIPE_INTERVAL * (GAME_CONFIG.PIPE_SPEED / SessionState.S_SPEED);
}

// ── Ładowanie Zasobów (Grafika) ───────────────────────────────────────────────
const spriteCache = {}; const collectCache = {};
let playerImg = null, collectImg = null, collectH = COL_W;
const skierBodyImg = new Image(); skierBodyImg.src = 'assets/characters/skier_body.png';

function loadImage(src) {
  return new Promise(res => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => res(img); img.onerror = () => res(null);
    img.src = src;
  });
}

export async function applyActiveSkin(key) {
  const ch = CHARACTERS[key];
  if (!spriteCache[key]) spriteCache[key] = await loadImage(`assets/characters/${ch.img || key+'.png'}`);
  if (!collectCache[key]) {
    const img = await loadImage(`assets/collectibles/${ch.col || key+'_col.png'}`);
    collectCache[key] = img ? { img, h: Math.max(1, Math.round(img.naturalHeight * COL_W / img.naturalWidth)) } : null;
  }
  playerImg = spriteCache[key] || null;
  collectImg = collectCache[key] ? collectCache[key].img : null;
  collectH = collectCache[key] ? collectCache[key].h : COL_W;
}

// ── Tło i UI Cache (High-Res 3D) ──────────────────────────────────────────────
function createHiResCache(w, h) {
  const cvs = document.createElement('canvas');
  cvs.width = Math.round(w * dpr);
  cvs.height = Math.round(h * dpr);
  const cx = cvs.getContext('2d');
  cx.scale(dpr, dpr);
  return { cvs, cx };
}

const { cvs: bgCacheCanvas, cx: bgCtx } = createHiResCache(GW, GH);
bgCtx.fillStyle = '#0f1432'; bgCtx.fillRect(0, 0, GW, GH);
bgCtx.fillStyle = '#b4c8ff';
Array.from({ length: 25 }).forEach(() => {
  bgCtx.beginPath(); bgCtx.arc(Math.random()*GW, Math.random()*GH*0.75, Math.random()<0.3?1.5:1, 0, Math.PI*2); bgCtx.fill();
});

const SHOP_BTN = { x: GW - 120, y: GH - 80, w: 110, h: 64 };
const LOBBY_BTN = { x: 10, y: GH - 80, w: 110, h: 64 };
let uiCacheReady = false;
const { cvs: uiCacheCanvas, cx: uctx } = createHiResCache(GW, GH);

function buildUICache() {
  uctx.clearRect(0, 0, GW, GH);
  // Tytuł z cieniem 3D
  uctx.textAlign = 'center'; uctx.font = '900 52px Arial';
  uctx.fillStyle = '#0f1432'; uctx.fillText('Bobby Bird', GW/2 + 4, GH/4 + 14);
  uctx.fillStyle = '#ffd700'; uctx.fillText('Bobby Bird', GW/2, GH/4 + 10);

  // Przycisk SKLEP (Z efektem wciśnięcia 3D)
  uctx.fillStyle = '#0a0a22'; uctx.beginPath(); uctx.roundRect(SHOP_BTN.x, SHOP_BTN.y + 5, SHOP_BTN.w, SHOP_BTN.h, 12); uctx.fill();
  uctx.fillStyle = '#1a6aff'; uctx.beginPath(); uctx.roundRect(SHOP_BTN.x, SHOP_BTN.y, SHOP_BTN.w, SHOP_BTN.h, 12); uctx.fill();
  uctx.font = 'bold 18px Arial'; uctx.fillStyle = '#fff'; uctx.fillText('🛒 SKLEP', SHOP_BTN.x + SHOP_BTN.w/2, SHOP_BTN.y + SHOP_BTN.h/2 + 7);

  // Przycisk LOBBY (Z efektem wciśnięcia 3D)
  uctx.fillStyle = '#0a0a22'; uctx.beginPath(); uctx.roundRect(LOBBY_BTN.x, LOBBY_BTN.y + 5, LOBBY_BTN.w, LOBBY_BTN.h, 12); uctx.fill();
  uctx.fillStyle = '#dc3232'; uctx.beginPath(); uctx.roundRect(LOBBY_BTN.x, LOBBY_BTN.y, LOBBY_BTN.w, LOBBY_BTN.h, 12); uctx.fill();
  uctx.font = 'bold 16px Arial'; uctx.fillText('🏠 LOBBY', LOBBY_BTN.x + LOBBY_BTN.w/2, LOBBY_BTN.y + LOBBY_BTN.h/2 + 7);
  uiCacheReady = true;
}

// Zmienne Tablicowe (Teraz na High-Res)
let leaderboard = [], leaderboardLoading = false, lbCacheReady = false, cachedLeaderboard = [], lastLeaderboardFetch = 0;
const { cvs: lbCacheCanvas, cx: lbCtx } = createHiResCache(GW, 300);

let spikesLeaderboard = [], spikesLbLoading = false, spikesLbReady = false, spikesCachedLb = [], lastSpikesLbFetch = 0;
const { cvs: spikesLbCacheCanvas, cx: spikesLbCtx } = createHiResCache(GW, 300);

// Pamięć podręczna dla kolców
const { cvs: spikeLeftCanvas, cx: spikeLeftCtx } = createHiResCache(24, 32);
spikeLeftCtx.fillStyle = '#888'; spikeLeftCtx.beginPath(); spikeLeftCtx.moveTo(0,0); spikeLeftCtx.lineTo(24,16); spikeLeftCtx.lineTo(0,32); spikeLeftCtx.fill();

const { cvs: spikeRightCanvas, cx: spikeRightCtx } = createHiResCache(24, 32);
spikeRightCtx.fillStyle = '#888'; spikeRightCtx.beginPath(); spikeRightCtx.moveTo(24,0); spikeRightCtx.lineTo(0,16); spikeRightCtx.lineTo(24,32); spikeRightCtx.fill();

// ── Pomocnicze funkcje fizyczne ───────────────────────────────────────────────
function overlaps(a, b) { return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y; }
function overlapsSpike(br, spY, side) {
  const tipX = side === 'left' ? 24 : GW - 24;
  if (side === 'left' && br.x > tipX) return false;
  if (side === 'right' && br.x + br.w < tipX) return false;
  const pen = side === 'left' ? tipX - br.x : (br.x + br.w) - tipX;
  const allY = 16 * Math.min(1, pen / 24);
  return (br.y <= spY + allY && br.y + br.h >= spY - allY);
}

// Bezpieczna wersja funkcji renderującej bez wycieków stanu
function txt(context, str, x, y, font, color, align = 'center') {
  context.font = font;
  context.fillStyle = color;
  context.textAlign = align;
  context.fillText(str, x, y);
}
function overlay(a) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, GW, GH); }
function drawBirdAt(x, y, angle) {
  if (!playerImg) return;
  ctx.save(); ctx.translate(x + BIRD_SIZE/2, y + BIRD_SIZE/2); ctx.rotate(angle * Math.PI / 180);
  ctx.drawImage(playerImg, -BIRD_SIZE/2, -BIRD_SIZE/2, BIRD_SIZE, BIRD_SIZE); ctx.restore();
}

// ── Maszyna Stanów ────────────────────────────────────────────────────────────
export const SceneManager = {
  activeScene: null,
  changeScene(newScene) {
    stopMusic(); stopSpikesAudio();
    if (this.activeScene && this.activeScene.cleanup) this.activeScene.cleanup();
    this.activeScene = newScene;
    if (this.activeScene.init) this.activeScene.init();
  },
  update(dt) { if (this.activeScene && this.activeScene.update) this.activeScene.update(dt); },
  draw() { if (this.activeScene && this.activeScene.draw) this.activeScene.draw(); },
  onAction(px, py) { if (this.activeScene && this.activeScene.onAction) this.activeScene.onAction(px, py); }
};

const _cr = { x: 0, y: 0, w: 0, h: 0 };
const _pr = { x: 0, y: 0, w: 0, h: 0 };

// ── Tryb Flappy ───────────────────────────────────────────────────────────────
export const FlappyMode = {
  state: 'waiting', score: 0, pipeTimer: 0, gameOverAt: 0,
  pipePool: Array.from({ length: 6 }, () => ({ active: false, x: 0, topH: 0, botY: 0, passed: false, collected: false })),
  bird: {
    x: 80, y: 300, vy: 0, _r: { x: 0, y: 0, w: BIRD_SIZE - 30, h: BIRD_SIZE - 30 },
    jump() { this.vy = JUMP_FORCE; PlayerState.stats.jumps++; },
    update(dt) { const f = dt/16.667; this.vy += GRAVITY * f; this.y += this.vy * f + 0.5 * GRAVITY * f * f; },
    rect() { this._r.x = this.x + 15; this._r.y = this.y + 15; return this._r; }
  },
  init() { this.resetState(); updateHUD(this.score); },
  resetState() {
    this.bird.x = 80; this.bird.y = GH/2; this.bird.vy = 0;
    this.pipePool.forEach(p => p.active = false);
    this.pipeTimer = this.score = 0; leaderboard = []; leaderboardLoading = false; lbCacheReady = false;
    SessionState.extraLifeAvail = SessionState.S_EXTRA; SessionState.flashUntil = 0; this.state = 'waiting';
  },
  startGame() { this.state = 'playing'; this.bird.jump(); startMusic(); },
  async die() {
    if (SessionState.extraLifeAvail) { SessionState.extraLifeAvail = false; SessionState.flashUntil = performance.now() + 1500; this.bird.vy = JUMP_FORCE; return; }
    PlayerState.stats.deaths++; stopMusic(); this.gameOverAt = performance.now(); this.state = 'gameover';
    leaderboardLoading = true; leaderboard = []; saveProgress();

    if (this.score > PlayerState.bestScore) {
      PlayerState.bestScore = this.score;
      const me = cachedLeaderboard.find(e => e.nick === PlayerState.nick);
      if (me) me.score = this.score; else cachedLeaderboard.push({ nick: PlayerState.nick, score: this.score });
      cachedLeaderboard.sort((a,b) => b.score - a.score); cachedLeaderboard = cachedLeaderboard.slice(0, 10);
    }
    if (performance.now() - lastLeaderboardFetch > 60000 || !cachedLeaderboard.length) { cachedLeaderboard = await getTopScores(); lastLeaderboardFetch = performance.now(); }
    leaderboard = cachedLeaderboard; leaderboardLoading = false; this.renderLb();
  },
  renderLb() {
    lbCacheCanvas.width = GW; lbCacheCanvas.height = 300; lbCtx.clearRect(0, 0, GW, 300);
    leaderboard.forEach((e, i) => {
      const color = e.nick === PlayerState.nick ? '#ffd700' : (i < 3 ? '#fff' : '#909090');
      txt(lbCtx, `${i+1}. ${e.nick}`, 22, 20 + i*22, '13px Arial', color, 'left'); txt(lbCtx, String(e.score), GW-22, 20 + i*22, '13px Arial', color, 'right');
    }); lbCacheReady = true;
  },
  update(dt) {
    if (this.state !== 'playing') return;
    this.bird.update(dt); this.pipeTimer += dt;
    if (this.pipeTimer >= SessionState.S_INTERVAL) {
      const p = this.pipePool.find(px => !px.active);
      if (p) { p.active = true; p.x = GW; p.topH = (GH/4 + Math.random()*(GH/2)) - SessionState.S_GAP/2; p.botY = p.topH + SessionState.S_GAP; p.passed = p.collected = false; }
      this.pipeTimer = 0;
    }
    const f = dt / 16.667; const br = this.bird.rect(); const inv = performance.now() < SessionState.flashUntil;

    for (const p of this.pipePool) {
      if (!p.active) continue;
      p.x -= SessionState.S_SPEED * f;
      if (!p.passed && p.x + PIPE_WIDTH < this.bird.x) p.passed = true;
      if (p.x + PIPE_WIDTH <= 0) { p.active = false; continue; }

      if (!p.collected) {
        _cr.x = p.x + PIPE_WIDTH/2 - COL_W/2; _cr.y = (p.topH + p.botY)/2 - collectH/2; _cr.w = COL_W; _cr.h = collectH;
        if (overlaps(br, _cr)) {
          p.collected = true;
          const pts = SessionState.S_DOUBLE ? 2 : 1;
          this.score += pts; PlayerState.coins += pts;
          const sfx = CHARACTERS[PlayerState.activeSkin].sfx || 'kaching';
          playSound(sfx, 0.5);
          playSpecialSound(this.score);
        }
      }
      if (!inv) {
        _pr.x = p.x; _pr.w = PIPE_WIDTH; _pr.y = 0; _pr.h = p.topH - 28; if (overlaps(br, _pr)) return this.die();
        _pr.x = p.x-10; _pr.w = PIPE_WIDTH+20; _pr.y = p.topH-28; _pr.h = 28; if (overlaps(br, _pr)) return this.die();
        _pr.x = p.x-10; _pr.w = PIPE_WIDTH+20; _pr.y = p.botY; _pr.h = 28; if (overlaps(br, _pr)) return this.die();
        _pr.x = p.x; _pr.w = PIPE_WIDTH; _pr.y = p.botY+28; _pr.h = GH - (p.botY+28); if (overlaps(br, _pr)) return this.die();
      }
    }
    if (this.bird.y > GH || this.bird.y < -BIRD_SIZE) this.die();
  },
  draw() {
    ctx.globalAlpha = this.state === 'waiting' ? 0.65 : 1.0;
    ctx.drawImage(bgCacheCanvas, 0, 0, GW, GH);
    ctx.globalAlpha = 1.0;

    for (const p of this.pipePool) {
      if (!p.active) continue;
      ctx.fillStyle = '#22b422'; if (p.topH > 0) ctx.fillRect(p.x, 0, PIPE_WIDTH, p.topH); if (p.botY < GH) ctx.fillRect(p.x, p.botY, PIPE_WIDTH, GH - p.botY);
      ctx.fillStyle = '#127812'; if (p.topH > 0) ctx.fillRect(p.x-10, p.topH - 28, PIPE_WIDTH+20, 28); if (p.botY < GH) ctx.fillRect(p.x-10, p.botY, PIPE_WIDTH+20, 28);
      if (collectImg && !p.collected) ctx.drawImage(collectImg, p.x+PIPE_WIDTH/2-COL_W/2, (p.topH+p.botY)/2-collectH/2, COL_W, collectH);
    }

    if (this.state !== 'waiting' && (!SessionState.flashUntil || ((performance.now() / 150) | 0) % 2 === 0)) drawBirdAt(this.bird.x, this.bird.y, Math.max(-35, Math.min(50, -this.bird.vy*3)));
    updateHUD(this.score);

    if (this.state === 'waiting') {
      if (!uiCacheReady) buildUICache();
      ctx.drawImage(uiCacheCanvas, 0, 0, GW, GH);
      drawBirdAt(GW/2 - BIRD_SIZE/2, GH/2 - BIRD_SIZE/2 + Math.sin(performance.now()/333)*12, 0);
      if (((performance.now() / 600) | 0) % 2 === 0) txt(ctx, 'Tap lub SPACJA aby zacząć', GW/2, GH*2/3+10, 'bold 20px Arial', '#fff');
    } else if (this.state === 'gameover') {
      overlay(0.62);
      txt(ctx, 'GAME OVER', GW/2 + 2, 74, '900 44px Arial', '#000');
      txt(ctx, 'GAME OVER', GW/2, 72, '900 44px Arial', '#dc3232');
      txt(ctx, 'Score: '+this.score, GW/2 + 2, 110, 'bold 26px Arial', '#000');
      txt(ctx, 'Score: '+this.score, GW/2, 108, 'bold 26px Arial', '#ffd700');
      ctx.strokeStyle='#444'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(20,122); ctx.lineTo(GW-20,122); ctx.stroke();
      txt(ctx, '\uD83C\uDFC6 TOP 10', GW/2, 138, 'bold 15px Arial', '#ffd700');

      if (leaderboardLoading) txt(ctx, 'Ładowanie...', GW/2, 160, '13px Arial', '#888');
      else if (lbCacheReady) ctx.drawImage(lbCacheCanvas, 0, 138, GW, 300);

      ctx.beginPath(); ctx.moveTo(20,380); ctx.lineTo(GW-20,380); ctx.stroke();

      ctx.fillStyle = '#0a0a22'; ctx.beginPath(); ctx.roundRect(LOBBY_BTN.x, LOBBY_BTN.y + 5, LOBBY_BTN.w, LOBBY_BTN.h, 12); ctx.fill();
      ctx.fillStyle = '#dc3232'; ctx.beginPath(); ctx.roundRect(LOBBY_BTN.x, LOBBY_BTN.y, LOBBY_BTN.w, LOBBY_BTN.h, 12); ctx.fill();
      txt(ctx, '🏠 LOBBY', LOBBY_BTN.x + LOBBY_BTN.w/2, LOBBY_BTN.y + LOBBY_BTN.h/2 + 7, 'bold 16px Arial', '#fff');

      if (performance.now() - this.gameOverAt > 1000) txt(ctx, 'Tapnij, aby zagrać ponownie', GW/2, LOBBY_BTN.y - 20, '15px Arial', '#fff');
    }
  },
  onAction(px, py) {
    if (px !== undefined) {
      if (this.state === 'waiting' && px>=SHOP_BTN.x && px<=SHOP_BTN.x+SHOP_BTN.w && py>=SHOP_BTN.y && py<=SHOP_BTN.y+SHOP_BTN.h) { setShopFromWaiting(true); showShop(); return; }
      if ((this.state === 'waiting' || this.state === 'gameover') && px>=LOBBY_BTN.x && px<=LOBBY_BTN.x+LOBBY_BTN.w && py>=LOBBY_BTN.y && py<=LOBBY_BTN.y+LOBBY_BTN.h) { stopMusic(); showLobby(); return; }
    }
    if (this.state === 'waiting') this.startGame(); else if (this.state === 'playing') this.bird.jump(); else if (this.state === 'gameover' && performance.now() - this.gameOverAt > 1000) this.resetState();
  }
};

// ── Tryb Spikes ───────────────────────────────────────────────────────────────
export const SpikesMode = {
  state: 'waiting', score: 0, gameOverAt: 0, spikesLeft: [], spikesRight: [], maxSpikes: 3, _secArray: [0,1,2,3,4,5,6,7,8,9,10,11],
  bird: {
    x: GW/2 - BIRD_SIZE/2, y: GH/2, vx: 4.5, vy: 0, _r: { x: 0, y: 0, w: BIRD_SIZE - 12, h: BIRD_SIZE - 12 },
    jump() { this.vy = JUMP_FORCE; PlayerState.stats.jumps++; },
    update(dt) { const f = dt/16.667; this.vy += GRAVITY * f; this.y += this.vy * f + 0.5 * GRAVITY * f * f; this.x += this.vx * f; },
    rect() { this._r.x = this.x + 6; this._r.y = this.y + 6; return this._r; }
  },
  init() { this.resetState(); updateHUD(this.score); },
  resetState() {
    this.bird.x = GW/2 - BIRD_SIZE/2; this.bird.y = GH/2; this.bird.vx = Math.random() > 0.5 ? 4.5 : -4.5; this.bird.vy = 0;
    this.score = 0; this.maxSpikes = 3; this.spikesLeft = []; this.spikesRight = [];
    spikesLeaderboard = []; spikesLbLoading = false; spikesLbReady = false; // Reset GUI
    SessionState.extraLifeAvail = SessionState.S_EXTRA; SessionState.flashUntil = 0; this.state = 'waiting';
  },
  startGame() { this.state = 'playing'; this.bird.jump(); startSpikesAudio(); },
  async die() {
    if (SessionState.extraLifeAvail) { SessionState.extraLifeAvail = false; SessionState.flashUntil = performance.now() + 1500; this.bird.vy = JUMP_FORCE; return; }
    PlayerState.stats.deaths++; stopSpikesAudio(); this.gameOverAt = performance.now(); this.state = 'gameover';
    spikesLbLoading = true; spikesLeaderboard = []; saveProgress();

    if (this.score > PlayerState.spikesBestScore) {
      PlayerState.spikesBestScore = this.score;
      const me = spikesCachedLb.find(e => e.nick === PlayerState.nick);
      if (me) me.spikesBestScore = this.score; else spikesCachedLb.push({ nick: PlayerState.nick, spikesBestScore: this.score });
      spikesCachedLb.sort((a,b) => b.spikesBestScore - a.spikesBestScore); spikesCachedLb = spikesCachedLb.slice(0, 10);
      saveProgress(true); // Ostre zapisanie przy pobiciu
    }

    if (performance.now() - lastSpikesLbFetch > 60000 || !spikesCachedLb.length) {
      spikesCachedLb = await getSpikesTopScores();
      lastSpikesLbFetch = performance.now();
    }
    spikesLeaderboard = spikesCachedLb; spikesLbLoading = false; this.renderLb();
  },
  renderLb() {
    spikesLbCacheCanvas.width = GW; spikesLbCacheCanvas.height = 300; spikesLbCtx.clearRect(0, 0, GW, 300);
    spikesLeaderboard.forEach((e, i) => {
      const color = e.nick === PlayerState.nick ? '#ffd700' : (i < 3 ? '#fff' : '#909090');
      txt(spikesLbCtx, `${i+1}. ${e.nick}`, 22, 20 + i*22, '13px Arial', color, 'left'); txt(spikesLbCtx, String(e.spikesBestScore || 0), GW-22, 20 + i*22, '13px Arial', color, 'right');
    }); spikesLbReady = true;
  },
  generateSpikes(side) {
    const arr = side === 'left' ? this.spikesLeft : this.spikesRight;
    const secH = (GH - 200) / 12;
    for (let i = 11; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [this._secArray[i], this._secArray[j]] = [this._secArray[j], this._secArray[i]]; }
    for (let i = 0; i < this.maxSpikes; i++) {
      const y = 100 + (this._secArray[i] * secH) + (secH/2);
      if (!arr[i]) arr[i] = { y, active: true }; else { arr[i].y = y; arr[i].active = true; }
    } arr.length = this.maxSpikes;
  },
  update(dt) {
    if (this.state !== 'playing') return;
    this.bird.update(dt); const br = this.bird.rect(); const inv = performance.now() < SessionState.flashUntil;

    if (this.bird.x <= 0) { this.bird.x = 0; this.bird.vx *= -1; this.bird.vy = JUMP_FORCE * 0.75; this.onWallHit('right'); }
    else if (this.bird.x + BIRD_SIZE >= GW) { this.bird.x = GW - BIRD_SIZE; this.bird.vx *= -1; this.bird.vy = JUMP_FORCE * 0.75; this.onWallHit('left'); }

    if (!inv) {
      if (this.bird.x < 30) { for(const sp of this.spikesLeft) if(overlapsSpike(br, sp.y, 'left')) return this.die(); }
      else if (this.bird.x > GW - BIRD_SIZE - 30) { for(const sp of this.spikesRight) if(overlapsSpike(br, sp.y, 'right')) return this.die(); }
    }
    if (this.bird.y > GH || this.bird.y < -BIRD_SIZE) this.die();
  },
  onWallHit(nextWall) {
    PlayerState.stats.spikesHits++;
    const pts = SessionState.S_DOUBLE ? 2 : 1;
    this.score += pts; PlayerState.coins += pts;
    const sfx = CHARACTERS[PlayerState.activeSkin].sfx || 'kaching';
    playSound(sfx, 0.5);
    if (this.score % 5 === 0 && this.maxSpikes < 10) this.maxSpikes++;
    if (Math.abs(this.bird.vx) < 8.5) this.bird.vx += (this.bird.vx > 0 ? 0.15 : -0.15);
    this.generateSpikes(nextWall); if (nextWall === 'right') this.spikesLeft.length = 0; else this.spikesRight.length = 0;
  },
  draw() {
    ctx.globalAlpha = this.state === 'waiting' ? 0.65 : 1.0;
    ctx.drawImage(bgCacheCanvas, 0, 0, GW, GH);
    ctx.globalAlpha = 1.0;

    this.spikesLeft.forEach(sp => ctx.drawImage(spikeLeftCanvas, 0, sp.y - 16, 24, 32));
    this.spikesRight.forEach(sp => ctx.drawImage(spikeRightCanvas, GW - 24, sp.y - 16, 24, 32));

    if (this.state !== 'waiting' && playerImg && (!SessionState.flashUntil || ((performance.now() / 150) | 0) % 2 === 0)) {
      ctx.save(); ctx.translate(this.bird.x + BIRD_SIZE/2, this.bird.y + BIRD_SIZE/2); if (this.bird.vx < 0) ctx.scale(-1, 1);
      ctx.rotate(Math.max(-20, Math.min(20, this.bird.vy * 2)) * Math.PI / 180); ctx.drawImage(playerImg, -BIRD_SIZE/2, -BIRD_SIZE/2, BIRD_SIZE, BIRD_SIZE); ctx.restore();
    }
    updateHUD(this.score);

    if (this.state === 'waiting') {
      txt(ctx, 'SPIKES MODE', GW/2 + 2, GH/4+12, '900 44px Arial', '#000');
      txt(ctx, 'SPIKES MODE', GW/2, GH/4+10, '900 44px Arial', '#dc3232');
      drawBirdAt(GW/2 - BIRD_SIZE/2, GH/2 - BIRD_SIZE/2 + Math.sin(performance.now()/333)*12, 0);
      if (((performance.now() / 600) | 0) % 2 === 0) txt(ctx, 'Tapnij aby zacząć', GW/2, GH*2/3+10, 'bold 20px Arial', '#fff');

      ctx.fillStyle = '#0a0a22'; ctx.beginPath(); ctx.roundRect(LOBBY_BTN.x, LOBBY_BTN.y + 5, LOBBY_BTN.w, LOBBY_BTN.h, 12); ctx.fill();
      ctx.fillStyle = '#dc3232'; ctx.beginPath(); ctx.roundRect(LOBBY_BTN.x, LOBBY_BTN.y, LOBBY_BTN.w, LOBBY_BTN.h, 12); ctx.fill();
      txt(ctx, '🏠 LOBBY', LOBBY_BTN.x + LOBBY_BTN.w/2, LOBBY_BTN.y + LOBBY_BTN.h/2 + 7, 'bold 16px Arial', '#fff');
    } else if (this.state === 'gameover') {
      overlay(0.75);
      txt(ctx, 'ZGINĄŁEŚ', GW/2 + 2, 62, '900 44px Arial', '#000');
      txt(ctx, 'ZGINĄŁEŚ', GW/2, 60, '900 44px Arial', '#dc3232');
      txt(ctx, 'Wynik: '+this.score, GW/2 + 2, 97, 'bold 26px Arial', '#000');
      txt(ctx, 'Wynik: '+this.score, GW/2, 95, 'bold 26px Arial', '#ffd700');
      txt(ctx, 'Rekord: '+PlayerState.spikesBestScore, GW/2, 115, '14px Arial', '#aaa');

      ctx.strokeStyle='#444'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(20,130); ctx.lineTo(GW-20,130); ctx.stroke();
      txt(ctx, '🔥 TOP 10 KOLCÓW', GW/2, 150, 'bold 15px Arial', '#dc3232');

      if (spikesLbLoading) txt(ctx, 'Ładowanie...', GW/2, 175, '13px Arial', '#888');
      else if (spikesLbReady) ctx.drawImage(spikesLbCacheCanvas, 0, 150, GW, 300);

      ctx.fillStyle = '#0a0a22'; ctx.beginPath(); ctx.roundRect(LOBBY_BTN.x, LOBBY_BTN.y + 5, LOBBY_BTN.w, LOBBY_BTN.h, 12); ctx.fill();
      ctx.fillStyle = '#dc3232'; ctx.beginPath(); ctx.roundRect(LOBBY_BTN.x, LOBBY_BTN.y, LOBBY_BTN.w, LOBBY_BTN.h, 12); ctx.fill();
      txt(ctx, '🏠 LOBBY', LOBBY_BTN.x + LOBBY_BTN.w/2, LOBBY_BTN.y + LOBBY_BTN.h/2 + 7, 'bold 16px Arial', '#fff');
      if (performance.now() - this.gameOverAt > 1000) txt(ctx, 'Tapnij, aby zagrać ponownie', GW/2, LOBBY_BTN.y - 20, '15px Arial', '#fff');
    }
  },
  onAction(px, py) {
    if (px !== undefined) if ((this.state === 'waiting' || this.state === 'gameover') && px>=LOBBY_BTN.x && px<=LOBBY_BTN.x+LOBBY_BTN.w && py>=LOBBY_BTN.y && py<=LOBBY_BTN.y+LOBBY_BTN.h) { stopSpikesAudio(); showLobby(); return; }
    if (this.state === 'waiting') this.startGame(); else if (this.state === 'playing') this.bird.jump(); else if (this.state === 'gameover' && performance.now() - this.gameOverAt > 1000) this.resetState();
  }
};

// ── Tryb Igrzysk Zimowych (MAMUT K-200) ──────────────────────────────────────
const skiTrees = Array.from({length: 120}, () => ({ x: Math.random() * 4000, s: 0.4 + Math.random() * 0.8 }));
const snowflakes = Array.from({length: 120}, () => ({ x: Math.random() * GW, y: Math.random() * GH, s: Math.random() * 2 + 1, v: Math.random() * 3 + 2 }));

// Ekstremalnie długa krzywa mamuciej skoczni
function getHillY(x) {
  if (x < 0) return 100;
  if (x < 250) return 100 + x * 1.2;               // Najazd
  if (x < 280) return 400 + (x - 250) * 0.2;       // Wypłaszczenie
  if (x < 300) return 406;                          // Próg
  if (x < 3500) {
    // Zeskok mamuta - rozciągnięty do 320 metrów
    const t = (x - 300) / 3200;
    return 406 + 1850 * Math.sin(t * Math.PI / 2);
  }
  return 2256; // Płaski odjazd na dole przepaści
}

export const SkiJumpMode = {
  state: 'waiting', distance: 0, gameOverAt: 0, camera: { x: 0, y: 0 },
  isPressing: false, hasCrashed: false, telemark: false,
  bird: { x: 0, y: 100, vx: 0, vy: 0, angle: 45 },
  baseWind: 0, wind: 0, speedKmh: 0, judges: [], totalScore: 0,
  feedbackText: '', feedbackColor: '#fff', feedbackTimer: 0, feedbackY: 0,

  // ZERO-ALLOCATION TRACKS
  tracksX: new Float32Array(1500),
  tracksY: new Float32Array(1500),
  trackCount: 0,

  init() { this.resetState(); updateHUD(this.distance); },
  resetState() {
    stopWind();
    this.bird.x = -20; this.bird.y = 70; this.bird.vx = 0; this.bird.vy = 0; this.bird.angle = 50;
    this.distance = 0; this.hasCrashed = false; this.telemark = false; this.isPressing = false;
    this.feedbackText = ''; this.feedbackTimer = 0;
    this.trackCount = 0; // Resetujemy licznik bez niszczenia pamięci RAM

    this.baseWind = (Math.random() * 4) - 2.0;
    this.wind = this.baseWind;

    const allKeys = Object.keys(CHARACTERS);
    const shuffled = [...allKeys].sort(() => 0.5 - Math.random());
    this.judges = shuffled.slice(0, 5).map(k => {
      const j = { key: k, name: CHARACTERS[k].name, score: '0.0', img: new Image(), isMin: false, isMax: false };
      j.img.src = `assets/characters/${CHARACTERS[k].img || k+'.png'}`;
      return j;
    });
    this.state = 'waiting';
  },
  startGame() { this.state = 'inrun'; this.bird.vx = 1.3; startWind(); },

  showFeedback(text, color) {
    this.feedbackText = text; this.feedbackColor = color;
    this.feedbackTimer = performance.now(); this.feedbackY = this.bird.y - 80;
  },

  update(dt) {
    if (this.state === 'waiting' || this.state === 'gameover') return;
    const f = dt / 16.667;
    // Prędkość wizualna mocniej podbita na mamucie
    this.speedKmh = Math.abs(this.bird.vx * 16 + this.bird.vy * 5.5);
    updateWind(this.speedKmh);

    if ((this.state === 'inrun' || this.state === 'landed') && !this.hasCrashed && this.trackCount < 1500) {
      this.tracksX[this.trackCount] = this.bird.x;
      this.tracksY[this.trackCount] = this.bird.y;
      this.trackCount++;
    }

    if (this.state === 'flight') {
       this.wind = this.baseWind + Math.sin(performance.now() * 0.002) * 0.8;
    }

    snowflakes.forEach(sn => {
      sn.y += sn.v * f; sn.x -= (this.bird.vx * 0.5 - this.wind * 1.5) * f;
      if (sn.y > GH) { sn.y = -10; sn.x = Math.random() * GW; }
      if (sn.x < 0) sn.x = GW + 10; if (sn.x > GW) sn.x = -10;
    });

    if (this.state === 'inrun') {
      this.bird.vx += 0.15 * f; // Lepsze przyspieszenie na najeździe
      this.bird.x += this.bird.vx * f;
      this.bird.y = getHillY(this.bird.x) - 15;
      this.bird.angle = 50;

      if (this.bird.x > 315) { // Dałem więcej czasu na reakcję
        this.state = 'flight';
        this.bird.vy = -1.5; // Zamiast spadać w dół, gra daje darmowe, słabe wybicie
        this.showFeedback('SPÓŹNIONY!', '#dc3232'); playSound('leci', 1.0);
      }
    }
    else if (this.state === 'flight') {
      if (this.isPressing) this.bird.angle -= 4.0 * f; else this.bird.angle += 2.5 * f;
      if (this.bird.angle < -15) this.bird.angle = -15; if (this.bird.angle > 85) this.bird.angle = 85;

      this.bird.vx += (this.wind * 0.003) * f;
      let windLift = this.wind > 0 ? (this.wind * 0.02) : (this.wind * 0.01);

      const angleDiff = Math.abs(this.bird.angle - 15);
      let lift = 0; let drag = 0.002;

      // ŁATWIEJSZY LOT: Tolerancja kąta rozciągnięta (z 40 na 50) i mniejsza kara za złą pozycję
      if (angleDiff < 50) lift = 0.465 * (1 - (angleDiff / 50));
      else drag += (angleDiff / 100) * 0.02;

      const terrainY = getHillY(this.bird.x);

      // ŁATWIEJSZA PODUSZKA POWIETRZNA: Działa już od 70 pikseli nad ziemią
      if (terrainY - this.bird.y < 70 && angleDiff < 30) {
         lift += 0.25;
      }

      this.bird.vx -= drag * f; this.bird.vy += (GRAVITY - lift - windLift) * f;
      this.bird.x += this.bird.vx * f; this.bird.y += this.bird.vy * f;

      if (this.bird.y >= terrainY - 15) { this.bird.y = terrainY - 15; this.land(); }
    }
    else if (this.state === 'landed') {
      if (this.hasCrashed) {
        this.bird.angle += 18 * f;
        this.bird.vy += GRAVITY * f;
        this.bird.x += this.bird.vx * f;
        this.bird.y += this.bird.vy * f;

        const groundY = getHillY(this.bird.x) - 15;
        if (this.bird.y >= groundY) {
           this.bird.y = groundY;
           this.bird.vy = -this.bird.vy * 0.45;
           this.bird.vx -= 0.4 * f;
        }
        if (this.bird.vx < 0) this.bird.vx = 0;

      } else {
        this.bird.vx -= 0.18 * f; // Mocniejsze hamowanie na wybiegu
        if (this.bird.vx < 0) this.bird.vx = 0;
        this.bird.x += this.bird.vx * f; this.bird.y = getHillY(this.bird.x) - 15;
      }

      if (this.bird.vx <= 0 && performance.now() - this.gameOverAt > 1500) {
        this.state = 'gameover'; this.checkRecord();
      }
    }
    // ZMIANA KAMERY: Przesuwamy punkt skupienia.
    // bird.y - GH * 0.25 (ptak na 1/4 wysokości od góry ekranu, widać ogromny dół!)
    // bird.x - GW * 0.25 (ptak na 1/4 szerokości od lewej, widać daleeeko w przód)
    this.camera.x = this.bird.x - GW * 0.25;
    this.camera.y = this.bird.y - GH * 0.25;
  },

  land() {
    this.state = 'landed'; this.gameOverAt = performance.now();
    this.distance = parseFloat(((this.bird.x - 300) / 10).toFixed(1));
    if (this.distance < 0) this.distance = 0;

    // NOWY SYSTEM LĄDOWANIA (Telemark vs Dwie Nogi vs Gleba)
    let isSafe = false;
    let isTwoFeet = false;

    if (this.telemark && this.bird.angle > -15 && this.bird.angle < 85) {
      isSafe = true; // Telemark wybacza PRAWIE WSZYSTKO
    } else if (!this.telemark && this.bird.angle > 0 && this.bird.angle < 65) {
      isSafe = true; // Zapomniałeś kliknąć, ale leciałeś prosto? Lądujesz bezpiecznie!
      isTwoFeet = true;
    }

    if (!isSafe) {
      this.hasCrashed = true;
      this.bird.vy = -5.0;
      this.bird.vx *= 0.85;
      this.showFeedback('GLEBA!', '#dc3232');
    } else if (isTwoFeet) {
      this.bird.angle = 40;
      this.showFeedback('DWIE NOGI', '#aaa');
    } else {
      this.bird.angle = 40;
      this.showFeedback('TELEMARK!', '#22b422');
    }

    // Inteligentni sędziowie (kary za dwie nogi)
    this.judges.forEach(j => {
      let base = 18;
      if (this.hasCrashed) base = 6 + Math.random() * 4;          // 6.0 - 10.0 (Upadek)
      else if (isTwoFeet) base = 13 + Math.random() * 3;          // 13.0 - 16.0 (Kara za dwie nogi)
      else base = 17.5 + Math.random() * 2.5;                     // 17.5 - 20.0 (Idealny Telemark)
      if (base > 20) base = 20;
      j.score = (Math.round(base * 2) / 2).toFixed(1);
    });

    const rawScores = this.judges.map((j, idx) => ({val: parseFloat(j.score), idx})).sort((a,b) => a.val - b.val);
    this.judges.forEach(j => { j.isMin = false; j.isMax = false; });
    this.judges[rawScores[0].idx].isMin = true; this.judges[rawScores[4].idx].isMax = true;

    const judgeTotal = rawScores[1].val + rawScores[2].val + rawScores[3].val;
    // PUNKTACJA MAMUCIA: Baza 120 pkt za punkt K (200m), 1.2 pkt za metr
    const distPts = 120 + (this.distance - 200) * 1.2;
    const windPts = -this.baseWind * 8.5;

    this.totalScore = (distPts + judgeTotal + windPts).toFixed(1);
    playSound('wyladowal', 1.0);
  },

  checkRecord() {
    const finalPoints = parseFloat(this.totalScore);
    if (!this.hasCrashed && finalPoints > PlayerState.skiBestScore) {
      PlayerState.skiBestScore = finalPoints;
      saveProgress(true); playSound('brawo', 1.0);
    } else if (this.hasCrashed) {
      PlayerState.stats.deaths++; saveProgress(true);
    }
  },

  draw() {
    const grad = ctx.createLinearGradient(0, 0, 0, GH);
    grad.addColorStop(0, '#3b82f6'); grad.addColorStop(1, '#93c5fd');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, GW, GH);
    ctx.save(); ctx.translate(-this.camera.x, -this.camera.y);

    skiTrees.forEach(t => {
      const tx = t.x; const ty = getHillY(tx) - 15;
      if (tx > this.camera.x - 100 && tx < this.camera.x + GW + 100) {
        ctx.fillStyle = '#064e3b'; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - 18*t.s, ty + 50*t.s); ctx.lineTo(tx + 18*t.s, ty + 50*t.s); ctx.fill();
        ctx.fillStyle = '#047857'; ctx.beginPath(); ctx.moveTo(tx, ty - 10*t.s); ctx.lineTo(tx - 12*t.s, ty + 30*t.s); ctx.lineTo(tx + 12*t.s, ty + 30*t.s); ctx.fill();
      }
    });

    ctx.fillStyle = '#553c15'; ctx.beginPath(); ctx.moveTo(-100, 100); ctx.lineTo(250, 400); ctx.lineTo(250, 480); ctx.lineTo(150, 480); ctx.lineTo(-100, 200); ctx.fill();
    ctx.fillStyle = '#3f2a0d'; ctx.beginPath(); ctx.moveTo(-100, 150); ctx.lineTo(250, 440); ctx.lineTo(250, 480); ctx.lineTo(-100, 200); ctx.fill();
    ctx.fillStyle = '#e2e8f0'; ctx.beginPath(); ctx.moveTo(-100, 95); ctx.lineTo(300, 396); ctx.lineTo(300, 406); ctx.lineTo(-100, 105); ctx.fill();
    ctx.fillStyle = '#dc3232'; ctx.beginPath(); ctx.moveTo(270, 390); ctx.lineTo(300, 396); ctx.lineTo(300, 406); ctx.lineTo(270, 400); ctx.fill();

    ctx.fillStyle = '#f8fafc'; ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(300, 406);
    for (let x = 300; x < this.camera.x + GW + 200; x += 50) ctx.lineTo(x, getHillY(x));
    // Dociągnięcie białego tła mocno w dół dla mamuta
    ctx.lineTo(this.camera.x + GW + 200, 3200); ctx.lineTo(300, 3200); ctx.fill(); ctx.stroke();

    if (this.trackCount > 1) {
      ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 2;
      ctx.beginPath(); for(let i=0; i<this.trackCount; i++) { if(i===0) ctx.moveTo(this.tracksX[i], this.tracksY[i] + 12); else ctx.lineTo(this.tracksX[i], this.tracksY[i] + 12); } ctx.stroke();
      ctx.beginPath(); for(let i=0; i<this.trackCount; i++) { if(i===0) ctx.moveTo(this.tracksX[i] - 8, this.tracksY[i] + 8); else ctx.lineTo(this.tracksX[i] - 8, this.tracksY[i] + 8); } ctx.stroke();
    }

    // Nowe znaczniki odległości na mamuta (co 20m, od 100m do 320m)
    ctx.textAlign = 'right'; ctx.font = 'bold 12px Arial';
    for (let d = 100; d <= 320; d += 20) {
       const mx = 300 + (d * 10); const my = getHillY(mx);
       if (mx > this.camera.x - 50 && mx < this.camera.x + GW + 50) {
         ctx.strokeStyle = (d === 200) ? '#dc3232' : (d === 240) ? '#1d4ed8' : '#64748b';
         ctx.lineWidth = (d === 200 || d === 240) ? 4 : 2;
         ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx, my + 40); ctx.stroke();
         ctx.fillStyle = (d === 200) ? '#dc3232' : '#0f172a'; ctx.fillText(d + 'm', mx - 6, my + 30);
       }
    }

    if (this.state === 'inrun' && this.bird.x > 150 && this.bird.x < 270) txt(ctx, 'GOTÓW...', this.bird.x, this.bird.y - 40, 'bold 20px Arial', '#fff');
    if (this.state === 'inrun' && this.bird.x >= 270 && this.bird.x < 305) txt(ctx, 'SKACZ!', this.bird.x, this.bird.y - 40, 'bold 24px Arial', '#ffd700');
    if (this.feedbackTimer > 0 && performance.now() - this.feedbackTimer < 1500) {
      this.feedbackY -= 0.5; txt(ctx, this.feedbackText, this.bird.x, this.feedbackY, 'bold 22px Arial', this.feedbackColor);
    }

    ctx.save(); ctx.translate(this.bird.x, this.bird.y); ctx.rotate(this.bird.angle * Math.PI / 180);
    if (skierBodyImg.complete && skierBodyImg.naturalHeight !== 0) ctx.drawImage(skierBodyImg, -30, -20, 60, 40);
    if (playerImg) ctx.drawImage(playerImg, -10, -35, 30, 30);

    if (this.hasCrashed && Math.abs(this.bird.vx) < 0.1) {
        ctx.fillStyle = '#dc3232'; ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
    ctx.restore();

    ctx.fillStyle = '#ffffff';
    snowflakes.forEach(sn => { ctx.beginPath(); ctx.arc(sn.x, sn.y, sn.s, 0, Math.PI*2); ctx.fill(); });

    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'; ctx.beginPath(); ctx.roundRect(GW - 90, 80, 80, 40, 8); ctx.fill();
    const windColor = this.wind > 0 ? '#22b422' : '#dc3232';
    txt(ctx, Math.abs(this.wind).toFixed(1) + ' m/s', GW - 50, 100, 'bold 14px Arial', windColor);
    ctx.save(); ctx.translate(GW - 50, 110); if (this.wind < 0) { ctx.scale(-1, 1); }
    ctx.fillStyle = windColor; ctx.beginPath(); ctx.moveTo(0, -3); ctx.lineTo(-15, -3); ctx.lineTo(-15, -7); ctx.lineTo(-25, 0); ctx.lineTo(-15, 7); ctx.lineTo(-15, 3); ctx.lineTo(0, 3); ctx.fill(); ctx.restore();
    txt(ctx, this.speedKmh.toFixed(1) + ' km/h', 50, 90, 'bold 16px Arial', '#fff');

    updateHUD(this.state === 'waiting' ? 0 : this.distance);

    if (this.state === 'waiting') {
      overlay(0.5);
      txt(ctx, 'MAMUT (K-200)', GW/2, GH/4, 'bold 36px Arial', '#e0f2fe');
      txt(ctx, '1. Tapnij aby ruszyć', GW/2, GH/2 - 20, '16px Arial', '#fff');
      txt(ctx, '2. Tapnij na CZERWONYM PROGU', GW/2, GH/2 + 10, 'bold 16px Arial', '#dc3232');
      txt(ctx, '3. Trzymaj ekran by płasko lecieć', GW/2, GH/2 + 40, '16px Arial', '#fff');
      txt(ctx, '4. Tapnij przed ziemią (TELEMARK)', GW/2, GH/2 + 70, 'bold 16px Arial', '#ffd700');
    }
    else if (this.state === 'gameover') {
      overlay(0.8);
      ctx.fillStyle = '#0f1432'; ctx.strokeStyle = '#6b21a8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(GW/2 - 170, GH/2 - 180, 340, 340, 12); ctx.fill(); ctx.stroke();

      if (this.hasCrashed) txt(ctx, 'UPADEK!', GW/2, GH/2 - 130, 'bold 36px Arial', '#dc3232');
      else txt(ctx, 'WYLĄDOWAŁ!', GW/2, GH/2 - 130, 'bold 36px Arial', '#22b422');

      const distPts = 120 + (this.distance - 200) * 1.2;
      const windPts = -this.baseWind * 8.5;

      txt(ctx, `Dystans: ${this.distance} m  (${distPts.toFixed(1)} pkt)`, GW/2, GH/2 - 90, 'bold 15px Arial', '#fff');
      txt(ctx, `Wiatr: ${this.baseWind > 0 ? '+' : ''}${this.baseWind.toFixed(1)} m/s  (${windPts > 0 ? '+' : ''}${windPts.toFixed(1)} pkt)`, GW/2, GH/2 - 65, 'bold 15px Arial', '#aaa');

      this.judges.forEach((j, i) => {
        const jx = GW/2 - 120 + i * 60; const jy = GH/2 - 10;
        if (j.img && j.img.complete) ctx.drawImage(j.img, jx - 20, jy - 20, 40, 40);
        else { ctx.fillStyle = '#333'; ctx.fillRect(jx-20, jy-20, 40, 40); }

        let color = '#ffd700';
        if (j.isMin || j.isMax) {
          color = '#555'; ctx.strokeStyle = '#dc3232'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(jx - 15, jy + 30); ctx.lineTo(jx + 15, jy + 20); ctx.stroke();
        }
        txt(ctx, j.score, jx, jy + 35, 'bold 15px Arial', color);
      });

      txt(ctx, `NOTA ŁĄCZNA: ${this.totalScore} pkt`, GW/2, GH/2 + 80, 'bold 22px Arial', '#ffd700');
      txt(ctx, `Rekord życiowy: ${PlayerState.skiBestScore} pkt`, GW/2, GH/2 + 105, '14px Arial', '#aaa');

      ctx.fillStyle = '#0a0a22'; ctx.beginPath(); ctx.roundRect(10, GH - 80 + 5, 110, 64, 12); ctx.fill();
      ctx.fillStyle = '#dc3232'; ctx.beginPath(); ctx.roundRect(10, GH - 80, 110, 64, 12); ctx.fill();
      txt(ctx, '🏠 LOBBY', 10 + 55, GH - 80 + 39, 'bold 16px Arial', '#fff');
      if (performance.now() - this.gameOverAt > 1000) txt(ctx, 'Tapnij by skoczyć ponownie', GW/2, GH - 40, '15px Arial', '#fff');
    }
  },

  onAction(px, py) {
    if (px !== undefined && (this.state === 'waiting' || this.state === 'gameover')) {
      if (px >= 10 && px <= 120 && py >= GH - 80 && py <= GH - 16) {
        stopWind(); // <--- ZATRZYMANIE WIATRU PRZED WYJŚCIEM
        showLobby();
        return;
      }
    }

    if (this.state === 'waiting') this.startGame();
    else if (this.state === 'inrun') {
      // Można kliknąć znacznie wcześniej
      if (this.bird.x > 100 && this.bird.x < 305) {
        const distToOptimal = Math.abs(this.bird.x - 295); // Punkt G to 295
        // Dzielnik 160 zamiast 120 -> potężna siła nawet przy słabszym timingu
        let power = 1.0 - (distToOptimal / 160);
        if (power < 0.3) power = 0.3; // Gwarancja minimalnego odbicia

        this.bird.vy = -3.8 - (power * 6.5);
        this.state = 'flight'; PlayerState.stats.jumps++; playSound('leci', 1.0);

        if (power > 0.80) this.showFeedback('IDEALNIE!', '#22b422');
        else if (power > 0.40) this.showFeedback('DOBRZE', '#eab308');
        else this.showFeedback('SŁABO', '#dc3232');
      }
    }
    else if (this.state === 'flight') {
      const terrainY = getHillY(this.bird.x);
      // GIGANTYCZNE OKNO LĄDOWANIA (300 pikseli zamiast 200)
      if (terrainY - this.bird.y < 300) {
          this.telemark = true;
          this.showFeedback('PRZYGOTOWANY', '#93c5fd');
      }
    }
    else if (this.state === 'gameover' && performance.now() - this.gameOverAt > 1000) this.resetState();
  }
};

// ── Pętla OODA (Render Loop) & Eventy ────────────────────────────────────────
let lastTime = performance.now(), loopRunning = false;

function loop(now) {
  if (!loopRunning) return; requestAnimationFrame(loop);
  let dt = now - lastTime; lastTime = now; if (dt > 50) dt = 50;
  if (SessionState.flashUntil && now > SessionState.flashUntil) SessionState.flashUntil = 0;
  if (isGameCanvasVisible) { SceneManager.update(dt); SceneManager.draw(); }
}
function startGameLoop() { if (loopRunning) return; loopRunning = true; lastTime = performance.now(); requestAnimationFrame(loop); }

document.addEventListener('keydown', e => {
  if (e.code === 'Space') {
    e.preventDefault(); SceneManager.onAction();
    if (SceneManager.activeScene === SkiJumpMode) SkiJumpMode.isPressing = true;
  }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space' && SceneManager.activeScene === SkiJumpMode) SkiJumpMode.isPressing = false;
});
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return; e.preventDefault();
  const cx = (e.clientX ?? e.touches?.[0]?.clientX ?? 0) - canvasRect.left; const cy = (e.clientY ?? e.touches?.[0]?.clientY ?? 0) - canvasRect.top;
  SceneManager.onAction(cx / canvasRect.width * GW, cy / canvasRect.height * GH);
  if (SceneManager.activeScene === SkiJumpMode) SkiJumpMode.isPressing = true;
});
window.addEventListener('pointerup', () => {
  if (SceneManager.activeScene === SkiJumpMode) SkiJumpMode.isPressing = false;
});

document.addEventListener('visibilitychange', () => {
  lastTime = performance.now();
  if (document.hidden) { if (audioCtx.state === 'running') audioCtx.suspend(); stopMusic(); stopSpikesAudio(); }
  else {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (SceneManager.activeScene && SceneManager.activeScene.state === 'playing') {
      if (SceneManager.activeScene === FlappyMode) resumeMusic(); else if (SceneManager.activeScene === SpikesMode) resumeSpikesAudio();
    }
  }
});

let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => {
      if (audioCtx.state === 'running') audioUnlocked = true;
    });
  } else if (audioCtx.state === 'running') {
    audioUnlocked = true;
  }
  const silence = new Audio('data:audio/mp3;base64,//OExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq');
  silence.play().catch(() => {});
}
['touchstart', 'touchend', 'mousedown', 'keydown'].forEach(evt => {
  document.addEventListener(evt, unlockAudio);
});
window.addEventListener('contextmenu', e => { if (isGameCanvasVisible) e.preventDefault(); });
