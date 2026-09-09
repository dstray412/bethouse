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

/* The three shape tests below read `rawCoverProb`: the model's own
   opinion before it is shrunk toward the line (see spreadShrink). The
   shipped `homeCoverProb` is that opinion times a measured slope, which
   for the NFL is zero, so it is a coin flip by design and the shape lives
   in the raw number. */
test("spreadProbability: liking the home side more than the market does", () => {
  const s = spreadProbability(10, -7); // model +3 on the home side
  assert.ok(s.edge > 0);
  assert.ok(s.rawCoverProb > 0.5 && s.rawCoverProb < 0.7,
    `3 points of edge should be a modest lean, got ${s.rawCoverProb}`);
});

test("spreadProbability: sign convention matches how a spread is graded", () => {
  // Home -7 means home must win by 8. A model projecting home by only 3
  // should make the home cover unlikely.
  assert.ok(spreadProbability(3, -7).rawCoverProb < 0.5);
  // Home +7 (road favourite) and a model projecting a home win: likely cover.
  assert.ok(spreadProbability(3, 7).rawCoverProb > 0.5);
});

test("spreadProbability: bigger disagreement, stronger opinion", () => {
  const a = spreadProbability(8, -7).rawCoverProb;
  const b = spreadProbability(14, -7).rawCoverProb;
  const c = spreadProbability(21, -7).rawCoverProb;
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

/* ------------------------------------------------------------------ *
 * Schedule parsing
 *
 * Oracle: the scoreboard's own `team.abbreviation`. These exist because
 * the board originally recovered team codes by searching each abbreviation
 * inside the full team name, which is wrong in both directions and shipped
 * that way: six of sixteen week-1 games silently vanished and two more were
 * projected against the wrong franchise.
 * ------------------------------------------------------------------ */
import { parseScheduleEvent } from "./fetch-nfl.mjs";

const event = (home, away, extra) =>
  Object.assign({
    id: "401872656",
    date: "2026-09-10T00:20Z",
    name: "Away Team at Home Team",
    status: { type: { completed: false } },
    competitions: [{
      competitors: [
        { homeAway: "home", team: { abbreviation: home } },
        { homeAway: "away", team: { abbreviation: away } },
      ],
    }],
  }, extra || {});

test("parseScheduleEvent: takes team codes from the data, not from the name", () => {
  const g = parseScheduleEvent(event("SEA", "NE"), 2026, 1);
  assert.equal(g.home, "SEA");
  assert.equal(g.away, "NE");
  assert.equal(g.season, 2026);
  assert.equal(g.week, 1);
});

test("parseScheduleEvent: the names that broke substring matching", () => {
  // "San Francisco 49ers" contains no "SF", so the old approach dropped it.
  const a = parseScheduleEvent(
    event("LAR", "SF", { name: "San Francisco 49ers at Los Angeles Rams" }), 2026, 1);
  assert.equal(a.away, "SF");
  assert.equal(a.home, "LAR");
  // "Arizona Cardinals" DOES contain "CAR", so the old approach called it
  // Carolina. Getting a real code is the whole point.
  const b = parseScheduleEvent(
    event("ARI", "CAR", { name: "Carolina Panthers at Arizona Cardinals" }), 2026, 1);
  assert.equal(b.home, "ARI");
  assert.equal(b.away, "CAR");
  // "Kansas City Chiefs" contains "CHI".
  const c = parseScheduleEvent(
    event("KC", "CHI", { name: "Chicago Bears at Kansas City Chiefs" }), 2026, 1);
  assert.equal(c.home, "KC");
  assert.equal(c.away, "CHI");
});

test("parseScheduleEvent: missing pieces come back null, not undefined-ish junk", () => {
  const g = parseScheduleEvent({ id: "1", competitions: [{ competitors: [] }] }, 2026, 1);
  assert.equal(g.home, null);
  assert.equal(g.away, null);
  const empty = parseScheduleEvent(null, 2026, 1);
  assert.equal(empty.home, null);
  assert.equal(empty.id, "");
});

test("parseScheduleEvent: reports whether the game has been played", () => {
  assert.equal(parseScheduleEvent(event("A", "B"), 2026, 1).completed, false);
  const done = event("A", "B", { status: { type: { completed: true } } });
  assert.equal(parseScheduleEvent(done, 2026, 1).completed, true);
});

test("scoreAnytimeTD: a leaky opponent is worth real probability", () => {
  // Not a tautology check — this pins that the opponent term is actually
  // wired to something the board can see. Measured 2025 defences ranged
  // from 0.76 to 1.32 touchdowns allowed against league average.
  const p = { games: 12, tds: 6, carries: 180, targets: 40 };
  const soft = scoreAnytimeTD(p, { oppFactor: 1.32 }).prob;
  const hard = scoreAnytimeTD(p, { oppFactor: 0.76 }).prob;
  assert.ok(soft - hard > 0.05,
    `the real spread of NFL defences should be worth more than 5 points, got ${soft - hard}`);
});

/* ------------------------------------------------------------------ *
 * Neutral sites
 *
 * Oracle: the definition of home field. Kickoff classics, conference
 * championships and every bowl are played where neither side is at home,
 * and ESPN still labels one of them "home" for the box score. The NFL's
 * London games carry the same flag. A game marked neutral must give the
 * home-field points to nobody -- in the ratings solve and in the
 * projection both, or the two halves of the model disagree about the
 * same game.
 * ------------------------------------------------------------------ */

test("buildTeamRatings: a neutral-site game credits home field to nobody", () => {
  // Two evenly matched teams, one game, played at a neutral site, where
  // the nominal home side wins by exactly the home-field constant. Read
  // as a home game, that is a dead-even pair. Read as neutral, the
  // "home" side is the better team by that much.
  const hf = DEFAULTS.homeField;
  const asHome = buildTeamRatings(
    [{ home: { team: "A", score: 20 + hf }, away: { team: "B", score: 20 } }],
    { teamK: 0 },
  );
  const asNeutral = buildTeamRatings(
    [{ home: { team: "A", score: 20 + hf }, away: { team: "B", score: 20 }, neutral: true }],
    { teamK: 0 },
  );
  close(asHome.off.A - asHome.off.B, 0, 1e-6);
  assert.ok(asNeutral.off.A - asNeutral.off.B > hf * 0.9, "neutral game must rate A above B");
});

test("projectGame: a neutral site removes home field from the margin", () => {
  const r = buildTeamRatings(syntheticSeason({ AAA: 4, BBB: 0, CCC: -4, DDD: 0 }));
  const home = projectGame(r, "AAA", "BBB");
  const neutral = projectGame(r, "AAA", "BBB", { neutral: true });
  close(home.margin - neutral.margin, r.homeField, 1e-9);
  close(home.total - neutral.total, r.homeField, 1e-9);
});

/* ------------------------------------------------------------------ *
 * The receiving-opportunity accessor and the yards gate
 *
 * Oracle: the model's own inputs. College box scores record receptions
 * and no targets, so which stat counts as receiving opportunity is a
 * league constant, and every reader of it -- the touchdown model, the
 * board's row filter, the tracker's snapshot -- goes through one
 * accessor rather than each spelling `p.targets` for itself.
 * ------------------------------------------------------------------ */

test("receivingOpportunity: reads the stat the league records", () => {
  const rec = { targets: 40, recs: 28 };
  assert.equal(nfl.receivingOpportunity(rec), 40);
  assert.equal(nfl.receivingOpportunity(rec, { receivingStat: "recs" }), 28);
  assert.equal(nfl.receivingOpportunity(null), 0);
});

test("scoreAnytimeTD: counts opportunity by the league's receiving stat", () => {
  const p = { games: 8, tds: 2, carries: 0, targets: 0, recs: 40 };
  // With targets as the stat this player has no receiving workload at all.
  const byTargets = scoreAnytimeTD(p);
  // With receptions he is a busy receiver.
  const byRecs = scoreAnytimeTD(p, { opts: { receivingStat: "recs" } });
  assert.equal(byTargets.perGameReceiving, 0);
  assert.equal(byRecs.perGameReceiving, 5);
  assert.ok(byRecs.prob > byTargets.prob);
});

test("yardsEligible: the one gate the board and the tracker both use", () => {
  // Enough games, enough opportunity, enough projected yards: on the board.
  const ok = nfl.yardsEligible({ games: 4, targets: 20, recYds: 200 });
  assert.ok(ok && ok.exp >= 20);
  close(ok.exp, expectedVolume(200, 4, 25));
  // Too few games.
  assert.equal(nfl.yardsEligible({ games: 2, targets: 20, recYds: 200 }), null);
  // Too little opportunity.
  assert.equal(nfl.yardsEligible({ games: 4, targets: 9, recYds: 200 }), null);
  // A projection below the floor.
  assert.equal(nfl.yardsEligible({ games: 4, targets: 20, recYds: 10 }), null);
  // The gate honours the league's receiving stat.
  assert.ok(nfl.yardsEligible({ games: 4, targets: 0, recs: 20, recYds: 200 }, { receivingStat: "recs" }));
});

test("expectedVolume: the prior defaults to the league constant", () => {
  close(expectedVolume(200, 4), expectedVolume(200, 4, DEFAULTS.yardPrior));
  close(expectedVolume(200, 4, undefined, { yardPrior: 40 }), expectedVolume(200, 4, 40));
});

test("bind: the same model, every function pre-bound to another league's constants", () => {
  const C = nfl.bind({ homeField: 3.5, receivingStat: "recs", yardPrior: 30 });
  assert.equal(C.DEFAULTS.homeField, 3.5);
  assert.equal(C.DEFAULTS.tdK, DEFAULTS.tdK, "unspecified constants carry over");
  const r = C.buildTeamRatings([{ home: { team: "A", score: 30 }, away: { team: "B", score: 20 } }]);
  assert.equal(r.homeField, 3.5);
  assert.equal(C.receivingOpportunity({ targets: 1, recs: 7 }), 7);
  close(C.expectedVolume(100, 2), expectedVolume(100, 2, 30));
  const s = C.scoreAnytimeTD({ games: 5, tds: 1, carries: 0, targets: 0, recs: 25 });
  assert.equal(s.perGameReceiving, 5);
  // An explicit override at the call still wins.
  assert.equal(C.projectGame(r, "A", "B", { neutral: true }).margin, C.projectGame(r, "A", "B").margin - 3.5);
});

/* ------------------------------------------------------------------ *
 * Picking a side
 *
 * Oracle: the grading rules. Home covers iff (home - away) + spread > 0;
 * the game goes over iff points > total; home wins iff margin > 0. A pick
 * is whichever side the projection gives more than half a chance, and
 * the probability reported is that side's. One function, used by the
 * page, the tracker and the backtest, so the three cannot disagree
 * about which side the model likes.
 * ------------------------------------------------------------------ */

test("winProbability: the projected margin in units of the model's error", () => {
  close(nfl.winProbability(0), 0.5);
  close(nfl.winProbability(DEFAULTS.marginSD), normalCDF(1));
  assert.ok(nfl.winProbability(-7) < 0.5);
  assert.equal(nfl.winProbability(NaN), null);
});

test("pickGame: likes the home side when it projects a bigger margin than the spread", () => {
  // Projected home by 7; market has home -3.5. Edge +3.5 to the home side.
  const p = nfl.pickGame({ margin: 7, total: 45 }, { spread: -3.5, total: 44.5 });
  assert.equal(p.spread.side, "home");
  close(p.spread.edge, 3.5);
  close(p.spread.prob, spreadProbability(7, -3.5).homeCoverProb);
  assert.ok(p.spread.prob >= 0.5);
  assert.equal(p.total.side, "over");
  close(p.total.edge, 0.5);
  close(p.total.prob, totalProbability(45, 44.5).overProb);
});

test("pickGame: the away side, and its probability is the away side's", () => {
  // Projected home by 1; market has home -6.5. The away side is getting
  // 5.5 points more than the projection says it needs.
  const p = nfl.pickGame({ margin: 1, total: 40 }, { spread: -6.5, total: 47 });
  assert.equal(p.spread.side, "away");
  close(p.spread.edge, 5.5);
  close(p.spread.prob, 1 - spreadProbability(1, -6.5).homeCoverProb);
  assert.equal(p.total.side, "under");
  close(p.total.edge, 7);
  close(p.total.prob, 1 - totalProbability(40, 47).overProb);
});

test("pickGame: the moneyline pick is the projected winner with its win probability", () => {
  const p = nfl.pickGame({ margin: -4, total: 40 }, { spread: 2.5, total: 40, homeML: 130, awayML: -150 });
  assert.equal(p.ml.side, "away");
  close(p.ml.prob, 1 - nfl.winProbability(-4));
  assert.equal(p.ml.price, -150);
});

test("pickGame: carries the price of the side it picked, defaulting spread and total juice to -110", () => {
  const priced = nfl.pickGame({ margin: 7, total: 45 }, {
    spread: -3.5, total: 44.5, homeSpreadOdds: -105, awaySpreadOdds: -115, overOdds: -102, underOdds: -118,
  });
  assert.equal(priced.spread.price, -105);
  assert.equal(priced.total.price, -102);
  const bare = nfl.pickGame({ margin: 7, total: 45 }, { spread: -3.5, total: 44.5 });
  assert.equal(bare.spread.price, -110);
  assert.equal(bare.total.price, -110);
});

test("pickGame: no line, no pick; a market that is missing is null, not a guess", () => {
  assert.equal(nfl.pickGame({ margin: 7, total: 45 }, null), null);
  const p = nfl.pickGame({ margin: 7, total: 45 }, { spread: -3.5 });
  assert.ok(p.spread);
  assert.equal(p.total, null);
  assert.equal(p.ml, null);
  assert.equal(nfl.pickGame(null, { spread: -3.5 }), null);
});

test("pickGame: exactly on the number is not a pick", () => {
  const p = nfl.pickGame({ margin: 3.5, total: 44.5 }, { spread: -3.5, total: 44.5 });
  assert.equal(p.spread, null);
  assert.equal(p.total, null);
});

/* ------------------------------------------------------------------ *
 * Calibration against the line
 *
 * Oracle: the replay. Regressing the outcome on the model's cover
 * probability gave a slope of -0.25 (NFL) and 0.07 (college, both seasons
 * alike): the projection carries no information about the spread that
 * the closing line does not already carry. Totals kept a fraction. So
 * the probability the page prints is pulled toward a coin flip by a
 * measured amount, spreadShrink and totalShrink, and 0 means "the model
 * has no opinion the market lacks". The edge in points is untouched: it
 * is still the side the model leans to, and the record still grades it.
 * ------------------------------------------------------------------ */

test("spreadProbability: shrunk toward a coin flip by the measured slope", () => {
  const raw = spreadProbability(7, -3.5, { spreadShrink: 1 }).homeCoverProb;
  const half = spreadProbability(7, -3.5, { spreadShrink: 0.5 }).homeCoverProb;
  const none = spreadProbability(7, -3.5, { spreadShrink: 0 }).homeCoverProb;
  close(half - 0.5, (raw - 0.5) / 2);
  close(none, 0.5);
  close(spreadProbability(7, -3.5, { spreadShrink: 0 }).edge, 3.5, 1e-9); // the lean survives
});

test("totalProbability: the same, with its own measured slope", () => {
  const raw = totalProbability(50, 44.5, { totalShrink: 1 }).overProb;
  const some = totalProbability(50, 44.5, { totalShrink: 0.25 }).overProb;
  close(some - 0.5, (raw - 0.5) / 4);
  close(totalProbability(40, 44.5, { totalShrink: 0 }).overProb, 0.5);
});

test("pickGame: still picks the side when the probability is a coin flip", () => {
  const p = nfl.pickGame({ margin: 7, total: 45 }, { spread: -3.5, total: 44.5 }, { spreadShrink: 0, totalShrink: 0 });
  assert.equal(p.spread.side, "home");
  close(p.spread.prob, 0.5);
  close(p.spread.edge, 3.5);
  assert.equal(p.total.side, "over");
  close(p.total.prob, 0.5);
});

test("the NFL ships its spread probability fully shrunk, and college too", async () => {
  const cfb = (await import("./cfb.js")).default;
  assert.equal(DEFAULTS.spreadShrink, 0);
  assert.equal(cfb.DEFAULTS.spreadShrink, 0);
  assert.ok(DEFAULTS.totalShrink > 0 && DEFAULTS.totalShrink < 1);
  assert.ok(cfb.DEFAULTS.totalShrink > 0 && cfb.DEFAULTS.totalShrink < 1);
});

/* ------------------------------------------------------------------ *
 * Availability
 *
 * Oracle: what a book does. A player ruled Out or on injured reserve has
 * his props voided, so a row for him is a row nobody can bet and a record
 * entry that can only be scratched. Questionable is a coin flip (59% of
 * skill players listed Questionable at game time played, measured over
 * 120 games of 2025), so he stays, flagged.
 * ------------------------------------------------------------------ */

test("availability: out, questionable, or fine, from the feed's status words", () => {
  for (const s of ["Out", "Injured Reserve", "Doubtful", "Suspension", "Physically Unable to Perform"]) {
    assert.equal(nfl.availability(s), "out", s);
  }
  assert.equal(nfl.availability("Questionable"), "questionable");
  assert.equal(nfl.availability("Active"), "ok");
  assert.equal(nfl.availability(undefined), "ok");
  assert.equal(nfl.availability(""), "ok");
});

test("parseInjuries: keys non-active players by athlete id, read off the player-card link", async () => {
  const { parseInjuries } = await import("./fetch-football.mjs");
  const entry = (name, status, id, pos, team, extra) => ({
    status, date: "2026-09-03T17:49Z",
    athlete: {
      displayName: name, position: { abbreviation: pos }, team: { abbreviation: team },
      links: id ? [{ rel: ["playercard"], href: `https://www.espn.com/nfl/player/_/id/${id}/${name.toLowerCase().replace(" ", "-")}` }] : [],
    },
    details: extra || {},
  });
  const inj = parseInjuries({ injuries: [
    { displayName: "Arizona Cardinals", injuries: [
      entry("Jacoby Brissett", "Active", "1", "QB", "ARI"),
      entry("Jeremiyah Love", "Questionable", "4870808", "RB", "ARI", { type: "Ankle", returnDate: "2026-09-13" }),
      entry("Nobody Linked", "Out", null, "WR", "ARI"),
    ] },
    { displayName: "Seattle Seahawks", injuries: [entry("Sam Darnold", "Out", "3912547", "QB", "SEA")] },
  ] });
  assert.equal(inj["1"], undefined, "an active player is not an injury");
  assert.deepEqual(inj["4870808"], { name: "Jeremiyah Love", team: "ARI", pos: "RB", status: "Questionable", detail: "Ankle", date: "2026-09-03T17:49Z" });
  assert.equal(inj["3912547"].status, "Out");
  assert.equal(Object.keys(inj).length, 2, "an entry with no id cannot be matched to anyone and is dropped");
  assert.deepEqual(parseInjuries(null), {});
});

/* ------------------------------------------------------------------ *
 * The stat table: receiving yards, rushing yards, passing yards, receptions
 *
 * Oracle: the receiving-yards model, which these generalise. Each stat is
 * a season total, an opportunity count, a replacement-level prior and a
 * gate. `statEligible(stat, record)` is the one gate for all four, and
 * `yardsEligible` is `statEligible("recyds", ...)` so nothing that used
 * it changes.
 * ------------------------------------------------------------------ */

test("STATS: the four props, each with a total, an opportunity, a box-score field, a prior and a gate in DEFAULTS", () => {
  for (const id of ["recyds", "rushyds", "passyds", "recs"]) {
    const st = nfl.STATS[id];
    assert.ok(st, id);
    assert.ok(st.label && st.total && st.opportunity && st.box.length === 2, id);
    for (const k of ["priorKey", "poolFloorKey", "minOppKey"]) assert.ok(nfl.DEFAULTS[st[k]] > 0, `${id}.${k}`);
    assert.ok(nfl.DEFAULTS[st.floorKey] >= 0, id);
  }
});

test("gameLine / gameValue: a box-score line, read the way a season record is", () => {
  const p = { rush: { att: 12, yds: 80, td: 1 }, rec: { tgt: 6, rec: 4, yds: 41 }, pass: { att: 30, yds: 251 } };
  assert.deepEqual(nfl.gameLine(p), { targets: 6, recs: 4, carries: 12, passAtt: 30 });
  assert.equal(nfl.gameValue("recyds", p), 41);
  assert.equal(nfl.gameValue("rushyds", p), 80);
  assert.equal(nfl.gameValue("passyds", p), 251);
  assert.equal(nfl.gameValue("recs", p), 4);
  assert.deepEqual(nfl.gameLine({ rec: { tgt: 3 } }), { targets: 3, recs: 0, carries: 0, passAtt: 0 }, "an absent block is zero");
  assert.equal(nfl.gameValue("passyds", { rec: { yds: 9 } }), 0);
  assert.equal(nfl.gameValue("spread", p), 0, "not a counting stat");
});

test("statOppFactor: the opponent's allowance at the stat's strength, 1 when there is none", () => {
  // Oracle: the touchdown model's oppFactor, which this mirrors: 1 = league average, clamped 0.6..1.6.
  assert.equal(nfl.statOppFactor("recyds", 1.3), 1, "shipped strength 0: the replay found no information in the opponent for receiving yards");
  close(nfl.statOppFactor("rushyds", 1.3), 1 + nfl.DEFAULTS.rushOppShrink * 0.3);
  const C = nfl.bind({ passOppShrink: 1, rushOppShrink: 0.5 });
  close(C.statOppFactor("passyds", 1.3), 1.3);
  close(C.statOppFactor("rushyds", 1.3), 1.15); // half strength is half way to the allowance
  close(C.statOppFactor("rushyds", 0.8), 0.9);
  assert.equal(C.statOppFactor("passyds", 2.5), 1.6, "clamped like the touchdown factors");
  assert.equal(C.statOppFactor("passyds", null), 1, "no opponent placed yet");
  assert.equal(C.statOppFactor("passyds", 0), 1);
  assert.equal(C.statOppFactor("spread", 1.3), 1, "not a counting stat");
});

test("statEligible: the opponent moves the projection, never the gate", () => {
  const C = nfl.bind({ rushOppShrink: 1 });
  const rec = { games: 4, carries: 60, rushYds: 300 };
  const base = C.statEligible("rushyds", rec).exp;
  const y = C.statEligible("rushyds", rec, null, { oppFactor: 1.2 });
  close(y.base, base);
  close(y.oppFactor, 1.2);
  close(y.exp, base * 1.2);
  // A base just over the floor stays on the board against a stingy defence even though exp drops under it...
  const edge = { games: 4, carries: 60, rushYds: 4 * 21 - nfl.DEFAULTS.yardK * (nfl.DEFAULTS.rushPrior - 21) };
  close(C.statEligible("rushyds", edge).base, 21);
  assert.ok(C.statEligible("rushyds", edge, null, { oppFactor: 0.7 }), "gated on his own season");
  // ...and a base under the floor stays off against a soft one.
  const under = { games: 4, carries: 60, rushYds: 4 * 19 - nfl.DEFAULTS.yardK * (nfl.DEFAULTS.rushPrior - 19) };
  assert.equal(C.statEligible("rushyds", under, null, { oppFactor: 1.5 }), null);
});

test("opponentIn / allowOf: the one opponent lookup, null when a team code matches neither side", () => {
  const g = { home: { team: "KC" }, away: { team: "BUF" } };
  assert.equal(nfl.opponentIn(g, { team: "KC" }), "BUF");
  assert.equal(nfl.opponentIn(g, { team: "BUF" }), "KC");
  assert.equal(nfl.opponentIn(g, { team: "KCC" }), null, "never the home team by default");
  assert.equal(nfl.opponentIn(null, { team: "KC" }), null);
  const tf = { KC: { off: 1, def: 1, allow: { passyds: 0.93 } }, BUF: { off: 1, def: 1 } };
  assert.equal(nfl.allowOf(tf, "KC", "passyds"), 0.93);
  assert.equal(nfl.allowOf(tf, "KC", "rushyds"), null, "a stat the table lacks");
  assert.equal(nfl.allowOf(tf, "BUF", "passyds"), null, "a table written before allow existed");
  assert.equal(nfl.allowOf(tf, "LV", "passyds"), null);
  assert.equal(nfl.allowOf(null, "KC", "passyds"), null);
});

test("projectedStat: the projection statEligible returns, available without the gate", () => {
  const C = nfl.bind({ rushOppShrink: 1 });
  const rec = { games: 4, carries: 60, rushYds: 300 };
  assert.deepEqual(C.projectedStat("rushyds", rec, null, { oppFactor: 1.2 }), C.statEligible("rushyds", rec, null, { oppFactor: 1.2 }));
  // Under the gate, the projection still exists: that is what a pool divides by.
  const small = { games: 4, carries: 3, rushYds: 40 };
  assert.equal(C.statEligible("rushyds", small), null);
  close(C.projectedStat("rushyds", small).exp, C.expectedStat("rushyds", small));
  assert.equal(C.projectedStat("spread", rec), null);
});

test("yardsEligible forwards the opponent, so it is still exactly statEligible('recyds')", () => {
  const C = nfl.bind({ yardOppShrink: 1 });
  const rec = { games: 4, targets: 20, recYds: 200 };
  assert.deepEqual(C.yardsEligible(rec, null, { oppFactor: 1.4 }), C.statEligible("recyds", rec, null, { oppFactor: 1.4 }));
  assert.notEqual(C.yardsEligible(rec, null, { oppFactor: 1.4 }).exp, C.yardsEligible(rec).exp);
});

test("statEligible: a league can bind its own gate for any stat", () => {
  const C = nfl.bind({ passMinOpportunity: 20, passFloor: 100 });
  assert.ok(C.statEligible("passyds", { games: 4, passAtt: 90, passYds: 500 }));
  assert.equal(nfl.statEligible("passyds", { games: 4, passAtt: 90, passYds: 500 }), null, "under the NFL's 40 attempts and 150-yard floor");
});

test("statEligible: receiving yards is exactly yardsEligible", () => {
  const rec = { games: 4, targets: 20, recYds: 200 };
  assert.deepEqual(nfl.statEligible("recyds", rec), nfl.yardsEligible(rec));
  assert.equal(nfl.statEligible("recyds", { games: 2, targets: 20, recYds: 200 }), null);
});

test("statEligible: rushing yards gate on carries, passing on attempts, receptions on receiving opportunity", () => {
  assert.ok(nfl.statEligible("rushyds", { games: 4, carries: 40, rushYds: 200 }));
  assert.equal(nfl.statEligible("rushyds", { games: 4, carries: 5, rushYds: 40 }), null, "too few carries");
  assert.ok(nfl.statEligible("passyds", { games: 4, passAtt: 120, passYds: 900 }));
  assert.equal(nfl.statEligible("passyds", { games: 4, passAtt: 10, passYds: 90 }), null, "a trick-play thrower is not a passer");
  assert.ok(nfl.statEligible("recs", { games: 4, targets: 20, recs: 14 }));
  // College counts receptions as opportunity, so a receptions prop gates on receptions.
  assert.ok(nfl.statEligible("recs", { games: 4, recs: 14, targets: 0 }, { receivingStat: "recs" }));
  assert.equal(nfl.statEligible("recs", { games: 4, recs: 14, targets: 0 }), null);
});

test("statEligible: the expectation is the shrunk per-game total toward the stat's own prior", () => {
  const e = nfl.statEligible("rushyds", { games: 4, carries: 60, rushYds: 300 });
  close(e.exp, (300 + nfl.DEFAULTS.yardK * nfl.DEFAULTS.rushPrior) / (4 + nfl.DEFAULTS.yardK));
  // The floor is applied to the expectation.
  assert.equal(nfl.statEligible("passyds", { games: 4, passAtt: 120, passYds: 200 }), null);
});

test("statOpportunity: a game line in season shape, per stat", () => {
  const line = { carries: 12, targets: 6, recs: 4, passAtt: 30 };
  assert.equal(nfl.statOpportunity("rushyds", line), 12);
  assert.equal(nfl.statOpportunity("recyds", line), 6);
  assert.equal(nfl.statOpportunity("recs", line), 6);
  assert.equal(nfl.statOpportunity("passyds", line), 30);
  assert.equal(nfl.statOpportunity("recs", line, { receivingStat: "recs" }), 4);
});

test("bind: the stat gate follows the bound league's receiving stat", () => {
  const C = nfl.bind({ receivingStat: "recs", yardMinOpportunity: 7 });
  assert.ok(C.statEligible("recs", { games: 4, recs: 10, recYds: 100 }));
  assert.ok(C.statEligible("recyds", { games: 4, recs: 10, recYds: 100 }));
});

/* ------------------------------------------------------------------ *
 * Rosters: who a player plays for today
 *
 * Oracle: ESPN's team roster endpoint, the same source the schedule and
 * box scores come from. A player's team used to be the team of his last
 * box score, which is last season's team until he plays a game -- A.J.
 * Brown sat on the Eagles' board in week 1 of 2026 after joining the
 * Patriots. The roster says where he is now; the record still says what
 * he did.
 * ------------------------------------------------------------------ */

const ROSTER_NE = { team: { id: "17", abbreviation: "NE" }, athletes: [
  { position: "offense", items: [
    { id: "4047646", fullName: "A.J. Brown", position: { abbreviation: "WR" }, status: { name: "Active" }, injuries: [] },
    { id: "1", fullName: "Someone", position: { abbreviation: "QB" }, status: { name: "Active" }, injuries: [{ status: "Out" }] },
  ] },
  { position: "injuredReserveOrOut", items: [
    { id: "2", fullName: "Hurt Guy", position: { abbreviation: "RB" }, status: { name: "Injured Reserve" } },
  ] },
  { position: "practiceSquad", items: [ { id: "3", fullName: "PS Guy", position: { abbreviation: "WR" } } ] },
] };

test("parseRoster: every athlete on the team with his position and roster group", () => {
  const r = nfl.parseRoster(ROSTER_NE);
  assert.equal(r.length, 4);
  assert.deepEqual(r[0], { id: "4047646", name: "A.J. Brown", team: "NE", pos: "WR", group: "offense", status: "Active" });
  assert.equal(r.find((a) => a.id === "2").group, "injuredReserveOrOut");
  assert.equal(r.find((a) => a.id === "3").group, "practiceSquad");
  assert.deepEqual(nfl.parseRoster(null), []);
  assert.deepEqual(nfl.parseRoster({ team: { abbreviation: "NE" } }), []);
  assert.deepEqual(nfl.parseRoster({ athletes: [{ items: [{ id: "9" }] }] }), [], "no team code, no roster");
});

test("applyRosters: a player's team is where the roster says; a player on no roster leaves the board", () => {
  const roster = new Map(nfl.parseRoster(ROSTER_NE).map((a) => [a.id, a]));
  roster.set("10", { id: "10", name: "Stayed", team: "PHI", pos: "WR", group: "offense", status: "Active" });
  const players = [
    { id: "4047646", name: "A.J. Brown", team: "PHI", games: 15 },
    { id: "10", name: "Stayed", team: "PHI", games: 17 },
    { id: "99", name: "Retired", team: "PHI", games: 12 },
  ];
  const out = nfl.applyRosters(players, roster);
  assert.deepEqual(out.players.map((p) => [p.id, p.team, p.movedFrom || null]),
    [["4047646", "NE", "PHI"], ["10", "PHI", null]]);
  assert.deepEqual(out.moved.map((m) => m.name), ["A.J. Brown"]);
  assert.deepEqual(out.dropped.map((m) => m.name), ["Retired"]);
  // The originals are not mutated: the season record keeps saying what he did, where.
  assert.equal(players[0].team, "PHI");
  // No roster, nothing changes.
  assert.deepEqual(nfl.applyRosters(players, null).players.map((p) => p.team), ["PHI", "PHI", "PHI"]);
});
