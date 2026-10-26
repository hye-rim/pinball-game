'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const run = (st, seconds) => { for (let i = 0; i < seconds / L.DT; i++) { L.step(st); } };
function inPlay() { const st = L.newGame(); st.phase = 'play'; st.ball = { x: 150, y: 300, vx: 0, vy: 0 }; return st; }

test('new game starts ready with all balls and zero score', () => {
  const st = L.newGame();
  assert.strictEqual(st.phase, 'ready');
  assert.strictEqual(st.ballsLeft, L.BALLS);
  assert.strictEqual(st.score, 0);
  assert.strictEqual(st.mult, 1);
  assert.strictEqual(st.ball.x, L.LANE_X);
});

test('the ball waits in the lane until the plunger is released', () => {
  const st = L.newGame();
  run(st, 1);
  assert.strictEqual(st.ball.y, L.LANE_BOTTOM);
  L.holdPlunger(st, true);
  run(st, 0.5);
  assert.ok(st.pull.power > 0.4 && st.pull.power < 0.6);
  assert.strictEqual(st.phase, 'ready');
  L.holdPlunger(st, false);
  assert.strictEqual(st.phase, 'play');
  assert.ok(st.ball.vy < -L.LAUNCH_MIN);
});

test('full power reaches the top and enters the table, weak power rolls back', () => {
  const full = L.newGame();
  L.holdPlunger(full, true); run(full, 1.2); L.holdPlunger(full, false);
  let minY = 999, minX = 999;
  for (let i = 0; i < 240 * 1.5; i++) { L.step(full); minY = Math.min(minY, full.ball.y); minX = Math.min(minX, full.ball.x); }
  assert.ok(minY < 60, `reached the top ${minY}`);
  assert.ok(minX < 260, 'deflected left into the table');
  const weak = L.newGame();
  L.holdPlunger(weak, true); L.holdPlunger(weak, false);
  let weakMin = 999;
  for (let i = 0; i < 240 * 4; i++) { L.step(weak); weakMin = Math.min(weakMin, weak.ball.y); }
  assert.ok(weakMin > 100, 'a weak shot does not clear the lane');
  assert.strictEqual(weak.phase, 'ready', 'it comes back to the lane and waits to be shot again');
});

test('gravity pulls the ball down', () => {
  const st = inPlay();
  st.ball.x = 150; st.ball.y = 300;
  const y0 = st.ball.y;
  run(st, 0.1);
  assert.ok(st.ball.y > y0);
  assert.ok(st.ball.vy > 50);
});

test('the ball stays inside the table until it drains', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const st = L.newGame();
    let r = seed; const rnd = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
    for (let n = 0; n < 240 * 60 && st.phase !== 'over'; n++) {
      if (st.phase === 'ready') { L.holdPlunger(st, true); for (let i = 0; i < 100 + rnd() * 140; i++) L.step(st); L.holdPlunger(st, false); }
      const b = st.ball;
      for (let s = 0; s < 2; s++) L.setFlipper(st, s, (b.y > 400 && b.vy > 0 && (s === 0 ? b.x < 150 : b.x >= 150)) || (b.y > 430 && Math.floor(n / 60) % 4 === s));
      L.step(st);
      if (st.phase === 'play') assert.ok(b.x > 0 && b.x < L.W && b.y > -5 && b.y < L.H + 30, `inside the table ${b.x},${b.y}`);
      st.events.length = 0;
    }
  }
});

test('a ball falling on a resting flipper does not pass through it', () => {
  for (const x of [95, 105, 115, 125]) {
    const st = inPlay();
    st.ball = { x, y: 380, vx: 0, vy: 400 };
    let drained = false;
    for (let i = 0; i < 240 * 1.2; i++) { L.step(st); if (st.events.some((e) => e.type === 'drain')) drained = true; st.events.length = 0; }
    assert.ok(!drained, `ball at x=${x} was held by the flipper`);
  }
});

test('a fast ball cannot tunnel through a swinging flipper', () => {
  const st = inPlay();
  L.setFlipper(st, 0, true);
  st.ball = { x: 110, y: 430, vx: 0, vy: L.MAX_SPEED };
  let passed = false;
  for (let i = 0; i < 240 * 0.5; i++) { L.step(st); if (st.ball.y > 500 && st.ball.x > 80 && st.ball.x < 135) passed = true; }
  assert.ok(!passed);
});

test('raising the flipper under the ball shoots it up', () => {
  const st = inPlay();
  st.ball = { x: 104, y: 452, vx: 0, vy: 0 };
  L.setFlipper(st, 0, true);
  let minVy = 0;
  for (let i = 0; i < 240 * 0.4; i++) { L.step(st); minVy = Math.min(minVy, st.ball.vy); }
  assert.ok(minVy < -300, `the flipper kicked it ${minVy}`);
});

test('a ball rolling down a resting flipper falls through the middle gap', () => {
  const st = inPlay();
  st.ball = { x: 110, y: 461, vx: 0, vy: 0 };
  let drained = false;
  for (let i = 0; i < 240 * 2 && !drained; i++) { L.step(st); if (st.events.some((e) => e.type === 'drain')) drained = true; }
  assert.ok(drained, 'without raising the flipper the ball is lost');
});

test('a bumper scores 100 and kicks the ball away', () => {
  const st = inPlay();
  const bp = L.BUMPERS[0];
  st.ball = { x: bp.x, y: bp.y - bp.r - L.BALL_R - 2, vx: 0, vy: 200 };
  let hit = false;
  for (let i = 0; i < 60 && !hit; i++) { L.step(st); if (st.events.some((e) => e.type === 'bumper')) hit = true; }
  assert.ok(hit);
  assert.strictEqual(st.score, 100);
  assert.ok(st.ball.vy < -300, 'it was kicked away from the bumper');
});

test('score is multiplied by the current multiplier', () => {
  const st = inPlay();
  st.mult = 3;
  const bp = L.BUMPERS[1];
  st.ball = { x: bp.x, y: bp.y - bp.r - L.BALL_R - 2, vx: 0, vy: 200 };
  for (let i = 0; i < 20; i++) L.step(st);
  assert.ok(st.score >= 300 && st.score % 300 === 0, `score ${st.score}`);
});

test('standup targets light once and all three give a bonus and a multiplier', () => {
  const st = inPlay();
  st.lit = [true, true, false];
  const tg = L.TARGETS[2];
  st.ball = { x: (tg.x1 + tg.x2) / 2, y: tg.y1 + 20, vx: 0, vy: -600 };
  let bonus = false;
  for (let i = 0; i < 80 && !bonus; i++) { L.step(st); if (st.events.some((e) => e.type === 'bonus')) bonus = true; }
  assert.ok(bonus);
  assert.strictEqual(st.mult, 2);
  assert.deepStrictEqual(st.lit, [false, false, false]);
  assert.strictEqual(st.score, 2500);
});

test('draining loses a ball and the next one waits in the lane', () => {
  const st = inPlay();
  st.ball = { x: 150, y: L.H - 5, vx: 0, vy: 600 };
  run(st, 0.3);
  assert.strictEqual(st.ballsLeft, L.BALLS - 1);
  assert.strictEqual(st.phase, 'ready');
  assert.strictEqual(st.ball.x, L.LANE_X);
});

test('the last drain ends the game', () => {
  const st = inPlay();
  st.ballsLeft = 1;
  st.ball = { x: 150, y: L.H - 5, vx: 0, vy: 600 };
  run(st, 0.3);
  assert.strictEqual(st.phase, 'over');
  const t = st.time;
  L.step(st);
  assert.strictEqual(st.time, t, 'nothing runs after game over');
});

test('same inputs give the same game', () => {
  const play = () => {
    const st = L.newGame();
    L.holdPlunger(st, true); run(st, 0.9); L.holdPlunger(st, false);
    for (let n = 0; n < 240 * 8; n++) { L.setFlipper(st, 0, n % 90 < 30); L.setFlipper(st, 1, n % 110 < 40); L.step(st); }
    return JSON.stringify([st.score, st.ball, st.ballsLeft, st.lit]);
  };
  assert.strictEqual(play(), play());
});

test('update runs fixed steps and caps a long pause', () => {
  const st = inPlay();
  L.update(st, 5);                                         // 한 번에 5초가 흘러도 0.05초까지만
  assert.ok(st.time <= 0.06);
  const a = inPlay(), b = inPlay();
  L.update(a, 1 / 60); L.update(a, 1 / 60);
  for (let i = 0; i < 8; i++) L.step(b);
  assert.ok(Math.abs(a.ball.y - b.ball.y) < 1e-6);
});
