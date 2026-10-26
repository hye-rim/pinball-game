'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 핀볼: 화면·입력·소리. 규칙과 물리는 logic.js (LOGIC_PINBALL)
(() => {
const L = LOGIC_PINBALL;
const $ = (id) => document.getElementById(id);
const BEST_KEY = 'pinballBest';
const T = { over: 900 };                                    // 시간(ms). 시험용으로 줄일 수 있다

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let best = Number(store.get(BEST_KEY)) || 0;

// ---------- 소리 ----------
let audio = null;
let muted = store.get('pinballMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
let lastSfx = 0;
const quiet = (gap) => { const n = performance.now(); if (n - lastSfx < gap) return true; lastSfx = n; return false; };
const sfx = {
  launch: () => tone(180, 0.25, 'sawtooth', 0.07, 500),
  bumper: () => tone(700 + Math.random() * 200, 0.08, 'square', 0.07),
  sling: () => tone(420, 0.05, 'square', 0.06),
  target: () => seq([660, 880], 70, 'triangle', 0.09),
  bonus: () => seq([523, 659, 784, 1047], 90, 'triangle', 0.1),
  flip: (s) => { if (quiet(70)) return; tone(120 + Math.min(180, s * 0.15), 0.05, 'triangle', 0.09); },
  drain: () => seq([330, 262, 196], 140, 'sawtooth', 0.06),
  over: () => seq([392, 330, 262, 196], 150, 'sawtooth', 0.06),
  record: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
};
function toggleMute() { muted = !muted; store.set('pinballMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let st = L.newGame();
let phase = 'title';                // title · play · over
let overTimer = 0, lastFrame = 0, pulledOnce = false;
const keys = { left: false, right: false, pull: false };
const touchHold = { left: new Set(), right: new Set(), pull: new Set() };   // 누르고 있는 손가락(포인터) 번호들

// ---------- 그리기 ----------
const canvas = $('table'), ctx = canvas.getContext('2d');
let cw = 0, chh = 0, dpr = 1;
function fit() {
  const r = canvas.getBoundingClientRect();
  dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
  cw = w; chh = h;
}
function line(x1, y1, x2, y2, w, col) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
function draw() {
  fit();
  const k = cw / L.W;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, chh);
  ctx.save();
  ctx.scale(k, k);
  const bg = ctx.createLinearGradient(0, 0, 0, L.H);
  bg.addColorStop(0, '#1c4a6e'); bg.addColorStop(1, '#14304a');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, L.W, L.H);
  // 발사 통로 바탕
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(268, 150, 22, 330);
  // 벽
  for (const w of L.WALLS) line(w[0], w[1], w[2], w[3], 5, '#c9d8ee');
  for (const w of L.WALLS) line(w[0], w[1], w[2], w[3], 2, '#ffffff');
  // 슬링샷
  L.SLINGS.forEach((s, i) => { line(s.x1, s.y1, s.x2, s.y2, 8, st.hot.sling[i] > 0 ? '#ffd23f' : '#ff5fa2'); });
  // 타깃
  L.TARGETS.forEach((t, i) => { line(t.x1, t.y1, t.x2, t.y2, 8, st.hot.target[i] > 0 ? '#ffffff' : st.lit[i] ? '#ffd23f' : '#4cd964'); });
  // 범퍼
  L.BUMPERS.forEach((b, i) => {
    const on = st.hot.bumper[i] > 0;
    ctx.fillStyle = on ? '#ffd23f' : '#ff5a4f'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + (on ? 3 : 0), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2b1d52'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.arc(b.x - 5, b.y - 5, b.r * 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b1d52'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.32, 0, Math.PI * 2); ctx.fill();
  });
  // 플리퍼
  for (let s = 0; s < 2; s++) {
    const pv = L.PIVOT[s], tip = L.tipOf(s, st.flip[s].angle);
    line(pv.x, pv.y, tip.x, tip.y, L.FLIP_R * 2 + 3, '#2b1d52');
    line(pv.x, pv.y, tip.x, tip.y, L.FLIP_R * 2, st.flip[s].up ? '#ffd23f' : '#ffffff');
    ctx.fillStyle = '#2b1d52'; ctx.beginPath(); ctx.arc(pv.x, pv.y, 3, 0, Math.PI * 2); ctx.fill();
  }
  // 스프링 (당길수록 눌린다)
  const pull = st.phase === 'ready' ? st.pull.power : 0;
  const top = L.LANE_BOTTOM + L.BALL_R + 2 + pull * 14;
  ctx.strokeStyle = '#c9d8ee'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(L.LANE_X - 6, top);
  for (let i = 0; i < 6; i++) ctx.lineTo(L.LANE_X + (i % 2 ? 6 : -6), top + (478 - top) * ((i + 1) / 6));
  ctx.stroke();
  line(L.LANE_X - 8, top, L.LANE_X + 8, top, 4, '#ff5fa2');
  // 공
  const b = st.ball;
  if (st.phase !== 'over') {
    const y = st.phase === 'ready' ? b.y + pull * 14 : b.y;
    const g = ctx.createRadialGradient(b.x - 2, y - 2, 1, b.x, y, L.BALL_R);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#9aa7bb');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, y, L.BALL_R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2b1d52'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.restore();
  // 글자 (판 위: 배수와 안내)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (phase === 'play' && st.phase === 'ready') text(pulledOnce ? '놓으면 발사!' : '🚀 발사를 꾹 눌렀다 놓아요', cw / 2, chh * 0.62, 13 * dpr);
  if (st.mult > 1) text(`x${st.mult}`, cw * 0.5, chh * 0.5, 22 * dpr);
}
function text(s, x, y, size) {
  ctx.font = `${size}px Jua, sans-serif`;
  ctx.lineWidth = size * 0.22; ctx.strokeStyle = '#2b1d52'; ctx.lineJoin = 'round';
  ctx.strokeText(s, x, y); ctx.fillStyle = '#ffd23f'; ctx.fillText(s, x, y);
}
function renderHud() {
  $('score').textContent = st.score.toLocaleString('ko-KR');
  $('balls').textContent = String(Math.max(0, st.ballsLeft));
  $('best').textContent = Math.max(best, st.score).toLocaleString('ko-KR');
}
function say(t) { $('msg').textContent = t; }

// ---------- 창 ----------
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ---------- 입력 ----------
// 누르고 있는 것(키·손가락)이 하나라도 있으면 그 플리퍼가 올라간다
function applyInput() {
  if (phase !== 'play') { L.setFlipper(st, 0, false); L.setFlipper(st, 1, false); L.holdPlunger(st, false); return; }
  const left = keys.left || touchHold.left.size > 0, right = keys.right || touchHold.right.size > 0;
  const pull = keys.pull || touchHold.pull.size > 0;
  if (left !== st.flip[0].up && left) { tutorialFlip(); }
  if (right !== st.flip[1].up && right) { tutorialFlip(); }
  L.setFlipper(st, 0, left); L.setFlipper(st, 1, right);
  if (pull && !st.pull.on) { pulledOnce = true; }
  L.holdPlunger(st, pull);
}
function tutorialFlip() { tutorialSignal('flip'); }
const KEYMAP = { KeyZ: 'left', ArrowLeft: 'left', KeyA: 'left', Slash: 'right', ArrowRight: 'right', KeyD: 'right', Space: 'pull', ArrowDown: 'pull', KeyS: 'pull' };
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') { toggleMute(); return; }
  const k = KEYMAP[e.code];
  if (k && !overlayOpen()) { e.preventDefault(); keys[k] = true; applyInput(); }
});
addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) { keys[k] = false; applyInput(); } });
addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; for (const s of Object.values(touchHold)) s.clear(); applyInput(); });
function bindHold(el, which) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); touchHold[which].add(e.pointerId); try { el.setPointerCapture(e.pointerId); } catch (_) {} el.classList.add('on'); applyInput(); });
  const up = (e) => { touchHold[which].delete(e.pointerId); if (!touchHold[which].size) el.classList.remove('on'); applyInput(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
}
bindHold($('leftBtn'), 'left'); bindHold($('rightBtn'), 'right'); bindHold($('launchBtn'), 'pull');
// 판의 왼쪽·오른쪽 절반을 눌러도 그쪽 플리퍼가 올라간다 (아래쪽 버튼을 안 보고도 칠 수 있게)
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * L.W, y = (e.clientY - r.top) / r.height * L.H;
  const which = x > 268 && y > 150 ? 'pull' : x < L.W / 2 ? 'left' : 'right';
  touchHold[which].add(e.pointerId);
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  canvas._hold = canvas._hold || new Map(); canvas._hold.set(e.pointerId, which);
  applyInput();
});
const canvasUp = (e) => { const m = canvas._hold; if (!m || !m.has(e.pointerId)) return; touchHold[m.get(e.pointerId)].delete(e.pointerId); m.delete(e.pointerId); applyInput(); };
canvas.addEventListener('pointerup', canvasUp); canvas.addEventListener('pointercancel', canvasUp); canvas.addEventListener('lostpointercapture', canvasUp);

// ---------- 흐름 ----------
function startGame() {
  clearTimeout(overTimer);
  st = L.newGame(); phase = 'play'; pulledOnce = false;
  hideOverlay(); say('🚀 발사 버튼을 꾹 눌렀다 놓으면 공이 나가요!\n◀ ▶ (또는 화면 왼쪽·오른쪽)으로 플리퍼를 올려요');
  renderHud(); draw();
}
function onEvents() {
  for (const e of st.events) {
    if (e.type === 'launch') { sfx.launch(); tutorialSignal('launch'); say(''); }
    else if (e.type === 'bumper') { if (!quiet(40)) sfx.bumper(); tutorialSignal('bumper'); }
    else if (e.type === 'sling') sfx.sling();
    else if (e.type === 'target') { sfx.target(); tutorialSignal('target'); }
    else if (e.type === 'bonus') { sfx.bonus(); say(`보너스! 점수 배수 x${e.mult}`); }
    else if (e.type === 'flip') sfx.flip(e.speed);
    else if (e.type === 'drain') { sfx.drain(); if (st.ballsLeft > 0) say(`공이 빠졌어요! 남은 공 ${st.ballsLeft}개`); }
    else if (e.type === 'relaunch') say('공이 다시 내려왔어요. 더 세게 쏴요!');
    else if (e.type === 'over') { phase = 'over'; overTimer = setTimeout(showOver, T.over); }
  }
  st.events.length = 0;
}
function showOver() {
  const record = st.score > best;
  if (record) { best = st.score; store.set(BEST_KEY, String(best)); sfx.record(); } else sfx.over();
  showOverlay(`
    <h2>${record ? '🏆 최고 기록!' : '게임 끝!'}</h2>
    <div class="big">${st.score.toLocaleString('ko-KR')}</div>
    <p>최고 기록 <b>${best.toLocaleString('ko-KR')}</b>점 · 점수 배수 최고 x${st.mult}</p>
    <div class="col"><button data-act="again">다시 하기</button></div>`);
  renderHud();
}
function showTitle() {
  phase = 'title'; st = L.newGame(); say(''); renderHud(); draw();
  showOverlay(`
    <h1>핀볼</h1>
    <p>공을 튕겨 <b>점수</b>를 모아요!</p>
    <div class="card2" style="font-size:13px">🚀 발사 버튼을 <b>꾹 눌렀다 놓으면</b> 공이 나가요<br>◀ ▶ 버튼(또는 화면 <b>왼쪽·오른쪽</b>)으로 <b>플리퍼</b>를 올려 공을 쳐요<br>빨간 <b>범퍼</b>·분홍 <b>슬링샷</b>·초록 <b>타깃</b> 세 개를 모두 켜면 점수 배수 UP!<br>공 ${L.BALLS}개를 다 잃으면 끝이에요</div>
    <p style="font-size:12.5px">키보드: Z · / 플리퍼 · 스페이스 발사 · M 소리</p>
    ${best ? `<span class="tag">최고 ${best.toLocaleString('ko-KR')}점</span>` : ''}
    <div class="col"><button data-act="start">시작하기</button></div>`);
}
$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur();
  if (btn.dataset.act === 'start' || btn.dataset.act === 'again') startGame();
});

// ---------- 매 프레임 ----------
function frame(dt) {
  if (phase === 'play') { applyInput(); L.update(st, dt); onEvents(); }
  renderHud(); draw();
}
function loop(now) {
  requestAnimationFrame(loop);
  const dt = lastFrame ? (now - lastFrame) / 1000 : 0;
  lastFrame = now;
  if (document.hidden) return;
  frame(Math.min(dt, 0.05));
}
showTitle();
requestAnimationFrame(loop);
addEventListener('resize', draw);

/* @test-hooks:start */
window.__pb = { get st() { return st; }, get phase() { return phase; }, T, frame, startGame, draw, keys, applyInput };
/* @test-hooks:end */
})();
