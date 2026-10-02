/*
 * BetHouse — enrich-nfl.test.mjs
 * The nflverse enrichment: three files, three id systems, one key.
 *
 * Oracle: nflverse's own column names and id systems (players.csv joins
 * gsis, pfr and espn ids; weekly stats and play-by-play key on gsis; snap
 * counts on pfr), the red-zone definition (inside the 20; goal line
 * inside the 5), and the rule that a missing row is unknown, never zero.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { crosswalk, weeklyEntries, snapEntries, playEntries, teamPlayEntries, mergeEntries, fillZeroTouches, attach, usageOf, gamesByPlayer, enrichKey } from "./enrich-nfl.mjs";

const XW = crosswalk([
  { gsis_id: "00-0036223", pfr_id: "TaylJo02", espn_id: "4242335", display_name: "Jonathan Taylor" },
  { gsis_id: "00-0039999", pfr_id: "NobodyX1", espn_id: "", display_name: "No Espn Id" },
  { gsis_id: "00-0030000", pfr_id: "", espn_id: "111", display_name: "Gsis Only" },
]);

test("crosswalk: gsis and pfr ids map to the espn id; a row without one is skipped", () => {
  assert.equal(XW.gsis.get("00-0036223"), "4242335");
  assert.equal(XW.pfr.get("TaylJo02"), "4242335");
  assert.equal(XW.gsis.get("00-0039999"), undefined);
  assert.equal(XW.gsis.get("00-0030000"), "111");
  assert.equal(XW.pfr.get(""), undefined);
});

test("weeklyEntries: regular-season skill players only, shares as numbers, keyed by season|week|espn", () => {
  const rows = [
    { season: "2025", week: "3", season_type: "REG", position: "RB", player_id: "00-0036223", target_share: "0.1234", air_yards_share: "0.05", receiving_air_yards: "12" },
    { season: "2025", week: "3", season_type: "POST", position: "RB", player_id: "00-0036223", target_share: "0.9" },
    { season: "2025", week: "3", season_type: "REG", position: "K", player_id: "00-0036223", target_share: "0.9" },
    { season: "2025", week: "4", season_type: "REG", position: "WR", player_id: "00-0039999", target_share: "0.3" },
    { season: "2025", week: "5", season_type: "REG", position: "WR", player_id: "00-0030000", target_share: "", air_yards_share: "" },
  ];
  const { entries, seen, matched } = weeklyEntries(rows, XW);
  assert.deepEqual(entries.get(enrichKey(2025, 3, "4242335")), { tsh: 0.123, ays: 0.05, ay: 12 });
  assert.equal(entries.has(enrichKey(2025, 4, "4242335")), false, "a player with no espn id is not joined");
  assert.equal(entries.has(enrichKey(2025, 5, "111")), false, "blank shares: no entry at all");
  assert.equal(seen, 3); assert.equal(matched, 2);
});

test("snapEntries: the offensive snap share by pfr id, regular season, skill positions", () => {
  const rows = [
    { season: "2025", week: "3", game_type: "REG", position: "RB", pfr_player_id: "TaylJo02", offense_pct: "0.83" },
    { season: "2025", week: "3", game_type: "REG", position: "T", pfr_player_id: "BankKe01", offense_pct: "1" },
    { season: "2025", week: "3", game_type: "POST", position: "RB", pfr_player_id: "TaylJo02", offense_pct: "0.5" },
    { season: "2025", week: "4", game_type: "REG", position: "RB", pfr_player_id: "NobodyX1", offense_pct: "0.5" },
  ];
  const { entries, seen, matched } = snapEntries(rows, XW);
  assert.deepEqual(entries.get(enrichKey(2025, 3, "4242335")), { snap: 0.83 });
  assert.equal(entries.size, 1); assert.equal(seen, 2); assert.equal(matched, 1);
});

test("playEntries: carries and targets inside the 20, goal-line carries inside the 5, scrambles as carries, two-point tries skipped, the weeks covered", () => {
  const plays = [
    { season: 2025, week: 3, yardline_100: 18, rush: 1, pass: 0, rusher_player_id: "00-0036223" },
    { season: 2025, week: 3, yardline_100: 3, rush: 1, pass: 0, rusher_player_id: "00-0036223" },
    { season: 2025, week: 3, yardline_100: 12, rush: 0, pass: 1, receiver_player_id: "00-0036223" },
    { season: 2025, week: 3, yardline_100: 45, rush: 1, pass: 0, rusher_player_id: "00-0036223" },
    { season: 2025, week: 3, yardline_100: 9, rush: 0, pass: 1, receiver_player_id: "" },
    { season: 2025, week: 3, yardline_100: 9, rush: 1, pass: 0, rusher_player_id: "00-0039999" },
    { season: 2025, week: 3, yardline_100: 20, rush: 1, pass: 0, rusher_player_id: "00-0030000" },
    { season: 2025, week: 3, yardline_100: 5, rush: 1, pass: 0, rusher_player_id: "00-0030000" },
    { season: 2025, week: 3, yardline_100: 21, rush: 1, pass: 0, rusher_player_id: "00-0030000" },
    { season: 2025, week: 3, yardline_100: 6, rush: 1, pass: 0, rusher_player_id: "00-0030000" },
    { season: 2025, week: 4, yardline_100: 4, rush: 0, pass: 1, qb_scramble: 1, rusher_player_id: "00-0030000" },
    { season: 2025, week: 4, yardline_100: 2, rush: 1, pass: 0, two_point_attempt: 1, rusher_player_id: "00-0030000" },
    { season: 2025, week: 5, yardline_100: 60, rush: 1, pass: 0, rusher_player_id: "00-0030000" },
  ];
  const { entries, matched, seen, weeks } = playEntries(plays, XW);
  assert.deepEqual(entries.get(enrichKey(2025, 3, "4242335")), { rzc: 2, rzt: 1, glc: 1 }, "two carries inside the 20, one of them inside the 5, one target inside the 20");
  assert.deepEqual(entries.get(enrichKey(2025, 3, "111")), { rzc: 3, rzt: 0, glc: 1 }, "the 20 is red zone and the 5 is goal line; the 21 and the 6 are not");
  assert.deepEqual(entries.get(enrichKey(2025, 4, "111")), { rzc: 1, rzt: 0, glc: 1 }, "a scramble inside the 5 is a goal-line carry; the two-point try is nothing");
  assert.equal(seen, 8, "every touch inside the 20 once, whoever made it; the 45 and the 60, the empty receiver and the two-point try are not touches");
  assert.equal(matched, 7, "one touch was by a player with no espn id");
  assert.deepEqual([...weeks].sort(), ["2025|3", "2025|4", "2025|5"], "the weeks the plays covered, including a week with no red-zone touch");
});

test("playEntries: an unmatched goal-line carry counts once as seen and never as matched", () => {
  const { seen, matched, entries } = playEntries([{ season: 2025, week: 1, yardline_100: 2, rush: 1, pass: 0, rusher_player_id: "00-0039999" }], XW);
  assert.equal(seen, 1); assert.equal(matched, 0); assert.equal(entries.size, 0);
});

test("mergeEntries and attach: one object per player-game; a game's players get `x` only when a row exists", () => {
  const a = new Map([[enrichKey(2025, 3, "4242335"), { tsh: 0.2 }]]);
  const b = new Map([[enrichKey(2025, 3, "4242335"), { snap: 0.8 }], [enrichKey(2025, 3, "111"), { snap: 0.1 }]]);
  const enrich = mergeEntries(a, b);
  assert.deepEqual(enrich[enrichKey(2025, 3, "4242335")], { tsh: 0.2, snap: 0.8 });
  const games = [{ season: 2025, week: 3, players: [{ id: "4242335" }, { id: "999" }] }, { season: 2025, week: 4, players: [{ id: "4242335", x: { stale: true } }] }];
  const { hit, total } = attach(games, enrich);
  assert.equal(hit, 1); assert.equal(total, 3);
  assert.deepEqual(games[0].players[0].x, { tsh: 0.2, snap: 0.8 });
  assert.equal("x" in games[0].players[1], false);
  assert.equal("x" in games[1].players[0], false, "a stale x from an earlier attach is cleared when no row exists now");
});

test("usageOf: means of the shares that are known, sums of the touches, counts of the games behind each; nothing zero-filled", () => {
  const rows = [
    { x: { snap: 0.9, tsh: 0.2, rzc: 3, rzt: 1, glc: 1 } },
    { x: { snap: 0.7, tsh: 0.3 } },
    { },
    { x: { rzc: 0, rzt: 2, glc: 0, ays: 0.4 } },
  ];
  const u = usageOf(rows);
  assert.deepEqual(u, { n: 4, snap: 0.8, snapN: 2, tsh: 0.25, tshN: 2, ays: 0.4, aysN: 1, rzc: 3, rzt: 3, glc: 1, rzN: 2 });
  assert.deepEqual(usageOf(rows, 2), { n: 2, ays: 0.4, aysN: 1, rzc: 0, rzt: 2, glc: 0, rzN: 1 }, "the last two games only");
  assert.deepEqual(usageOf([{}, {}]), { n: 2 }, "no rows known: no fields, so a consumer treats it as unknown");
});

test("gamesByPlayer: each player's rows oldest first, so `recent` means the latest games", () => {
  const games = [
    { date: "2025-09-21T00:00Z", players: [{ id: "a", x: { snap: 0.5 } }] },
    { date: "2025-09-07T00:00Z", players: [{ id: "a", x: { snap: 0.9 } }, { id: "b" }] },
  ];
  const by = gamesByPlayer(games);
  assert.deepEqual(by.get("a").map((p) => p.x.snap), [0.9, 0.5]);
  assert.equal(by.get("b").length, 1);
});

test("mergeEntries keeps every key from every map, so a rebuild of two seasons can be laid over a cache of four", () => {
  const cache = { "2023|1|a": { snap: 0.5 }, "2025|1|a": { snap: 0.6 } };
  const fresh = new Map([["2025|1|a", { snap: 0.7, tsh: 0.1 }], ["2026|1|a", { snap: 0.8 }]]);
  const rebuilt = new Set(["2025", "2026"]);
  const out = {};
  for (const k in cache) if (!rebuilt.has(k.split("|")[0])) out[k] = cache[k];
  Object.assign(out, mergeEntries(fresh));
  assert.deepEqual(out, { "2023|1|a": { snap: 0.5 }, "2025|1|a": { snap: 0.7, tsh: 0.1 }, "2026|1|a": { snap: 0.8 } });
});

test("fillZeroTouches: a game the stats saw in a week the plays covered is zero touches; an uncovered week or an unseen game stays unknown", () => {
  const enrich = { "2025|1|a": { tsh: 0.2 }, "2025|1|b": { snap: 0.6, rzc: 2, rzt: 0, glc: 1 }, "2025|1|c": { rzc: 1, rzt: 0, glc: 0 }, "2025|1|d": {}, "2025|2|a": { tsh: 0.3 } };
  assert.equal(fillZeroTouches(enrich, new Set(["2025|1"])), 1);
  assert.deepEqual(enrich["2025|1|a"], { tsh: 0.2, rzc: 0, rzt: 0, glc: 0 });
  assert.deepEqual(enrich["2025|1|b"], { snap: 0.6, rzc: 2, rzt: 0, glc: 1 }, "known touches untouched");
  assert.deepEqual(enrich["2025|1|d"], {}, "nothing saw him: still unknown");
  assert.deepEqual(enrich["2025|2|a"], { tsh: 0.3 }, "the plays have not reached week 2: unknown, not zero");
  assert.equal(fillZeroTouches({ "2025|3|a": { tsh: 0.1 } }), 1, "without a coverage set every seen game is filled");
});

test("weeklyEntries: a row with nothing measured makes no entry, so attach cannot count it as a hit", () => {
  const { entries } = weeklyEntries([{ season: "2025", week: "5", season_type: "REG", position: "WR", player_id: "00-0030000", target_share: "", air_yards_share: "", receiving_air_yards: "" }], XW);
  assert.equal(entries.size, 0);
});

test("snapEntries: a blank snap share makes no entry", () => {
  const { entries } = snapEntries([{ season: "2025", week: "3", game_type: "REG", position: "RB", pfr_player_id: "TaylJo02", offense_pct: "" }], XW);
  assert.equal(entries.size, 0);
});

/* The team-game lines the box score cannot see: sacks, red-zone trips
   and third downs, per offence per game (the defence's are its
   opponent's). Oracle: nflverse's own flags, checked against the cached
   2024-26 play-by-play. A sack is `sack` 1 (every one sits on a
   scrimmage pass row). A red-zone trip is a drive nflverse flags
   `drive_inside20`, counted once a `drive`; a two-point try is not a
   trip. A third down is a scrimmage row on down 3 marked converted or
   failed; a kneel or a spike is graded failed by nflverse but is not a
   scrimmage row, so it is neither, and the flags never sit on a penalty
   row. */
test("teamPlayEntries: sacks, red-zone trips once a drive by nflverse's flag, third downs converted and failed on scrimmage rows, keyed by season|week|offence", () => {
  const P = (o) => Object.assign({ season: 2026, week: 1, game_id: "g", posteam: "KC", defteam: "LAC", play_type: "pass", pass: 1, rush: 0, down: 1, yardline_100: 60, drive: 1, drive_inside20: 0, sack: 0, third_down_converted: 0, third_down_failed: 0, two_point_attempt: 0 }, o);
  const plays = [
    P({ sack: 1, down: 2 }),
    P({ down: 3, third_down_converted: 1 }),
    P({ down: 3, third_down_failed: 1 }),
    P({ down: 3, third_down_failed: 1, play_type: "qb_kneel", pass: 0, qb_kneel: 1 }),       // a kneel nflverse grades failed: not a scrimmage row, not a third down
    P({ down: 3, third_down_converted: 1, play_type: "no_play", pass: 0 }),                   // a penalty row: not a scrimmage row (and the flag never sits there anyway)
    P({ drive: 1, drive_inside20: 1 }), P({ drive: 1, drive_inside20: 1, play_type: "run", pass: 0, rush: 1, yardline_100: 4 }),   // one trip, two plays
    P({ drive: 2, drive_inside20: 1 }),                                                        // a second trip
    P({ drive: 2, drive_inside20: 1, two_point_attempt: 1, yardline_100: 2 }),                 // the two-point try after it: the same drive, and not a trip
    P({ drive: 3, drive_inside20: 1, play_type: "field_goal", pass: 0 }),                      // a kick is not a scrimmage row; the flag on the drive's scrimmage rows is what counts
    P({ posteam: "LAC", defteam: "KC", sack: 1 }), P({ posteam: "LAC", defteam: "KC", down: 3, third_down_failed: 1 }),
    P({ week: 2, posteam: "WSH", defteam: "LAR", down: 3, third_down_converted: 1 }),
  ];
  const t = teamPlayEntries(plays);
  assert.deepEqual(t.entries.get("2026|1|KC"), { sk: 1, rz: 2, t3a: 2, t3c: 1 });
  assert.deepEqual(t.entries.get("2026|1|LAC"), { sk: 1, rz: 0, t3a: 1, t3c: 0 });
  assert.deepEqual(t.entries.get("2026|2|WSH"), { sk: 0, rz: 0, t3a: 1, t3c: 1 }, "keys carry the codes toPlays translated (WAS→WSH, LA→LAR), the history's spelling");
  assert.equal(teamPlayEntries([]).entries.size, 0);
});
