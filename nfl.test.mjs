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

test("parseScheduleEvent: carries ESPN's team ids and the venue when the feed has them, for the home page's logos", () => {
  const e = event("SEA", "NE");
  e.competitions[0].competitors[0].team.id = 26; e.competitions[0].competitors[1].team.id = 17;
  e.competitions[0].venue = { fullName: "Lumen Field" };
  const g = parseScheduleEvent(e, 2026, 1);
  assert.equal(g.homeId, "26"); assert.equal(g.awayId, "17"); assert.equal(g.venue, "Lumen Field");
  const bare = parseScheduleEvent(event("SEA", "NE"), 2026, 1);
  assert.ok(!("homeId" in bare) && !("venue" in bare), "absent in the feed: absent in the row, not null");
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
    assert.ok(st.label && st.total.length === 1 && st.opportunity && st.box.length === 1 && st.box[0].length === 2, id);
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
  assert.equal(nfl.statOppFactor("recyds", 1.3), 1, "shipped strength 0: the opponent carries nothing for receiving yards (A3 re-measured it on fixed lines: noise)");
  close(nfl.bind({ yardOppShrink: 0.5 }).statOppFactor("recyds", 1.3), 1.15, 1e-9, "at half strength, half way to the allowance");
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
    { id: "1", fullName: "Someone", position: { abbreviation: "QB" }, status: { name: "Active" }, injuries: [{ status: "Out", date: "2026-09-13T15:09Z" }] },
    { id: "4", fullName: "Back Already", position: { abbreviation: "TE" }, status: { name: "Active" }, injuries: [{ status: "Active", date: "2026-09-20T15:09Z" }] },
    { id: "5", fullName: "Downgraded", position: { abbreviation: "WR" }, status: { name: "Active" }, injuries: [{ status: "Out", date: "2026-09-06T15:09Z" }, { status: "Questionable", date: "2026-09-20T15:09Z" }] },
  ] },
  { position: "injuredReserveOrOut", items: [
    { id: "2", fullName: "Hurt Guy", position: { abbreviation: "RB" }, status: { name: "Injured Reserve" }, injuries: [{ status: "Questionable", date: "2026-09-11T15:09Z" }] },
  ] },
  { position: "practiceSquad", items: [ { id: "3", fullName: "PS Guy", position: { abbreviation: "WR" } } ] },
] };

test("parseRoster: every athlete on the team with his position and roster group", () => {
  const r = nfl.parseRoster(ROSTER_NE);
  assert.equal(r.length, 6);
  assert.deepEqual(r[0], { id: "4047646", name: "A.J. Brown", team: "NE", pos: "WR", group: "offense", status: "Active", listed: "", listedAt: "" });
  // What the roster lists him as. The league report missed Josh Jacobs'
  // suspension (2026-09-24, status "News", injuries [{status: "Out"}]);
  // the roster is the second source, the group when there is no entry.
  assert.equal(r.find((a) => a.id === "1").listed, "Out", "the athlete's own injury entry");
  assert.equal(r.find((a) => a.id === "1").listedAt, "2026-09-13T15:09Z", "and when it was entered");
  assert.equal(r.find((a) => a.id === "2").listed, "Injured Reserve", "the roster group outranks a dated entry from before the move");
  assert.equal(r.find((a) => a.id === "2").listedAt, "", "and is not dated, so it cannot read as stale");
  assert.equal(r.find((a) => a.id === "5").listed, "Questionable", "the latest entry, not the first");
  assert.equal(r.find((a) => a.id === "5").listedAt, "2026-09-20T15:09Z");
  assert.equal(r.find((a) => a.id === "3").listed, "");
  assert.equal(r.find((a) => a.id === "4").listed, "", "an entry that says Active is not a listing (parseInjuries skips the same)");
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

/* ------------------------------------------------------------------ *
 * Search: find a player on the board
 *
 * Oracle: what a bettor types. Case, punctuation and accents do not
 * count; every word typed has to be found somewhere in the name, the
 * team or the opponent, in any order.
 * ------------------------------------------------------------------ */

test("playerMatches: words in any order against name, team and opponent, ignoring case, dots and accents", () => {
  const aj = { name: "A.J. Brown", team: "NE", opp: "SEA" };
  for (const q of ["", "  ", "aj", "a.j.", "brown", "AJ BROWN", "brown aj", "ne", "sea", "brown sea", "ne brown"]) {
    assert.ok(nfl.playerMatches(q, aj), JSON.stringify(q));
  }
  for (const q of ["browne", "phi", "brown phi", "a.j. smith"]) {
    assert.ok(!nfl.playerMatches(q, aj), JSON.stringify(q));
  }
  assert.ok(nfl.playerMatches("aberg", { name: "Ludvig Åberg", team: "" }), "accents fold");
  // A word matches the START of a name, team or opponent word, never the middle:
  // "ne" is the Patriots, not everyone called Achane or Etienne.
  assert.ok(!nfl.playerMatches("ne", { name: "De'Von Achane", team: "MIA", opp: "LV" }));
  assert.ok(!nfl.playerMatches("ne", { name: "Travis Etienne Jr.", team: "JAX", opp: "CLE" }));
  assert.ok(nfl.playerMatches("ach", { name: "De'Von Achane", team: "MIA", opp: "LV" }), "a prefix of a name word");
  assert.ok(nfl.playerMatches("devon", { name: "De'Von Achane", team: "MIA", opp: "LV" }), "the apostrophe does not split the word");
  assert.ok(nfl.playerMatches("st brown", { name: "Amon-Ra St. Brown", team: "DET" }));
  assert.ok(!nfl.playerMatches("x", null));
});

/* ------------------------------------------------------------------ *
 * Alternate lines: the ladder, and rushing + receiving yards
 *
 * Oracle: `empiricalOver`, which already answers "P(actual > t)" for any
 * t. A rung "N+" is the book's phrase for actual >= N, and yards come in
 * whole numbers, so it is the over of N - 0.5 -- never N, which would
 * turn an exact N into a loss that the book pays. Rushing + receiving is
 * a fifth row of the same table: the two totals summed, touches for
 * opportunity, its own prior and floor.
 * ------------------------------------------------------------------ */

test("STATS: every row's total and box-score fields are lists, and rushrec sums two of them", () => {
  for (const id of ["recyds", "rushyds", "passyds", "recs", "rushrec"]) {
    const st = nfl.STATS[id];
    assert.ok(st, id);
    assert.ok(Array.isArray(st.total) && st.total.length >= 1, `${id}.total is a list of record fields`);
    assert.ok(Array.isArray(st.box) && st.box.every((b) => b.length === 2), `${id}.box is a list of [block, field]`);
    for (const k of ["priorKey", "poolFloorKey", "minOppKey"]) assert.ok(nfl.DEFAULTS[st[k]] > 0, `${id}.${k}`);
    assert.ok(nfl.DEFAULTS[st.floorKey] >= 0, id);
  }
  assert.deepEqual(nfl.STATS.rushrec.total, ["rushYds", "recYds"]);
  assert.equal(nfl.STATS.rushrec.opportunity, "touches");
});

test("statTotal: a season record's total for a stat, summed when the stat is a sum", () => {
  const rec = { games: 5, carries: 80, targets: 20, rushYds: 400, recYds: 120, recs: 15, passAtt: 0, passYds: 0 };
  assert.equal(nfl.statTotal("rushyds", rec), 400);
  assert.equal(nfl.statTotal("recyds", rec), 120);
  assert.equal(nfl.statTotal("rushrec", rec), 520);
  assert.equal(nfl.statTotal("recs", rec), 15);
  assert.equal(nfl.statTotal("rushrec", { rushYds: 30 }), 30, "an absent field is zero");
  assert.equal(nfl.statTotal("spread", rec), 0, "not a counting stat");
  // The tracker's box-score line has the same field names, so it settles through the same call.
  assert.equal(nfl.statTotal("rushrec", { td: 1, recYds: 20, rushYds: 30, passYds: 0, recs: 3 }), 50);
});

test("rushrec: touches for opportunity, the two yardages summed off a box score", () => {
  const p = { rush: { att: 12, yds: 80, td: 1 }, rec: { tgt: 6, rec: 4, yds: 41 } };
  assert.equal(nfl.gameValue("rushrec", p), 121);
  assert.equal(nfl.statOpportunity("rushrec", nfl.gameLine(p)), 18, "carries + targets in the NFL");
  const college = nfl.bind({ receivingStat: "recs" });
  assert.equal(college.statOpportunity("rushrec", college.gameLine(p)), 16, "carries + receptions where targets are not recorded");
  const rec = { games: 4, carries: 60, targets: 12, rushYds: 300, recYds: 80 };
  assert.equal(nfl.statOpportunity("rushrec", rec), 72);
  const y = nfl.statEligible("rushrec", rec);
  assert.ok(y && y.exp > 0, "a back with touches is on the rush + rec board");
  close(y.base, nfl.expectedVolume(380, 4, nfl.DEFAULTS.rushrecPrior));
  assert.equal(nfl.statEligible("rushrec", { games: 4, carries: 4, targets: 3, rushYds: 20, recYds: 10 }), null, "too few touches");
});

test("ladder: every rung is the over of N - 0.5, read off the pool, and never gets easier as N rises", () => {
  const pool = [0.2, 0.5, 0.8, 1, 1.1, 1.3, 1.6, 2, 2.5, 3];
  const L = nfl.ladder("recyds", 40, pool, { ladderEdge: 0 });
  assert.ok(L.length > 0);
  assert.deepEqual(L.map((r) => r.at), nfl.LADDERS.recyds.filter((n) => L.some((r) => r.at === n)), "rungs come from the stat's ladder, in order");
  for (const r of L) {
    close(r.line, r.at - 0.5);
    close(r.prob, empiricalOver(40, r.at - 0.5, pool));
  }
  for (let i = 1; i < L.length; i++) assert.ok(L[i].prob <= L[i - 1].prob, "monotone");
  // Exactly N counts as N+: a 40-yard projection with a ratio of 1 lands on 40, and 40+ includes it.
  const exact = nfl.ladder("recyds", 40, [1], { ladderEdge: 0 });
  assert.equal(exact.find((r) => r.at === 40).prob, 1);
  assert.equal(exact.find((r) => r.at === 50).prob, 0);
});

test("ladder: rungs no book would post are left off, unless asked for", () => {
  // 1,000 ratios: one in a thousand clears 4x, so 160+ on a 40-yard projection is 0.1%.
  const pool = []; for (let i = 0; i < 1000; i++) pool.push(i === 0 ? 5 : 0.5 + i / 1000);
  const shown = nfl.ladder("recyds", 40, pool);
  assert.ok(shown.every((r) => r.prob >= DEFAULTS.ladderEdge && r.prob <= 1 - DEFAULTS.ladderEdge));
  assert.ok(!shown.some((r) => r.at === 150), "150+ at 0.1% is not offered");
  const all = nfl.ladder("recyds", 40, pool, { ladderEdge: 0 });
  assert.ok(all.some((r) => r.at === 150), "the replay grades every rung");
  assert.equal(all.length, nfl.LADDERS.recyds.length);
  const C = nfl.bind({ ladderEdge: 0 });
  assert.equal(C.ladder("recyds", 40, pool).length, all.length, "a bound league's edge is its own");
});

test("ladder: refuses rather than inventing, and every stat has one", () => {
  assert.deepEqual(nfl.ladder("recyds", 0, [1, 2]), []);
  assert.deepEqual(nfl.ladder("recyds", 40, []), []);
  assert.deepEqual(nfl.ladder("spread", 40, [1, 2]), []);
  for (const id of Object.keys(nfl.STATS)) {
    const rungs = nfl.LADDERS[id];
    assert.ok(Array.isArray(rungs) && rungs.length >= 5, `${id} has a ladder`);
    for (let i = 1; i < rungs.length; i++) assert.ok(rungs[i] > rungs[i - 1], `${id} ladder ascends`);
  }
  assert.ok(nfl.LADDERS.recyds.includes(10) && nfl.LADDERS.recyds.includes(25), "the rungs a book offers");
  assert.ok(nfl.LADDERS.passyds[0] >= 100, "passing rungs are in passing yards");
  assert.ok(nfl.LADDERS.recs[0] <= 2 && Number.isInteger(nfl.LADDERS.recs[0]), "catches are whole");
});

test("ladder: a bound league keeps the same rungs and its own constants", () => {
  const C = nfl.bind({ rushrecPrior: 40 });
  assert.deepEqual(C.LADDERS, nfl.LADDERS);
  const rec = { games: 4, carries: 60, targets: 12, rushYds: 300, recYds: 80 };
  close(C.expectedStat("rushrec", rec), nfl.expectedVolume(380, 4, 40));
  assert.deepEqual(C.ladder("rushrec", 60, [0.5, 1, 1.5]).map((r) => r.at), nfl.ladder("rushrec", 60, [0.5, 1, 1.5]).map((r) => r.at));
});

/* ------------------------------------------------------------------ *
 * Pools by level: the games nearest a player's own projection
 *
 * Oracle: the ladder replay (backtest-nfl.mjs --ladder, 2026-09-21). One
 * pool for every level priced the smallest third of projections 5-10
 * points too confident at the middle rungs and the largest third 7-12
 * points too timid: a 20-yard projection's ratios are wider than a
 * 90-yard one's. So a pool carries each game's expectation beside its
 * ratio, and the over is read off the `poolWindow` games whose
 * expectation was nearest this player's.
 * ------------------------------------------------------------------ */

test("poolNear: the K games nearest an expectation, from a pool sorted by expectation", () => {
  const pool = { exp: [10, 20, 30, 40, 50, 60, 70], ratio: [1, 2, 3, 4, 5, 6, 7] };
  assert.deepEqual(nfl.poolNear(pool, 40, 3).sort(), [3, 4, 5]);
  assert.deepEqual(nfl.poolNear(pool, 41, 2).sort(), [4, 5], "ties break toward the nearer side");
  assert.deepEqual(nfl.poolNear(pool, 5, 2).sort(), [1, 2], "one-sided at the bottom");
  assert.deepEqual(nfl.poolNear(pool, 500, 2).sort(), [6, 7], "one-sided at the top");
  assert.deepEqual(nfl.poolNear(pool, 40, 100).sort(), [1, 2, 3, 4, 5, 6, 7], "asking for more than there is gives everything");
  assert.deepEqual(nfl.poolNear(pool, 40, 0), [1, 2, 3, 4, 5, 6, 7], "no window is the whole pool");
  assert.deepEqual(nfl.poolNear([1, 2, 3], 40, 2), [1, 2, 3], "a flat pool has no levels to choose by");
  assert.deepEqual(nfl.poolNear(null, 40, 2), []);
});

test("empiricalOver / ladder: a levelled pool is read through the window, a flat one as before", () => {
  // Small projections miss a lot; big ones do not. One pool of both would price a 60 like a 15.
  const exp = [], ratio = [];
  for (let i = 0; i < 100; i++) { exp.push(15); ratio.push(i < 50 ? 0 : 2); }     // coin flip to double, else nothing
  for (let i = 0; i < 100; i++) { exp.push(60); ratio.push(0.9 + (i % 10) / 50); } // 0.9 .. 1.08, never a zero
  const pool = nfl.sortedPool(exp, ratio, "recyds");
  assert.deepEqual(pool.exp.slice(0, 3), [15, 15, 15]);
  assert.equal(pool.stat, "recyds");
  const C = nfl.bind({ yardPoolShare: 0.5 });
  close(C.empiricalOver(60, 40, pool), 1, 1e-12, "a 60-yard player clears 40 in every one of his own games");
  close(C.empiricalOver(15, 10, pool), 0.5, 1e-12, "a 15-yard player is a coin flip to reach 10");
  close(nfl.bind({ yardPoolShare: 0 }).empiricalOver(60, 40, pool), 0.75, 1e-12, "no share: the mixed answer");
  close(nfl.empiricalOver(60, 40, [0, 0, 2, 2]), 0.5, 1e-12, "a flat pool is read as it always was");
  const L = C.ladder("recyds", 60, pool, { ladderEdge: 0 });
  close(L.find((r) => r.at === 40).prob, 1);
  // The share is the pool's stat's: a receptions pool at share 0 is read whole even by a league whose yards are halved.
  const recs = nfl.sortedPool(exp, ratio, "recs");
  close(nfl.bind({ recsPoolShare: 0, yardPoolShare: 0.5 }).empiricalOver(60, 40, recs), 0.75, 1e-12);
  // A levelled pool that names no stat reads the fallback share.
  const anon = nfl.sortedPool(exp, ratio);
  close(nfl.bind({ poolShare: 0.5 }).empiricalOver(60, 40, anon), 1, 1e-12);
  close(nfl.empiricalOver(60, 40, anon), 0.75, 1e-12);
  assert.equal(C.poolReads(pool, 60).length, 100, "what the page says the number was read off");
  assert.equal(nfl.poolReads([1, 2, 3], 60).length, 3);
  for (const id of Object.keys(nfl.STATS)) assert.ok(nfl.DEFAULTS[nfl.STATS[id].poolShareKey] >= 0, `${id} names its share`);
  assert.equal(nfl.poolSize(pool), 200);
  assert.equal(nfl.poolSize([1, 2, 3]), 3);
  assert.equal(nfl.poolSize(null), 0);
  assert.equal(nfl.poolSize({ exp: [], ratio: [] }), 0);
});

/* ------------------------------------------------------------------ *
 * One quarterback throws for a team
 *
 * Oracle: the box score. Every quarterback with 40 attempts on file --
 * last season's starter, the backup who filled in for six games -- got
 * a passing line, and the one-game slip paired the Falcons' three
 * passers with each other (2026-09-24). A book posts passing yards for
 * the starter alone. The starter is whoever threw most in the team's
 * last game, unless he is ruled out today, then the next by attempts
 * per game.
 * ------------------------------------------------------------------ */

test("startingPasser: most attempts over the team's recent games, then on file, skipping anyone out", () => {
  const { startingPasser } = nfl;
  const love = { id: "love", passAtt: 510, recentAtt: 96, out: false };
  const taylor = { id: "taylor", passAtt: 134, recentAtt: 0, out: false };
  assert.equal(startingPasser([taylor, love]), "love");
  assert.equal(startingPasser([{ ...love, out: true }, taylor]), "taylor", "the starter is out: the backup starts");
  // Week 1: nobody has thrown this season, so the record decides -- the
  // week-18 fill-in with 40 attempts in a finale does not beat the starter.
  assert.equal(startingPasser([{ ...love, recentAtt: 0 }, { ...taylor, passAtt: 300, recentAtt: 0 }]), "love");
  // Starter out: recent attempts first (the mop-up man IS the active backup), then the record.
  const qb2 = { id: "qb2", passAtt: 300, recentAtt: 0, out: false }, qb3 = { id: "qb3", passAtt: 20, recentAtt: 3, out: false };
  assert.equal(startingPasser([{ ...love, out: true }, qb2, qb3]), "qb3");
  assert.equal(startingPasser([{ ...love, out: true }, qb2, { ...qb3, recentAtt: 0 }]), "qb2");
  assert.equal(startingPasser([{ ...love, out: true }, { ...taylor, out: true }]), null, "everyone out: nobody");
  assert.equal(startingPasser([]), null);
  assert.equal(startingPasser(null), null);
});

test("backupPassers: quarterbacks only, judged on this season's last three games, the record before the season", async () => {
  const { backupPassers } = await import("./fetch-football.mjs");
  const game = (id, season, date, home, away, rows) => ({ id, season, date, home: { team: home }, away: { team: away },
    players: rows.map(([pid, team, att]) => ({ id: pid, name: pid, team, pass: { att, yds: att * 7 } })) });
  const games = [
    game("a", 2025, "2025-12-28T18:00Z", "KC", "DEN", [["mahomes", "KC", 30], ["nix", "DEN", 28]]),
    game("b", 2025, "2026-01-04T18:00Z", "KC", "LV", [["oladokun", "KC", 17], ["mahomes", "KC", 0], ["punter", "KC", 1], ["stidham", "LV", 25]]),
    game("c", 2026, "2026-09-07T17:00Z", "DEN", "KC", [["mahomes", "KC", 8], ["oladokun", "KC", 25], ["nix", "DEN", 33], ["wr", "DEN", 1]]),
    game("d", 2026, "2026-09-14T17:00Z", "KC", "NYG", [["mahomes", "KC", 34], ["dart", "NYG", 30]]),
  ];
  const players = [
    { id: "mahomes", team: "KC", games: 20, passAtt: 572 }, { id: "oladokun", team: "KC", games: 4, passAtt: 42 },
    { id: "punter", team: "KC", games: 20, passAtt: 1 }, { id: "nix", team: "DEN", games: 18, passAtt: 540 },
    { id: "wr", team: "DEN", games: 18, passAtt: 1 }, { id: "stidham", team: "LV", games: 3, passAtt: 90 },
    { id: "dart", team: "NYG", games: 2, passAtt: 30 }, { id: "wilson", team: "NYG", games: 17, passAtt: 480 },
  ];
  const roster = new Map(players.map((p) => [p.id, { id: p.id, team: p.team, pos: p.id === "punter" ? "P" : p.id === "wr" ? "WR" : "QB" }]));
  const M = nfl;
  // In season: the last three games this season. Mahomes left game c early
  // and Oladokun threw 25, but weeks together say Mahomes.
  let b = backupPassers(M, players, games, roster, {}, 2026);
  assert.deepEqual([...b].sort(), ["oladokun", "wilson"], "the backups; Dart threw NYG's games this season");
  assert.ok(!b.has("punter") && !b.has("wr"), "a punter or receiver with a trick-play attempt is not a quarterback");
  // Week 1 (no games this season on file): the record, not the finale where the backup threw.
  b = backupPassers(M, players, games, roster, {}, 2027);
  assert.ok(b.has("oladokun") && !b.has("mahomes"), "the week-18 fill-in does not become the starter");
  assert.ok(b.has("dart") && !b.has("wilson"), "before he has thrown a game, the veteran's record wins");
  // The starter ruled out: the next man up gets the line.
  b = backupPassers(M, players, games, roster, { mahomes: { status: "Out" } }, 2026);
  assert.ok(b.has("mahomes") && !b.has("oladokun"));
  // No roster: anyone with the attempts the board gates on counts as a quarterback.
  b = backupPassers(M, players, games, null, {}, 2026);
  assert.ok(b.has("oladokun") && !b.has("mahomes") && !b.has("punter"), "the punter is below the gate, not a backup");
  assert.deepEqual([...backupPassers(M, [], games, roster, {}, 2026)], []);
  // Attempts thrown AGAINST the team (before a trade) are not attempts for it.
  const traded = games.concat([game("e", 2026, "2026-09-21T17:00Z", "KC", "DEN", [["nix", "DEN", 40], ["mahomes", "KC", 20]])]);
  const moved = players.map((p) => (p.id === "nix" ? { ...p, team: "KC", movedFrom: "DEN" } : p));
  roster.get("nix").team = "KC";
  b = backupPassers(M, moved, traded, roster, {}, 2026);
  assert.ok(b.has("nix") && !b.has("mahomes"), "Nix's 40 against Kansas City do not make him its starter");
  roster.get("nix").team = "DEN";
  // Ids are matched as strings, the way applyRosters does.
  b = backupPassers(M, players.map((p) => ({ ...p, id: p.id === "punter" ? "punter" : p.id })), games, roster, {}, 2026);
  assert.ok(!b.has("punter"));
});

test("statEligible: a backup quarterback gets no passing line; his other props gate as before", () => {
  const rec = { games: 17, passAtt: 510, passYds: 3913, carries: 60, rushYds: 300, targets: 0, recYds: 0, recs: 0 };
  assert.ok(nfl.statEligible("passyds", rec), "a passer with the attempts is eligible");
  assert.equal(nfl.statEligible("passyds", { ...rec, backupQB: true }), null, "not when he is the backup");
  assert.equal(!!nfl.statEligible("rushyds", { ...rec, backupQB: true }), !!nfl.statEligible("rushyds", rec), "rushing is gated on touches, not on the depth chart");
});

test("notActive: the league report, then the roster's own listing for anyone the report missed", async () => {
  const { notActive } = await import("./fetch-football.mjs");
  const report = { "4362249": { name: "Jayden Reed", team: "GB", pos: "WR", status: "Doubtful", detail: "Neck", date: "2026-09-23" } };
  const roster = new Map([
    ["4362249", { id: "4362249", name: "Jayden Reed", team: "GB", pos: "WR", group: "offense", status: "Active", listed: "Out" }],
    ["4047365", { id: "4047365", name: "Josh Jacobs", team: "GB", pos: "RB", group: "offense", status: "News", listed: "Out" }],
    ["4036378", { id: "4036378", name: "Jordan Love", team: "GB", pos: "QB", group: "offense", status: "Active", listed: "" }],
  ]);
  const out = notActive(report, roster);
  assert.equal(out["4362249"].status, "Doubtful", "the report is the dated word and wins");
  assert.deepEqual(out["4047365"], { name: "Josh Jacobs", team: "GB", pos: "RB", status: "Out", detail: "" }, "the roster fills in what the report missed");
  assert.equal(out["4036378"], undefined, "listed as nothing: available");
  assert.deepEqual(notActive(report, null), report, "no roster: the report alone");
  assert.deepEqual(notActive({}, roster)["4047365"].status, "Out");
  // A listing the player has played through is stale: an entry ESPN never
  // cleared would void him on every board after his return.
  roster.get("4047365").listedAt = "2026-09-13T15:09Z";
  const played = new Map([["4047365", "2026-09-20T17:00Z"]]);
  assert.equal(notActive({}, roster, played)["4047365"], undefined, "played after the entry: not listed");
  assert.equal(notActive({}, roster, new Map([["4047365", "2026-09-06T17:00Z"]]))["4047365"].status, "Out", "played before it: listed");
  roster.get("4047365").listedAt = "";
  assert.equal(notActive({}, roster, played)["4047365"].status, "Out", "an undated listing (the roster group) is never stale");
});

/* ------------------------------------------------------------------ *
 * The board row the fetcher writes for a player
 *
 * Oracle: the roster (position), the merged not-active map (status) and
 * the starter rule (backupQB), each already tested above; this pins that
 * the row carries each one and carries nothing when the source has
 * nothing, so an older data file without positions still reads.
 * ------------------------------------------------------------------ */

test("boardPlayer: position off the roster, status off the report, backup off the starter rule, and nothing invented", async () => {
  const { boardPlayer } = await import("./fetch-football.mjs");
  const rec = { id: "1", name: "A", team: "KC", games: 5, tds: 1, carries: 0, targets: 30, recYds: 300, rushYds: 0, recs: 20, passAtt: 0, passYds: 0 };
  const ctx = {
    roster: new Map([["1", { id: "1", team: "KC", pos: "WR" }]]),
    injuries: { "1": { status: "Questionable", detail: "Knee" } },
    backups: new Set(["2"]), opponentOf: { KC: "LAC" },
  };
  const a = boardPlayer(rec, ctx);
  assert.equal(a.pos, "WR");
  assert.equal(a.opp, "LAC");
  assert.equal(a.status, "Questionable"); assert.equal(a.injury, "Knee");
  assert.equal("backupQB" in a, false);
  assert.equal(a.recYds, 300, "the record's numbers come through");
  const b = boardPlayer({ ...rec, id: "2", passAtt: 100, movedFrom: "DEN" }, { ...ctx, roster: null, opponentOf: {} });
  assert.equal("pos" in b, false, "no roster: no position, not an empty one");
  assert.equal(b.backupQB, true);
  assert.equal("status" in b, false); assert.equal("injury" in b, false);
  assert.equal(b.opp, null, "on bye or unplaced");
  assert.equal(b.movedFrom, "DEN");
});

/* ------------------------------------------------------------------ *
 * Recent games: the compact rows the fetcher writes, read back by the model
 *
 * Oracle: gameValue on the full box-score line. A compact row is
 * [MMDD, opp, recYds, recs, rushYds, passYds, tds]; rebuilt into the
 * box shape it must give every stat the same number the full line does,
 * and a rung is cleared at N - 0.5, the way the ladder settles it.
 * ------------------------------------------------------------------ */

test("recentLine / recentValues / recentHits: a compact row reads like the box line it came from", () => {
  const { recentLine, recentValues, recentHits, gameValue, STATS } = nfl;
  const box = { id: "1", name: "A", team: "KC", rush: { att: 12, yds: 55, td: 1 }, rec: { tgt: 5, rec: 4, yds: 38, td: 0 }, pass: { att: 0, cmp: 0, yds: 0, td: 0, int: 0 } };
  const row = ["260921", "LAC", 38, 4, 55, 0, 1];
  for (const stat of Object.keys(STATS)) assert.equal(gameValue(stat, recentLine(row)), gameValue(stat, box), stat);
  const recent = [["260928", "DEN", 10, 1, 0, 0, 0], row, ["250914", "NYG", 120, 9, 0, 0, 2]];
  assert.deepEqual(recentValues("recyds", recent), [10, 38, 120]);
  assert.deepEqual(recentValues("rushrec", recent), [10, 93, 120]);
  assert.deepEqual(recentValues("recs", recent), [1, 4, 9]);
  assert.equal(recentHits("recyds", recent, 10), 3, "a 10-yard game clears 10+");
  assert.equal(recentHits("recyds", recent, 20), 2, "and misses 20+");
  assert.equal(recentHits("recyds", recent, 100), 1);
  assert.equal(recentHits("recyds", [], 10), 0);
  assert.deepEqual(recentValues("recyds", null), []);
  assert.equal(recentHits("recyds", null, 10), 0);
});

test("recentRows: each player's last N lines, newest first, from the games on file; nobody without a game", async () => {
  const { recentRows } = await import("./fetch-football.mjs");
  const game = (id, date, home, away, rows) => ({ id, season: 2026, date, home: { team: home }, away: { team: away },
    players: rows.map(([pid, team, rec, rush, pass]) => ({ id: pid, name: pid, team, ...(rec ? { rec } : {}), ...(rush ? { rush } : {}), ...(pass ? { pass } : {}) })) });
  const games = [
    game("g1", "2026-09-07T17:00Z", "KC", "LAC", [["a", "KC", { tgt: 8, rec: 6, yds: 80, td: 1 }], ["q", "LAC", null, null, { att: 30, yds: 250, td: 2 }]]),
    game("g3", "2026-09-21T17:00Z", "DEN", "KC", [["a", "KC", { tgt: 4, rec: 3, yds: 30, td: 0 }, { att: 2, yds: 9, td: 0 }]]),
    game("g2", "2026-09-14T17:00Z", "KC", "NYG", [["a", "KC", { tgt: 9, rec: 7, yds: 110, td: 2 }]]),
  ];
  const out = recentRows(games, 2, nfl);
  // The date carries the year: the log spans two seasons, and 09/14 comes round again.
  assert.deepEqual(out.get("a"), [["260921", "DEN", 30, 3, 9, 0, 0], ["260914", "NYG", 110, 7, 0, 0, 2]], "newest first, capped at N, the opponent named");
  assert.deepEqual(out.get("q"), [["260907", "KC", 0, 0, 0, 250, 0]], "a passer's line; touchdowns are the ones he scores, not throws");
  assert.equal(out.has("nobody"), false);
  assert.equal(recentRows([], 5, nfl).size, 0);
  // A line for a player on neither side of the game (a bad box score) is no row at all.
  const stray = [game("g9", "2026-09-28T17:00Z", "KC", "LAC", [["z", "DEN", { tgt: 1, rec: 1, yds: 5, td: 0 }]])];
  assert.equal(recentRows(stray, 5, nfl).has("z"), false);
});

test("boardPlayer: carries the player's recent rows when there are any, and no field when there are none", async () => {
  const { boardPlayer } = await import("./fetch-football.mjs");
  const rec = { id: "1", name: "A", team: "KC", games: 5, tds: 1, carries: 0, targets: 30, recYds: 300, rushYds: 0, recs: 20, passAtt: 0, passYds: 0 };
  const rows = [["260921", "LAC", 38, 4, 0, 0, 1]];
  const a = boardPlayer(rec, { roster: null, injuries: {}, backups: new Set(), opponentOf: {}, recent: new Map([["1", rows]]) });
  assert.deepEqual(a.recent, rows);
  const b = boardPlayer(rec, { roster: null, injuries: {}, backups: new Set(), opponentOf: {}, recent: new Map() });
  assert.equal("recent" in b, false);
});

test("boardPlayer: the per-game log rides along only for a model whose touchdown decay reads it; college at equal weights writes none", async () => {
  const { boardPlayer } = await import("./fetch-football.mjs");
  const cfb = (await import("./cfb.js")).default;
  const rec = { id: "1", name: "A", team: "KC", games: 2, tds: 1, carries: 0, targets: 10, recYds: 100, rushYds: 0, recs: 8, passAtt: 0, passYds: 0, log: [[0, 0, 5, null, null, null], [1, 0, 5, null, null, null]] };
  const ctx = { roster: null, injuries: {}, backups: new Set(), opponentOf: {}, recent: new Map() };
  assert.ok(nfl.DEFAULTS.tdDecay < 1 && cfb.DEFAULTS.tdDecay === 1, "the fixture assumes the NFL decays and college does not");
  assert.deepEqual(boardPlayer(rec, { ...ctx, model: nfl }).log, rec.log, "the NFL board lost the log its decay reads");
  assert.equal("log" in boardPlayer(rec, { ...ctx, model: cfb }), false, "college carries a log nothing reads (1,362 players of it put the file over 1 MB)");
  assert.equal("log" in boardPlayer(rec, ctx), false, "no model, no decay to read it");
});

test("recentDate: a compact row's date reads back as a calendar date", () => {
  assert.equal(nfl.recentDate("260921"), "2026-09-21");
  assert.equal(nfl.recentDate("0921"), "09-21", "an older file's four-digit date still reads");
  assert.equal(nfl.recentDate(null), "");
});

test("boardPlayer: nflverse usage rides along only when a row was known; `n` alone is not usage", async () => {
  const { boardPlayer } = await import("./fetch-football.mjs");
  const p = { id: "4242335", name: "Jonathan Taylor", team: "IND", games: 4, tds: 5, carries: 80, targets: 12, recYds: 60, rushYds: 400, recs: 10, passAtt: 0, passYds: 0 };
  const rows = [
    { x: { snap: 0.8, tsh: 0.1, rzc: 4, rzt: 1, glc: 2 } },
    { x: { snap: 0.9, tsh: 0.12, rzc: 2, rzt: 0, glc: 1 } },
    { },
    { x: { snap: 0.7 } },
  ];
  const usage = new Map([["4242335", rows]]);
  const b = boardPlayer(p, { opponentOf: { IND: "WSH" }, usage });
  assert.equal(b.usage.n, 4);
  assert.equal(b.usage.snap, 0.8); assert.equal(b.usage.snapN, 3);
  assert.equal(b.usage.rzc, 6); assert.equal(b.usage.glc, 3); assert.equal(b.usage.rzN, 2);
  assert.equal(b.usage3.n, 3); assert.equal(b.usage3.rzc, 2, "the last three games only");
  const none = boardPlayer(p, { opponentOf: {}, usage: new Map([["4242335", [{}, {}]]]) });
  assert.equal("usage" in none, false, "games with no rows: no usage field, so the page treats it as unknown");
  assert.equal("usage" in boardPlayer(p, { opponentOf: {} }), false, "no feed at all: no field");
});

/* ------------------------------------------------------------------ *
 * The three touchdown terms added 2026-09-30, off by default
 *
 * Oracle: the model's own arithmetic, and the rule that a term at its
 * default changes nothing; that an unknown red-zone row is never a zero;
 * that the decay weights sum the way a geometric series does.
 * ------------------------------------------------------------------ */

test("usageTDs: the two-term fit unless tdRz is on AND the red-zone rows are known", () => {
  const two = nfl.usageTDs(10, 5);
  assert.equal(two, nfl.DEFAULTS.tdPerCarry * 10 + nfl.DEFAULTS.tdPerTarget * 5);
  const o = { tdRz: 1, tdPerCarryRz: 0.02, tdPerTargetRz: 0.03, tdPerRzCarry: 0.1, tdPerRzTarget: 0.2, tdPerGlCarry: 0.3 };
  assert.equal(nfl.usageTDs(10, 5, o), two, "tdRz on but no rows: the two-term fit, an unknown is not a zero");
  assert.equal(nfl.usageTDs(10, 5, o, { c: 2, t: 1, g: 1 }), 0.02 * 10 + 0.03 * 5 + 0.1 * 2 + 0.2 * 1 + 0.3 * 1);
  assert.equal(nfl.usageTDs(10, 5, { tdRz: 0 }, { c: 2, t: 1, g: 1 }), two, "tdRz off: rows ignored");
});

test("rzPerGame and weightedLine: per-game red-zone usage over the games it was known for; decay weights newest games up", () => {
  assert.equal(nfl.rzPerGame({ rz: { c: 6, t: 3, g: 2, n: 3 } }).c, 2);
  assert.equal(nfl.rzPerGame({ rz: { c: 0, t: 0, g: 0, n: 0 } }), null);
  assert.equal(nfl.rzPerGame({}), null);
  const player = { log: [[0, 10, 2, null, null, null], [1, 12, 3, null, null, null], [2, 20, 4, null, null, null]] };
  const equal = nfl.weightedLine(player, Object.assign({}, nfl.DEFAULTS, { tdDecay: 1 }));
  assert.equal(equal.games, 3); assert.equal(equal.tds, 3);
  const half = nfl.weightedLine(player, Object.assign({}, nfl.DEFAULTS, { tdDecay: 0.5 }));
  assert.equal(half.games, 3, "the evidence is still three games: the weights only choose which games speak");
  const scale = 3 / (0.25 + 0.5 + 1);
  assert.ok(Math.abs(half.tds - (0.25 * 0 + 0.5 * 1 + 1 * 2) * scale) < 1e-12, "weights 0.25, 0.5, 1 oldest to newest, scaled to sum to three");
  assert.ok(Math.abs(half.perGameCarries - (0.25 * 10 + 0.5 * 12 + 1 * 20) / 1.75) < 1e-12, "the weighted per-game workload is returned for the panel");
  assert.equal(nfl.weightedLine({ log: [] }, nfl.DEFAULTS), null);
});

test("scoreAnytimeTD: with every term off the rows and the script factor change nothing; on, each moves the number the way it says", () => {
  const p = { games: 10, tds: 6, carries: 150, targets: 30, rz: { c: 20, t: 5, g: 8, n: 10 },
    log: Array.from({ length: 10 }, (_, i) => [i < 6 ? 1 : 0, 15, 3, 2, 0.5, 0.8]) };
  const off = { tdDecay: 1, tdScript: 0, tdRz: 0 };
  const base = nfl.scoreAnytimeTD(p, { teamFactor: 1, oppFactor: 1, scriptFactor: 1.3, opts: off });
  const plain = nfl.scoreAnytimeTD({ games: 10, tds: 6, carries: 150, targets: 30 }, { teamFactor: 1, oppFactor: 1, opts: off });
  assert.equal(base.prob, plain.prob, "rows and a script factor present, every term off: the same number");
  assert.equal(base.scriptFactor, 1.3); assert.equal(base.weighted, false);
  const script = nfl.scoreAnytimeTD(p, { teamFactor: 1, oppFactor: 1, scriptFactor: 1.3, opts: Object.assign({}, off, { tdScript: 1 }) });
  assert.ok(script.lambda > base.lambda, "a team projected above the league scores more");
  const half = nfl.scoreAnytimeTD(p, { teamFactor: 1, oppFactor: 1, scriptFactor: 1.3, opts: Object.assign({}, off, { tdScript: 0.5 }) });
  assert.ok(half.lambda > base.lambda && half.lambda < script.lambda, "the power scales the effect");
  const rz = nfl.scoreAnytimeTD(p, { teamFactor: 1, oppFactor: 1, opts: Object.assign({}, off, { tdRz: 1, tdPerCarryRz: 0.02, tdPerTargetRz: 0.03, tdPerRzCarry: 0.1, tdPerRzTarget: 0.1, tdPerGlCarry: 0.2 }) });
  assert.deepEqual(rz.rz, { c: 2, t: 0.5, g: 0.8 });
  assert.equal(rz.usageRate, 0.02 * 15 + 0.03 * 3 + 0.1 * 2 + 0.1 * 0.5 + 0.2 * 0.8);
  const decayed = nfl.scoreAnytimeTD(p, { teamFactor: 1, oppFactor: 1, opts: Object.assign({}, off, { tdDecay: 0.8 }) });
  assert.equal(decayed.weighted, true);
  assert.ok(decayed.observedRate === base.observedRate, "the reported season rate is still the plain one");
  assert.ok(decayed.lambda < base.lambda, "his scores were all early in the log, so weighting the recent games up lowers him");
});

test("seasonLines: every player gets a per-game log; red-zone sums only over games with rows, nulls elsewhere", async () => {
  const { seasonLines } = await import("./fetch-football.mjs");
  const g = (date, x) => ({ date, season: 2026, week: 1, home: { team: "A", score: 20, stats: {} }, away: { team: "B", score: 10, stats: {} },
    players: [{ id: "p1", name: "P", team: "A", rush: { att: 10, yds: 40, td: 1 }, rec: { rec: 1, tgt: 2, yds: 5, td: 0 }, ...(x ? { x } : {}) }] });
  const { players } = seasonLines([g("2026-09-07T00:00Z", { rzc: 3, rzt: 1, glc: 2, snap: 0.8 }), g("2026-09-14T00:00Z", null)], nfl);
  const r = players.get("p1");
  assert.deepEqual(r.log, [[1, 10, 2, 3, 1, 2], [1, 10, 2, null, null, null]]);
  assert.deepEqual(r.rz, { c: 3, t: 1, g: 2, n: 1 }, "one game had rows");
});

test("the shipped touchdown terms: decay at 0.97, script and red zone off, so the board and the replay agree with the README's tables", () => {
  assert.equal(nfl.DEFAULTS.tdDecay, 0.97);
  // A3 (2026-10-01): the per-prop decay where it cleared both windows, the receiving opponent at half strength.
  assert.deepEqual([nfl.DEFAULTS.yardDecay, nfl.DEFAULTS.rushDecay, nfl.DEFAULTS.passDecay, nfl.DEFAULTS.recsDecay], [0.88, 0.97, 1, 1]);
  assert.equal(nfl.DEFAULTS.rushrecDecay, 0.9);
  assert.deepEqual([nfl.DEFAULTS.yardOppShrink, nfl.DEFAULTS.recsOppShrink, nfl.DEFAULTS.rushrecOppShrink, nfl.DEFAULTS.passPoolShare], [0, 0, 0, 0], "no opponent term for receiving yards: noise on fixed lines");
  assert.equal(nfl.DEFAULTS.tdScript, 0);
  assert.equal(nfl.DEFAULTS.tdRz, 0);
  // With the decay on, a player whose log is present is weighted; one without a log is scored as before.
  const withLog = { games: 4, tds: 2, carries: 60, targets: 10, log: [[0, 15, 2, null, null, null], [0, 15, 3, null, null, null], [1, 15, 3, null, null, null], [1, 15, 2, null, null, null]] };
  const s = nfl.scoreAnytimeTD(withLog, { teamFactor: 1, oppFactor: 1 });
  assert.equal(s.weighted, true);
  const plain = nfl.scoreAnytimeTD({ games: 4, tds: 2, carries: 60, targets: 10 }, { teamFactor: 1, oppFactor: 1 });
  assert.equal(plain.weighted, false);
  assert.ok(s.lambda > plain.lambda, "his two scores were his last two games, so recent weighting lifts him");
});

test("seasonLines: the per-game log is oldest first whatever order the games arrive in, and holds the league's receiving opportunity", async () => {
  const { seasonLines } = await import("./fetch-football.mjs");
  const g = (date, tgt, rec) => ({ date, season: 2026, week: 1, home: { team: "A", score: 20, stats: {} }, away: { team: "B", score: 10, stats: {} },
    players: [{ id: "p1", name: "P", team: "A", rush: { att: 5, yds: 20, td: 0 }, rec: { rec, tgt, yds: 50, td: 1 } }] });
  const newestFirst = [g("2026-09-21T00:00Z", 8, 6), g("2026-09-07T00:00Z", 3, 2)];
  const nflLine = seasonLines(newestFirst, nfl).players.get("p1");
  assert.deepEqual(nflLine.log.map((row) => row[2]), [3, 8], "oldest first, targets for the NFL");
  const cfb = (await import("./cfb.js")).default;
  const cfbLine = seasonLines(newestFirst, cfb).players.get("p1");
  assert.deepEqual(cfbLine.log.map((row) => row[2]), [2, 6], "oldest first, receptions for college, where targets are never recorded");
});

/* ------------------------------------------------------------------ *
 * A3: the per-prop decay, the recent-form weight on a counting prop's line
 *
 * Oracle: the tdDecay rule in weightedLine — the newest game weighs 1,
 * each older game decay^age, weights scaled to sum to the game count so
 * the yardK shrink sees the same amount of evidence. The log is
 * `record.slog`, one value per stat in STATS order, oldest first, as
 * seasonLines (fetch-football.mjs) writes it with gameValue; the board
 * carries the fetcher's precomputed `w` instead.
 * ------------------------------------------------------------------ */
/* A log row from a game line, the way seasonLines builds one: every stat's game value in STATS order. */
const slogRow = (p) => Object.keys(nfl.STATS).map((stat) => nfl.gameValue(stat, p));
const rec4 = (lines) => ({ games: lines.length,
  recYds: lines.reduce((s, p) => s + (p.rec?.yds || 0), 0), recs: lines.reduce((s, p) => s + (p.rec?.rec || 0), 0),
  rushYds: lines.reduce((s, p) => s + (p.rush?.yds || 0), 0), passYds: 0, carries: 0, targets: 30, passAtt: 0, slog: lines.map(slogRow) });
const RISING = rec4([{ rec: { yds: 20, rec: 2 } }, { rec: { yds: 40, rec: 4 } }, { rec: { yds: 60, rec: 6 } }, { rec: { yds: 80, rec: 8 } }]);
const FLAT = rec4([{ rec: { yds: 50 } }, { rec: { yds: 50 } }, { rec: { yds: 50 } }, { rec: { yds: 50 } }]);

test("a decay of 1 is today's model: the weighted total is the plain total, with or without a log", () => {
  for (const k of ["passDecay", "recsDecay"]) assert.equal(nfl.DEFAULTS[k], 1, k + " ships at 1: no value cleared the rule on both windows");
  close(nfl.weightedStatTotal("recyds", RISING, { yardDecay: 1 }), 200);
  close(nfl.expectedStat("recyds", RISING, { yardDecay: 1 }), nfl.expectedVolume(200, 4, nfl.DEFAULTS.yardPrior));
  close(nfl.weightedStatTotal("recyds", { games: 4, recYds: 200 }, { yardDecay: 0.9 }), 200, 1e-9, "no log and no w: the plain total");
});

test("a decay under 1 weights recent games up without changing the evidence: a flat log is unchanged, a rising one rises, weights sum to the game count", () => {
  close(nfl.weightedStatTotal("recyds", FLAT, { yardDecay: 0.8 }), 200, 1e-9, "equal games, any decay: the same total");
  const w = nfl.weightedStatTotal("recyds", RISING, { yardDecay: 0.8 });
  // By hand: weights 0.512, 0.64, 0.8, 1 (sum 2.952); Σ w·v = 10.24+25.6+48+80 = 163.84; scaled by 4/2.952 = 222.0.
  close(w, 163.84 * 4 / 2.952, 1e-6);
  assert.ok(w > 200, "a rising line weighted toward the recent games is above its plain total");
  close(nfl.expectedStat("recyds", RISING, { yardDecay: 0.8 }), nfl.expectedVolume(w, 4, nfl.DEFAULTS.yardPrior), 1e-9, "the expectation is the shrink of the weighted total");
  // Each stat reads its own column: receptions from the rec column, rush + rec from the sum.
  close(nfl.weightedStatTotal("recs", RISING, { recsDecay: 0.8 }), 16.384 * 4 / 2.952, 1e-6, "receptions read the wrong column");
  const rr = rec4([{ rush: { yds: 20 }, rec: { yds: 10 } }, { rush: { yds: 50 }, rec: { yds: 20 } }]);
  close(nfl.weightedStatTotal("rushrec", rr, { rushrecDecay: 0.5 }), (0.5 * 30 + 70) * 2 / 1.5, 1e-9, "the rushrec column is not the sum");
});

test("the fetcher's precomputed w stands in for the log on the board, agrees with it to rounding, and carries only the stats whose decay is under 1", () => {
  const only = { yardDecay: 0.8, rushDecay: 1, passDecay: 1, recsDecay: 1, rushrecDecay: 1 };
  const w = nfl.weightedStatTotals(RISING, only);
  assert.deepEqual(Object.keys(w), ["recyds"], "w carries a stat whose decay is 1, or misses the one that is not");
  assert.deepEqual(Object.keys(nfl.weightedStatTotals(RISING)).sort(), ["recyds", "rushrec", "rushyds"], "the shipped decays: three stats in w, not five");
  const board = { games: 4, recYds: 200, recs: 20, w };
  close(nfl.weightedStatTotal("recyds", board, { yardDecay: 0.8 }), w.recyds, 1e-9);
  // toFixed(2) on the total: within 0.005 of the log's figure, so the per-game expectation within 0.002.
  close(nfl.expectedStat("recyds", board, { yardDecay: 0.8 }), nfl.expectedStat("recyds", RISING, { yardDecay: 0.8 }), 2e-3, "the board's w and the replay's log disagree beyond rounding");
  close(nfl.expectedStat("recyds", board, { yardDecay: 1 }), nfl.expectedVolume(200, 4, nfl.DEFAULTS.yardPrior), 1e-9, "with the decay off, w is ignored");
  assert.equal(nfl.weightedStatTotals({ games: 4, recYds: 200 }), null, "no log, no w");
  assert.equal(nfl.weightedStatTotals(RISING, { yardDecay: 1, rushDecay: 1, passDecay: 1, recsDecay: 1, rushrecDecay: 1 }), null, "every decay at 1: nothing to write");
});

test("end to end: seasonLines writes the log the decay reads, so a rising receiver projects above his plain average", async () => {
  const { seasonLines } = await import("./fetch-football.mjs");
  const game = (date, yds) => ({ id: "g" + date, season: 2026, week: 1, date, home: { team: "KC", score: 0 }, away: { team: "LAC", score: 0 },
    players: [{ id: "r1", name: "Rising", team: "KC", rec: { yds, rec: 3, tgt: 5, td: 0 } }] });
  const { players } = seasonLines([game("2026-09-21", 60), game("2026-09-07", 20), game("2026-09-14", 40)], nfl);
  const r = players.get("r1");
  assert.deepEqual(r.slog.map((row) => row[Object.keys(nfl.STATS).indexOf("recyds")]), [20, 40, 60], "the log is not oldest first, or not the receiving column");
  assert.equal(r.slog.length, r.games);
  close(nfl.weightedStatTotal("recyds", r, { yardDecay: 1 }), 120, 1e-9);
  assert.ok(nfl.weightedStatTotal("recyds", r, { yardDecay: 0.8 }) > 120, "the rising line did not rise");
  close(nfl.weightedStatTotal("recyds", r, { yardDecay: 0.8 }), (0.64 * 20 + 0.8 * 40 + 60) * 3 / 2.44, 1e-9);
});

/* ------------------------------------------------------------------ *
 * A4: wind in the total. Oracle: experiment-wind.mjs's definition, windK
 * points per mph over windFloor off the total of an outdoor game, half
 * from each side; the margin untouched.
 * ------------------------------------------------------------------ */
test("wind: at windK 0 nothing moves; with a term, an outdoor game over the floor loses windK a mph from its total, half a side, the margin unchanged; a dome or no reading moves nothing", () => {
  const ratings = { off: { KC: 2, LAC: -1 }, def: { KC: -1, LAC: 1 }, league: 23, homeField: 2 };
  const base = nfl.projectGame(ratings, "KC", "LAC");
  assert.equal(nfl.DEFAULTS.windK, 0, "windK ships at 0 until a value clears the rule");
  assert.equal(nfl.DEFAULTS.windFloor, 15);
  const same = nfl.projectGame(ratings, "KC", "LAC", { wind: 25 });
  close(same.total, base.total, 1e-9, "a reading with windK 0 moved the total");
  assert.equal(same.windPts, 0);
  const w = nfl.projectGame(ratings, "KC", "LAC", { wind: 25, windK: 0.5 });
  close(w.total, base.total - 5, 1e-9, "25 mph at K 0.5 over a 15 floor is 5 points");
  close(w.margin, base.margin, 1e-9, "the margin is not the wind's");
  close(w.homePts, base.homePts - 2.5, 1e-9); close(w.awayPts, base.awayPts - 2.5, 1e-9);
  assert.equal(w.windPts, 5);
  close(nfl.projectGame(ratings, "KC", "LAC", { wind: 10, windK: 0.5 }).total, base.total, 1e-9, "under the floor is calm");
  close(nfl.projectGame(ratings, "KC", "LAC", { wind: 25, windK: 0.5, indoor: true }).total, base.total, 1e-9, "a dome has no wind");
  close(nfl.projectGame(ratings, "KC", "LAC", { wind: null, windK: 0.5 }).total, base.total, 1e-9, "no reading, no term");
  close(nfl.projectGame(ratings, "KC", "LAC", { wind: 25, windK: 0.5, windFloor: 20 }).total, base.total - 2.5, 1e-9, "the floor is a constant");
});
