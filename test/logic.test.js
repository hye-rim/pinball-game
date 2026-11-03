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

// ---------- 테이블 2 (미션 테이블)·미션·멀티볼 ----------
function missionPlay(table = 1) { const st = L.newGame({ table }); st.phase = 'play'; st.ball = { x: 150, y: 300, vx: 0, vy: 0 }; return st; }
const evs = (st, type) => st.events.filter((e) => e.type === type);

test('table 0 is the original table; table 1 has five bumpers and missions', () => {
  const a = L.newGame(), b = L.newGame({ table: 1 });
  assert.strictEqual(a.table, 0);
  assert.strictEqual(a.bumpers, L.BUMPERS);
  assert.strictEqual(a.bumpers.length, 3);
  assert.strictEqual(a.mission, null, 'no missions on the classic table');
  assert.strictEqual(b.table, 1);
  assert.strictEqual(b.bumpers.length, 5);
  assert.ok(b.mission && b.mission.i === 0);
  assert.strictEqual(b.hot.bumper.length, 5);
  assert.strictEqual(L.newGame({ table: 7 }).table, 0, 'unknown table falls back to the classic one');
});

// 점 (px,py) 에서 선분까지 거리
const distToSeg = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
};
// 범퍼 가장자리와 다른 물체 사이 틈이 이 값보다 좁으면 공이 끼어 범퍼·타깃 사이를 튕겨 다니며 점수를 번다
const MIN_POCKET = L.BALL_R * 2 + 24;

test('bumpers on both tables leave no pocket where the ball can bounce between a bumper and a wall, target or another bumper', () => {
  for (const tb of L.TABLES) {
    const bps = tb.bumpers;
    for (let i = 0; i < bps.length; i++) {
      for (let j = i + 1; j < bps.length; j++) {
        const gap = Math.hypot(bps[i].x - bps[j].x, bps[i].y - bps[j].y) - bps[i].r - bps[j].r;
        assert.ok(gap > MIN_POCKET, `table ${L.TABLES.indexOf(tb)}: bumpers ${i} and ${j} are ${gap.toFixed(1)} apart`);
      }
      for (const w of L.WALLS) {
        const gap = distToSeg(bps[i].x, bps[i].y, w[0], w[1], w[2], w[3]) - bps[i].r;
        assert.ok(gap > MIN_POCKET, `table ${L.TABLES.indexOf(tb)}: bumper ${i} is ${gap.toFixed(1)} from a wall`);
      }
      for (const tg of tb.targets) {
        const gap = distToSeg(bps[i].x, bps[i].y, tg.x1, tg.y1, tg.x2, tg.y2) - bps[i].r;
        assert.ok(gap > MIN_POCKET, `table ${L.TABLES.indexOf(tb)}: bumper ${i} is ${gap.toFixed(1)} from a target`);
      }
      for (const sl of L.SLINGS) {
        const gap = distToSeg(bps[i].x, bps[i].y, sl.x1, sl.y1, sl.x2, sl.y2) - bps[i].r;
        assert.ok(gap > MIN_POCKET, `table ${L.TABLES.indexOf(tb)}: bumper ${i} is ${gap.toFixed(1)} from a slingshot`);
      }
    }
  }
});

test('bumper hits count toward the first mission; finishing it pays the reward and starts the next', () => {
  const st = missionPlay();
  const goal = L.missionInfo(st).goal;
  assert.strictEqual(L.missionInfo(st).id, 'bumper');
  st.mission.progress = goal - 1;
  const bp = st.bumpers[1];
  st.ball = { x: bp.x, y: bp.y - bp.r - L.BALL_R - 2, vx: 0, vy: 200 };
  for (let i = 0; i < 20; i++) L.step(st);
  const done = evs(st, 'missionDone');
  assert.strictEqual(done.length, 1);
  assert.strictEqual(done[0].pts, 3000);
  assert.ok(st.score >= 3100, `score ${st.score}`);
  assert.strictEqual(L.missionInfo(st).id, 'target', 'moved on to the next mission');
  assert.strictEqual(st.mission.progress, 0);
  assert.strictEqual(st.mission.done, 1);
});

test('only the active mission counts, and the classic table ignores missions entirely', () => {
  const st = missionPlay();
  L.missionHit(st, 'sling');
  assert.strictEqual(st.mission.progress, 0);
  const c = missionPlay(0);
  L.missionHit(c, 'bumper');
  assert.strictEqual(c.mission, null);
  assert.strictEqual(c.events.length, 0);
});

test('the target mission gives a multiball: an extra ball drops in from the top', () => {
  const st = missionPlay();
  st.mission.i = 1; st.mission.progress = 0;
  st.lit = [true, true, false];
  const tg = L.TARGETS[2];
  st.ball = { x: (tg.x1 + tg.x2) / 2, y: tg.y1 + 20, vx: 0, vy: -600 };
  for (let i = 0; i < 80 && !st.extra.length; i++) L.step(st);
  assert.strictEqual(st.extra.length, 1);
  assert.ok(st.extra[0].y < 60, 'it starts near the top');
  assert.ok(st.extra[0].x > 180 && st.extra[0].x < 250, 'right side, like a launched ball');
  assert.ok(st.extra[0].vx < 0, 'heading left into the table');
  assert.strictEqual(L.missionInfo(st).id, 'sling');
  assert.strictEqual(st.multis, 1);
});

test('extra balls fall like the main ball and cost nothing when they drain', () => {
  const st = missionPlay();
  L.spawnExtra(st, 2);
  assert.strictEqual(st.extra.length, 2);
  const left = st.ballsLeft;
  for (let i = 0; i < 240 * 12 && st.extra.length; i++) { st.ball = { x: 150, y: 300, vx: 0, vy: 0 }; L.step(st); }   // 메인 공은 매번 제자리로
  assert.strictEqual(st.extra.length, 0, 'both fell out');
  assert.strictEqual(st.ballsLeft, left, 'no ball was lost');
  assert.strictEqual(st.phase, 'play');
});

test('when the main ball drains an extra ball takes over; only the last one costs a ball', () => {
  const st = missionPlay();
  L.spawnExtra(st, 1);
  const heir = st.extra[0];
  st.ball = { x: 150, y: L.H - 5, vx: 0, vy: 600 };
  for (let i = 0; i < 60; i++) L.step(st);
  assert.strictEqual(st.ballsLeft, L.BALLS, 'still all balls');
  assert.strictEqual(st.ball, heir, 'the extra became the main ball');
  assert.strictEqual(st.extra.length, 0);
  assert.strictEqual(st.phase, 'play');
  st.ball = { x: 150, y: L.H - 5, vx: 0, vy: 600 };
  for (let i = 0; i < 60; i++) L.step(st);
  assert.strictEqual(st.ballsLeft, L.BALLS - 1, 'now a ball is lost');
  assert.strictEqual(st.phase, 'ready');
});

test('a main ball that rolls back into the lane is replaced by an extra instead of freezing the table', () => {
  const st = missionPlay();
  L.spawnExtra(st, 1);
  const heir = st.extra[0];
  st.ball = { x: L.LANE_X, y: 470, vx: 0, vy: 0 };
  for (let i = 0; i < 4; i++) L.step(st);
  assert.strictEqual(st.phase, 'play');
  assert.strictEqual(st.ball, heir);
});

test('extra balls are capped and a full cap gives no new ball', () => {
  const st = missionPlay();
  assert.strictEqual(L.spawnExtra(st, 10), L.MAX_EXTRA);
  assert.strictEqual(L.spawnExtra(st, 1), 0);
  assert.strictEqual(st.extra.length, L.MAX_EXTRA);
  assert.strictEqual(st.multis, 1, 'the second request made nothing, so it is not counted');
});

test('missions get harder each round and cycle through all four', () => {
  for (const m of L.MISSIONS) assert.ok(L.goalOf(m, 3) >= L.goalOf(m, 0));
  assert.ok(L.goalOf(L.MISSIONS[0], 1) > L.goalOf(L.MISSIONS[0], 0));
  const st = missionPlay();
  for (let n = 0; n < L.MISSIONS.length; n++) {
    const info = L.missionInfo(st);
    st.mission.progress = info.goal - 1;
    L.missionHit(st, info.id);
  }
  assert.strictEqual(st.mission.i, 0);
  assert.strictEqual(st.mission.round, 1, 'one full round done');
  assert.strictEqual(st.mission.done, 4);
  assert.ok(L.missionInfo(st).goal > L.goalOf(L.MISSIONS[0], 0));
});

test('mission table games are deterministic too, extra balls included', () => {
  const play = () => {
    const st = L.newGame({ table: 1 });
    L.holdPlunger(st, true); run(st, 0.9); L.holdPlunger(st, false);
    for (let n = 0; n < 240 * 10; n++) {
      if (n === 240 * 3) L.spawnExtra(st, 2);
      L.setFlipper(st, 0, n % 90 < 30); L.setFlipper(st, 1, n % 110 < 40); L.step(st);
    }
    return JSON.stringify([st.score, st.ball, st.extra, st.ballsLeft, st.mission, st.lit]);
  };
  assert.strictEqual(play(), play());
});

test('an extra ball resting on a target gets nudged like the main ball', () => {
  const st = missionPlay();
  L.spawnExtra(st, 1);
  const tg = L.TARGETS[1];
  st.extra[0] = { x: (tg.x1 + tg.x2) / 2, y: tg.y1 - L.BALL_R - 3 - 0.01, vx: 0, vy: 0, stall: 0 };
  let nudged = false;
  for (let i = 0; i < 240 * 6 && !nudged; i++) { st.ball = { x: 150, y: 300, vx: 0, vy: 0 }; L.step(st); if (st.events.some((e) => e.type === 'nudge')) nudged = true; st.events.length = 0; }
  assert.ok(nudged, 'it was shaken loose within six seconds');
});

test('extra balls spawned in a row all enter the table and none starts inside a wall, bumper or target', () => {
  for (let k = 0; k < 30; k++) {
    const st = missionPlay(); st.time = k * 0.37;
    L.spawnExtra(st, 3);
    for (const e of st.extra) {
      for (const bp of st.bumpers) assert.ok(Math.hypot(e.x - bp.x, e.y - bp.y) > bp.r + L.BALL_R, 'not inside a bumper');
      for (const tg of L.TARGETS) assert.ok(Math.abs(e.y - tg.y1) > L.BALL_R + 3 || e.x > tg.x2 + 10 || e.x < tg.x1 - 10, 'not on a target');
      assert.ok(e.x > 20 && e.x < 260 && e.y > 15, 'inside the table');
    }
  }
});
