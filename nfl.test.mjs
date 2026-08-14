/*
 * BetHouse — nfl.test.mjs
 * Tests for the three NFL models.
 *
 * These test SHAPE: that each model responds correctly to its inputs,
 * clamps what needs clamping, and reduces to something checkable by hand at
 * the boundaries. Whether any of them is any good is `backtest-nfl.mjs`'s
 * question, and the answer for the spread model is expected to be "no".
 *
 * Where a test pins a number that came out of a fit rather than a rule it is
 * marked `characterization:` so the next person knows they may move it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import nfl from "./nfl.js";

const {
  DEFAULTS, buildTeamRatings, projectGame, normalCDF, spreadProbability,
  totalProbability, usageTDs, scoreAnytimeTD, expectedVolume, empiricalOver,
  ratioPool, fairPrice,
} = nfl;

const close = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} ≈ ${b} (tol ${tol})`);

/* ------------------------------------------------------------------ *
 * normalCDF
 * ------------------------------------------------------------------ */

test("normalCDF: known values", () => {
  close(normalCDF(0), 0.5, 1e-7);
  close(normalCDF(1.6448536), 0.95, 1e-5);
  close(normalCDF(-1.6448536), 0.05, 1e-5);
  close(normalCDF(1.959964), 0.975, 1e-5);
});

test("normalCDF: symmetric and monotone", () => {
  for (const z of [0.25, 0.8, 1.5, 2.7]) {
    close(normalCDF(z) + normalCDF(-z), 1, 1e-6);
  }
  let prev = 0;
  for (let z = -3; z <= 3; z += 0.25) {
    const v = normalCDF(z);
    assert.ok(v >= prev, "must be non-decreasing");
    prev = v;
  }
});

test("normalCDF: stays inside [0,1] at the extremes", () => {
  for (const z of [-40, -8, 8, 40]) {
    const v = normalCDF(z);
    assert.ok(v >= 0 && v <= 1, `${z} -> ${v}`);
  }
});

/* ------------------------------------------------------------------ *
 * Team ratings
 * ------------------------------------------------------------------ */

/** A round-robin where each team's true strength is known by construction. */
function syntheticSeason(strength, rounds = 6) {
  const teams = Object.keys(strength);
  const games = [];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const [h, a] = r % 2 ? [teams[i], teams[j]] : [teams[j], teams[i]];
        games.push({
          home: { team: h, score: 23 + strength[h] - strength[a] / 2 + 2 },
          away: { team: a, score: 23 + strength[a] - strength[h] / 2 },
        });
      }
    }
  }
  return games;
}

test("buildTeamRatings: a better team rates better", () => {
  const games = syntheticSeason({ AAA: 8, BBB: 0, CCC: -8, DDD: 0 });
  const r = buildTeamRatings(games, { teamK: 0 });
  assert.ok(r.off.AAA > r.off.BBB, "AAA should out-rate BBB on offence");
  assert.ok(r.off.BBB > r.off.CCC, "BBB should out-rate CCC on offence");
});

test("buildTeamRatings: separates offence from schedule", () => {
  /*
   * Both GOOD and FLAT score exactly 30. GOOD did it against a defence that
   * holds everyone else to 10; FLAT did it against one that gives up 40.
   * Identical box scores, and the solve has to rate GOOD's offence higher.
   *
   * The first version of this test got the setup wrong: it named a team
   * STINGY but handed it a defence that allowed 30 in both its games, the
   * same as the "sieve". With identical defences the two offences SHOULD
   * rate equal, so the assertion was false while the model was right. Home
   * field is switched off here so it cannot muddy a structural check.
   */
  const games = [
    { home: { team: "GOOD", score: 30 }, away: { team: "STINGY", score: 20 } },
    { home: { team: "FILL", score: 10 }, away: { team: "STINGY", score: 20 } },
    { home: { team: "STINGY", score: 20 }, away: { team: "FILL", score: 10 } },
    { home: { team: "FLAT", score: 30 }, away: { team: "SIEVE", score: 20 } },
    { home: { team: "FILL", score: 40 }, away: { team: "SIEVE", score: 20 } },
    { home: { team: "SIEVE", score: 20 }, away: { team: "FILL", score: 40 } },
  ];
  const r = buildTeamRatings(games, { teamK: 0, homeField: 0 });
  assert.ok(
    r.def.STINGY < r.def.SIEVE,
    `the setup itself must hold: STINGY's defence (${r.def.STINGY}) has to rate better than SIEVE's (${r.def.SIEVE})`,
  );
  assert.ok(
    r.off.GOOD > r.off.FLAT,
    `scoring 30 on a good defence should rate above scoring 30 on a bad one (${r.off.GOOD} vs ${r.off.FLAT})`,
  );
});

test("buildTeamRatings: the ridge shrinks a short record", () => {
  const games = [
    { home: { team: "HOT", score: 45 }, away: { team: "X", score: 10 } },
    { home: { team: "Y", score: 21 }, away: { team: "Z", score: 20 } },
    { home: { team: "Z", score: 22 }, away: { team: "Y", score: 21 } },
  ];
  const loose = buildTeamRatings(games, { teamK: 0 }).off.HOT;
  const tight = buildTeamRatings(games, { teamK: 20 }).off.HOT;
  assert.ok(Math.abs(tight) < Math.abs(loose), "more K must mean less extreme");
});

test("buildTeamRatings: counts games and survives empty input", () => {
  const games = syntheticSeason({ A: 3, B: 0, C: -3 }, 2);
  const r = buildTeamRatings(games);
  for (const t of ["A", "B", "C"]) assert.ok(r.games[t] > 0);
  const empty = buildTeamRatings([]);
  assert.deepEqual(empty.off, {});
  assert.deepEqual(buildTeamRatings(null).off, {});
});

test("buildTeamRatings: ignores malformed games instead of poisoning ratings", () => {
  const games = [
    { home: { team: "A", score: 24 }, away: { team: "B", score: 17 } },
    null,
    { home: null, away: { team: "B", score: 3 } },
    { home: { team: "A", score: NaN }, away: { team: "B", score: 10 } },
  ];
  const r = buildTeamRatings(games, { teamK: 0 });
  assert.ok(isFinite(r.off.A) && isFinite(r.off.B));
});

test("buildTeamRatings: is deterministic", () => {
  const games = syntheticSeason({ A: 5, B: 1, C: -4, D: 0 }, 3);
  const a = buildTeamRatings(games), b = buildTeamRatings(games);
  assert.deepEqual(a.off, b.off);
  assert.deepEqual(a.def, b.def);
});

/* ------------------------------------------------------------------ *
 * projectGame
 * ------------------------------------------------------------------ */

test("projectGame: home field goes to whoever is at home", () => {
  /*
   * Two identical teams: whoever hosts is favoured, by the same amount
   * either way. So the two margins are both positive and sum to twice the
   * home field edge -- they are NOT negatives of each other, which is what
   * this test asserted at first. That would only hold if home field were
   * worth nothing, in which case there would be nothing to test.
   */
  const games = syntheticSeason({ A: 0, B: 0, C: 0 }, 4);
  const r = buildTeamRatings(games, { teamK: 0 });
  const atA = projectGame(r, "A", "B");
  const atB = projectGame(r, "B", "A");
  assert.ok(atA.margin > 0, "home side of an even matchup is favoured");
  assert.ok(atB.margin > 0, "and so is the other one, when it hosts");
  close(atA.margin + atB.margin, 2 * r.homeField, 1e-6);
});

test("projectGame: the better team is favoured", () => {
  const r = buildTeamRatings(syntheticSeason({ BIG: 10, SML: -10, MID: 0 }, 5), { teamK: 0 });
  assert.ok(projectGame(r, "BIG", "SML").margin > projectGame(r, "MID", "SML").margin);
});

test("projectGame: total is the two projections added", () => {
  const r = buildTeamRatings(syntheticSeason({ A: 4, B: -4 }, 4), { teamK: 0 });
  const p = projectGame(r, "A", "B");
  close(p.total, p.homePts + p.awayPts, 1e-9);
  close(p.margin, p.homePts - p.awayPts, 1e-9);
});

test("projectGame: an unknown team falls back to league average, not NaN", () => {
  const r = buildTeamRatings(syntheticSeason({ A: 4, B: -4 }, 3), { teamK: 0 });
  const p = projectGame(r, "A", "WHO");
  assert.ok(isFinite(p.margin) && isFinite(p.total));
});

/* ------------------------------------------------------------------ *
 * Against the line
 * ------------------------------------------------------------------ */

test("spreadProbability: agreeing with the line is a coin flip", () => {
  // Model says home by 7; market says home -7. No disagreement, no edge.
  const s = spreadProbability(7, -7);
  close(s.edge, 0, 1e-9);
  close(s.homeCoverProb, 0.5, 1e-6);
});

test("spreadProbability: liking the home side more than the market does", () => {
  const s = spreadProbability(10, -7); // model +3 on the home side
  assert.ok(s.edge > 0);
  assert.ok(s.homeCoverProb > 0.5 && s.homeCoverProb < 0.7,
    `3 points of edge should be a modest lean, got ${s.homeCoverProb}`);
});

test("spreadProbability: sign convention matches how a spread is graded", () => {
  // Home -7 means home must win by 8. A model projecting home by only 3
  // should make the home cover unlikely.
  assert.ok(spreadProbability(3, -7).homeCoverProb < 0.5);
  // Home +7 (road favourite) and a model projecting a home win: likely cover.
  assert.ok(spreadProbability(3, 7).homeCoverProb > 0.5);
});

test("spreadProbability: bigger disagreement, stronger opinion", () => {
  const a = spreadProbability(8, -7).homeCoverProb;
  const b = spreadProbability(14, -7).homeCoverProb;
  const c = spreadProbability(21, -7).homeCoverProb;
  assert.ok(a < b && b < c);
});

test("spreadProbability: junk in, null out", () => {
  assert.equal(spreadProbability(NaN, -3), null);
  assert.equal(spreadProbability(3, undefined), null);
});

test("totalProbability: projecting the market total is a coin flip", () => {
  const t = totalProbability(45, 45);
  close(t.edge, 0, 1e-9);
  close(t.overProb, 0.5, 1e-6);
});

test("totalProbability: projecting more points leans over", () => {
  assert.ok(totalProbability(52, 45).overProb > 0.5);
  assert.ok(totalProbability(38, 45).overProb < 0.5);
});

/* ------------------------------------------------------------------ *
 * Anytime touchdown
 * ------------------------------------------------------------------ */

test("usageTDs: a target is worth more than a carry", () => {
  assert.ok(usageTDs(0, 1) > usageTDs(1, 0),
    "measured: 0.0473 per target against 0.0335 per carry");
  close(usageTDs(10, 10), 10 * DEFAULTS.tdPerCarry + 10 * DEFAULTS.tdPerTarget, 1e-12);
  close(usageTDs(0, 0), 0, 1e-12);
});

test("scoreAnytimeTD: probability is a probability", () => {
  const s = scoreAnytimeTD({ games: 8, tds: 5, carries: 120, targets: 20 }, {});
  assert.ok(s.prob > 0 && s.prob < 1);
});

test("scoreAnytimeTD: more workload, better chance", () => {
  const low = scoreAnytimeTD({ games: 8, tds: 2, carries: 30, targets: 8 }, {});
  const high = scoreAnytimeTD({ games: 8, tds: 2, carries: 150, targets: 40 }, {});
  assert.ok(high.prob > low.prob, "the ball has to reach you to score");
});

test("scoreAnytimeTD: a hot streak is discounted toward workload", () => {
  // Same workload, wildly different scoring. The gap between them must be
  // much smaller than the gap in their raw rates, because touchdowns are
  // the noisiest thing a skill player does.
  const cold = scoreAnytimeTD({ games: 6, tds: 0, carries: 90, targets: 12 }, {});
  const hot = scoreAnytimeTD({ games: 6, tds: 6, carries: 90, targets: 12 }, {});
  const rawGap = 6 / 6 - 0 / 6;
  const modelGap = hot.lambda - cold.lambda;
  assert.ok(modelGap > 0, "scoring more should still count for something");
  assert.ok(modelGap < rawGap * 0.75, `expected heavy shrinkage, got ${modelGap} of ${rawGap}`);
});

test("scoreAnytimeTD: shrinkage relaxes as the season goes on", () => {
  const early = scoreAnytimeTD({ games: 2, tds: 2, carries: 30, targets: 6 }, {});
  const late = scoreAnytimeTD({ games: 16, tds: 16, carries: 240, targets: 48 }, {});
  assert.ok(late.shrink > early.shrink, "more games means more of his own record");
});

test("scoreAnytimeTD: opponent and offence move it the right way", () => {
  const p = { games: 8, tds: 4, carries: 100, targets: 30 };
  const base = scoreAnytimeTD(p, {}).prob;
  assert.ok(scoreAnytimeTD(p, { oppFactor: 1.4 }).prob > base, "leaky defence helps");
  assert.ok(scoreAnytimeTD(p, { oppFactor: 0.7 }).prob < base, "good defence hurts");
  assert.ok(scoreAnytimeTD(p, { teamFactor: 1.4 }).prob > base, "good offence helps");
});

test("scoreAnytimeTD: context factors are clamped, so one bad input cannot run away", () => {
  const p = { games: 8, tds: 4, carries: 100, targets: 30 };
  const wild = scoreAnytimeTD(p, { oppFactor: 99, teamFactor: 99 });
  assert.ok(wild.oppFactor <= 1.6 && wild.teamFactor <= 1.6);
  assert.ok(wild.prob <= 0.95);
});

test("scoreAnytimeTD: never promises a certainty", () => {
  const s = scoreAnytimeTD({ games: 16, tds: 40, carries: 400, targets: 200 }, { oppFactor: 1.6, teamFactor: 1.6 });
  assert.ok(s.prob <= 0.95, `no NFL player is a lock to score, got ${s.prob}`);
});

test("scoreAnytimeTD: a player who has never played returns null, not a guess", () => {
  assert.equal(scoreAnytimeTD({ games: 0, tds: 0, carries: 0, targets: 0 }, {}), null);
  assert.equal(scoreAnytimeTD(null, {}), null);
});

test("scoreAnytimeTD: a blocking tight end is a long shot, not zero", () => {
  const s = scoreAnytimeTD({ games: 10, tds: 0, carries: 0, targets: 8 }, {});
  assert.ok(s.prob > 0 && s.prob < 0.12, `expected a long shot, got ${s.prob}`);
});

test("scoreAnytimeTD: a workhorse back is the most likely scorer on the board", () => {
  // characterization: depends on the fitted usage constants, but a back on
  // 20 carries a game has to land in bookmaker territory (roughly -150 to
  // +150), not at 10% and not at 95%.
  const s = scoreAnytimeTD({ games: 10, tds: 8, carries: 200, targets: 40 }, {});
  assert.ok(s.prob > 0.4 && s.prob < 0.8, `got ${s.prob}`);
});

/* ------------------------------------------------------------------ *
 * Yards and catches
 * ------------------------------------------------------------------ */

test("expectedVolume: shrinks toward the prior early and trusts the record late", () => {
  const early = expectedVolume(300, 2, 40); // 150/game over 2 games
  const late = expectedVolume(2400, 16, 40); // 150/game over 16
  assert.ok(early < late, "two big games should not project like sixteen");
  assert.ok(early > 40, "but they should still count for something");
});

test("expectedVolume: no games played falls back to the prior", () => {
  close(expectedVolume(0, 0, 55), 55, 1e-9);
});

test("ratioPool: builds actual/expected and drops the unusable", () => {
  const pool = ratioPool([
    { expected: 50, actual: 100 }, // 2.0
    { expected: 50, actual: 25 },  // 0.5
    { expected: 1, actual: 40 },   // dropped: expectation too small
  ], 5);
  assert.equal(pool.length, 2);
  close(pool[0], 2, 1e-12);
  close(pool[1], 0.5, 1e-12);
});

test("empiricalOver: reads the answer off real outcomes", () => {
  // Half the pool doubled their expectation, half halved it.
  const pool = [2, 2, 0.5, 0.5];
  close(empiricalOver(50, 60, pool), 0.5, 1e-12); // only the 2.0s clear 60
  close(empiricalOver(50, 10, pool), 1, 1e-12);   // everyone clears 10
  close(empiricalOver(50, 200, pool), 0, 1e-12);  // nobody clears 200
});

test("empiricalOver: a higher line is always harder", () => {
  const pool = [0.1, 0.4, 0.8, 1.0, 1.3, 1.9, 2.6];
  let prev = 1.1;
  for (const line of [10, 25, 50, 75, 120]) {
    const p = empiricalOver(50, line, pool);
    assert.ok(p <= prev, `raising the line must not raise the chance`);
    prev = p;
  }
});

test("empiricalOver: the skew is kept, which is the whole point", () => {
  // A right-skewed pool: most games below expectation, a few far above.
  // The median outcome is BELOW the mean, so the over at the mean should
  // hit less than half the time. A normal-shaped model would say 50%.
  const pool = [0.2, 0.3, 0.4, 0.5, 0.7, 0.9, 1.1, 3.9];
  const p = empiricalOver(50, 50, pool);
  assert.ok(p < 0.5, `right-skewed outcomes should clear their mean less than half the time, got ${p}`);
});

test("empiricalOver: refuses rather than inventing a number", () => {
  assert.equal(empiricalOver(0, 40, [1, 2]), null);
  assert.equal(empiricalOver(50, 40, []), null);
  assert.equal(empiricalOver(50, 40, null), null);
});

/* ------------------------------------------------------------------ *
 * fairPrice
 * ------------------------------------------------------------------ */

test("fairPrice: matches the convention used everywhere else", () => {
  assert.equal(fairPrice(0.5), 100);
  assert.ok(fairPrice(0.8) < 0);
  assert.ok(fairPrice(0.2) > 0);
  assert.equal(fairPrice(1), null);
  assert.equal(fairPrice(0), null);
});
