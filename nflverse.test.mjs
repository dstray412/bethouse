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
import { parseCSV, toGame, rowsToGames } from "./nflverse.mjs";

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
