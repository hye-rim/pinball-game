'use strict';

// 핀볼: 규칙·물리만 모아 둔 파일 (그리기·입력 없음). 브라우저와 테스트(Node)가 같이 쓴다.
//
// - 세로로 긴 판 W x H (왼쪽 위가 0,0, 아래로 갈수록 y 가 커진다). 판은 기울어 있어 공이 늘 아래로 굴러 내려온다 (중력)
// - 오른쪽 길쭉한 통로(발사 통로) 맨 아래에서 스프링을 당겼다 놓으면 공이 위로 쏘아 올라가 판으로 들어온다
// - 왼쪽·오른쪽 플리퍼로 공을 쳐 올린다. 범퍼·슬링샷·타깃에 맞으면 점수. 공은 BALLS 개이고 아래 구멍으로 빠지면 하나 잃는다
// - 모든 움직임은 아주 짧은 고정 시간 DT 단위로 계산한다 (플리퍼가 빨라도 공이 뚫고 지나가지 않게). 같은 입력이면 같은 결과
const LOGIC_PINBALL = (() => {
const W = 300, H = 520;
const DT = 1 / 240;
const GRAV = 900;                       // 아래로 가는 가속도 (칸/초²)
const BALL_R = 7;
const MAX_SPEED = 1300;
const BALLS = 3;
const WALL_E = 0.5;                     // 벽에 튕길 때 남는 속도 비율
const FLIP_LEN = 53, FLIP_R = 6;
const FLIP_REST = 0.49, FLIP_UP = -0.43;   // 라디안. 왼쪽 플리퍼 기준 (양수 = 오른쪽 아래를 가리킴). 오른쪽은 좌우 반대
const FLIP_SPEED = 14;                  // 플리퍼가 도는 빠르기 (라디안/초)
const PIVOT = [{ x: 88, y: 462 }, { x: 212, y: 462 }];
const LANE_X = 279, LANE_BOTTOM = 462;  // 발사 통로 가운데와 공이 놓이는 높이
const LAUNCH_MIN = 800, LAUNCH_MAX = 1150;
const BUMPERS = [{ x: 105, y: 150, r: 17 }, { x: 195, y: 150, r: 17 }, { x: 150, y: 218, r: 17 }];
const BUMPER_KICK = 380;
const TARGETS = [{ x1: 96, y1: 64, x2: 124, y2: 64 }, { x1: 136, y1: 64, x2: 164, y2: 64 }, { x1: 176, y1: 64, x2: 204, y2: 64 }];
const SLINGS = [[10, 335, 72, 402], [268, 335, 198, 402]].map(([x1, y1, x2, y2]) => {   // 벽에서 비스듬히 내려오는 삼각형 모양 (공이 뒤로 못 들어간다)
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  let nx = dy / len, ny = -dx / len;                       // 선분에 수직인 방향 중 위쪽을 보는 쪽
  if (ny > 0) { nx = -nx; ny = -ny; }
  return { x1, y1, x2, y2, nx, ny };
});
const SLING_KICK = 260;
const STALL_SECONDS = 4;

// 판 둘레와 안내 벽 (공이 튕기는 고정된 선분)
const WALLS = (() => {
  const w = [];
  w.push([10, 415, 10, 70]);                                         // 왼쪽 벽
  for (let i = 0; i < 6; i++) {                                      // 왼쪽 위 둥근 모서리
    const a1 = Math.PI + (i / 6) * (Math.PI / 2), a2 = Math.PI + ((i + 1) / 6) * (Math.PI / 2);
    w.push([70 + 60 * Math.cos(a1), 70 + 60 * Math.sin(a1), 70 + 60 * Math.cos(a2), 70 + 60 * Math.sin(a2)]);
  }
  w.push([70, 10, 230, 10]);                                         // 위
  for (let i = 0; i < 6; i++) {                                      // 오른쪽 위 둥근 모서리
    const a1 = Math.PI * 1.5 + (i / 6) * (Math.PI / 2), a2 = Math.PI * 1.5 + ((i + 1) / 6) * (Math.PI / 2);
    w.push([230 + 60 * Math.cos(a1), 70 + 60 * Math.sin(a1), 230 + 60 * Math.cos(a2), 70 + 60 * Math.sin(a2)]);
  }
  w.push([290, 70, 290, 480]);                                       // 오른쪽 바깥 벽
  w.push([268, 480, 290, 480]);                                      // 발사 통로 바닥
  w.push([268, 150, 268, 480]);                                      // 발사 통로와 판 사이 칸막이
  w.push([10, 415, 86, 455]);                                        // 왼쪽 아래 비탈 (플리퍼 윗면으로 매끄럽게 이어진다)
  w.push([268, 426, 214, 455]);                                      // 오른쪽 아래 비탈
  return w;
})();

function newGame() {
  const st = {
    score: 0, mult: 1, ballsLeft: BALLS, phase: 'ready',             // ready (공이 발사 통로에서 대기) · play · over
    ball: { x: LANE_X, y: LANE_BOTTOM, vx: 0, vy: 0 },
    flip: [{ angle: FLIP_REST, up: false, omega: 0 }, { angle: FLIP_REST, up: false, omega: 0 }],
    pull: { on: false, power: 0 },
    lit: [false, false, false],
    hot: { bumper: [0, 0, 0], target: [0, 0, 0], sling: [0, 0] },       // 방금 맞은 효과 (남은 시간, 화면용)
    events: [], time: 0, acc: 0, stall: 0, ballNo: 1,
  };
  return st;
}

// 원(p, 반지름 r)과 선분의 충돌을 풀고 튕긴다. surf 는 선분 표면의 속도(플리퍼용). 부딪혔으면 법선 방향 속도 변화 전의 -vn(세기)을 돌려준다
let lastNx = 0, lastNy = 0;                                // 방금 부딪힌 곳의 법선 (슬링샷이 앞에서 맞았는지 보려고)
function hitSegment(p, ax, ay, bx, by, r, e, surfX = 0, surfY = 0, surfFn = null) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - ax) * dx + (p.y - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t, qy = ay + dy * t;
  let nx = p.x - qx, ny = p.y - qy;
  let d = Math.hypot(nx, ny);
  if (d >= r) return 0;
  if (d < 1e-6) { nx = dy; ny = -dx; d = Math.hypot(nx, ny) || 1; }
  nx /= d; ny /= d;
  lastNx = nx; lastNy = ny;
  p.x = qx + nx * r; p.y = qy + ny * r;
  if (surfFn) { const s = surfFn(qx, qy); surfX = s.x; surfY = s.y; }
  const vn = (p.vx - surfX) * nx + (p.vy - surfY) * ny;
  if (vn < 0) { p.vx -= (1 + e) * vn * nx; p.vy -= (1 + e) * vn * ny; return -vn; }
  return 0.0001;
}

const tipOf = (side, angle) => {
  const s = side === 0 ? 1 : -1, pv = PIVOT[side];
  return { x: pv.x + s * FLIP_LEN * Math.cos(angle), y: pv.y + FLIP_LEN * Math.sin(angle) };
};
function gain(st, pts) { st.score += pts * st.mult; }

function setFlipper(st, side, up) { st.flip[side].up = !!up; }
function holdPlunger(st, on) {
  if (on) { st.pull.on = true; return; }
  if (!st.pull.on) return;
  st.pull.on = false;
  if (st.phase === 'ready') {
    const power = Math.max(0, Math.min(1, st.pull.power));
    st.ball.vx = 0; st.ball.vy = -(LAUNCH_MIN + (LAUNCH_MAX - LAUNCH_MIN) * power);
    st.phase = 'play'; st.stall = 0;
    st.events.push({ type: 'launch', power });
  }
  st.pull.power = 0;
}

function step(st, dt = DT) {
  if (st.phase === 'over') return;
  st.time += dt;
  // 플리퍼
  for (let s = 0; s < 2; s++) {
    const f = st.flip[s];
    const target = f.up ? FLIP_UP : FLIP_REST;
    const before = f.angle;
    const dir = Math.sign(target - f.angle);
    f.angle += dir * FLIP_SPEED * dt;
    if ((target - f.angle) * dir < 0) f.angle = target;
    f.omega = (f.angle - before) / dt;
  }
  if (st.pull.on && st.phase === 'ready') st.pull.power = Math.min(1, st.pull.power + dt / 1.0);
  for (const k of ['bumper', 'target', 'sling']) st.hot[k] = st.hot[k].map((v) => Math.max(0, v - dt));
  if (st.phase === 'ready') return;
  const b = st.ball;
  b.vy += GRAV * dt;
  b.x += b.vx * dt; b.y += b.vy * dt;
  b.vx *= 1 - 0.02 * dt; b.vy *= 1 - 0.02 * dt;
  for (const w of WALLS) hitSegment(b, w[0], w[1], w[2], w[3], BALL_R, WALL_E);
  // 범퍼
  BUMPERS.forEach((bp, i) => {
    let nx = b.x - bp.x, ny = b.y - bp.y;
    const d = Math.hypot(nx, ny), min = bp.r + BALL_R;
    if (d >= min) return;
    if (d < 1e-6) { nx = 0; ny = -1; } else { nx /= d; ny /= d; }
    b.x = bp.x + nx * min; b.y = bp.y + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; }
    b.vx += nx * BUMPER_KICK; b.vy += ny * BUMPER_KICK;
    st.hot.bumper[i] = 0.18; gain(st, 100); st.events.push({ type: 'bumper', i });
  });
  // 슬링샷
  SLINGS.forEach((sl, i) => {
    const hit = hitSegment(b, sl.x1, sl.y1, sl.x2, sl.y2, BALL_R, 0.3);
    if (hit > 300 && lastNx * sl.nx + lastNy * sl.ny > 0.5 && st.hot.sling[i] <= 0) { b.vx += sl.nx * SLING_KICK; b.vy += sl.ny * SLING_KICK; st.hot.sling[i] = 0.15; gain(st, 10); st.events.push({ type: 'sling', i }); }
  });
  // 타깃
  TARGETS.forEach((tg, i) => {
    const hit = hitSegment(b, tg.x1, tg.y1, tg.x2, tg.y2, BALL_R + 3, 0.6);
    if (hit > 40) {
      st.hot.target[i] = 0.2;
      if (!st.lit[i]) { st.lit[i] = true; gain(st, 500); st.events.push({ type: 'target', i }); } else gain(st, 50);
      if (st.lit.every(Boolean)) {
        st.lit = [false, false, false]; gain(st, 2000);
        st.mult = Math.min(5, st.mult + 1);
        st.events.push({ type: 'bonus', mult: st.mult });
      }
    }
  });
  // 플리퍼 (표면 속도는 도는 빠르기 x 축에서의 거리)
  for (let s = 0; s < 2; s++) {
    const f = st.flip[s], pv = PIVOT[s], tip = tipOf(s, f.angle);
    const surf = (qx, qy) => ({ x: -f.omega * (qy - pv.y) * (s === 0 ? 1 : -1), y: f.omega * (qx - pv.x) * (s === 0 ? 1 : -1) });
    const hit = hitSegment(b, pv.x, pv.y, tip.x, tip.y, BALL_R + FLIP_R, 0.45, 0, 0, surf);
    if (hit > 120) st.events.push({ type: 'flip', side: s, speed: hit });
  }
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > MAX_SPEED) { b.vx *= MAX_SPEED / sp; b.vy *= MAX_SPEED / sp; }
  // 오래 멈춰 있으면 살짝 흔들어 준다 (플리퍼 위에서 가만히 있는 건 괜찮다)
  const onFlipper = b.y > 440 && b.x > 80 && b.x < 220;
  if (sp < 25 && !onFlipper && b.x < 268) st.stall += dt; else st.stall = 0;
  if (st.stall > STALL_SECONDS) { b.vx += (Math.abs(Math.sin(st.time * 12.9898) * 43758.5453) % 1 - 0.5) * 300; b.vy -= 200; st.stall = 0; st.events.push({ type: 'nudge' }); }
  // 약하게 쏴서 발사 통로로 도로 떨어졌으면 다시 쏠 수 있게 대기 상태로
  if (b.x > 268 && b.y > 440 && sp < 40) {
    st.phase = 'ready'; st.ball = { x: LANE_X, y: LANE_BOTTOM, vx: 0, vy: 0 }; st.pull = { on: false, power: 0 };
    st.events.push({ type: 'relaunch' });
    return;
  }
  // 아래 구멍
  if (b.y > H + BALL_R) drain(st);
}

function drain(st) {
  st.events.push({ type: 'drain' });
  st.ballsLeft--;
  if (st.ballsLeft <= 0) { st.phase = 'over'; st.events.push({ type: 'over' }); return; }
  st.ballNo++;
  st.phase = 'ready';
  st.ball = { x: LANE_X, y: LANE_BOTTOM, vx: 0, vy: 0 };
  st.pull = { on: false, power: 0 };
}

// 흐른 시간(초)만큼 DT 단위로 계산한다
function update(st, seconds) {
  st.acc += Math.min(seconds, 0.05);
  while (st.acc >= DT) { step(st, DT); st.acc -= DT; if (st.phase === 'over') { st.acc = 0; break; } }
}

return { W, H, DT, GRAV, BALL_R, BALLS, FLIP_LEN, FLIP_R, FLIP_REST, FLIP_UP, PIVOT, LANE_X, LANE_BOTTOM, BUMPERS, TARGETS, SLINGS, WALLS, LAUNCH_MIN, LAUNCH_MAX, MAX_SPEED, newGame, setFlipper, holdPlunger, step, update, tipOf };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_PINBALL;
