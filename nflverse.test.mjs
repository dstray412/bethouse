/*
 * BetHouse — nflverse.test.mjs
 * The nflverse loader: a CSV parser with no dependency, and the conversion
 * of nflverse rows into the game shape the football model already reads.
 *
 * Oracle for the sign convention: 2024 week 1, Baltimore at Kansas City.
 * nflverse says spread_line 3 (positive = home favoured); our cache and
 * ESPN say KC -3. Ours is the negation, and getting it wrong flips every
 * road favourite in 27 seasons.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSV, toGame, rowsToGames, maxAgeHoursFor, isStale } from "./nflverse.mjs";

test("parseCSV: quoted fields, embedded commas, empty cells, CRLF", () => {
  const rows = parseCSV('a,b,c\r\n1,"x, y",\n"",3,"q""uote"\n');
  assert.deepEqual(rows, [
    { a: "1", b: "x, y", c: "" },
    { a: "", b: "3", c: 'q"uote' },
  ]);
  assert.deepEqual(parseCSV(""), []);
  assert.deepEqual(parseCSV("only,header\n"), []);
});

const row = (over) => Object.assign({
  game_id: "2024_01_BAL_KC", season: "2024", game_type: "REG", week: "1", gameday: "2024-09-05", gametime: "20:20",
  away_team: "BAL", away_score: "20", home_team: "KC", home_score: "27", location: "Home",
  total: "47", away_moneyline: "124", home_moneyline: "-148", spread_line: "3",
  away_spread_odds: "-118", home_spread_odds: "-102", total_line: "46", roof: "outdoors", temp: "67", wind: "8",
}, over || {});

test("toGame: the spread is negated into our home-relative convention", () => {
  const g = toGame(row());
  assert.equal(g.spread, -3, "KC -3 at home");
  assert.equal(g.total, 46);
  assert.equal(g.homeML, -148);
  assert.equal(g.awayML, 124);
  assert.equal(g.homeSpreadOdds, -102);
  assert.equal(g.awaySpreadOdds, -118);
  assert.equal(g.home.team, "KC");
  assert.equal(g.home.score, 27);
  assert.equal(g.away.score, 20);
  assert.equal(g.season, 2024);
  assert.equal(g.week, 1);
  assert.equal("neutral" in g, false);
  assert.equal(g.wind, 8);
  assert.equal(g.temp, 67);
  assert.equal(g.roof, "outdoors");
  // The grading identity must hold on the converted game: KC won by 7 and
  // was favoured by 3, so the home side covered.
  assert.ok(g.home.score - g.away.score + g.spread > 0);
});

test("toGame: a road favourite keeps its sign", () => {
  const g = toGame(row({ spread_line: "-7.5" })); // away favoured by 7.5
  assert.equal(g.spread, 7.5);
});

test("toGame: neutral sites, missing weather and unplayed games", () => {
  assert.equal(toGame(row({ location: "Neutral" })).neutral, true);
  const bare = toGame(row({ temp: "", wind: "", total_line: "", spread_line: "" }));
  assert.equal(bare.wind, null);
  assert.equal(bare.temp, null);
  assert.equal(bare.spread, null);
  assert.equal(bare.total, null);
  assert.equal(toGame(row({ home_score: "", away_score: "" })), null, "no score, no game");
});

test("rowsToGames: regular season only unless asked, sorted by date", () => {
  const games = rowsToGames([
    row({ game_id: "b", gameday: "2024-09-08", week: "1" }),
    row({ game_id: "a", gameday: "2024-09-05", week: "1" }),
    row({ game_id: "p", game_type: "WC", week: "19", gameday: "2025-01-11" }),
  ]);
  assert.deepEqual(games.map((g) => g.id), ["a", "b"]);
  assert.equal(rowsToGames([row({ game_type: "WC", week: "19" })], { playoffs: true }).length, 1);
});

/* ------------------------------------------------------------------ *
 * Play-by-play: the columns we keep, the gzip on disk, the team codes
 *
 * A season of play-by-play is ~370 columns and ~50,000 rows. Building an
 * object with all 370 columns per row costs about 18 million strings per
 * season for the forty we use, and `desc` alone — the play's English,
 * commas and quotes and all — is the largest field in the file. So parseCSV
 * takes a `keep` set, and these tests pin that it keeps exactly that and
 * nothing else while still parsing the quoting correctly.
 *
 * The file on disk stays gzipped: 2 MB instead of 11 for 2026, 19 instead
 * of ~120 for a full season. node:zlib does the rest at load time.
 * ------------------------------------------------------------------ */
import { gzipSync } from "node:zlib";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipFile, toEspnTeam, toPlays, toFtnMap, isScrimmage, ftnKey } from "./nflverse.mjs";

test("parseCSV: `keep` materialises only the columns asked for", () => {
  const text = 'a,desc,c\n1,"a long, quoted ""play"" description",3\n';
  assert.deepEqual(parseCSV(text, ["a", "c"]), [{ a: "1", c: "3" }]);
  assert.deepEqual(parseCSV(text, new Set(["desc"])), [{ desc: 'a long, quoted "play" description' }]);
  assert.deepEqual(parseCSV(text), [{ a: "1", desc: 'a long, quoted "play" description', c: "3" }],
    "no keep, no change");
  assert.deepEqual(parseCSV(text, ["nope"]), [{}], "a column that is not there is simply absent");
  // A skipped column still has to be *parsed*, or its commas and newlines
  // would shift every column after it.
  assert.deepEqual(parseCSV('a,desc,c\n1,"x, y\nz",9\n', ["a", "c"]), [{ a: "1", c: "9" }]);
  assert.deepEqual(parseCSV("a,b\n\n1,2\n", ["b"]), [{ b: "2" }], "blank lines stay skipped");
});

test("gunzipFile: the cache holds the .gz and the loader decompresses it", () => {
  const dir = mkdtempSync(join(tmpdir(), "bethouse-gz-"));
  try {
    const text = "game_id,play_id,posteam\n2026_01_ARI_LAC,924,LAC\n";
    const f = join(dir, "play_by_play_test.csv.gz");
    writeFileSync(f, gzipSync(Buffer.from(text, "utf8")));
    assert.equal(gunzipFile(f), text);
    assert.deepEqual(parseCSV(gunzipFile(f), ["posteam"]), [{ posteam: "LAC" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("toEspnTeam: two codes disagree with the rest of the repo, and only two", () => {
  // nflverse says LA and WAS; every other file in this repo (and ESPN, which
  // wrote them) says LAR and WSH. Measured against nfl-history.json, whose 32
  // codes match nflverse's on all thirty others.
  assert.equal(toEspnTeam("LA"), "LAR");
  assert.equal(toEspnTeam("WAS"), "WSH");
  assert.equal(toEspnTeam("KC"), "KC");
  assert.equal(toEspnTeam("LAC"), "LAC", "the other Los Angeles team was never renamed");
  assert.equal(toEspnTeam(""), "");
  assert.equal(toEspnTeam(null), "");
});

const pbpRow = (over) => Object.assign({
  game_id: "2026_01_ARI_LAC", play_id: "924", season: "2026", week: "1", season_type: "REG",
  posteam: "LA", defteam: "WAS", play_type: "run", yards_gained: "-4",
  shotgun: "1", no_huddle: "0", qb_dropback: "0", qb_kneel: "0", qb_spike: "0", qb_scramble: "0",
  pass_length: "", pass_location: "", air_yards: "", yards_after_catch: "",
  run_location: "left", run_gap: "end", down: "1", ydstogo: "10", yardline_100: "75",
  score_differential: "0", game_seconds_remaining: "1800", epa: "-5.19676485145465", success: "0",
  pass: "0", rush: "1", sack: "0", qb_hit: "0", complete_pass: "0", incomplete_pass: "0",
  interception: "0", fumble_lost: "0", touchdown: "0", xpass: "0.5", pass_oe: "-63.1224691867828",
  cpoe: "", wp: "0.5", vegas_wp: "0.5", aborted_play: "0", special: "0",
}, over || {});

test("toPlays: numbers are numbers, team codes are ESPN's, blanks are null", () => {
  const [p] = toPlays([pbpRow()]);
  assert.equal(p.posteam, "LAR");
  assert.equal(p.defteam, "WSH");
  assert.equal(p.yards_gained, -4);
  assert.equal(p.play_id, 924);
  assert.equal(p.season, 2026);
  assert.equal(p.week, 1);
  assert.equal(p.rush, 1);
  assert.equal(p.air_yards, null, "an empty cell is null, not 0");
  assert.equal(p.cpoe, null);
  assert.ok(Math.abs(p.epa + 5.19676485145465) < 1e-12);
  assert.ok(Math.abs(p.pass_oe + 63.1224691867828) < 1e-9);
  assert.equal(p.run_gap, "end", "the text columns stay text");
  assert.equal(p.game_id, "2026_01_ARI_LAC");
  assert.equal("desc" in p, false, "the play's English is not carried around");
});

test("toPlays: only regular-season scrimmage snaps, unless asked otherwise", () => {
  const rows = [
    pbpRow(),                                                     // a run: keep
    pbpRow({ play_type: "pass", pass: "1", rush: "0" }),           // a dropback: keep
    pbpRow({ season_type: "POST" }),                               // playoffs
    pbpRow({ posteam: "" }),                                       // GAME / END QUARTER marker
    pbpRow({ play_type: "punt", special: "1", rush: "0" }),         // special teams
    pbpRow({ play_type: "no_play", pass: "0", rush: "0" }),         // a penalty wiped it out
    pbpRow({ play_type: "qb_kneel", qb_kneel: "1", rush: "0" }),
    pbpRow({ play_type: "qb_spike", qb_spike: "1", pass: "0", rush: "0" }),
    pbpRow({ aborted_play: "1" }),
  ];
  assert.equal(toPlays(rows).length, 2, "two real snaps in nine rows");
  assert.equal(toPlays(rows, { postseason: true }).length, 3, "the playoff snap comes back");
  assert.equal(toPlays(rows, { scrimmageOnly: false }).length, 7, "everything else with a posteam");
});

test("isScrimmage: a scramble is a snap even though nflverse calls it a run", () => {
  // Measured, 2026 weeks 1–2: 149 scrambles, every one with pass=1 and
  // rush=0 under play_type "run". Ten of them have qb_dropback=0, which is
  // why nothing here reads qb_dropback.
  const scramble = toPlays([pbpRow({ play_type: "run", pass: "1", rush: "0", qb_scramble: "1", qb_dropback: "0" })]);
  assert.equal(scramble.length, 1);
  assert.equal(scramble[0].pass, 1, "a scramble is a dropback");
  assert.equal(isScrimmage({ play_type: "run", pass: 0, rush: 0 }), false, "nothing happened");
});

test("toFtnMap: charting rows key on the nflverse game and play id", () => {
  const rows = [{
    nflverse_game_id: "2026_01_NE_SEA", nflverse_play_id: "64", season: "2026", week: "1",
    is_play_action: "TRUE", is_rpo: "FALSE", is_screen_pass: "FALSE", is_motion: "TRUE",
    is_no_huddle: "FALSE", is_qb_sneak: "FALSE", is_trick_play: "FALSE",
    is_qb_out_of_pocket: "FALSE", is_interception_worthy: "FALSE", is_catchable_ball: "TRUE",
    is_contested_ball: "FALSE", is_drop: "FALSE", is_throw_away: "FALSE", is_qb_fault_sack: "FALSE",
    n_blitzers: "2", n_pass_rushers: "6", n_offense_backfield: "2", n_defense_box: "6",
    starting_hash: "L", qb_location: "U", read_thrown: "0",
  }];
  const m = toFtnMap(rows);
  const f = m.get(ftnKey("2026_01_NE_SEA", 64));
  assert.ok(f, "the key a play can be looked up by");
  assert.equal(f.is_play_action, true, "TRUE/FALSE become booleans");
  assert.equal(f.is_rpo, false);
  assert.equal(f.n_blitzers, 2, "counts become numbers");
  assert.equal(f.starting_hash, "L");
  assert.equal(m.get(ftnKey("2026_01_NE_SEA", "64")), f, "a string id keys the same row");
  assert.equal(m.get(ftnKey("2026_01_NE_SEA", 65)), undefined);
});

test("the season under way is re-fetched after twelve hours; a finished season never is", () => {
  // Oracle: the CI cache restores nflverse/ between runs, so without this the
  // in-progress play-by-play would freeze at the week first downloaded.
  const now = new Date("2026-09-21T12:00:00Z");
  assert.equal(maxAgeHoursFor(2026, now), 12);
  assert.equal(maxAgeHoursFor("2026", now), 12);
  assert.equal(maxAgeHoursFor(2025, now), Infinity);
  const t0 = Date.parse("2026-09-21T00:00:00Z");
  assert.equal(isStale(t0, 12, t0 + 11 * 3600 * 1000), false);
  assert.equal(isStale(t0, 12, t0 + 13 * 3600 * 1000), true);
  assert.equal(isStale(t0, Infinity, t0 + 1e12), false, "a finished season is never stale");
});
