/*
 * BetHouse — chips.test.mjs
 * The chips a football row and its card wear: each one a measured number
 * past a threshold that lives in chips.js and nowhere else.
 *
 * Oracle for every assertion: the plan (B3 / B0) states the thresholds,
 * and the data file's fields are the ones fetch-football.mjs writes:
 * `log` rows oldest first [td, carries, receivingOpportunity, rzc, rzt, glc],
 * `rz` {c, t, g, n}, `usage` {snap, snapN, tsh, ays, aysN, ...}.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import chips from "./chips.js";

const T = chips.THRESHOLDS;

/* A log of n games at `season` opportunities each, the last three at `recent`. */
const logOf = (n, season, recent) => Array.from({ length: n }, (_, i) => [0, i >= n - 3 ? recent : season, 0, 0, 0, 0]);
const byId = (list, id) => list.filter((c) => c.id === id)[0] || null;

test("the thresholds live in one place and say what the plan says", () => {
  assert.deepEqual(T, { volume: 0.2, redZone: 0.2, snapsHigh: 0.7, snapsLow: 0.4, deep: 0.3, defence: 0.07, recentGames: 3, minGames: 6 });
  assert.equal(chips.MAX_ROW, 3);
});

test("volume: the last three games' opportunities against the games before them, past twenty percent either way, six games or more", () => {
  // Eight games: five at 10, the last three at 16: +60% on the five before.
  const up = chips.forPlayer({ log: logOf(8, 10, 16) }, {});
  const c = byId(up, "volume");
  assert.ok(c, "no volume chip at +60%");
  assert.equal(c.dir, "up");
  assert.equal(c.label, "Volume up");
  assert.equal(c.value, "+60%");
  assert.match(c.note, /last 3 games/);
  assert.match(c.note, /16\.0 .*a game.*10\.0 over the 5 before/, "the note does not carry both numbers: " + c.note);
  // Five at 10, the last three at 4: −60%.
  const down = byId(chips.forPlayer({ log: logOf(8, 10, 4) }, {}), "volume");
  assert.equal(down && down.dir, "down");
  assert.equal(down.value, "−60%");
  assert.equal(byId(chips.forPlayer({ log: logOf(8, 10, 11) }, {}), "volume"), null, "a 10% move is not a chip");
  assert.equal(byId(chips.forPlayer({ log: logOf(8, 10, 12.1) }, {}), "volume").value, "+21%");
  assert.equal(byId(chips.forPlayer({ log: logOf(5, 10, 20) }, {}), "volume"), null, "five games: the last three are most of the season");
  assert.equal(byId(chips.forPlayer({ log: logOf(8, 0, 0) }, {}), "volume"), null, "no opportunities, no ratio");
  assert.equal(byId(chips.forPlayer({}, {}), "volume"), null, "no log, no chip");
});

test("red zone: his share of the red-zone touches logged for his team's priced players, shown from twenty percent, and the note says whose touches", () => {
  const c = byId(chips.forPlayer({ rz: { c: 8, t: 2, g: 3, n: 5 } }, { teamRz: 40, team: "KC" }), "redzone");
  assert.ok(c, "no red-zone chip at 25%");
  assert.equal(c.label, "Red zone 25%");
  assert.match(c.note, /10 of the 40 red-zone touches logged for KC's priced players/);
  assert.match(c.note, /his over 5 games/);
  assert.doesNotMatch(c.note, /the team's \d/, "the note claims a team total the file does not carry");
  assert.equal(byId(chips.forPlayer({ rz: { c: 7, t: 0, g: 0, n: 5 } }, { teamRz: 40 }), "redzone"), null, "17.5% is under the line");
  assert.equal(byId(chips.forPlayer({ rz: { c: 8, t: 2, g: 0, n: 5 } }, { teamRz: 0 }), "redzone"), null, "no team total, no share");
  assert.equal(byId(chips.forPlayer({ rz: { c: 8, t: 2, g: 0, n: 5 } }, {}), "redzone"), null, "no team total passed, no share");
});

test("snaps: the season snap share at seventy percent or above, or forty or below", () => {
  const hi = byId(chips.forPlayer({ usage: { snap: 0.834, snapN: 10 } }, {}), "snaps");
  assert.equal(hi && hi.label, "Snaps 83%");
  assert.equal(hi.dir, "up");
  const lo = byId(chips.forPlayer({ usage: { snap: 0.31, snapN: 10 } }, {}), "snaps");
  assert.equal(lo && lo.label, "Snaps 31%");
  assert.equal(lo.dir, "down");
  assert.equal(byId(chips.forPlayer({ usage: { snap: 0.55, snapN: 10 } }, {}), "snaps"), null);
  assert.equal(byId(chips.forPlayer({ usage: { snap: 0.9, snapN: 0 } }, {}), "snaps"), null, "a share over no games");
  assert.equal(byId(chips.forPlayer({ usage: { snap: null, snapN: 10 } }, {}), "snaps"), null, "a missing share is not Snaps 0%");
});

test("deep: the air-yards share from thirty percent", () => {
  const c = byId(chips.forPlayer({ usage: { ays: 0.342, aysN: 10 } }, {}), "deep");
  assert.equal(c && c.label, "Deep 34%");
  assert.match(c.note, /air yards/);
  assert.equal(byId(chips.forPlayer({ usage: { ays: 0.2, aysN: 10 } }, {}), "deep"), null);
  assert.equal(byId(chips.forPlayer({ usage: { ays: 0.5, aysN: 0 } }, {}), "deep"), null);
});

test("defence: the opponent factor seven percent either side of average, as the row's badge always was", () => {
  const soft = byId(chips.forPlayer({}, { oppFactor: 1.21, opp: "WSH", what: "touchdowns" }), "defence");
  assert.equal(soft && soft.label, "Soft D");
  assert.equal(soft.dir, "up");
  assert.equal(soft.value, "+21%");
  assert.match(soft.note, /WSH gives up 21% more touchdowns than average/);
  const tough = byId(chips.forPlayer({}, { oppFactor: 0.9, opp: "SF", what: "rushing yards" }), "defence");
  assert.equal(tough && tough.label, "Tough D");
  assert.equal(tough.dir, "down");
  assert.match(tough.note, /SF gives up 10% fewer rushing yards than average/);
  assert.equal(byId(chips.forPlayer({}, { oppFactor: 1.05, opp: "X" }), "defence"), null);
  assert.equal(byId(chips.forPlayer({}, { oppFactor: null, opp: "X" }), "defence"), null);
});

test("order and the row's cap: volume, red zone, defence, snaps, deep; a row wears three", () => {
  const p = { log: logOf(10, 10, 14), rz: { c: 10, t: 2, g: 1, n: 8 }, usage: { snap: 0.8, snapN: 10, ays: 0.35, aysN: 10 } };
  const all = chips.forPlayer(p, { teamRz: 40, oppFactor: 1.1, opp: "DEN", what: "touchdowns" });
  assert.deepEqual(all.map((c) => c.id), ["volume", "redzone", "defence", "snaps", "deep"]);
  assert.deepEqual(chips.row(all).map((c) => c.id), ["volume", "redzone", "defence"]);
  assert.deepEqual(chips.row([]), []);
});

test("every chip is plain data: a label, a value or none, a note, and no markup", () => {
  const p = { log: logOf(10, 10, 14), rz: { c: 10, t: 2, g: 1, n: 8 }, usage: { snap: 0.8, snapN: 10, ays: 0.35, aysN: 10 } };
  for (const c of chips.forPlayer(p, { teamRz: 40, oppFactor: 1.1, opp: "DEN", what: "touchdowns" })) {
    assert.equal(typeof c.id, "string"); assert.equal(typeof c.label, "string"); assert.equal(typeof c.note, "string");
    assert.ok(c.value == null || typeof c.value === "string");
    assert.doesNotMatch(c.label + c.note, /<[a-z]/i, "chips.js wrote markup; the board escapes, chips.js does not");
  }
});
