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

/* ---------------------------------------------------------------- *
 * Recording after the fact
 *
 * The first version refused any bet on a game that had started, borrowing
 * track.mjs's pregame-only rule. That rule exists to stop the MODEL grading
 * itself on lookahead. Applied to the user's own log it was just wrong: it
 * made it impossible to write down a bet you actually placed, which is the
 * entire point of a bet log.
 *
 * So retro entry is allowed and MARKED. "Entered after the result was
 * known" is a fact about the entry, not an accusation, and the record needs
 * it to stay meaningful.
 * ---------------------------------------------------------------- */

test("a bet can be recorded after the fact, and says so", () => {
  const b = bets.single(leg(), "2026-08-19", { retro: true });
  assert.equal(b.retro, true);
});

test("a bet recorded before first pitch carries no retro mark at all", () => {
  /* Absent rather than false, so the flag means something when it is there
     and old entries do not need rewriting. */
  const b = bets.single(leg(), "2026-08-19");
  assert.equal("retro" in b, false);
});

test("summarise: counts what was entered after the result was known", () => {
  let list = bets.add([], bets.single(leg({ playerId: 1 }), "2026-08-19"));
  list = bets.add(list, bets.single(leg({ playerId: 2 }), "2026-08-19", { retro: true }));
  list = bets.applyResults(list, { "823342|1|hrr": 1, "823342|2|hrr": 1 });

  const s = bets.summarise(list);
  assert.equal(s.graded, 2);
  assert.equal(s.retro.graded, 1, "one of the two was entered afterwards");
  assert.equal(s.live.graded, 1, "and one was there before first pitch");
  assert.equal(s.retro.hits, 1);
});

test("summarise: with nothing back-filled, the retro tally is empty", () => {
  const list = bets.applyResults(
    bets.add([], bets.single(leg(), "2026-08-19")),
    { "823342|690993|hrr": 1 },
  );
  assert.equal(bets.summarise(list).retro.tracked, 0);
  assert.equal(bets.summarise(list).live.tracked, 1);
});

test("summarise: straight and parlay each report their own win rate", () => {
  /* The thing the panel is asked for: how am I doing on straights, how am I
     doing on parlays. A combined rate answers neither. */
  let list = bets.add([], single({ playerId: 1, prob: 0.8 }));
  list = bets.add(list, single({ playerId: 2, prob: 0.8 }));
  list = bets.add(list, bets.parlay([leg({ playerId: 3 }), leg({ playerId: 4 })], 0.4, "2026-08-19"));
  list = bets.applyResults(list, {
    "823342|1|hrr": 1, "823342|2|hrr": 0,
    "823342|3|hrr": 1, "823342|4|hrr": 1,
  });

  const s = bets.summarise(list);
  assert.equal(s.singles.hitRate, 0.5);
  assert.equal(s.parlays.hitRate, 1);
});

test("parlay: can also be recorded after the fact", () => {
  const b = bets.parlay([leg({ playerId: 1 }), leg({ playerId: 2 })], 0.4, "2026-08-19", {
    retro: true,
  });
  assert.equal(b.retro, true);
  assert.equal(b.legs.length, 2);
});

test("the retro mark survives storage and import", () => {
  let list = bets.add([], bets.single(leg(), "2026-08-19", { retro: true }));
  assert.equal(bets.parse(bets.serialise(list))[0].retro, true);
  assert.equal(bets.migrate(JSON.parse(bets.serialise(list)))[0].retro, true);
});

/* ---------------------------------------------------------------- *
 * The regression that shipped
 *
 * When every bet became {legs:[...]}, add() started requiring `legs` and
 * silently returned the list unchanged for anything else. The board's row
 * button still passed a flat pick, so tapping a player did nothing at all:
 * no error, no console warning, an empty log. It reached production.
 *
 * The unit tests did not catch it because they build through single(),
 * which is not what the board called. So the fix is not "call single()" —
 * it is that a flat pick IS a one-leg bet and add() must take it, the same
 * way migrate() already does. A shape this module understands everywhere
 * else cannot be a silent no-op here.
 * ---------------------------------------------------------------- */

test("add: takes a bare pick and stores it as a one-leg bet", () => {
  const list = bets.add([], leg());
  assert.equal(list.length, 1, "a flat pick must not be silently dropped");
  assert.equal(list[0].legs.length, 1);
  assert.equal(list[0].legs[0].name, "Colt Keith");
  assert.equal(list[0].prob, 0.73);
  assert.equal(list[0].key, "823342|690993|hrr");
});

test("add: a bare pick and the same pick via single() are the same bet", () => {
  const viaPick = bets.add([], leg({ date: "2026-08-19" }));
  const viaSingle = bets.add([], single());
  assert.equal(viaPick[0].key, viaSingle[0].key);
  /* And adding both must not log twice. */
  assert.equal(bets.add(viaPick, single()).length, 1);
});

test("add: still refuses something that is neither a bet nor a pick", () => {
  assert.deepEqual(bets.add([], { name: "nobody" }), []);
  assert.deepEqual(bets.add([], null), []);
  assert.deepEqual(bets.add([], { legs: [] }), []);
});

/* ---------------------------------------------------------------- *
 * No closing line value (2026-10-17): the site shows chances, not odds,
 * so a leg carries no market, no price and no closing number, and an
 * old log's price fields are dropped on read.
 * ---------------------------------------------------------------- */

test("a new leg carries no market or price fields, an old log's pass through untouched, and the summary has no CLV", () => {
  const fresh = bets.single(leg(), "2026-08-19");
  for (const k of ["marketKey", "priceAtBet", "noVigAtBet", "noVigAtClose", "priceAtClose"]) assert.equal(k in fresh.legs[0], false, k + " on a new leg");
  // Oracle: data loss. A log written while the site priced legs keeps those fields on re-save; nothing reads them.
  const old = { marketKey: "x|hrr|0.5", priceAtBet: "-110", noVigAtBet: 0.5, noVigAtClose: 0.55, priceAtClose: "-120" };
  const b = bets.single(leg(old), "2026-08-19");
  for (const k of Object.keys(old)) assert.equal(b.legs[0][k], old[k], k + " was dropped from an old log");
  assert.equal("clv" in bets.summarise([b]), false);
  for (const k of ["legClv", "clvOf"]) assert.equal(k in bets, false, k + " is still exported");
});

/* ---------------------------------------------------------------- *
 * Football legs: a line sold as a number and up, graded off the box
 * ---------------------------------------------------------------- */

const fleg = (over = {}) => ({
  gamePk: "401872980", playerId: "2577417", prop: "recyds", rung: 20, propLabel: "20+ receiving yards",
  name: "Dak Prescott", team: "DAL", prob: 0.64, league: "NFL", kickoff: "2026-10-09T00:15Z", recordDay: "2026-10-09", ...over,
});

test("legKey: a football leg's rung is part of its identity, so two rungs on one player are two legs; a baseball key is unchanged", () => {
  assert.equal(bets.legKey(fleg()), "401872980|2577417|recyds|20");
  assert.notEqual(bets.legKey(fleg()), bets.legKey(fleg({ rung: 30 })));
  assert.equal(bets.legKey(leg()), "823342|690993|hrr");
});

test("normLeg: a football leg keeps its rung, league, kickoff and record day through build, storage and migrate", () => {
  const b = bets.parlay([fleg(), fleg({ playerId: "1", prop: "td", rung: 1, propLabel: "Anytime TD", prob: 0.3 })], 0.192, "2026-10-08");
  assert.deepEqual([b.legs[0].rung, b.legs[0].league, b.legs[0].kickoff, b.legs[0].recordDay], [20, "NFL", "2026-10-09T00:15Z", "2026-10-09"]);
  const back = bets.migrate(JSON.parse(bets.serialise([b])))[0];
  assert.deepEqual(back, b);
  assert.equal(bets.parse(bets.serialise([b]))[0].key, b.key);
});

test("resultsFrom: a football record day grades a held leg off the row's box line at the leg's own rung", () => {
  const day = { date: "2026-10-09", predictions: [
    { gameId: "401872980", playerId: "2577417", prop: "recyds", line: 55.5, prob: 0.5, actual: 0, result: { td: 1, recYds: 24, rushYds: 10, passYds: 0, recs: 3 } },
    { gameId: "401872980", playerId: "2577417", prop: "rushrec", line: 60.5, prob: 0.5, actual: 0, result: { td: 1, recYds: 24, rushYds: 10, passYds: 0, recs: 3 } },
    { gameId: "401872980", playerId: "2577417", prop: "td", prob: 0.2, actual: 1, result: { td: 1, recYds: 24, rushYds: 10, passYds: 0, recs: 3 } },
    { gameId: "401872980", playerId: "9", prop: "recyds", line: 40.5, prob: 0.5 }, // not yet graded: no box
  ] };
  const held = [bets.parlay([
    fleg(), fleg({ rung: 25 }), fleg({ prop: "rushrec", rung: 30, propLabel: "30+ rush + rec yards" }), fleg({ prop: "rushrec", rung: 40 }),
    fleg({ prop: "td", rung: 1 }), fleg({ prop: "recs", rung: 3 }), fleg({ playerId: "9", rung: 40 }),
  ], 0.01, "2026-10-08")];
  const r = bets.resultsFrom(day, held);
  assert.deepEqual(r, {
    "401872980|2577417|recyds|20": 1, "401872980|2577417|recyds|25": 0, "401872980|2577417|rushrec|30": 1, "401872980|2577417|rushrec|40": 0,
    "401872980|2577417|td|1": 1,
  }, "the rung is not read off the box; receptions has no row so it waits; the ungraded row grades nothing");
  /* The row's own line is not a held leg: its actual is never keyed to a rung it was not about. */
  assert.equal(r["401872980|2577417|recyds"], undefined);
  /* Without the held legs, a football day grades nothing: the rung is the leg's, not the row's. */
  assert.deepEqual(bets.resultsFrom(day), {});
  const graded = bets.applyResults(held, r)[0];
  assert.equal(graded.actual, 0, "a parlay with a missed leg is not lost");
  assert.equal(graded.legs.find((l) => l.rung === 20 && l.prop === "recyds").actual, 1);
});

test("recordPaths: where the grades live, a file a day for baseball and a file a record day for football, only while something is open", () => {
  const list = [
    bets.single(leg(), "2026-08-19"),
    bets.parlay([fleg(), fleg({ playerId: "1" })], 0.4, "2026-10-08"),
    bets.parlay([fleg({ league: "CFB", recordDay: "2026-10-10", gamePk: "7" })], 0.6, "2026-10-10"),
    Object.assign(bets.single(leg({ gamePk: 5 }), "2026-08-18"), { actual: 1 }),
  ];
  assert.deepEqual(bets.recordPaths(list), ["nfl-record/2026-10-09.json", "history/2026-08-19.json"], "newest first, football before baseball, a settled bet's file not fetched; a leg from a league the log no longer grades (the college board, removed 2026-10-16) has nowhere to be graded");
  assert.deepEqual(bets.recordPaths([]), []);
  assert.deepEqual(bets.recordPaths([bets.parlay([fleg({ recordDay: undefined })], 0.5, "2026-10-08")]), [], "a football leg without a record day has nowhere to be graded; it is not fetched as baseball");
});

test("recordDay and league are validated: a record day is a calendar date and a league one the log grades, so a tampered or imported log cannot widen the fetch path", () => {
  const bad = bets.parlay([fleg({ recordDay: "../somefile" }), fleg({ playerId: "1", recordDay: "2026-10-09T00:15Z" }), fleg({ playerId: "2", league: "../x" })], 0.1, "2026-10-08");
  assert.equal(bad.legs[0].recordDay, undefined, "a traversal string was stored as a record day");
  assert.equal(bad.legs[1].recordDay, undefined, "a timestamp was stored as a record day");
  assert.equal(bad.legs[2].league, undefined, "an unknown league was stored");
  assert.deepEqual(bets.recordPaths([bad]), [], "a leg with no valid record day was fetched");
  /* A stored entry that skipped normLeg (hand-edited storage) is checked again at the path. */
  const forged = Object.assign({}, bets.parlay([fleg()], 0.5, "2026-10-08"));
  forged.legs = forged.legs.map((l) => Object.assign({}, l, { recordDay: "../x" }));
  assert.deepEqual(bets.recordPaths([forged]), []);
  assert.deepEqual(bets.recordPaths([bets.parlay([fleg()], 0.5, "2026-10-08")]), ["nfl-record/2026-10-09.json"]);
});

test("boxHit: the stat the prop counts, at or over the rung; rush + rec the two yards summed; a stat the box lacks grades nothing", () => {
  const box = { td: 1, recYds: 24, rushYds: 10, passYds: 316, recs: 3 };
  assert.deepEqual([bets.boxHit("td", box, 1), bets.boxHit("recyds", box, 24), bets.boxHit("recyds", box, 25), bets.boxHit("rushrec", box, 34), bets.boxHit("rushrec", box, 35), bets.boxHit("passyds", box, 300), bets.boxHit("recs", box, 4)], [1, 1, 0, 1, 0, 1, 0]);
  assert.equal(bets.boxHit("hrr", box, 1), null); assert.equal(bets.boxHit("recyds", null, 20), null); assert.equal(bets.boxHit("recyds", { recYds: "x" }, 20), null);
});

test("a scratched player voids his leg: a book would void it, so the parlay settles on the legs that stood, and a single is void", () => {
  const day = { date: "2026-10-09", predictions: [
    { gameId: "401872980", playerId: "4429676", prop: "td", prob: 0.09, scratched: true },
    { gameId: "401872980", playerId: "2577417", prop: "passyds", line: 256.5, prob: 0.5, actual: 1, result: { td: 0, recYds: 0, rushYds: 0, passYds: 316, recs: 0 } },
  ] };
  const scratched = fleg({ playerId: "4429676", prop: "td", rung: 1, propLabel: "Anytime TD", prob: 0.09 });
  const stood = fleg({ prop: "passyds", rung: 250, propLabel: "250+ passing yards" });
  const held = [bets.parlay([scratched, stood], 0.05, "2026-10-08"), bets.single(scratched, "2026-10-08")];
  const r = bets.resultsFrom(day, held);
  assert.deepEqual(r, { "401872980|4429676|td|1": "void", "401872980|2577417|passyds|250": 1 });
  const out = bets.applyResults(held, r);
  assert.equal(out[0].legs[0].void, true); assert.equal(out[0].legs[0].actual == null, true, "a void leg has an outcome");
  assert.equal(out[0].actual, 1, "the parlay did not settle on the leg that stood");
  assert.equal(out[1].void, true); assert.equal(out[1].actual == null, true, "a void single has an outcome"); assert.ok(out[1].gradedAt);
  /* A void bet is tracked, neither graded nor pending, and expectation covers only the graded; it is never fetched again. */
  const sum = bets.summarise(out);
  assert.deepEqual([sum.tracked, sum.graded, sum.void, sum.pending, sum.hits], [2, 1, 1, 0, 1]);
  assert.deepEqual(bets.recordPaths(out), []);
  /* First grade wins for a void too, and a void leg is not re-read. */
  assert.deepEqual(bets.applyResults(out, { "401872980|4429676|td|1": 1 }), out);
  /* A void leg survives storage and migrate. */
  const back = bets.migrate(JSON.parse(bets.serialise(out)));
  assert.deepEqual(back, out);
  /* A parlay whose every leg is void is void. */
  const all = bets.applyResults([bets.parlay([scratched, fleg({ playerId: "4429676", prop: "recs", rung: 2 })], 0.05, "2026-10-08")], { "401872980|4429676|td|1": "void", "401872980|4429676|recs|2": "void" })[0];
  assert.equal(all.void, true); assert.equal(all.actual == null, true);
  /* A parlay with a void leg and a missed one is lost; with a void leg and an open one is open. */
  const mixed = bets.parlay([scratched, stood], 0.05, "2026-10-08");
  assert.equal(bets.applyResults([mixed], { "401872980|4429676|td|1": "void", "401872980|2577417|passyds|250": 0 })[0].actual, 0);
  const half = bets.applyResults([mixed], { "401872980|4429676|td|1": "void" })[0];
  assert.equal(half.actual == null, true); assert.equal(half.void, undefined); assert.equal(half.legs[0].void, true);
});

/* A league the log no longer grades (the college board, removed 2026-10-16).
   Oracle: the void rule above -- a leg the book cannot settle comes off the
   slip, and a slip with nothing left on it is void, not open forever. */
test("a logged football leg from a league the log no longer grades is void at build; a bet of only such legs settles void, a mixed slip just loses the leg", () => {
  const cfb = bets.parlay([fleg({ league: "CFB", gamePk: "7", recordDay: "2026-10-10" })], 0.6, "2026-10-10");
  assert.equal(cfb.legs[0].void, true);
  assert.equal("league" in cfb.legs[0], false, "no fetch path is kept for it");
  assert.equal(cfb.void, true, "nothing on it can ever grade: settled void, as a book voids an unsettleable market");
  assert.ok(cfb.gradedAt);
  assert.deepEqual(bets.recordPaths([cfb]), [], "a settled bet is not fetched");
  assert.equal(bets.summarise([cfb]).void, 1);
  const mixed = bets.parlay([fleg(), fleg({ league: "CFB", gamePk: "7", playerId: "9" })], 0.4, "2026-10-08");
  assert.equal("void" in mixed, false, "an NFL leg still stands, so the slip settles as a shorter parlay");
  assert.equal(mixed.legs[1].void, true);
  assert.equal("void" in mixed.legs[0], false);
  assert.deepEqual(bets.recordPaths([mixed]), ["nfl-record/2026-10-09.json"]);
  const nfl = bets.parlay([fleg()], 0.6, "2026-10-09");
  assert.equal("void" in nfl.legs[0], false);
  assert.equal("void" in nfl, false);
});
