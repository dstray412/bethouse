/*
 * BetHouse — watchlist.test.mjs
 * What the browser remembers about the football boards: the price you
 * typed against a row (phase 1), the players you starred (phase 3).
 *
 * Oracle: the bet log (bets.js), which this module copies -- a versioned
 * storage key, a parse that swallows bad JSON, a serialise that is plain
 * JSON -- and the American price format, where a price is a whole number
 * at or beyond ±100 and nothing else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import W from "./watchlist.js";

test("priceKey: the slate and the line are part of a counting prop's key, the slate alone of a touchdown's", () => {
  const rec = { league: "NFL", slate: "2026-4", playerId: "4241479", prop: "recyds", line: 59.5 };
  assert.equal(W.priceKey(rec), "NFL|2026-4|4241479|recyds|59.5");
  // The same player at the High line setting is a different price.
  assert.notEqual(W.priceKey(rec), W.priceKey({ ...rec, line: 77.5 }));
  // ...and last week's price is not this week's: a new opponent, a new number at the book.
  assert.notEqual(W.priceKey(rec), W.priceKey({ ...rec, slate: "2026-5" }));
  assert.equal(W.priceKey({ league: "NFL", slate: "2026-4", playerId: "4241479", prop: "td" }), "NFL|2026-4|4241479|td");
  assert.equal(W.priceKey({ league: "NFL", slate: "2026-4", playerId: "4241479", prop: "td", line: 0.5 }), "NFL|2026-4|4241479|td", "a line on a touchdown is ignored");
  assert.notEqual(W.priceKey({ ...rec, league: "CFB" }), W.priceKey(rec), "leagues share ids; the key keeps them apart");
});

test("forSlate: only this slate's prices are kept, so the store does not carry every week ever typed", () => {
  const m = { "NFL|2026-3|1|td": -120, "NFL|2026-4|1|td": -140, "CFB|2026-4|9|rushyds|88.5": 105, "NFL|2026-4|2|recyds|59.5": 110 };
  assert.deepEqual(W.forSlate(m, "NFL", "2026-4"), { "NFL|2026-4|1|td": -140, "NFL|2026-4|2|recyds|59.5": 110 });
  assert.deepEqual(W.forSlate(m, "NFL", "2026-9"), {});
  assert.deepEqual(W.forSlate(null, "NFL", "2026-4"), {});
});

test("validPrice: an American price is a whole number at or beyond ±100", () => {
  for (const ok of [-110, 150, "+150", "-100", " -105 ", 100]) assert.equal(W.validPrice(ok), Number(String(ok).trim()), String(ok));
  for (const bad of [0, 50, -99, -100.5, "abc", "", null, undefined, NaN, Infinity, "1e3"]) assert.equal(W.validPrice(bad), null, String(bad));
});

test("parsePrices: bad JSON is an empty map, and only valid prices under string keys survive", () => {
  assert.deepEqual(W.parsePrices("not json"), {});
  assert.deepEqual(W.parsePrices(null), {});
  assert.deepEqual(W.parsePrices("[1,2]"), {}, "a list is not a map");
  const raw = JSON.stringify({ "NFL|2026-4|1|td": -120, "NFL|2026-4|2|recyds|59.5": "+140", "NFL|2026-4|3|td": 50, "NFL|2026-4|4|td": "x", "": -110 });
  assert.deepEqual(W.parsePrices(raw), { "NFL|2026-4|1|td": -120, "NFL|2026-4|2|recyds|59.5": 140 });
});

test("serialise / parsePrices round-trip, and the key carries a version", () => {
  const m = { "NFL|2026-4|1|td": -120, "CFB|2026-4|9|rushyds|88.5": 105 };
  assert.deepEqual(W.parsePrices(W.serialise(m)), m);
  assert.match(W.PRICE_KEY, /^bethouse\.prices\.v\d+$/);
});

/* Stars: the players you are watching, per league. A star is on the
   player, not on a prop -- you watch a man, then look at his props. */
test("watchKey: league and player, so the two boards' stars stay apart", () => {
  assert.equal(W.watchKey({ league: "NFL", playerId: "4241479" }), "NFL|4241479");
  assert.notEqual(W.watchKey({ league: "CFB", playerId: "4241479" }), W.watchKey({ league: "NFL", playerId: "4241479" }));
});

test("parseWatch: bad JSON is nothing, and only distinct string keys survive", () => {
  assert.deepEqual(W.parseWatch("nope"), []);
  assert.deepEqual(W.parseWatch(null), []);
  assert.deepEqual(W.parseWatch('{"a":1}'), [], "a map is not a list");
  assert.deepEqual(W.parseWatch('["NFL|1","NFL|1",7,null,"","CFB|2"]'), ["NFL|1", "CFB|2"]);
});

test("toggle / has: a star goes on, then off, and a list is never mutated in place", () => {
  const a = ["NFL|1"];
  const b = W.toggle(a, "NFL|2");
  assert.deepEqual(b, ["NFL|1", "NFL|2"]); assert.deepEqual(a, ["NFL|1"], "the input list was mutated");
  assert.deepEqual(W.toggle(b, "NFL|1"), ["NFL|2"]);
  assert.ok(W.has(b, "NFL|2")); assert.ok(!W.has(b, "NFL|9")); assert.ok(!W.has(null, "NFL|2"));
  assert.deepEqual(W.parseWatch(W.serialise(b)), b);
  assert.match(W.WATCH_KEY, /^bethouse\.watch\.v\d+$/);
});

/* Tracked props: a player, a prop and a target, for the live page. */
test("trackKey / parseTracks / toggleTrack: a tracked prop is one player, one prop, one target in one game", () => {
  const t = { league: "NFL", sport: "football", gameId: "401872945", playerId: "4242335", name: "Jonathan Taylor", team: "IND", opp: "KC", prop: "rushyds", rung: 100 };
  assert.equal(W.trackKey(t), "NFL|401872945|4242335|rushyds|100");
  assert.equal(W.trackKey({ ...t, prop: "td", rung: undefined }), "NFL|401872945|4242335|td");
  const list = W.toggleTrack([], t);
  assert.equal(list.length, 1); assert.equal(list[0].key, W.trackKey(t)); assert.equal(list[0].name, "Jonathan Taylor");
  assert.ok(W.hasTrack(list, W.trackKey(t)));
  assert.deepEqual(W.toggleTrack(list, t), [], "the same prop again untracks it");
  assert.equal(W.toggleTrack(list, { ...t, rung: 125 }).length, 2, "another target is another tracked prop");
  assert.deepEqual(W.parseTracks("nope"), []);
  assert.deepEqual(W.parseTracks(W.serialise(list)), list, "round trip");
  assert.deepEqual(W.parseTracks(JSON.stringify([{ key: "x" }, null, { ...list[0], key: "wrong" }, list[0], list[0]])), [list[0]], "only self-consistent entries, once");
  assert.match(W.TRACK_KEY, /^bethouse\.track\.v\d+$/);
});
