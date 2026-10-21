/*
 * BetHouse — watchlist.test.mjs
 * What the browser remembers about the football boards: the players you
 * starred and the props you track live. (The typed prices went on
 * 2026-10-17 with the rest of the odds.)
 *
 * Oracle: the bet log (bets.js), which this module copies -- a versioned
 * storage key, a parse that swallows bad JSON, a serialise that is plain
 * JSON.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import W from "./watchlist.js";






/* Stars: the players you are watching, per league. A star is on the
   player, not on a prop -- you watch a man, then look at his props. */
test("watchKey: league and player, so the two boards' stars stay apart", () => {
  assert.equal(W.watchKey({ league: "NFL", playerId: "4241479" }), "NFL|4241479");
  assert.notEqual(W.watchKey({ league: "XFL", playerId: "4241479" }), W.watchKey({ league: "NFL", playerId: "4241479" }));
});

test("parseWatch: bad JSON is nothing, and only distinct string keys survive", () => {
  assert.deepEqual(W.parseWatch("nope"), []);
  assert.deepEqual(W.parseWatch(null), []);
  assert.deepEqual(W.parseWatch('{"a":1}'), [], "a map is not a list");
  assert.deepEqual(W.parseWatch('["NFL|1","NFL|1",7,null,"","XFL|2"]'), ["NFL|1", "XFL|2"]);
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

test("a track keeps the team's logo key so the live page can mark the team", async () => {
  const W = (await import("./watchlist.js")).default;
  const raw = { league: "NFL", sport: "football", gameId: "1", playerId: "2", name: "A", team: "BUF", opp: "NE", teamKey: "buf", prop: "td" };
  const t = W.toggleTrack([], raw)[0];
  assert.equal(t.teamKey, "buf");
  const back = W.parseTracks(W.serialise([t]));
  assert.equal(back[0].teamKey, "buf", "round-trips through storage");
  assert.equal(W.trackKey(t), W.trackKey(Object.assign({}, t, { teamKey: undefined })), "the key does not depend on it");
});

test("no price store: nothing keyed for typed prices, since the site shows chances, not odds (2026-10-17)", () => {
  for (const k of ["PRICE_KEY", "priceKey", "forSlate", "validPrice", "parsePrices"]) assert.equal(k in W, false, k + " is still exported");
});
