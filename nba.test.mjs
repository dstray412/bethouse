/*
 * BetHouse — nba.test.mjs
 * Tests for the NBA board: the fetcher's parsers, the model, the record.
 *
 * Like nfl.test.mjs these test SHAPE: that a parser reads the field ESPN
 * documents, that the model answers its inputs the right way round and
 * reduces to something checkable by hand at the edges. Whether the model
 * is any good is `backtest-nba.mjs`'s question.
 *
 * Where a test pins a number that came out of a fit rather than a rule it
 * is marked `characterization:` so the next person knows they may move it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGame, parseScheduleEvent, calendarDates, slateDay, wanted } from "./fetch-nba.mjs";

/* ------------------------------------------------------------------ *
 * Fixtures: ESPN's shapes, cut down to the fields the parsers read
 * ------------------------------------------------------------------ */

const KEYS = ["minutes", "points", "fieldGoalsMade-fieldGoalsAttempted", "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
  "freeThrowsMade-freeThrowsAttempted", "rebounds", "assists", "turnovers", "steals", "blocks", "offensiveRebounds", "defensiveRebounds", "fouls", "plusMinus"];
const ath = (id, name, stats, more = {}) => ({ athlete: { id, displayName: name, position: { abbreviation: more.pos || "G" } }, starter: !!more.starter, didNotPlay: !!more.dnp, stats });
const side = (abbr, athletes) => ({ team: { abbreviation: abbr }, statistics: [{ keys: KEYS, athletes }] });
const summary = (over = {}) => ({
  header: {
    id: "401910029", season: { year: 2027, type: 2 },
    competitions: [{
      date: "2026-11-22T20:30Z", neutralSite: false, type: { abbreviation: "STD" },
      status: { type: { completed: true } },
      competitors: [
        { homeAway: "home", team: { abbreviation: "ATL", id: "1" }, score: "107" },
        { homeAway: "away", team: { abbreviation: "DET", id: "8" }, score: "97" },
      ],
      ...over,
    }],
  },
  boxscore: { players: [
    side("DET", [
      ath("4432166", "Cade Cunningham", ["33", "5", "2-9", "1-3", "0-0", "4", "15", "6", "1", "1", "0", "4", "4", "-8"], { starter: true }),
      ath("4397882", "Tolu Smith", [], { dnp: true, pos: "F" }),
    ]),
    side("ATL", [
      ath("3908845", "John Collins", ["22", "18", "6-9", "4-5", "2-2", "6", "0", "1", "1", "1", "1", "5", "1", "-5"], { starter: true, pos: "F" }),
      ath("1", "Garbage Time", ["0", "0", "0-0", "0-0", "0-0", "0", "0", "0", "0", "0", "0", "0", "0", "0"]),
    ]),
  ] },
});

/* ------------------------------------------------------------------ *
 * parseGame
 * ------------------------------------------------------------------ */

test("parseGame: a box-score line is the fields ESPN names, made-attempted split on the dash", () => {
  const g = parseGame(summary());
  assert.equal(g.id, "401910029");
  assert.equal(g.season, 2027);
  assert.equal(g.type, 2);
  assert.equal(g.date, "2026-11-22T20:30Z");
  assert.deepEqual(g.home, { team: "ATL", score: 107 });
  assert.deepEqual(g.away, { team: "DET", score: 97 });
  const cade = g.players.find((p) => p.id === "4432166");
  assert.deepEqual(cade, { id: "4432166", name: "Cade Cunningham", team: "DET", pos: "G", st: 1, min: 33, pts: 5, reb: 4, ast: 15, tpm: 1, tpa: 3, fga: 9, fta: 0, stl: 1, blk: 1, to: 6 });
  const collins = g.players.find((p) => p.id === "3908845");
  assert.equal(collins.team, "ATL");
  assert.equal(collins.tpm, 4);
  assert.equal(collins.pts, 18);
});

test("parseGame: a player who did not play, or logged no minutes, has no line", () => {
  const g = parseGame(summary());
  assert.equal(g.players.some((p) => p.id === "4397882"), false, "did not play");
  assert.equal(g.players.some((p) => p.id === "1"), false, "no minutes");
  assert.equal(g.players.length, 2);
});

test("parseGame: a neutral site is recorded, and a payload with no competition is null", () => {
  assert.equal(parseGame(summary({ neutralSite: true })).neutral, true);
  assert.equal("neutral" in parseGame(summary()), false);
  assert.equal(parseGame(null), null);
  assert.equal(parseGame({ header: { competitions: [] } }), null);
});

test("parseGame: a stat is read by its key, not its column", () => {
  const s = summary();
  const block = s.boxscore.players[0].statistics[0];
  // The same line with the columns in another order.
  const order = [5, 1, 0, 6, 3, 2, 4, 7, 8, 9, 10, 11, 12, 13];
  block.keys = order.map((i) => KEYS[i]);
  block.athletes[0].stats = order.map((i) => ["33", "5", "2-9", "1-3", "0-0", "4", "15", "6", "1", "1", "0", "4", "4", "-8"][i]);
  const cade = parseGame(s).players.find((p) => p.id === "4432166");
  assert.equal(cade.reb, 4);
  assert.equal(cade.ast, 15);
  assert.equal(cade.min, 33);
});

/* ------------------------------------------------------------------ *
 * The schedule
 * ------------------------------------------------------------------ */

const event = (over = {}) => ({
  id: "401910100", date: "2026-11-24T00:30Z", name: "Oklahoma City Thunder at Indiana Pacers",
  season: { year: 2027, type: 2 },
  status: { type: { completed: false, state: "pre" } },
  competitions: [{
    type: { abbreviation: "STD" }, venue: { fullName: "Gainbridge Fieldhouse" },
    competitors: [
      { homeAway: "home", team: { abbreviation: "IND", id: "11" } },
      { homeAway: "away", team: { abbreviation: "OKC", id: "25" } },
    ],
  }],
  ...over,
});

test("parseScheduleEvent: team codes, ids, the tip and whether it is final", () => {
  const g = parseScheduleEvent(event());
  assert.deepEqual(g, { id: "401910100", date: "2026-11-24T00:30Z", season: 2027, type: 2, kind: "STD", completed: false, state: "pre",
    name: "Oklahoma City Thunder at Indiana Pacers", home: "IND", away: "OKC", homeId: "11", awayId: "25", venue: "Gainbridge Fieldhouse" });
  assert.equal(parseScheduleEvent(event({ status: { type: { completed: true, state: "post" } } })).completed, true);
});

test("parseScheduleEvent: missing pieces come back null, never a guess", () => {
  const g = parseScheduleEvent({ id: "1", competitions: [{ competitors: [] }] });
  assert.equal(g.home, null);
  assert.equal(g.away, null);
  assert.equal(parseScheduleEvent(null).id, "");
});

test("wanted: the regular season, the play-in and the playoffs; never the preseason or the All-Star games", () => {
  assert.equal(wanted(parseScheduleEvent(event())), true);
  assert.equal(wanted(parseScheduleEvent(event({ season: { year: 2026, type: 5 } }))), true, "play-in");
  assert.equal(wanted(parseScheduleEvent(event({ season: { year: 2026, type: 3 } }))), true, "playoffs");
  assert.equal(wanted(parseScheduleEvent(event({ season: { year: 2026, type: 1 } }))), false, "preseason");
  const allStar = event();
  allStar.competitions[0].type.abbreviation = "ALLSTAR";
  assert.equal(wanted(parseScheduleEvent(allStar)), false, "the All-Star games sit inside the regular season");
  assert.equal(wanted(parseScheduleEvent({ id: "1", competitions: [{ competitors: [] }] })), false, "no teams");
  assert.equal(wanted(parseScheduleEvent(event({ id: "401&x=1" }))), false, "an id that is not digits never reaches a request url");
});

test("calendarDates: the scoreboard's whitelist as YYYYMMDD, in order, the league's day and not UTC's", () => {
  const payload = { leagues: [{ calendar: ["2024-10-23T07:00Z", "2024-10-22T07:00Z", "junk", "2024-10-22T07:00Z"] }] };
  assert.deepEqual(calendarDates(payload), ["20241022", "20241023"]);
  assert.deepEqual(calendarDates(null), []);
});

test("slateDay: the league's day turns over at 6am Eastern, so a late tip belongs to the night it started", () => {
  // 03:30 UTC on the 24th is 10:30pm Eastern on the 23rd.
  assert.equal(slateDay(new Date("2026-11-24T03:30:00Z")), "20261123");
  // 09:00 UTC is 4am Eastern: last night's games may still be going final.
  assert.equal(slateDay(new Date("2026-11-24T09:00:00Z")), "20261123");
  // 12:20 UTC is 7:20am Eastern: today's slate.
  assert.equal(slateDay(new Date("2026-11-24T12:20:00Z")), "20261124");
  // Daylight time: 10:30 UTC in July is 6:30am Eastern.
  assert.equal(slateDay(new Date("2026-07-01T10:30:00Z")), "20260701");
  assert.equal(slateDay(new Date("2026-07-01T09:30:00Z")), "20260630");
});

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

import nba from "./nba.js";
import nfl from "./nfl.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `expected ${a} ≈ ${b} (tol ${tol})`);
/* A season record from per-game lines [min, pts, reb, ast, tpm], oldest first. */
const record = (rows, more = {}) => {
  const r = { id: "1", name: "A Player", team: "ATL", games: rows.length, min: 0, pts: 0, reb: 0, ast: 0, tpm: 0, slog: rows.map((x) => x.slice()) };
  for (const [min, pts, reb, ast, tpm] of rows) { r.min += min; r.pts += pts; r.reb += reb; r.ast += ast; r.tpm += tpm; }
  return Object.assign(r, more);
};
const steady = (n, line = [32, 20, 6, 5, 2]) => record(Array.from({ length: n }, () => line));
/* Every term off: equal weights, no opponent, so a number is checkable by hand. */
const PLAIN = { ptsDecay: 1, rebDecay: 1, astDecay: 1, tpmDecay: 1, praDecay: 1, minDecay: null, ptsOppShrink: 0, rebOppShrink: 0, astOppShrink: 0, tpmOppShrink: 0, praOppShrink: 0 };

test("the stat table: five props, each with a ladder and every key it names in DEFAULTS", () => {
  assert.deepEqual(Object.keys(nba.STATS), ["pts", "reb", "ast", "tpm", "pra"]);
  for (const [id, st] of Object.entries(nba.STATS)) {
    assert.ok(Array.isArray(nba.LADDERS[id]) && nba.LADDERS[id].length, `${id} has a ladder`);
    assert.deepEqual(nba.LADDERS[id], [...nba.LADDERS[id]].sort((a, b) => a - b), `${id} ladder ascends`);
    for (const k of ["priorKey", "kKey", "poolFloorKey", "poolShareKey", "floorKey", "oppShrinkKey", "decayKey"]) {
      assert.ok(st[k] in nba.DEFAULTS, `${id}.${k} = ${st[k]} is a DEFAULTS key`);
    }
    assert.ok(st.label && st.unit, `${id} has a label and a unit`);
  }
});

test("statTotal and gameValue: a stat is its fields summed, on a season record or a box line", () => {
  const line = { min: 30, pts: 21, reb: 7, ast: 4, tpm: 3 };
  assert.equal(nba.gameValue("pts", line), 21);
  assert.equal(nba.gameValue("tpm", line), 3);
  assert.equal(nba.gameValue("pra", line), 32);
  assert.equal(nba.statTotal("pra", steady(4)), 4 * 31);
  assert.equal(nba.statTotal("nope", line), 0);
  assert.equal(nba.gameValue("pts", null), 0);
});

test("expectedStat: with equal weights it is the season average shrunk toward the prior by K games", () => {
  const r = steady(10);
  const K = nba.DEFAULTS.ptsK, prior = nba.DEFAULTS.ptsPrior;
  close(nba.expectedStat("pts", r, PLAIN), (200 + K * prior) / (10 + K));
  // No games: the prior itself. More games: nearer his own average.
  close(nba.expectedStat("pts", record([]), PLAIN), prior);
  const far = Math.abs(nba.expectedStat("pts", steady(4), PLAIN) - 20), near = Math.abs(nba.expectedStat("pts", steady(40), PLAIN) - 20);
  assert.ok(near < far, "forty games sit nearer his average than four");
});

test("expectedStat: a decay under 1 weights recent games up and leaves a steady line alone", () => {
  const rising = record([[30, 10, 5, 5, 1], [30, 10, 5, 5, 1], [30, 10, 5, 5, 1], [30, 30, 5, 5, 1], [30, 30, 5, 5, 1], [30, 30, 5, 5, 1]]);
  const flat = nba.expectedStat("pts", rising, PLAIN), recent = nba.expectedStat("pts", rising, { ...PLAIN, ptsDecay: 0.8 });
  assert.ok(recent > flat, "the later thirty-point games count for more");
  close(nba.expectedStat("pts", steady(12), { ...PLAIN, ptsDecay: 0.8 }), nba.expectedStat("pts", steady(12), PLAIN), 1e-9);
  // Only the stat decayed moves.
  close(nba.expectedStat("reb", rising, { ...PLAIN, ptsDecay: 0.8 }), nba.expectedStat("reb", rising, PLAIN));
});

test("expectedStat: minDecay splits the line into a per-minute rate and the minutes he is getting now", () => {
  // Same rate every game (0.5 a minute), minutes doubled lately.
  const more = record([[16, 8, 0, 0, 0], [16, 8, 0, 0, 0], [16, 8, 0, 0, 0], [16, 8, 0, 0, 0], [32, 16, 0, 0, 0], [32, 16, 0, 0, 0]]);
  const plain = nba.expectedStat("pts", more, PLAIN);
  const split = nba.expectedStat("pts", more, { ...PLAIN, minDecay: 0.5 });
  assert.ok(split > plain, "the minutes he plays now carry the projection up");
  // minDecay equal to the stat's own decay is the plain weighted line.
  close(nba.expectedStat("pts", more, { ...PLAIN, ptsDecay: 0.9, minDecay: 0.9 }), nba.expectedStat("pts", more, { ...PLAIN, ptsDecay: 0.9 }), 1e-9);
});

test("expectedStat: without the log, the fetcher's weighted totals stand in; without either, the plain total", () => {
  const r = steady(10);
  const w = nba.weightedStatTotals(r, { ...PLAIN, ptsDecay: 0.9 });
  const noLog = { ...r, slog: undefined, w };
  close(nba.expectedStat("pts", noLog, { ...PLAIN, ptsDecay: 0.9 }), nba.expectedStat("pts", r, { ...PLAIN, ptsDecay: 0.9 }), 0.01);
  close(nba.expectedStat("pts", { ...r, slog: undefined }, { ...PLAIN, ptsDecay: 0.9 }), nba.expectedStat("pts", r, PLAIN));
});

test("statEligible: the one gate is games, minutes and the stat's floor; the opponent moves the number, never the gate", () => {
  const o = PLAIN;
  assert.ok(nba.statEligible("pts", steady(20), o), "a twenty-a-night starter is on the board");
  assert.equal(nba.statEligible("pts", steady(nba.DEFAULTS.minGames - 1), o), null, "too few games");
  assert.equal(nba.statEligible("pts", steady(20, [nba.DEFAULTS.minMinutes - 1, 20, 6, 5, 2]), o), null, "too few minutes");
  assert.equal(nba.statEligible("tpm", steady(20, [32, 20, 6, 5, 0]), o), null, "under the floor: no threes, no line");
  assert.equal(nba.statEligible("nope", steady(20), o), null);
  const shr = { ...o, ptsOppShrink: 0.5 };
  const soft = nba.statEligible("pts", steady(20), shr, { oppFactor: 1.2 }), tough = nba.statEligible("pts", steady(20), shr, { oppFactor: 0.8 });
  assert.ok(soft.exp > soft.base && tough.exp < tough.base);
  close(soft.oppFactor, 1.1);
  close(soft.base, tough.base);
  // A low scorer facing a soft defence stays off: the gate is his own level.
  const low = steady(20, [20, nba.DEFAULTS.ptsFloor - 2, 3, 1, 0]);
  assert.equal(nba.statEligible("pts", low, shr, { oppFactor: 1.6 }), null);
});

test("lineFor: the half number nearest the projection, so a made three is never offered a whole count away", () => {
  assert.equal(nba.lineFor(2.6), 2.5);
  assert.equal(nba.lineFor(2.4), 2.5);
  assert.equal(nba.lineFor(24.9), 24.5);
  assert.equal(nba.lineFor(25), 25.5);
  assert.equal(nba.lineFor(20, 1.3), 26.5);
  assert.equal(nba.lineFor(20, 0.7), 14.5);
  for (const e of [0.6, 1.2, 3.7, 11.1, 28.49]) assert.ok(Math.abs(nba.lineFor(e) - e) <= 0.5);
  // Football's rule is its own and unchanged: the projection rounded, then the half above it.
  assert.equal(nfl.lineFor(62.4), 62.5);
  assert.equal(nfl.lineFor(62.6), 63.5);
  assert.equal(nfl.lineFor(60, 1.3), 78.5);
});

test("statOppFactor: 1 without an allowance or a strength, clamped like the football factors", () => {
  assert.equal(nba.statOppFactor("pts", null, { ptsOppShrink: 0.5 }), 1);
  assert.equal(nba.statOppFactor("pts", 1.3, { ptsOppShrink: 0 }), 1);
  assert.equal(nba.statOppFactor("pts", 9, { ptsOppShrink: 1 }), 1.6);
  assert.equal(nba.statOppFactor("pts", 0.1, { ptsOppShrink: 1 }), 0.6);
});

test("empiricalOver: read off the pool, a flat one whole and a levelled one at the stat's share nearest the projection", () => {
  // Flat: half the games doubled, half were nothing.
  assert.equal(nba.empiricalOver(20, 19.5, [2, 2, 0, 0]), 0.5);
  assert.equal(nba.empiricalOver(20, 19.5, []), null);
  assert.equal(nba.empiricalOver(0, 19.5, [1]), null);
  // Levelled: low projections always miss, high always hit.
  const exp = [], ratio = [];
  for (let i = 0; i < 50; i++) { exp.push(5); ratio.push(0); }
  for (let i = 0; i < 50; i++) { exp.push(30); ratio.push(2); }
  const pool = nba.sortedPool(exp, ratio, "pts");
  assert.equal(nba.empiricalOver(30, 29.5, pool, { ptsPoolShare: 0.5 }), 1, "a thirty-point projection reads the thirty-point games");
  assert.equal(nba.empiricalOver(5, 4.5, pool, { ptsPoolShare: 0.5 }), 0);
  assert.equal(nba.empiricalOver(30, 29.5, pool, { ptsPoolShare: 0 }), 0.5, "a share of 0 reads the whole pool");
  assert.equal(nba.poolReads(pool, 30, { ptsPoolShare: 0.5 }).length, 50);
  assert.equal(nba.poolSize(pool), 100);
});

test("the pool math is nfl.js's own, not a second copy", () => {
  for (const k of ["sortedPool", "poolNear", "poolSize", "ratioPool", "playerMatches", "opponentIn", "allowOf", "recentDate", "applyRosters"]) {
    assert.equal(nba[k], nfl[k], `${k} is the football model's function`);
  }
});

test("ladder: every rung between the edges, N+ settled as the over of N - 0.5, falling as the rung rises", () => {
  const pool = nba.sortedPool(Array.from({ length: 200 }, () => 20), Array.from({ length: 200 }, (_, i) => i / 100), "pts");
  const rungs = nba.ladder("pts", 20, pool);
  assert.ok(rungs.length >= 3);
  for (const r of rungs) {
    assert.equal(r.line, r.at - 0.5);
    assert.ok(nba.LADDERS.pts.includes(r.at));
    assert.ok(r.prob >= nba.DEFAULTS.ladderEdge && r.prob <= 1 - nba.DEFAULTS.ladderEdge);
    close(r.prob, nba.empiricalOver(20, r.line, pool));
  }
  for (let i = 1; i < rungs.length; i++) assert.ok(rungs[i].prob <= rungs[i - 1].prob);
  assert.deepEqual(nba.ladder("pts", 0, pool), []);
  assert.deepEqual(nba.ladder("pts", 20, null), []);
  assert.deepEqual(nba.ladder("nope", 20, pool), []);
});

test("recent rows: [YYMMDD, opp, min, pts, reb, ast, tpm, team] read back through the stat table", () => {
  const recent = [["261122", "DET", 34, 28, 9, 6, 4, "ATL"], ["261120", "BOS", 30, 12, 4, 2, 0, "ATL"]];
  assert.deepEqual(nba.recentValues("pts", recent), [28, 12]);
  assert.deepEqual(nba.recentValues("pra", recent), [43, 18]);
  assert.equal(nba.recentHits("pts", recent, 20), 1);
  assert.equal(nba.recentHits("tpm", recent, 4), 1, "N+ is cleared at N");
  assert.deepEqual(nba.recentValues("pts", null), []);
  assert.deepEqual(nba.recentRow("20261122", { min: 34, pts: 28, reb: 9, ast: 6, tpm: 4, team: "ATL" }, "DET"), recent[0]);
  assert.ok(Array.isArray(nba.RECENT_COLUMNS) && nba.RECENT_COLUMNS.every((c) => c.label && Number.isInteger(c.at)));
});

test("availability: out is void, day-to-day is flagged, anything else plays", () => {
  assert.equal(nba.availability("Out"), "out");
  assert.equal(nba.availability("Out For Season"), "out");
  assert.equal(nba.availability("Suspension"), "out");
  assert.equal(nba.availability("Doubtful"), "out");
  assert.equal(nba.availability("Day-To-Day"), "questionable");
  assert.equal(nba.availability("Questionable"), "questionable");
  assert.equal(nba.availability(""), "ok");
  assert.equal(nba.availability("Probable"), "ok");
  assert.equal(nba.availability("some new word"), "ok", "an unknown word is a row that may void, not a starter that vanishes");
});

test("parseRoster: a flat list of athletes with the team's code, his position and his latest listing", () => {
  const payload = { team: { abbreviation: "ATL" }, athletes: [
    { id: "1", displayName: "Healthy Guard", position: { abbreviation: "G" }, injuries: [] },
    { id: "2", fullName: "Hurt Forward", position: { abbreviation: "F" }, injuries: [
      { status: "Day-To-Day", date: "2026-11-01T00:00Z" }, { status: "Out", date: "2026-11-20T00:00Z" }, { status: "Active", date: "2026-11-22T00:00Z" }] },
    null, { displayName: "No Id" },
  ] };
  const r = nba.parseRoster(payload);
  assert.deepEqual(r, [
    { id: "1", name: "Healthy Guard", team: "ATL", pos: "G", listed: "", listedAt: "" },
    { id: "2", name: "Hurt Forward", team: "ATL", pos: "F", listed: "Out", listedAt: "2026-11-20T00:00Z" },
  ]);
  assert.deepEqual(nba.parseRoster({ athletes: [{ id: "1" }] }), [], "a roster that cannot say which team it is moves nobody");
});

test("terms: one short string that moves when any term a projection reads moves", () => {
  const base = nba.terms();
  assert.equal(typeof base, "string");
  assert.ok(base.length < 140, "it is written on every row of the record");
  for (const st of Object.values(nba.STATS)) for (const k of [st.decayKey, st.oppShrinkKey, st.kKey, st.priorKey, st.homeKey]) {
    assert.notEqual(nba.terms({ [k]: 0.123 }), base, `${k} is in it`);
  }
  assert.notEqual(nba.terms({ minDecay: null }), base);
  assert.equal(nba.bind({ ptsDecay: 0.5 }).terms(), nba.terms({ ptsDecay: 0.5 }));
});

test("bind: the same model under other constants, an explicit opts still winning", () => {
  const b = nba.bind({ ...PLAIN, ptsK: 0 });
  close(b.expectedStat("pts", steady(10)), 20);
  close(b.expectedStat("pts", steady(10), { ptsK: 10, ptsPrior: 0 }), 10);
  assert.equal(b.DEFAULTS.ptsK, 0);
  assert.equal(b.STATS, nba.STATS);
  close(b.bind({ ptsPrior: 0, ptsK: 10 }).expectedStat("pts", steady(10)), 10);
});

/* ------------------------------------------------------------------ *
 * Season lines, the walk and the pools: what the board and the replay share
 * ------------------------------------------------------------------ */

import { seasonLines, walk, poolEntries, gaveUp, seasonOf } from "./fetch-nba.mjs";

const pl = (id, team, min, pts, reb = 0, ast = 0, tpm = 0) => ({ id, name: "P" + id, team, min, pts, reb, ast, tpm });
const gm = (id, date, season, home, away, players, more = {}) => ({ id, date, season, type: 2, home: { team: home, score: 100 }, away: { team: away, score: 90 }, players, ...more });

test("seasonLines: a record is his games summed, on the team he last played for, the log oldest first whatever order the games arrive in", () => {
  const games = [
    gm("2", "2026-11-03T00:00Z", 2027, "BOS", "NY", [pl("a", "NY", 30, 20, 5, 4, 2), pl("b", "BOS", 20, 8)]),
    gm("1", "2026-11-01T00:00Z", 2027, "ATL", "BOS", [pl("a", "ATL", 34, 30, 6, 2, 3), pl("b", "BOS", 22, 10)]),
  ];
  const { players, teamFactors } = seasonLines(games, nba);
  const a = players.get("a");
  assert.equal(a.games, 2);
  assert.equal(a.team, "NY", "traded: the team of his latest game");
  assert.equal(a.pts, 50); assert.equal(a.min, 64); assert.equal(a.reb, 11); assert.equal(a.ast, 6); assert.equal(a.tpm, 5);
  assert.deepEqual(a.slog, [[34, 30, 6, 2, 3], [30, 20, 5, 4, 2]]);
  assert.deepEqual(a.last, "2026-11-03T00:00Z");
  for (const t of ["ATL", "BOS", "NY"]) assert.ok(teamFactors[t] && teamFactors[t].allow && isFinite(teamFactors[t].allow.pts));
});

test("seasonLines: a defence's allowance is what opponents did against it over the league's rate, regressed toward 1", () => {
  // SOFT gives up 40 a game to the one opposing player, HARD gives up 10; six games each way.
  const games = [];
  for (let i = 0; i < 6; i++) {
    games.push(gm("s" + i, `2026-11-${String(i + 1).padStart(2, "0")}T00:00Z`, 2027, "SOFT", "X", [pl("x", "X", 30, 40), pl("s", "SOFT", 30, 25)]));
    games.push(gm("h" + i, `2026-11-${String(i + 1).padStart(2, "0")}T01:00Z`, 2027, "HARD", "Y", [pl("y", "Y", 30, 10), pl("h", "HARD", 30, 25)]));
  }
  const { teamFactors } = seasonLines(games, nba);
  assert.ok(teamFactors.SOFT.allow.pts > 1.1, "more than the league");
  assert.ok(teamFactors.HARD.allow.pts < 0.9, "fewer than the league");
  assert.ok(teamFactors.SOFT.allow.pts < 40 / 25, "but regressed: six games are not the whole truth");
});

test("walk: each day sees only the games before it, from this season and last", () => {
  const games = [
    gm("old", "2024-11-01T00:00Z", 2025, "ATL", "BOS", [pl("a", "ATL", 30, 99)]),
    gm("g1", "2025-11-01T00:00Z", 2026, "ATL", "BOS", [pl("a", "ATL", 30, 10)]),
    gm("g2", "2026-11-01T23:30Z", 2027, "ATL", "BOS", [pl("a", "ATL", 30, 20)]),
    gm("g3", "2026-11-02T03:00Z", 2027, "LAL", "NY", [pl("z", "LAL", 30, 20)]), // 10pm Eastern on the 1st: the same slate
    gm("g4", "2026-11-03T00:30Z", 2027, "ATL", "NY", [pl("a", "ATL", 30, 30)]),
  ];
  const seen = [...walk(games, nba)].map((d) => ({ day: d.day, ids: d.games.map((g) => g.id), a: d.lines.players.get("a") }));
  assert.deepEqual(seen.map((d) => d.day), ["20241031", "20251031", "20261101", "20261102"]);
  assert.deepEqual(seen[2].ids, ["g2", "g3"], "a late tip belongs to the slate it started on");
  assert.equal(seen[0].a, undefined, "nothing before the first game");
  assert.equal(seen[2].a.pts, 10, "the 2024-25 game is two seasons back and out of the window; today's is not in yet");
  assert.equal(seen[3].a.pts, 30, "last season's game and this season's first");
  assert.equal(seen[3].a.games, 2);
  // `from` skips the days before it without changing what a later day sees.
  const late = [...walk(games, nba, { from: "20261102" })];
  assert.deepEqual(late.map((d) => d.day), ["20261102"]);
  assert.equal(late[0].lines.players.get("a").pts, 30);
});

test("poolEntries: actual over the projection made before the game, for players at the pool's floor with three games behind them", () => {
  const rows = (n, pts) => Array.from({ length: n }, () => [30, pts, 0, 0, 0]);
  const mk = (id, n, pts) => ({ id, games: n, min: 30 * n, pts: pts * n, reb: 0, ast: 0, tpm: 0, slog: rows(n, pts) });
  const lines = { players: new Map([["a", mk("a", 10, 20)], ["thin", mk("thin", 2, 20)], ["low", mk("low", 10, 1)]]), teamFactors: {} };
  const game = gm("g", "2026-11-05T00:00Z", 2027, "ATL", "BOS", [pl("a", "ATL", 30, 30), pl("thin", "ATL", 30, 30), pl("low", "BOS", 30, 3), pl("new", "BOS", 30, 12)]);
  const got = poolEntries("pts", game, lines, nba.bind(PLAIN));
  assert.equal(got.length, 1, "two games is not a line, one point a game is under the floor, and a debut has no projection");
  const exp = nba.bind(PLAIN).expectedStat("pts", lines.players.get("a"));
  close(got[0].exp, exp);
  close(got[0].ratio, 30 / exp);
});

test("gaveUp: a final game ESPN still has no box score for after three days is not asked for again", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  assert.equal(gaveUp({ date: "2026-05-23T00:00Z" }, now), true);
  assert.equal(gaveUp({ date: "2026-11-22T00:00Z" }, now), false, "yesterday's may only be late");
  assert.equal(gaveUp({ date: "" }, now), false);
});

test("seasonOf: a season is named for the year it ends in, and October starts the next", () => {
  assert.equal(seasonOf(new Date("2026-11-23T18:00:00Z")), 2027);
  assert.equal(seasonOf(new Date("2027-04-10T18:00:00Z")), 2027);
  assert.equal(seasonOf(new Date("2026-09-30T18:00:00Z")), 2026);
  assert.equal(seasonOf(new Date("2026-10-01T18:00:00Z")), 2027);
});

/* ------------------------------------------------------------------ *
 * The board file
 * ------------------------------------------------------------------ */

import { boardPayload, pickSlate, NBA } from "./fetch-nba.mjs";

/* Forty days of a four-team league, every team every other day, so pools and lines have something in them. */
function league4() {
  const games = [];
  const day = (i) => new Date(Date.UTC(2026, 9, 20 + i, 23, 30)).toISOString().replace(/:\d\d\.\d+Z$/, "Z");
  for (let i = 0; i < 34; i++) {
    const [h1, a1, h2, a2] = i % 2 ? ["ATL", "BOS", "NY", "LAL"] : ["BOS", "NY", "LAL", "ATL"];
    const side = (t, k) => [pl(t + "1", t, 34, 22 + ((i + k) % 7), 6, 5, 2), pl(t + "2", t, 20, 9 + ((i + k) % 3), 3, 2, 1)];
    games.push(gm("a" + i, day(i), 2027, h1, a1, [...side(h1, 0), ...side(a1, 1)]));
    games.push(gm("b" + i, day(i), 2027, h2, a2, [...side(h2, 2), ...side(a2, 3)]));
  }
  return games;
}
const NOW = new Date("2026-11-23T17:00:00Z");
const slate = [{ id: "s1", date: "2026-11-24T00:30Z", name: "New York Knicks at Atlanta Hawks", completed: false, state: "pre", home: "ATL", away: "NY", homeId: "1", awayId: "18", season: 2027, type: 2, kind: "STD" }];

test("boardPayload: tonight's games, the players on them with a line, the pools, and the terms it was built with", () => {
  const D = boardPayload({ history: { games: league4(), seasons: [2027] }, slate, day: "20261123", model: nba, now: NOW });
  assert.equal(D.date, "2026-11-23");
  assert.equal(D.season, 2027);
  assert.equal(D.generated, NOW.toISOString());
  assert.deepEqual(D.games.map((g) => [g.id, g.home, g.away, g.date]), [["s1", "ATL", "NY", "2026-11-24T00:30Z"]]);
  assert.deepEqual([...new Set(D.players.map((p) => p.team))].sort(), ["ATL", "NY"], "only the teams playing tonight");
  const p = D.players.find((x) => x.id === "ATL1");
  assert.equal(p.opp, "NY");
  assert.equal(p.home, true);
  assert.equal(D.players.find((x) => x.id === "NY1").home, false);
  assert.equal(p.games, 34);
  assert.ok(p.recent.length <= NBA.recentGames && p.recent[0][0] > p.recent[1][0], "recent rows, newest first");
  assert.equal(p.slog, undefined, "the log stays out of the file; the weighted totals stand in");
  assert.ok(p.w && isFinite(p.w.pts) && isFinite(p.w.min.pts));
  for (const stat of Object.keys(nba.STATS)) {
    assert.equal(D.pools[stat].stat, stat);
    assert.ok(nba.poolSize(D.pools[stat]) > 0, `${stat} pool is filled`);
  }
  assert.deepEqual(D.model, { terms: nba.terms() });
  assert.ok(D.teamFactors.NY.allow.pts > 0);
});

test("boardPayload: the board's number is the replay's number, the log or the file", () => {
  const games = league4();
  const D = boardPayload({ history: { games }, slate, day: "20261123", model: nba, now: NOW });
  const p = D.players.find((x) => x.id === "ATL1");
  const full = seasonLines(games, nba).players.get("ATL1");
  for (const stat of Object.keys(nba.STATS)) {
    const ctx = { oppFactor: nba.allowOf(D.teamFactors, p.opp, stat) };
    const a = nba.statEligible(stat, p, null, ctx), b = nba.statEligible(stat, full, null, ctx);
    assert.ok(a && b, `${stat} is offered either way`);
    close(a.exp, b.exp, 0.01);
  }
});

test("boardPayload: the roster places him, the report lists him, a long absence leaves him off", () => {
  const games = league4();
  // ATL2 was traded to NY; NY2 is out; BOS plays nobody tonight. LAL1 has not played in his team's last six.
  const roster = new Map([["ATL1", { id: "ATL1", team: "ATL", pos: "G" }], ["ATL2", { id: "ATL2", team: "NY", pos: "F" }], ["NY1", { id: "NY1", team: "NY", pos: "C" }], ["NY2", { id: "NY2", team: "NY", pos: "G" }]]);
  const injuries = { NY2: { name: "PNY2", team: "NY", pos: "G", status: "Out", detail: "Knee" }, NY1: { name: "PNY1", team: "NY", pos: "C", status: "Day-To-Day", detail: "Ankle" } };
  const D = boardPayload({ history: { games }, slate, day: "20261123", model: nba, now: NOW, roster, injuries });
  const by = Object.fromEntries(D.players.map((p) => [p.id, p]));
  assert.equal(by.ATL2.team, "NY"); assert.equal(by.ATL2.movedFrom, "ATL"); assert.equal(by.ATL2.opp, "ATL"); assert.equal(by.ATL2.pos, "F");
  assert.equal(by.NY2.status, "Out"); assert.equal(by.NY2.injury, "Knee");
  assert.equal(by.NY1.status, "Day-To-Day");
  assert.equal(by.ATL1.status, undefined, "nothing is written that a source did not say");
  // Six more ATL games without ATL1: he is not in the rotation today.
  const more = games.slice();
  for (let i = 0; i < 6; i++) more.push(gm("x" + i, `2026-11-23T0${i}:00Z`, 2027, "ATL", "BOS", [pl("ATL2", "ATL", 30, 12, 3, 2, 1), pl("BOS1", "BOS", 30, 20)]));
  const D2 = boardPayload({ history: { games: more }, slate, day: "20261123", model: nba, now: NOW });
  assert.equal(D2.players.some((p) => p.id === "ATL1"), false, "absent from his team's last six games");
  assert.equal(D2.players.some((p) => p.id === "ATL2"), true);
});

test("boardPayload: no slate is an empty board, not a missing one", () => {
  const D = boardPayload({ history: { games: league4() }, slate: [], day: "20261123", model: nba, now: NOW });
  assert.deepEqual(D.games, []);
  assert.deepEqual(D.players, []);
  assert.ok(D.pools.pts);
});

test("pickSlate: the first day with a game still to tip; a finished night gives way to the next", () => {
  const done = [{ id: "1", completed: true, state: "post" }], live = [{ id: "2", completed: false, state: "in" }], pre = [{ id: "3", completed: false, state: "pre" }];
  assert.deepEqual(pickSlate([["20261123", pre]]), { day: "20261123", games: pre });
  assert.deepEqual(pickSlate([["20261123", done], ["20261124", pre]]), { day: "20261124", games: pre });
  assert.deepEqual(pickSlate([["20261123", live.concat(pre)], ["20261124", pre]]).day, "20261123", "a night under way with a game still to tip is tonight");
  assert.deepEqual(pickSlate([["20261123", live], ["20261124", []]]), { day: "20261123", games: live }, "nothing ahead: the last day seen, so the page shows what just happened");
  assert.equal(pickSlate([]), null);
});

/* ------------------------------------------------------------------ *
 * The record: the shared tracker, told which league
 * ------------------------------------------------------------------ */

import { playerRows, propsFor, settlePlayer, ladderSummary, predKey } from "./track-football.mjs";
import * as trackCore from "./track-core.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("propsFor: the NBA record reports its five props and nothing football-shaped", () => {
  assert.deepEqual(propsFor(nba).map((p) => p.id), ["pts", "reb", "ast", "tpm", "pra"]);
  const ids = propsFor(nfl).map((p) => p.id);
  assert.equal(ids[0], "td");
  assert.deepEqual(ids.slice(-4), ["spread", "total", "ml", "mlLine"]);
});

test("playerRows: one row a prop the board offers, at the board's line, with the ladder it shows", () => {
  const D = boardPayload({ history: { games: league4() }, slate, day: "20261123", model: nba, now: NOW });
  const g = D.games[0], p = D.players.find((x) => x.id === "ATL1");
  const rows = playerRows(nba, D, p, g);
  assert.deepEqual(rows.map((r) => r.prop).sort(), ["ast", "pra", "pts", "reb", "tpm"]);
  for (const r of rows) {
    const y = nba.statEligible(r.prop, p, null, { oppFactor: nba.allowOf(D.teamFactors, p.opp, r.prop) });
    assert.equal(r.line, nba.lineFor(y.exp), "the projection line the page prints");
    close(r.prob, nba.empiricalOver(y.exp, r.line, D.pools[r.prop]), 1e-4);
    assert.equal(r.gameId, "s1"); assert.equal(r.playerId, "ATL1"); assert.equal(r.kickoff, g.date);
    assert.equal(r.key, predKey(r));
    const offered = nba.ladder(r.prop, y.exp, D.pools[r.prop]).map((x) => String(x.at));
    assert.deepEqual(Object.keys(r.ladder || {}), offered, "exactly the rungs the page shows");
  }
  // A player the gate refuses has no rows: the record never holds a bet the board did not offer.
  assert.deepEqual(playerRows(nba, D, { ...p, games: 2 }, g), []);
});

test("settlePlayer: the over of a half line off the box score, the sum settled on all three", () => {
  const line = { min: 30, pts: 21, reb: 7, ast: 4, tpm: 3 };
  assert.equal(settlePlayer({ prop: "pts", line: 20.5 }, line, nba), 1);
  assert.equal(settlePlayer({ prop: "pts", line: 21.5 }, line, nba), 0);
  assert.equal(settlePlayer({ prop: "pra", line: 31.5 }, line, nba), 1);
  assert.equal(settlePlayer({ prop: "pra", line: 32.5 }, line, nba), 0);
  assert.equal(settlePlayer({ prop: "recyds", line: 1.5 }, line, nba), null, "not this league's prop");
  // The league's own box score, by athlete id, and what a graded row keeps of it.
  const lines = NBA.boxScoreLines(summary());
  assert.equal(lines.get("4432166").played, true);
  assert.equal(lines.has("4397882"), false, "did not play: the row is scratched, not lost");
  assert.deepEqual(NBA.resultOf(lines.get("4432166")), { min: 33, pts: 5, reb: 4, ast: 15, tpm: 1 });
});

test("ladderSummary: a graded row becomes one outcome a rung, settled by the same rule", () => {
  const dir = mkdtempSync(join(tmpdir(), "nba-record-"));
  try {
    trackCore.saveDay(dir, { date: "2026-11-23", graded: true, predictions: [
      { gameId: "g", playerId: "1", prop: "pts", line: 20.5, prob: 0.5, actual: 1, result: { min: 30, pts: 21, reb: 7, ast: 4, tpm: 3 }, ladder: { 15: 0.8, 20: 0.55, 25: 0.3 } },
      { gameId: "g", playerId: "2", prop: "pts", line: 10.5, prob: 0.5, ladder: { 10: 0.6 } }, // not graded yet
    ] });
    const s = ladderSummary(dir, nba);
    assert.equal(s.all.n, 3);
    assert.deepEqual(s.stats.pts.rungs.map((r) => [r.rung, r.actual]), [[15, 100], [20, 100], [25, 0]]);
    assert.equal(s.stats.pts.label, "Points");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the home side reaches the board's and the tracker's projection, so a home term that ships moves all three alike", () => {
  const D = boardPayload({ history: { games: league4() }, slate, day: "20261123", model: nba, now: NOW });
  const withHome = nba.bind({ ptsHome: 0.05 });
  const p = D.players.find((x) => x.id === "ATL1"), g = D.games[0];
  const row = playerRows(withHome, D, p, g).find((r) => r.prop === "pts");
  const y = withHome.statEligible("pts", p, null, { oppFactor: nba.allowOf(D.teamFactors, p.opp, "pts"), home: true });
  assert.equal(row.line, withHome.lineFor(y.exp), "the tracker passed the side the data file names");
  assert.ok(y.exp > nba.statEligible("pts", p, null, { oppFactor: nba.allowOf(D.teamFactors, p.opp, "pts") }).exp);
});

test("recent rows carry the league's day: a 10pm Eastern tip is not printed a day late", () => {
  const games = league4();
  games.push(gm("late", "2026-11-23T03:00Z", 2027, "ATL", "NY", [pl("ATL1", "ATL", 30, 20, 5, 5, 2), pl("NY1", "NY", 30, 20, 5, 5, 2)]));
  const D = boardPayload({ history: { games }, slate, day: "20261123", model: nba, now: NOW });
  assert.equal(D.players.find((x) => x.id === "ATL1").recent[0][0], "261122");
});
