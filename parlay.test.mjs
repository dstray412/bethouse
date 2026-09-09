import test from "node:test";
import assert from "node:assert/strict";
import P from "./parlay.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const leg = (playerId, gameId, team, prob) => ({ key: `${gameId}|${playerId}`, playerId, gameId, team, prob, name: String(playerId) });

/* Oracle: the baseball board's combineLegs (score.js), which this
   generalises, and the arithmetic of independent events. */

test("combineLegs: the product, classified by what shares a game or a player", () => {
  const cross = P.combineLegs([leg("a", 1, "X", 0.5), leg("b", 2, "Y", 0.4)]);
  close(cross.prob, 0.2); assert.equal(cross.correlation, "none"); assert.ok(cross.independent); close(cross.adjusted, 0.2);
  const game = P.combineLegs([leg("a", 1, "X", 0.5), leg("b", 1, "Y", 0.4)]);
  assert.equal(game.correlation, "game"); assert.ok(!game.independent);
  const team = P.combineLegs([leg("a", 1, "X", 0.5), leg("b", 1, "X", 0.4)]);
  assert.equal(team.correlation, "team", "every leg on one team");
  const mixed = P.combineLegs([leg("a", 1, "X", 0.5), leg("b", 1, "X", 0.4), leg("c", 1, "Y", 0.4)]);
  assert.equal(mixed.correlation, "mixed", "some legs share a team, not all");
  const severe = P.combineLegs([leg("a", 1, "X", 0.5), leg("a", 1, "X", 0.4)]);
  assert.equal(severe.correlation, "severe"); assert.equal(severe.adjusted, null, "the number is meaningless, so there is none");
  assert.equal(P.combineLegs([]), null);
  assert.equal(P.combineLegs([leg("a", 1, "X", 1.2)]), null);
});

test("combineLegs: a measured lift applies to the correlated case it was measured on, and only there", () => {
  const lift = { game: 1.1, team: 1.3, mixed: 0.9 };
  close(P.combineLegs([leg("a", 1, "X", 0.5), leg("b", 2, "Y", 0.4)], lift).adjusted, 0.2, 1e-9);
  close(P.combineLegs([leg("a", 1, "X", 0.5), leg("b", 1, "Y", 0.4)], lift).adjusted, 0.22, 1e-9);
  close(P.combineLegs([leg("a", 1, "X", 0.5), leg("b", 1, "X", 0.4)], lift).adjusted, 0.26, 1e-9);
  close(P.combineLegs([leg("a", 1, "X", 0.5), leg("b", 1, "X", 0.4), leg("c", 1, "Y", 0.5)], lift).adjusted, 0.09, 1e-9);
  assert.equal(P.combineLegs([leg("a", 1, "X", 0.9), leg("b", 1, "X", 0.9)], { team: 2 }).adjusted, 1, "capped at certainty");
});

test("suggestParlay, slate: the best leg from each of N different games, or nothing", () => {
  const c = [leg("a", 1, "X", 0.6), leg("b", 1, "Y", 0.7), leg("c", 2, "Z", 0.5), leg("d", 3, "W", 0.65), leg("e", 3, "V", 0.1)];
  const out = P.suggestParlay(c, { legs: 3 });
  assert.deepEqual(out.legs.map((l) => l.playerId), ["b", "d", "c"], "one per game, best first");
  assert.equal(out.combined.correlation, "none");
  assert.equal(P.suggestParlay(c, { legs: 4 }), null, "three games cannot fill four legs");
  assert.equal(P.suggestParlay(c, { legs: 0 }), null);
  assert.equal(P.suggestParlay(c, { legs: 2.5 }), null);
  assert.equal(P.suggestParlay([], { legs: 1 }), null);
});

test("suggestParlay, one game: the best legs in that game, one per player, or nothing", () => {
  const c = [leg("a", 1, "X", 0.6), leg("b", 1, "Y", 0.7), leg("a2", 1, "X", 0.65), leg("c", 2, "Z", 0.9)];
  c.push({ ...leg("a", 1, "X", 0.62), key: "1|a|other" }); // the same player, another prop
  const out = P.suggestParlay(c, { legs: 3, scope: "game", gameId: 1, lift: { team: 1.2, game: 1.1 } });
  assert.deepEqual(out.legs.map((l) => l.playerId), ["b", "a2", "a"], "player a appears once, at his best prop");
  assert.equal(out.combined.correlation, "mixed", "two of the three share a team");
  close(out.combined.adjusted, 0.7 * 0.65 * 0.62, 1e-9, "no mixed lift passed, so the product");
  const two = P.suggestParlay(c, { legs: 2, scope: "game", gameId: 1, lift: { team: 1.2, game: 1.1 } });
  assert.equal(two.combined.correlation, "game", "one leg per team");
  close(two.combined.adjusted, 0.7 * 0.65 * 1.1, 1e-9);
  assert.equal(P.suggestParlay(c, { legs: 4, scope: "game", gameId: 1 }), null, "three players cannot fill four legs");
  assert.equal(P.suggestParlay(c, { legs: 2, scope: "game", gameId: 9 }), null);
});

test("combineLegs: game legs are nobody's player; a spread side counts as its team, a total as none", () => {
  const spread = { key: "1|game|spread", playerId: "game", gameId: 1, team: "X", prob: 0.5, prop: "spread" };
  const total = { key: "1|game|total", playerId: "game", gameId: 1, team: null, prob: 0.52, prop: "total" };
  assert.equal(P.combineLegs([spread, total]).correlation, "game", "two game legs are not the same player");
  assert.equal(P.combineLegs([spread, leg("a", 1, "X", 0.5)]).correlation, "team", "the side and its player");
  assert.equal(P.combineLegs([total, leg("a", 1, "X", 0.5)]).correlation, "game");
  assert.equal(P.combineLegs([spread, leg("a", 2, "Y", 0.5)]).correlation, "none");
});

test("combineLegs: the same player twice is severe with no number until a lift is measured for it", () => {
  const two = [leg("a", 1, "X", 0.5), { ...leg("a", 1, "X", 0.6), key: "1|a|recyds", prop: "recyds" }];
  assert.equal(P.combineLegs(two).correlation, "severe"); assert.equal(P.combineLegs(two).adjusted, null);
  const c = P.combineLegs(two, { player: 1.4 });
  assert.equal(c.correlation, "player"); close(c.adjusted, 0.5 * 0.6 * 1.4, 1e-9);
});

test("suggestParlay, one game: spread and total may both appear; a player still only once", () => {
  const c = [leg("a", 1, "X", 0.6), { ...leg("a", 1, "X", 0.65), key: "1|a|recyds", prop: "recyds" },
    { key: "1|game|spread", playerId: "game", gameId: 1, team: "Y", prob: 0.55, prop: "spread" },
    { key: "1|game|total", playerId: "game", gameId: 1, team: null, prob: 0.53, prop: "total" }];
  const out = P.suggestParlay(c, { legs: 3, scope: "game", gameId: 1 });
  assert.deepEqual(out.legs.map((l) => l.key), ["1|a|recyds", "1|game|spread", "1|game|total"]);
});
