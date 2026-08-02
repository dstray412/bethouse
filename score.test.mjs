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
  // Values fitted from 2,465 real starts, not assumed.
  close(score.expectedPA(1), 4.536);
  close(score.expectedPA(9), 4.536 - 0.1326 * 8); // 3.475
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
  // A hitter gets 4 trips or 5, never 4.536, so this is a mixture of the
  // two whole-trip cases weighted by the fraction.
  const pa = score.expectedPA(1);
  const frac = pa - 4;
  const expected = 1 - ((1 - frac) * Math.pow(0.75, 4) + frac * Math.pow(0.75, 5));
  close(score.probAtLeastOne(PLAYER, { correlation: 0 }), expected, 1e-12);
});

test("fractional plate appearances are a mixture, not a fractional power", () => {
  // The power form is the approximation. Assert the mixture identity, and
  // assert the two genuinely differ so nobody "simplifies" this back later.
  close(score.mixPow(0.75, 4.65), 0.35 * Math.pow(0.75, 4) + 0.65 * Math.pow(0.75, 5), 1e-12);
  assert.ok(Math.abs(score.mixPow(0.75, 4.65) - Math.pow(0.75, 4.65)) > 0.002);
  close(score.mixPow(0.5, 4.5), 0.5 * Math.pow(0.5, 4) + 0.5 * Math.pow(0.5, 5), 1e-12);
  // A whole number of trips must reduce to plain exponentiation.
  close(score.mixPow(0.75, 4), Math.pow(0.75, 4), 1e-12);
});

test("correlation 1 is full independence and is the most optimistic", () => {
  const pa = score.expectedPA(1);
  const expected =
    1 - score.mixPow(0.75, pa) * score.mixPow(0.875, pa) * score.mixPow(0.875, pa);
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
  close(s.expectedPA, 4.536);
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

test("home run probability uses the same whole-trip mixture as the others", () => {
  // Previously Poisson over fractional PA. Switched so all three models agree
  // on what "4.65 trips" means; without that, P(1+ TB) and P(1+ hit) diverge.
  const p = { hr: 20, pa: 400, slot: 1, name: "x" };
  const s = score.scoreHR(p, {});
  close(s.prob, 1 - score.mixPow(1 - 20 / 400, score.expectedPA(1)), 1e-12);
});

test("all three models agree that 1+ total bases is 1+ hits", () => {
  // The invariant that exposed the fractional-PA inconsistency in the first
  // place. If these ever diverge again, one of the models is wrong.
  const lgTB = { single: 0.152, double: 0.043, triple: 0.004, hr: 0.031 };
  const p = { name: "x", hits: 120, doubles: 28, triples: 2, hr: 20, pa: 500, slot: 2 };
  const r = score.tbRates(p, lgTB);
  const pa = score.expectedPA(2);
  const viaDistribution = score.probAtLeastTB(r, pa, 1);
  const viaRate = 1 - score.mixPow(1 - (r.p1 + r.p2 + r.p3 + r.p4), pa);
  close(viaDistribution, viaRate, 1e-12);
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

/* ---------------------------------------------------------------- *
 * Handedness and home/away
 * ---------------------------------------------------------------- */

// Measured from 2026 data, relative to each group's overall rate.
const PLAT_HITS = { R: { L: 1.018, R: 0.992 }, L: { L: 0.947, R: 1.018 }, S: { L: 1.024, R: 0.989 } };
const PLAT_HR   = { R: { L: 0.995, R: 1.002 }, L: { L: 0.751, R: 1.086 }, S: { L: 1.161, R: 0.928 } };
const VENUE     = { home: 1.007, away: 0.993 };

test("platoon points the right way for each batter handedness", () => {
  // Righties hit lefties better; lefties hit righties better. Getting this
  // backwards would be worse than applying nothing.
  assert.ok(score.platoonFactor("R", "L", PLAT_HITS) > 1);
  assert.ok(score.platoonFactor("R", "R", PLAT_HITS) < 1);
  assert.ok(score.platoonFactor("L", "L", PLAT_HITS) < 1);
  assert.ok(score.platoonFactor("L", "R", PLAT_HITS) > 1);
});

test("unknown handedness is neutral, never guessed", () => {
  assert.equal(score.platoonFactor(null, "L", PLAT_HITS), 1);
  assert.equal(score.platoonFactor("R", null, PLAT_HITS), 1);
  assert.equal(score.platoonFactor("R", "L", null), 1);
  assert.equal(score.homeAwayFactor(true, null), 1);
});

test("a player's own split is weighted exactly PA/(PA+K)", () => {
  // Platoon splits are famously noisy, so a player's own number is blended
  // in at weight PA/(PA+600). Assert the weight itself rather than an
  // eyeballed tolerance: recover w from the output and check it.
  const lgMult = PLAT_HITS.R.L;
  const overall = 0.22;
  for (const pa of [60, 150, 600, 1800]) {
    const own = { hits: 0.3 * pa, pa }; // a real .300-vs-LHP sample
    const ownMult = 0.3 / overall;
    const got = score.platoonFactor("R", "L", PLAT_HITS, own, overall);
    const w = (got - lgMult) / (ownMult - lgMult);
    close(w, pa / (pa + score.PLATOON_K), 1e-9);
  }
  // 60 PA earns the player barely any say; 1800 PA earns him most of it.
  close(60 / (60 + score.PLATOON_K), 60 / 660, 1e-9);
  assert.ok(1800 / (1800 + score.PLATOON_K) > 0.74);
  // Anything under the floor is ignored outright.
  const under = score.platoonFactor("R", "L", PLAT_HITS, { hits: 20, pa: 40 }, 0.22);
  close(under, PLAT_HITS.R.L, 1e-12);
});

test("a small platoon sample stays close to the league value in practice", () => {
  // Same check in outcome terms: a 40-PA hot streak must not swing the
  // final probability by a meaningful amount.
  const lg = { hit: 0.217, run: 0.119, rbi: 0.114 };
  const base = { name: "x", hits: 0.22 * 450, runs: 55, rbi: 52, pa: 450, slot: 2, batSide: "R" };
  const plain = score.scoreHRR(base, { leagueRates: lg, pitchHand: "L", leaguePlatoon: PLAT_HITS });
  const hot = score.scoreHRR(
    { ...base, vsHand: { hits: 12, pa: 40 } },
    { leagueRates: lg, pitchHand: "L", leaguePlatoon: PLAT_HITS }
  );
  assert.ok(Math.abs(hot.prob - plain.prob) < 0.006, "a 40-PA split swung the prop too far");
});

test("home runs use the HR platoon table, not the hits one", () => {
  // This is the bug the backtest exposed: the lefty-vs-lefty power effect is
  // about -25%, where the hits effect is only about -5%. Using the hits table
  // for home runs understates it more than fivefold.
  const p = { hr: 20, pa: 450, slot: 3, batSide: "L" };
  const withHR = score.scoreHR(p, { pitchHand: "L", leaguePlatoonHR: PLAT_HR, leaguePlatoon: PLAT_HITS });
  const withHits = score.scoreHR(p, { pitchHand: "L", leaguePlatoon: PLAT_HITS });
  assert.ok(withHR.platoonFactor < 0.8, `HR table should suppress hard, got ${withHR.platoonFactor}`);
  assert.ok(withHits.platoonFactor > 0.9, "hits table barely suppresses");
  assert.ok(withHR.prob < withHits.prob, "the HR table must produce the lower estimate");
});

test("the clamp floor does not truncate the real lefty-on-lefty effect", () => {
  // A floor of 0.82 (calibrated for hits) would silently turn a 25%
  // suppression into 18%. The floor must sit below the measured value.
  const f = score.platoonFactor("L", "L", PLAT_HR);
  assert.ok(f < 0.8 && f > 0.7, `expected ~0.751, got ${f}`);
});

test("a right-handed batter's home run rate is barely platoon-sensitive", () => {
  const p = { hr: 20, pa: 450, slot: 3, batSide: "R" };
  const vsL = score.scoreHR(p, { pitchHand: "L", leaguePlatoonHR: PLAT_HR });
  const vsR = score.scoreHR(p, { pitchHand: "R", leaguePlatoonHR: PLAT_HR });
  assert.ok(Math.abs(vsL.prob - vsR.prob) < 0.005, "righty HR platoon should be near zero");
});

test("home/away moves the estimate the right way and stays small", () => {
  const p = { name: "x", hits: 100, runs: 50, rbi: 50, pa: 450, slot: 2 };
  const lg = { hit: 0.217, run: 0.119, rbi: 0.114 };
  const h = score.scoreHRR(p, { leagueRates: lg, leagueHomeAway: VENUE, isHome: true });
  const a = score.scoreHRR(p, { leagueRates: lg, leagueHomeAway: VENUE, isHome: false });
  assert.ok(h.prob > a.prob);
  assert.ok(h.prob - a.prob < 0.01, "home/away is worth well under a point on this prop");
});

test("the whole platoon swing on H+R+RBI is about one point", () => {
  // Documented because it is the reason the backtest A/B found no
  // improvement: real effect, far too small to matter against lineup slot.
  const p = { name: "x", hits: 0.22 * 450, runs: 55, rbi: 52, pa: 450, slot: 2, batSide: "R" };
  const lg = { hit: 0.217, run: 0.119, rbi: 0.114 };
  const vsL = score.scoreHRR(p, { leagueRates: lg, pitchHand: "L", leaguePlatoon: PLAT_HITS });
  const vsR = score.scoreHRR(p, { leagueRates: lg, pitchHand: "R", leaguePlatoon: PLAT_HITS });
  const swing = vsL.prob - vsR.prob;
  assert.ok(swing > 0.005 && swing < 0.02, `expected ~0.010, got ${swing}`);
});

test("scoreHR reports handedness so the UI can explain itself", () => {
  // Without these fields the board silently drops the handedness line from
  // the home run view, which is the one view where it matters most.
  const s = score.scoreHR(
    { hr: 25, pa: 500, slot: 3, batSide: "L" },
    { pitchHand: "L", leaguePlatoonHR: PLAT_HR, isHome: true }
  );
  assert.equal(s.batSide, "L");
  assert.equal(s.pitchHand, "L");
  assert.equal(s.isHome, true);
});

test("a mismatched-units own-split is refused, not clamped into a lie", () => {
  // Passing hit counts against a home-run rate gives a ratio near 4.4.
  // Clamping that would return the 1.35 ceiling for a matchup whose true
  // value is 0.75 — confidently backwards. It must fall back to league.
  const bogus = score.platoonFactor("L", "L", PLAT_HR, { hits: 110, pa: 500 }, 0.05);
  close(bogus, PLAT_HR.L.L, 1e-12);
  // The correctly-typed call still blends: 15 HR in 500 PA is .030 against a
  // .050 overall rate, a 0.60 ratio, which is a credible platoon split.
  const good = score.platoonFactor("L", "L", PLAT_HR, { hits: 15, pa: 500 }, 0.05);
  assert.ok(good !== PLAT_HR.L.L, "a valid sample should still move it");
  assert.ok(good > 0.6 && good < 1.1);
});

test("the plausibility guard rejects only absurd ratios, not real splits", () => {
  // The guard exists to catch units mismatches (~4.4), not to discard real
  // extremes. A 0.60 platoon ratio is a genuine, if strong, split.
  const real = score.platoonFactor("L", "L", PLAT_HR, { hits: 15, pa: 500 }, 0.05);
  assert.notEqual(real, PLAT_HR.L.L);
  // A hits-vs-HR-rate mismatch lands near 4.4 and must be thrown out.
  const mismatch = score.platoonFactor("L", "L", PLAT_HR, { hits: 110, pa: 500 }, 0.05);
  close(mismatch, PLAT_HR.L.L, 1e-12);
});

/* ---------------------------------------------------------------- *
 * Games already in progress
 * ---------------------------------------------------------------- */

test("a bet already won is settled at 100%, not modelled", () => {
  const s = score.scoreHRR(
    { ...PLAYER, sofar: { pa: 2, hits: 1, runs: 0, rbi: 0, tb: 1, hr: 0 } },
    {}
  );
  assert.equal(s.settled, true);
  assert.equal(s.prob, 1);
});

test("a bet with no trips left and no result is settled at 0%", () => {
  const s = score.scoreHRR(
    { ...PLAYER, slot: 9, sofar: { pa: 9, hits: 0, runs: 0, rbi: 0, tb: 0, hr: 0 } },
    {}
  );
  assert.equal(s.settled, true);
  assert.equal(s.prob, 0);
});

test("mid-game, only the remaining trips count", () => {
  // Two trips taken, nothing to show for them. The bet now needs the same
  // result from what is left, which is a materially worse number than the
  // pregame one. Showing the pregame figure to someone watching the fifth
  // inning is the bug this fixes.
  const pre = score.scoreHRR(PLAYER, {});
  const mid = score.scoreHRR(
    { ...PLAYER, sofar: { pa: 2, hits: 0, runs: 0, rbi: 0, tb: 0, hr: 0 } },
    {}
  );
  assert.ok(mid.prob < pre.prob, "mid-game must be lower than pregame");
  close(mid.remainingPA, score.expectedPA(1) - 2, 1e-9);
});

test("remaining plate appearances never go negative", () => {
  close(score.remainingPA(1, { pa: 99 }), 0);
  close(score.remainingPA(1, null), score.expectedPA(1));
  close(score.remainingPA(1, { pa: 0 }), score.expectedPA(1));
});

test("an unknown lineup slot is unmodellable, not a lost bet", () => {
  // These must stay null. Returning a settled 0% would put a confident
  // "no chance" on a player we simply have no lineup information for.
  assert.equal(score.scoreHRR({ ...PLAYER, slot: undefined }, {}), null);
  assert.equal(score.scoreHRR({ ...PLAYER, slot: 12 }, {}), null);
  assert.equal(score.scoreHRR({ ...PLAYER, pa: 0 }, {}), null);
});

test("total bases already banked count toward the threshold", () => {
  const lgTB = { single: 0.152, double: 0.043, triple: 0.004, hr: 0.031 };
  const base = { name: "x", hits: 120, doubles: 28, triples: 2, hr: 20, pa: 500, slot: 2 };
  // A double in the first inning settles a 2+ bet immediately.
  const done = score.scoreTB({ ...base, sofar: { pa: 1, tb: 2 } }, { leagueTB: lgTB, threshold: 2 });
  assert.equal(done.settled, true);
  assert.equal(done.prob, 1);
  // A single leaves him needing one more base from his remaining trips,
  // which is EASIER than the pregame 2+ bet, so the number must go up.
  const pre = score.scoreTB(base, { leagueTB: lgTB, threshold: 2 });
  const partial = score.scoreTB({ ...base, sofar: { pa: 1, tb: 1 } }, { leagueTB: lgTB, threshold: 2 });
  assert.equal(partial.stillNeeds, 1);
  assert.ok(partial.prob > pre.prob, "one base banked should improve a 2+ bet");
});

test("total bases with nothing banked and trips burned gets worse", () => {
  const lgTB = { single: 0.152, double: 0.043, triple: 0.004, hr: 0.031 };
  const base = { name: "x", hits: 120, doubles: 28, triples: 2, hr: 20, pa: 500, slot: 2 };
  const pre = score.scoreTB(base, { leagueTB: lgTB, threshold: 2 });
  const cold = score.scoreTB({ ...base, sofar: { pa: 2, tb: 0 } }, { leagueTB: lgTB, threshold: 2 });
  assert.ok(cold.prob < pre.prob, "two hitless trips should lower a 2+ bet");
  assert.equal(cold.stillNeeds, 2);
});

test("a home run already hit settles the home run bet", () => {
  const s = score.scoreHR({ hr: 25, pa: 500, slot: 3, sofar: { pa: 2, hr: 1 } }, {});
  assert.equal(s.settled, true);
  assert.equal(s.prob, 1);
});
