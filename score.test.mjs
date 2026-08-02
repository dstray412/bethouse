/*
 * BetHouse — score.test.mjs
 * Run with:  node --test
 *
 * These test the SHAPE of the model: that it responds correctly to inputs,
 * clamps what needs clamping, and reduces to something checkable by hand at
 * the boundaries. They do NOT test whether the model is any good at predicting
 * baseball. Only backtest.mjs can answer that, and until it has run, treat
 * every probability out of score.js as unvalidated.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import score from "./score.js";

const close = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} ≈ ${b} (tol ${tol})`);

/* ---------------------------------------------------------------- *
 * Plate appearances by slot
 * ---------------------------------------------------------------- */

test("leadoff gets the most plate appearances, ninth the fewest", () => {
  close(score.expectedPA(1), 4.65);
  close(score.expectedPA(9), 4.65 - 0.105 * 8); // 3.81
  for (let s = 2; s <= 9; s++) {
    assert.ok(score.expectedPA(s) < score.expectedPA(s - 1));
  }
});

test("a lineup slot outside 1-9 is not a lineup slot", () => {
  assert.ok(Number.isNaN(score.expectedPA(0)));
  assert.ok(Number.isNaN(score.expectedPA(10)));
  assert.ok(Number.isNaN(score.expectedPA(undefined)));
});

/* ---------------------------------------------------------------- *
 * Rates
 * ---------------------------------------------------------------- */

test("rates are per plate appearance, not per at-bat", () => {
  // 100 hits in 400 PA is a .250 hit rate per trip, regardless of walks.
  const r = score.perPA({ hits: 100, runs: 50, rbi: 50, pa: 400 });
  close(r.hit, 0.25);
  close(r.run, 0.125);
  close(r.rbi, 0.125);
});

test("zero plate appearances cannot produce a rate", () => {
  const r = score.perPA({ hits: 0, runs: 0, rbi: 0, pa: 0 });
  close(r.hit, 0);
  close(r.run, 0);
  close(r.rbi, 0);
});

/* ---------------------------------------------------------------- *
 * The combined probability
 * ---------------------------------------------------------------- */

const PLAYER = { hits: 100, runs: 50, rbi: 50, pa: 400, slot: 1 };

test("correlation 0 reduces to hits only, which is hand-checkable", () => {
  // 1 - 0.75^4.65
  const expected = 1 - Math.pow(0.75, 4.65);
  close(score.probAtLeastOne(PLAYER, { correlation: 0 }), expected, 1e-12);
  close(score.probAtLeastOne(PLAYER, { correlation: 0 }), 0.737563, 1e-5);
});

test("correlation 1 is full independence and is the most optimistic", () => {
  const pa = 4.65;
  const expected =
    1 - Math.pow(0.75, pa) * Math.pow(0.875, pa) * Math.pow(0.875, pa);
  close(score.probAtLeastOne(PLAYER, { correlation: 1 }), expected, 1e-12);
});

test("higher correlation always means a higher estimate", () => {
  // This is the whole reason k is a knob: guessing it high inflates every
  // number on the board. The ordering must be monotonic so fitting it works.
  let prev = -1;
  for (const k of [0, 0.25, 0.5, 0.75, 1]) {
    const p = score.probAtLeastOne(PLAYER, { correlation: k });
    assert.ok(p > prev, `k=${k} did not increase the estimate`);
    prev = p;
  }
});

test("the default sits between the conservative and optimistic bounds", () => {
  const lo = score.probAtLeastOne(PLAYER, { correlation: 0 });
  const hi = score.probAtLeastOne(PLAYER, { correlation: 1 });
  const def = score.probAtLeastOne(PLAYER, {});
  assert.ok(def > lo && def < hi);
});

test("a better hitter in the same slot always ranks higher", () => {
  const good = score.probAtLeastOne({ ...PLAYER, hits: 120 }, {});
  const bad = score.probAtLeastOne({ ...PLAYER, hits: 80 }, {});
  assert.ok(good > bad);
});

test("the same hitter batting higher in the order always ranks higher", () => {
  const first = score.probAtLeastOne({ ...PLAYER, slot: 1 }, {});
  const eighth = score.probAtLeastOne({ ...PLAYER, slot: 8 }, {});
  assert.ok(first > eighth);
});

test("probabilities stay inside [0,1] even for absurd inputs", () => {
  const monster = score.probAtLeastOne({ hits: 399, runs: 399, rbi: 399, pa: 400, slot: 1 }, { correlation: 1 });
  assert.ok(monster > 0 && monster <= 1);
  const ghost = score.probAtLeastOne({ hits: 0, runs: 0, rbi: 0, pa: 400, slot: 9 }, {});
  close(ghost, 0);
});

/* ---------------------------------------------------------------- *
 * Context factors
 * ---------------------------------------------------------------- */

test("a pitcher who allows more contact raises the estimate", () => {
  assert.ok(score.pitcherFactor(0.28, 0.248) > 1);
  assert.ok(score.pitcherFactor(0.21, 0.248) < 1);
  close(score.pitcherFactor(0.248, 0.248), 1);
});

test("pitcher factor is clamped, because a 40-inning sample is noise", () => {
  // A .400 opponent average over six starts should not double anyone's odds.
  close(score.pitcherFactor(0.4, 0.248), 1.12);
  close(score.pitcherFactor(0.1, 0.248), 0.88);
});

test("missing pitcher data is neutral, never a guess", () => {
  close(score.pitcherFactor(0, 0.248), 1);
  close(score.pitcherFactor(undefined, 0.248), 1);
  close(score.offenseFactor(undefined, 4.5), 1);
});

test("a better offense raises the estimate, clamped", () => {
  assert.ok(score.offenseFactor(5.4, 4.5) > 1);
  assert.ok(score.offenseFactor(3.9, 4.5) < 1);
  close(score.offenseFactor(9, 4.5), 1.15);
  close(score.offenseFactor(1, 4.5), 0.85);
});

test("offense context moves runs and RBI but never the hit leg", () => {
  // Two identical hitters, wildly different lineups around them. The gap
  // must come only from the run and RBI legs, so with correlation 0 (hits
  // only) the two must be identical.
  const ctxGood = { teamRunsPerGame: 5.4, leagueRunsPerGame: 4.5, correlation: 0 };
  const ctxBad = { teamRunsPerGame: 3.9, leagueRunsPerGame: 4.5, correlation: 0 };
  const a = score.scoreHRR(PLAYER, ctxGood);
  const b = score.scoreHRR(PLAYER, ctxBad);
  close(a.prob, b.prob, 1e-12);

  // With the run/RBI legs live, the good lineup must win.
  const a2 = score.scoreHRR(PLAYER, { ...ctxGood, correlation: 0.55 });
  const b2 = score.scoreHRR(PLAYER, { ...ctxBad, correlation: 0.55 });
  assert.ok(a2.prob > b2.prob);
});

/* ---------------------------------------------------------------- *
 * scoreHRR wiring
 * ---------------------------------------------------------------- */

test("scoreHRR refuses to opine without a slot or a sample", () => {
  assert.equal(score.scoreHRR({ ...PLAYER, slot: undefined }, {}), null);
  assert.equal(score.scoreHRR({ ...PLAYER, pa: 0 }, {}), null);
});

test("scoreHRR reports the inputs it used, not just an answer", () => {
  const s = score.scoreHRR(PLAYER, { oppAvgAllowed: 0.28, leagueAvgAllowed: 0.248 });
  assert.equal(s.slot, 1);
  close(s.expectedPA, 4.65);
  // hitRate is the rate the model ACTUALLY used, after context. The pitcher
  // factor wants 0.28/0.248 = 1.129 but clamps to 1.12, so 0.25 -> 0.28.
  close(s.rawHitRate, 0.25);
  close(s.hitRate, 0.25 * 1.12);
  close(s.pitcherFactor, 1.12);
  assert.equal(s.pa, 400);
  assert.equal(s.confidence, 1);
  assert.ok(s.score > 0 && s.score <= 100);
});

test("regression pulls a tiny sample most of the way to league average", () => {
  const lg = { hit: 0.217, run: 0.119, rbi: 0.114 };
  // 5-for-9 is a .556 hitter on paper and must not be treated as one.
  const callup = score.scoreHRR(
    { name: "callup", hits: 5, runs: 3, rbi: 3, pa: 9, slot: 1 },
    { leagueRates: lg }
  );
  const regular = score.scoreHRR(
    { name: "regular", hits: 100, runs: 50, rbi: 50, pa: 400, slot: 1 },
    { leagueRates: lg }
  );
  // Regressed rate must land near league, nowhere near .556
  assert.ok(callup.hitRate < 0.26, `callup regressed to ${callup.hitRate}`);
  assert.ok(callup.hitRate > 0.21);
  // And the real .250 hitter with a full season must outrank him
  assert.ok(regular.prob > callup.prob);
});

test("a player exactly at league rate is left alone", () => {
  const lg = { hit: 0.217, run: 0.119, rbi: 0.114 };
  const p = { hits: 0.217 * 600, runs: 0.119 * 600, rbi: 0.114 * 600, pa: 600 };
  const reg = score.regressedPerPA(p, lg);
  close(reg.hit, 0.217, 1e-9);
});

test("a big sample keeps more of its deviation than a small one", () => {
  // This is the whole point of the K weighting: player weight = PA/(PA+K).
  // At K=180 that is 77% for 600 PA and 36% for 100 PA.
  const lg = { hit: 0.217, run: 0.119, rbi: 0.114 };
  const rate = 0.300; // same deviation above league, different sample sizes
  const big = score.regressedPerPA({ hits: rate * 600, runs: 0, rbi: 0, pa: 600 }, lg);
  const small = score.regressedPerPA({ hits: rate * 100, runs: 0, rbi: 0, pa: 100 }, lg);
  const devBig = big.hit - lg.hit;
  const devSmall = small.hit - lg.hit;
  assert.ok(devBig > devSmall, "600 PA should retain more deviation than 100 PA");
  close(devBig / (rate - lg.hit), 600 / 780, 1e-9);
  close(devSmall / (rate - lg.hit), 100 / 280, 1e-9);
});

test("without league rates there is no regression, by design", () => {
  const a = score.regressedPerPA({ hits: 5, runs: 3, rbi: 3, pa: 9 }, null);
  close(a.hit, 5 / 9);
});

/* ---------------------------------------------------------------- *
 * Home runs
 * ---------------------------------------------------------------- */

test("home run probability follows the Poisson form", () => {
  const p = { hr: 20, pa: 400, slot: 1, name: "x" };
  const s = score.scoreHR(p, {});
  const lambda = (20 / 400) * 4.65;
  close(s.prob, 1 - Math.exp(-lambda), 1e-12);
});

test("a home-run-prone pitcher raises it, a stingy one lowers it", () => {
  const p = { hr: 20, pa: 400, slot: 1 };
  const hi = score.scoreHR(p, { pitcherHr9: 2.0, leagueHr9: 1.2 });
  const lo = score.scoreHR(p, { pitcherHr9: 0.6, leagueHr9: 1.2 });
  const mid = score.scoreHR(p, {});
  assert.ok(hi.prob > mid.prob && mid.prob > lo.prob);
});

test("home run pitcher factor is clamped too", () => {
  const p = { hr: 20, pa: 400, slot: 1 };
  close(score.scoreHR(p, { pitcherHr9: 99, leagueHr9: 1.2 }).pitcherFactor, 1.35);
  close(score.scoreHR(p, { pitcherHr9: 0.01, leagueHr9: 1.2 }).pitcherFactor, 0.75);
});

test("a player with no home runs is not a home run bet", () => {
  close(score.scoreHR({ hr: 0, pa: 400, slot: 1 }, {}).prob, 0);
});

/* ---------------------------------------------------------------- *
 * Presentation
 * ---------------------------------------------------------------- */

test("fair price converts a probability to the break-even number", () => {
  assert.equal(score.fairPrice(0.75), -300);
  assert.equal(score.fairPrice(0.5), 100);
  assert.equal(score.fairPrice(0.25), 300);
  assert.ok(Number.isNaN(score.fairPrice(0)));
  assert.ok(Number.isNaN(score.fairPrice(1)));
});

test("sample confidence separates a real season from a hot week", () => {
  assert.equal(score.sampleConfidence(500), 1);
  assert.equal(score.sampleConfidence(300), 0.85);
  assert.equal(score.sampleConfidence(200), 0.65);
  assert.equal(score.sampleConfidence(100), 0.4);
  assert.equal(score.sampleConfidence(30), 0.2);
  assert.equal(score.sampleConfidence(0), 0);
});

test("rank sorts by probability and drops the unscoreable", () => {
  const out = score.rank([
    { name: "a", prob: 0.6 },
    null,
    { name: "b", prob: 0.9 },
    { name: "c", prob: NaN },
    { name: "d", prob: 0.75 },
  ]);
  assert.deepEqual(out.map((x) => x.name), ["b", "d", "a"]);
});
