/*
 * BetHouse — bets.test.mjs
 * Run with:  node --test
 *
 * The bet log is the one place in this project where the data is the user's
 * own claim rather than something measured, so the rules that keep it honest
 * live here: a grade is never overwritten, an ungraded pick never counts
 * toward a record, and expectation is summed over the SAME picks that were
 * graded so the two numbers are comparable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import bets from "./bets.js";

const pick = (over = {}) => ({
  gamePk: 823342,
  playerId: 690993,
  prop: "hrr",
  name: "Colt Keith",
  team: "DET",
  prob: 0.73,
  date: "2026-08-19",
  ...over,
});

/* ---------------------------------------------------------------- *
 * Identity
 * ---------------------------------------------------------------- */

test("keyOf: a pick is one player, one game, one prop", () => {
  assert.equal(bets.keyOf(pick()), "823342|690993|hrr");
  /* The same hitter on two props is two bets, not one. */
  assert.notEqual(bets.keyOf(pick()), bets.keyOf(pick({ prop: "tb2" })));
  /* And the same hitter in a doubleheader is two bets. */
  assert.notEqual(bets.keyOf(pick()), bets.keyOf(pick({ gamePk: 823343 })));
});

test("keyOf: refuses a pick it cannot identify", () => {
  for (const bad of [null, undefined, {}, { gamePk: 1 }, { gamePk: 1, playerId: 2 }]) {
    assert.equal(bets.keyOf(bad), null);
  }
});

/* ---------------------------------------------------------------- *
 * Adding and removing
 * ---------------------------------------------------------------- */

test("add: tapping the same player twice does not log two bets", () => {
  const one = bets.add([], pick());
  assert.equal(one.length, 1);
  assert.equal(bets.add(one, pick()).length, 1);
});

test("add: an unidentifiable pick is dropped, not stored half-formed", () => {
  assert.deepEqual(bets.add([], { name: "nobody" }), []);
  assert.deepEqual(bets.add([], null), []);
});

test("add: does not mutate the list it was given", () => {
  const before = [];
  const after = bets.add(before, pick());
  assert.equal(before.length, 0);
  assert.equal(after.length, 1);
});

test("remove: takes out one bet and leaves the rest", () => {
  let list = bets.add(bets.add([], pick()), pick({ prop: "tb2" }));
  assert.equal(list.length, 2);
  list = bets.remove(list, "823342|690993|hrr");
  assert.equal(list.length, 1);
  assert.equal(list[0].prop, "tb2");
  /* Removing something that is not there is not an error. */
  assert.equal(bets.remove(list, "nope").length, 1);
});

test("has: answers for the exact bet, not the player", () => {
  const list = bets.add([], pick());
  assert.equal(bets.has(list, "823342|690993|hrr"), true);
  assert.equal(bets.has(list, "823342|690993|tb2"), false);
});

/* ---------------------------------------------------------------- *
 * Grading
 * ---------------------------------------------------------------- */

test("resultsFrom: reads a graded history day into key -> outcome", () => {
  const day = {
    date: "2026-08-19",
    predictions: [
      { gamePk: 1, playerId: 10, prop: "hrr", actual: 1 },
      { gamePk: 1, playerId: 11, prop: "hrr", actual: 0 },
      { gamePk: 1, playerId: 12, prop: "hrr" }, // not graded yet
    ],
  };
  assert.deepEqual(bets.resultsFrom(day), { "1|10|hrr": 1, "1|11|hrr": 0 });
});

test("resultsFrom: a malformed or empty day yields nothing, never throws", () => {
  for (const bad of [null, undefined, {}, { predictions: null }, { predictions: [] }]) {
    assert.deepEqual(bets.resultsFrom(bad), {});
  }
});

test("applyResults: fills in an outcome and leaves everything else alone", () => {
  const list = bets.add([], pick());
  const out = bets.applyResults(list, { "823342|690993|hrr": 1 });
  assert.equal(out[0].actual, 1);
  assert.equal(out[0].name, "Colt Keith");
  assert.equal(out[0].prob, 0.73);
});

test("applyResults: a grade already recorded is never overwritten", () => {
  /* Same rule track.mjs enforces on the model: the first grade stands.
     A history file that is later rebuilt must not be able to rewrite a
     loss into a win in someone's record. */
  const list = bets.applyResults(bets.add([], pick()), { "823342|690993|hrr": 0 });
  const again = bets.applyResults(list, { "823342|690993|hrr": 1 });
  assert.equal(again[0].actual, 0);
});

test("applyResults: an outcome for a bet you do not hold is ignored", () => {
  const list = bets.add([], pick());
  const out = bets.applyResults(list, { "999|999|hr": 1 });
  assert.equal(out.length, 1);
  assert.equal(out[0].actual, undefined);
});

test("ungradedDates: only days that still have something to settle", () => {
  let list = bets.add([], pick({ date: "2026-08-17" }));
  list = bets.add(list, pick({ date: "2026-08-18", playerId: 2 }));
  list = bets.add(list, pick({ date: "2026-08-18", playerId: 3 }));
  list = bets.applyResults(list, { "823342|2|hrr": 1, "823342|3|hrr": 0 });

  /* 08-18 is fully settled; 08-17 is not. */
  assert.deepEqual(bets.ungradedDates(list), ["2026-08-17"]);
});

test("ungradedDates: newest first, so the most interesting day is fetched first", () => {
  let list = bets.add([], pick({ date: "2026-08-17" }));
  list = bets.add(list, pick({ date: "2026-08-19", playerId: 2 }));
  list = bets.add(list, pick({ date: "2026-08-18", playerId: 3 }));
  assert.deepEqual(bets.ungradedDates(list), ["2026-08-19", "2026-08-18", "2026-08-17"]);
});

/* ---------------------------------------------------------------- *
 * The record
 * ---------------------------------------------------------------- */

test("summarise: expectation is summed over the graded picks only", () => {
  /* The whole point of the comparison. Counting a pending 90% bet toward
     "expected" while it cannot yet count toward "hit" would make every
     open slate look like a losing one. */
  let list = bets.add([], pick({ playerId: 1, prob: 0.8 }));
  list = bets.add(list, pick({ playerId: 2, prob: 0.6 }));
  list = bets.add(list, pick({ playerId: 3, prob: 0.9 })); // stays pending
  list = bets.applyResults(list, { "823342|1|hrr": 1, "823342|2|hrr": 0 });

  const s = bets.summarise(list);
  assert.equal(s.tracked, 3);
  assert.equal(s.graded, 2);
  assert.equal(s.pending, 1);
  assert.equal(s.hits, 1);
  assert.ok(Math.abs(s.expected - 1.4) < 1e-9, `expected 1.4, got ${s.expected}`);
});

test("summarise: nothing graded yet is reported as nothing, not as zero-for-zero", () => {
  const s = bets.summarise(bets.add([], pick()));
  assert.equal(s.graded, 0);
  assert.equal(s.hits, 0);
  assert.equal(s.expected, 0);
  /* hitRate is null rather than NaN or 0: "no record yet" and "a record of
     zero" are different claims and the page has to be able to tell them
     apart before it writes a sentence. */
  assert.equal(s.hitRate, null);
});

test("summarise: an empty log is empty, not an error", () => {
  const s = bets.summarise([]);
  assert.equal(s.tracked, 0);
  assert.equal(s.hitRate, null);
  assert.deepEqual(s.byProp, {});
});

test("summarise: splits by prop, because they are different bets", () => {
  let list = bets.add([], pick({ playerId: 1, prop: "hrr", prob: 0.8 }));
  list = bets.add(list, pick({ playerId: 2, prop: "hr", prob: 0.12 }));
  list = bets.applyResults(list, { "823342|1|hrr": 1, "823342|2|hr": 0 });

  const s = bets.summarise(list);
  assert.equal(s.byProp.hrr.graded, 1);
  assert.equal(s.byProp.hrr.hits, 1);
  assert.equal(s.byProp.hr.graded, 1);
  assert.equal(s.byProp.hr.hits, 0);
});

/* ---------------------------------------------------------------- *
 * Storage round-trip
 * ---------------------------------------------------------------- */

test("parse: junk in storage yields an empty log rather than a dead board", () => {
  /* A throw here would take the whole page down, which is exactly how a
     stale score.js blanked the board during QA. Corrupt local data must
     cost the user their log, never the site. */
  for (const junk of ["", "{", "null", '"a string"', "{}", "[1,2,3]", '[{"no":"key"}]']) {
    assert.deepEqual(bets.parse(junk), []);
  }
});

test("parse: reads back exactly what serialise wrote", () => {
  let list = bets.add([], pick());
  list = bets.applyResults(list, { "823342|690993|hrr": 1 });
  assert.deepEqual(bets.parse(bets.serialise(list)), list);
});

test("parse: drops entries it cannot identify but keeps the rest", () => {
  const good = bets.add(bets.add([], pick()), pick({ playerId: 2 }));
  const mixed = JSON.stringify([good[0], { name: "junk" }, good[1]]);
  assert.equal(bets.parse(mixed).length, 2);
});

test("parse: rejects an entry whose stored key contradicts its own fields", () => {
  /* Storage is a file the user can edit. A key that does not match the
     gamePk/playerId/prop beside it means the entry was tampered with or
     half-written, and grading it would attach someone else's outcome. */
  const [b] = bets.add([], pick());
  const forged = JSON.stringify([Object.assign({}, b, { key: "1|1|hrr" })]);
  assert.deepEqual(bets.parse(forged), []);
});

test("importing hand-written JSON normalises through add", () => {
  /* parse is strict because it guards internal storage. An exported file
     someone has edited by hand will not carry a key, so import rebuilds
     each entry rather than demanding one. */
  const raw = [pick(), { name: "junk" }, pick({ playerId: 2, actual: 1 })];
  const list = raw.reduce((acc, r) => bets.add(acc, r), []);
  assert.equal(list.length, 2);
  assert.equal(bets.parse(bets.serialise(list)).length, 2);
});

test("add: carries an outcome through when one is offered", () => {
  /* Only import supplies this. A tap from the board cannot: the game has
     not started, which is rule 1. */
  const [b] = bets.add([], pick({ actual: 1, gradedAt: "2026-08-19T23:00:00.000Z" }));
  assert.equal(b.actual, 1);
  assert.equal(b.gradedAt, "2026-08-19T23:00:00.000Z");
});

test("an exported log survives a round trip through import with its grades", () => {
  let list = bets.add(bets.add([], pick({ playerId: 1 })), pick({ playerId: 2 }));
  list = bets.applyResults(list, { "823342|1|hrr": 1, "823342|2|hrr": 0 });
  const before = bets.summarise(list);

  const reimported = JSON.parse(bets.serialise(list)).reduce((a, r) => bets.add(a, r), []);
  const after = bets.summarise(reimported);

  assert.equal(after.graded, before.graded);
  assert.equal(after.hits, before.hits);
  assert.equal(after.expected, before.expected);
});

test("summarise: reports the spread you would expect from chance alone", () => {
  /* Without this the panel can only say "you hit 9, the model said 8.6",
     which invites reading a 0.4 gap as skill. Each bet is its own coin with
     its own bias, so the variance of the total is the sum of p(1-p) and the
     board can say whether the gap is inside the noise. Same standard the
     rest of the project holds itself to. */
  let list = bets.add([], pick({ playerId: 1, prob: 0.5 }));
  list = bets.add(list, pick({ playerId: 2, prob: 0.5 }));
  list = bets.add(list, pick({ playerId: 3, prob: 0.5 }));
  list = bets.add(list, pick({ playerId: 4, prob: 0.5 }));
  list = bets.applyResults(list, {
    "823342|1|hrr": 1, "823342|2|hrr": 1, "823342|3|hrr": 0, "823342|4|hrr": 0,
  });

  const s = bets.summarise(list);
  // four coins at p=0.5: variance 4 * 0.25 = 1, so sd = 1
  assert.ok(Math.abs(s.sd - 1) < 1e-9, `expected sd 1, got ${s.sd}`);
});

test("summarise: a certainty contributes no spread, and nothing graded has none", () => {
  let list = bets.add([], pick({ playerId: 1, prob: 1 }));
  list = bets.applyResults(list, { "823342|1|hrr": 1 });
  assert.equal(bets.summarise(list).sd, 0);
  assert.equal(bets.summarise([]).sd, 0);
});

test("summarise: pending bets add no spread, matching expected", () => {
  /* sd must cover exactly the bets that expected covers, or the z it feeds
     is comparing two different sets. */
  let list = bets.add([], pick({ playerId: 1, prob: 0.5 }));
  list = bets.add(list, pick({ playerId: 2, prob: 0.5 })); // pending
  list = bets.applyResults(list, { "823342|1|hrr": 1 });
  assert.ok(Math.abs(bets.summarise(list).sd - 0.5) < 1e-9);
});
