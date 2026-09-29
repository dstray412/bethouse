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

test("priceKey: the line is part of a counting prop's key, and no part of a touchdown's", () => {
  const rec = { league: "NFL", playerId: "4241479", prop: "recyds", line: 59.5 };
  assert.equal(W.priceKey(rec), "NFL|4241479|recyds|59.5");
  // The same player at the High line setting is a different price.
  assert.notEqual(W.priceKey(rec), W.priceKey({ ...rec, line: 77.5 }));
  assert.equal(W.priceKey({ league: "NFL", playerId: "4241479", prop: "td" }), "NFL|4241479|td");
  assert.equal(W.priceKey({ league: "NFL", playerId: "4241479", prop: "td", line: 0.5 }), "NFL|4241479|td", "a line on a touchdown is ignored");
  assert.notEqual(W.priceKey({ ...rec, league: "CFB" }), W.priceKey(rec), "leagues share ids; the key keeps them apart");
});

test("validPrice: an American price is a whole number at or beyond ±100", () => {
  for (const ok of [-110, 150, "+150", "-100", " -105 ", 100]) assert.equal(W.validPrice(ok), Number(String(ok).trim()), String(ok));
  for (const bad of [0, 50, -99, -100.5, "abc", "", null, undefined, NaN, Infinity, "1e3"]) assert.equal(W.validPrice(bad), null, String(bad));
});

test("parsePrices: bad JSON is an empty map, and only valid prices under string keys survive", () => {
  assert.deepEqual(W.parsePrices("not json"), {});
  assert.deepEqual(W.parsePrices(null), {});
  assert.deepEqual(W.parsePrices("[1,2]"), {}, "a list is not a map");
  const raw = JSON.stringify({ "NFL|1|td": -120, "NFL|2|recyds|59.5": "+140", "NFL|3|td": 50, "NFL|4|td": "x", "": -110 });
  assert.deepEqual(W.parsePrices(raw), { "NFL|1|td": -120, "NFL|2|recyds|59.5": 140 });
});

test("serialise / parsePrices round-trip, and the key carries a version", () => {
  const m = { "NFL|1|td": -120, "CFB|9|rushyds|88.5": 105 };
  assert.deepEqual(W.parsePrices(W.serialise(m)), m);
  assert.match(W.PRICE_KEY, /^bethouse\.prices\.v\d+$/);
});
