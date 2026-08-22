/*
 * BetHouse — bets.test.mjs
 * Run with:  node --test
 *
 * The bet log is the one place in this project where the data is the user's
 * own claim rather than something measured, so the rules that keep it honest
 * live here: a grade is never overwritten, an ungraded bet never counts
 * toward a record, and expectation is summed over the SAME bets that were
 * graded so the two numbers are comparable.
 *
 * A SINGLE IS A PARLAY WITH ONE LEG. Everything below is written against
 * that, because the alternative — two shapes, two grading paths, two
 * summaries — is two of everything that can disagree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import bets from "./bets.js";

const leg = (over = {}) => ({
  gamePk: 823342,
  playerId: 690993,
  prop: "hrr",
  propLabel: "1+ H/R/RBI",
  name: "Colt Keith",
  team: "DET",
  prob: 0.73,
  ...over,
});

const single = (over = {}) => bets.single(leg(over), "2026-08-19");
const parlay = (legs, date = "2026-08-19") =>
  bets.parlay(legs, legs.reduce((a, l) => a * l.prob, 1), date);

/* ---------------------------------------------------------------- *
 * Identity
 * ---------------------------------------------------------------- */

test("legKey: one leg is one player, one game, one prop", () => {
  assert.equal(bets.legKey(leg()), "823342|690993|hrr");
  /* The same hitter on two props is two legs, and a doubleheader is two games. */
  assert.notEqual(bets.legKey(leg()), bets.legKey(leg({ prop: "tb2" })));
  assert.notEqual(bets.legKey(leg()), bets.legKey(leg({ gamePk: 823343 })));
});

test("legKey: refuses a leg it cannot identify", () => {
  for (const bad of [null, undefined, {}, { gamePk: 1 }, { gamePk: 1, playerId: 2 }]) {
    assert.equal(bets.legKey(bad), null);
  }
});

test("keyOf: a bet is the set of its legs, whatever order they went in", () => {
  const a = parlay([leg({ playerId: 1 }), leg({ playerId: 2 }), leg({ playerId: 3 })]);
  const b = parlay([leg({ playerId: 3 }), leg({ playerId: 1 }), leg({ playerId: 2 })]);
  assert.equal(bets.keyOf(a), bets.keyOf(b));
  /* Reordering the slip is not a different wager, so tapping "bet this"
     on the same three legs twice must not log two parlays. */
  assert.equal(bets.add(bets.add([], a), b).length, 1);
});

test("keyOf: a single and a parlay containing it are different bets", () => {
  const one = single({ playerId: 1 });
  const two = parlay([leg({ playerId: 1 }), leg({ playerId: 2 })]);
  assert.notEqual(bets.keyOf(one), bets.keyOf(two));
});

test("keyOf: refuses a bet with no legs, or a leg it cannot identify", () => {
  for (const bad of [null, {}, { legs: [] }, { legs: null }, { legs: [{ gamePk: 1 }] }]) {
    assert.equal(bets.keyOf(bad), null);
  }
});

/* ---------------------------------------------------------------- *
 * Building
 * ---------------------------------------------------------------- */

test("single: is a one-leg bet at that leg's own probability", () => {
  const b = single();
  assert.equal(b.legs.length, 1);
  assert.equal(b.prob, 0.73);
  assert.equal(b.legs[0].name, "Colt Keith");
});

test("parlay: carries the combined probability it was shown at, not a recomputation", () => {
  /* The slip prints a combined number and you bet on the strength of it.
     Storing that, rather than recomputing later from legs whose model
     numbers have since moved, is what makes the comparison mean anything. */
  const b = bets.parlay(
    [leg({ playerId: 1, prob: 0.8 }), leg({ playerId: 2, prob: 0.5 })],
    0.4,
    "2026-08-19",
  );
  assert.equal(b.legs.length, 2);
  assert.ok(Math.abs(b.prob - 0.4) < 1e-12);
});

test("add: does not mutate the list it was given", () => {
  const before = [];
  assert.equal(bets.add(before, single()).length, 1);
  assert.equal(before.length, 0);
});

test("add: an unidentifiable bet is dropped, not stored half-formed", () => {
  assert.deepEqual(bets.add([], null), []);
  assert.deepEqual(bets.add([], { legs: [{ name: "nobody" }] }), []);
});

test("remove: takes out one bet and leaves the rest", () => {
  let list = bets.add(bets.add([], single()), parlay([leg({ playerId: 1 }), leg({ playerId: 2 })]));
  assert.equal(list.length, 2);
  list = bets.remove(list, bets.keyOf(single()));
  assert.equal(list.length, 1);
  assert.equal(list[0].legs.length, 2);
});

test("has: answers for the exact bet, not the player", () => {
  const list = bets.add([], single());
  assert.equal(bets.has(list, bets.keyOf(single())), true);
  assert.equal(bets.has(list, bets.keyOf(single({ prop: "tb2" }))), false);
});

/* ---------------------------------------------------------------- *
 * Settling
 *
 * The rule that makes a parlay a parlay.
 * ---------------------------------------------------------------- */

test("a parlay dies on the first missed leg, without waiting for the rest", () => {
  /* A 3.05pm leg that misses has already decided a slip whose other legs
     are 10pm starts. Showing it as OPEN for another seven hours would be
     withholding a result the board already knows. */
  const b = parlay([leg({ playerId: 1 }), leg({ playerId: 2 }), leg({ playerId: 3 })]);
  const out = bets.applyResults(bets.add([], b), { "823342|2|hrr": 0 });
  assert.equal(out[0].actual, 0);
});

test("a parlay pays only when every leg is in and every leg hit", () => {
  const b = parlay([leg({ playerId: 1 }), leg({ playerId: 2 })]);
  let list = bets.applyResults(bets.add([], b), { "823342|1|hrr": 1 });
  assert.equal(list[0].actual, undefined, "one leg home is not a win yet");

  list = bets.applyResults(list, { "823342|2|hrr": 1 });
  assert.equal(list[0].actual, 1);
});

test("a leg outcome is recorded even while the parlay is still open", () => {
  /* So the panel can show "2 of 3 legs in" rather than a silent OPEN. */
  const b = parlay([leg({ playerId: 1 }), leg({ playerId: 2 })]);
  const list = bets.applyResults(bets.add([], b), { "823342|1|hrr": 1 });
  assert.equal(list[0].legs[0].actual, 1);
  assert.equal(list[0].legs[1].actual, undefined);
});

test("a single settles exactly like a one-leg parlay", () => {
  const hit = bets.applyResults(bets.add([], single()), { "823342|690993|hrr": 1 });
  assert.equal(hit[0].actual, 1);
  const miss = bets.applyResults(bets.add([], single()), { "823342|690993|hrr": 0 });
  assert.equal(miss[0].actual, 0);
});

test("applyResults: a grade already recorded is never overwritten", () => {
  /* Same rule track.mjs enforces on the model. Rebuilding a history file
     must not be able to turn a loss into a win in someone's record. */
  const list = bets.applyResults(bets.add([], single()), { "823342|690993|hrr": 0 });
  const again = bets.applyResults(list, { "823342|690993|hrr": 1 });
  assert.equal(again[0].actual, 0);
});

test("applyResults: an outcome for a bet you do not hold is ignored", () => {
  const out = bets.applyResults(bets.add([], single()), { "999|999|hr": 1 });
  assert.equal(out.length, 1);
  assert.equal(out[0].actual, undefined);
});

test("resultsFrom: reads a graded history day into leg key -> outcome", () => {
  const day = {
    predictions: [
      { gamePk: 1, playerId: 10, prop: "hrr", actual: 1 },
      { gamePk: 1, playerId: 11, prop: "hrr", actual: 0 },
      { gamePk: 1, playerId: 12, prop: "hrr" },
    ],
  };
  assert.deepEqual(bets.resultsFrom(day), { "1|10|hrr": 1, "1|11|hrr": 0 });
});

test("resultsFrom: a malformed or empty day yields nothing, never throws", () => {
  for (const bad of [null, undefined, {}, { predictions: null }, { predictions: [] }]) {
    assert.deepEqual(bets.resultsFrom(bad), {});
  }
});

test("ungradedDates: only days that still have something to settle, newest first", () => {
  let list = bets.add([], bets.single(leg(), "2026-08-17"));
  list = bets.add(list, bets.single(leg({ playerId: 2 }), "2026-08-19"));
  list = bets.add(list, bets.single(leg({ playerId: 3 }), "2026-08-18"));
  assert.deepEqual(bets.ungradedDates(list), ["2026-08-19", "2026-08-18", "2026-08-17"]);

  list = bets.applyResults(list, { "823342|2|hrr": 1 });
  assert.deepEqual(bets.ungradedDates(list), ["2026-08-18", "2026-08-17"]);
});

/* ---------------------------------------------------------------- *
 * The record
 * ---------------------------------------------------------------- */

test("summarise: expectation and spread cover exactly the graded bets", () => {
  let list = bets.add([], single({ playerId: 1, prob: 0.8 }));
  list = bets.add(list, single({ playerId: 2, prob: 0.6 }));
  list = bets.add(list, single({ playerId: 3, prob: 0.9 })); // stays pending
  list = bets.applyResults(list, { "823342|1|hrr": 1, "823342|2|hrr": 0 });

  const s = bets.summarise(list);
  assert.equal(s.tracked, 3);
  assert.equal(s.graded, 2);
  assert.equal(s.pending, 1);
  assert.equal(s.hits, 1);
  assert.ok(Math.abs(s.expected - 1.4) < 1e-9);
  // variance 0.8*0.2 + 0.6*0.4 = 0.16 + 0.24 = 0.4
  assert.ok(Math.abs(s.sd - Math.sqrt(0.4)) < 1e-9);
});

test("summarise: a parlay counts once, at its combined number", () => {
  /* Not once per leg. A three-leg slip is one wager that wins or loses
     whole, so it contributes one outcome and one expectation. */
  const p = bets.parlay(
    [leg({ playerId: 1 }), leg({ playerId: 2 }), leg({ playerId: 3 })],
    0.4,
    "2026-08-19",
  );
  const list = bets.applyResults(bets.add([], p), {
    "823342|1|hrr": 1, "823342|2|hrr": 1, "823342|3|hrr": 1,
  });
  const s = bets.summarise(list);
  assert.equal(s.graded, 1);
  assert.equal(s.hits, 1);
  assert.ok(Math.abs(s.expected - 0.4) < 1e-9);
});

test("summarise: singles and parlays are counted apart as well as together", () => {
  /* An 81% single and a 40% three-leg slip are not the same kind of bet,
     and a combined hit rate hides which one is carrying the record. */
  let list = bets.add([], single({ playerId: 1, prob: 0.8 }));
  list = bets.add(list, bets.parlay([leg({ playerId: 2 }), leg({ playerId: 3 })], 0.4, "2026-08-19"));
  list = bets.applyResults(list, {
    "823342|1|hrr": 1, "823342|2|hrr": 1, "823342|3|hrr": 0,
  });

  const s = bets.summarise(list);
  assert.equal(s.singles.graded, 1);
  assert.equal(s.singles.hits, 1);
  assert.equal(s.parlays.graded, 1);
  assert.equal(s.parlays.hits, 0);
  assert.equal(s.graded, 2);
  assert.equal(s.hits, 1);
});

test("summarise: nothing graded yet is reported as nothing, not as zero-for-zero", () => {
  const s = bets.summarise(bets.add([], single()));
  assert.equal(s.graded, 0);
  assert.equal(s.hitRate, null);
});

test("summarise: an empty log is empty, not an error", () => {
  const s = bets.summarise([]);
  assert.equal(s.tracked, 0);
  assert.equal(s.hitRate, null);
  assert.equal(s.sd, 0);
  assert.equal(s.sharedLegs, 0);
});

test("summarise: a certainty contributes no spread", () => {
  let list = bets.add([], single({ playerId: 1, prob: 1 }));
  list = bets.applyResults(list, { "823342|1|hrr": 1 });
  assert.equal(bets.summarise(list).sd, 0);
});

/* ---------------------------------------------------------------- *
 * The spread assumes bets do not overlap. Say so when they do.
 * ---------------------------------------------------------------- */

test("summarise: notices when the same leg is riding in more than one bet", () => {
  /* Adding variances assumes the bets are independent of each other. Bet a
     single on a hitter AND a parlay containing him and they are anything
     but, so the spread is understated and the panel has to admit it. */
  let list = bets.add([], single({ playerId: 1 }));
  list = bets.add(list, bets.parlay([leg({ playerId: 1 }), leg({ playerId: 2 })], 0.4, "2026-08-19"));
  assert.equal(bets.summarise(list).sharedLegs, 1);
});

test("summarise: distinct bets on distinct players share nothing", () => {
  let list = bets.add([], single({ playerId: 1 }));
  list = bets.add(list, single({ playerId: 2 }));
  assert.equal(bets.summarise(list).sharedLegs, 0);
});

/* ---------------------------------------------------------------- *
 * Storage
 * ---------------------------------------------------------------- */

test("parse: junk in storage yields an empty log rather than a dead board", () => {
  /* A throw here would take the whole page down, which is exactly how a
     stale script blanked the board during QA. Corrupt local data must cost
     the user their log, never the site. */
  for (const junk of ["", "{", "null", '"a string"', "{}", "[1,2,3]", '[{"no":"legs"}]']) {
    assert.deepEqual(bets.parse(junk), []);
  }
});

test("parse: reads back exactly what serialise wrote", () => {
  let list = bets.add([], single());
  list = bets.add(list, parlay([leg({ playerId: 1 }), leg({ playerId: 2 })]));
  list = bets.applyResults(list, { "823342|690993|hrr": 1 });
  assert.deepEqual(bets.parse(bets.serialise(list)), list);
});

test("parse: rejects an entry whose stored key contradicts its own legs", () => {
  /* Storage is a file the user can edit. A key that disagrees with the legs
     beside it means the entry was tampered with or half-written, and
     grading it would attach someone else's outcome. */
  const [b] = bets.add([], single());
  const forged = JSON.stringify([Object.assign({}, b, { key: "1|1|hrr" })]);
  assert.deepEqual(bets.parse(forged), []);
});

/* ---------------------------------------------------------------- *
 * Migration off the single-only shape
 * ---------------------------------------------------------------- */

test("migrate: a v1 single becomes a one-leg bet, grade and all", () => {
  /* v1 shipped 2026-08-20 and stored one pick per entry with the player
     fields at the top level. Anyone who tracked a bet that day must not
     lose it, or their record silently restarts. */
  const v1 = [
    {
      key: "823342|690993|hrr", gamePk: 823342, playerId: 690993, prop: "hrr",
      propLabel: "1+ H/R/RBI", name: "Colt Keith", team: "DET", prob: 0.73,
      date: "2026-08-19", addedAt: "2026-08-19T14:00:00.000Z",
      actual: 1, gradedAt: "2026-08-19T23:00:00.000Z",
    },
  ];
  const out = bets.migrate(v1);
  assert.equal(out.length, 1);
  assert.equal(out[0].legs.length, 1);
  assert.equal(out[0].legs[0].name, "Colt Keith");
  assert.equal(out[0].prob, 0.73);
  assert.equal(out[0].actual, 1, "a settled v1 bet stays settled");
  assert.equal(out[0].legs[0].actual, 1, "and its leg carries the outcome too");
  assert.equal(out[0].key, bets.keyOf(out[0]));
  assert.equal(out[0].addedAt, "2026-08-19T14:00:00.000Z");
});

test("migrate: an ungraded v1 entry stays ungraded", () => {
  const out = bets.migrate([
    { gamePk: 1, playerId: 2, prop: "hrr", prob: 0.5, date: "2026-08-19" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].actual, undefined);
});

test("migrate: junk migrates to nothing rather than throwing", () => {
  for (const bad of [null, undefined, "", {}, [null], [{ nope: 1 }]]) {
    assert.deepEqual(bets.migrate(bad), []);
  }
});

test("migrate: a log already in the new shape passes through untouched", () => {
  /* Migration runs on read, and on import. It has to be safe to hand it v2. */
  const v2 = bets.add([], parlay([leg({ playerId: 1 }), leg({ playerId: 2 })]));
  assert.deepEqual(bets.migrate(v2), v2);
});

test("an exported log survives a round trip through import with its grades", () => {
  let list = bets.add([], single({ playerId: 1 }));
  list = bets.add(list, parlay([leg({ playerId: 2 }), leg({ playerId: 3 })]));
  list = bets.applyResults(list, {
    "823342|1|hrr": 1, "823342|2|hrr": 1, "823342|3|hrr": 1,
  });
  const before = bets.summarise(list);

  const reimported = bets.migrate(JSON.parse(bets.serialise(list)));
  const after = bets.summarise(reimported);

  assert.equal(after.graded, before.graded);
  assert.equal(after.hits, before.hits);
  assert.ok(Math.abs(after.expected - before.expected) < 1e-12);
});
