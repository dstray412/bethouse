/*
 * BetHouse — cfbfastr.test.mjs
 * The cfbfastR-data loader: twenty seasons of college schedules and lines
 * into the model's game shape.
 *
 * Oracle for the sign: the lines table gives each side its own number, and
 * the home side's number IS the home-relative spread in our convention
 * (negative = home favoured). Utah −1.5 at home in 2006 is spread −1.5.
 * Oracle for the side mapping: an abbreviation co-occurs with its own team
 * id in every game it appears in and with the opponent's id only once.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { abbrToTeam, closingLines, toGame } from "./cfbfastr.mjs";

const lineRow = (gid, home, away, market, abbr, line, odds, book, open) => ({
  game_id: gid, market_type: market, abbr, lines: line, odds, book, opening_lines: open ?? "", home_team_id: home, away_team_id: away,
});

test("abbrToTeam: the id that keeps showing up with the abbreviation is the team", () => {
  const rows = [
    lineRow("1", "254", "2628", "spread", "TCU", "1.5", "-103", "A"), lineRow("1", "254", "2628", "spread", "UTH", "-1.5", "-117", "A"),
    lineRow("2", "2628", "99", "spread", "UTH", "-7", "-110", "A"), lineRow("2", "2628", "99", "spread", "XYZ", "7", "-110", "A"),
    lineRow("3", "254", "77", "spread", "TCU", "-3", "-110", "A"), lineRow("3", "254", "77", "spread", "QQQ", "3", "-110", "A"),
  ];
  const m = abbrToTeam(rows);
  assert.equal(m.get("UTH"), "2628");
  assert.equal(m.get("TCU"), "254");
});

test("closingLines: the home side's spread, the total, from the preferred book, opening kept", () => {
  const rows = [
    lineRow("1", "254", "2628", "spread", "TCU", "1.5", "-103", "5Dimes & sportbet", "2.5"),
    lineRow("1", "254", "2628", "spread", "UTH", "-1.5", "-117", "5Dimes & sportbet", "-2.5"),
    lineRow("1", "254", "2628", "spread", "TCU", "2.0", "-110", "PINNACLE", "3"),
    lineRow("1", "254", "2628", "spread", "UTH", "-2.0", "-110", "PINNACLE", "-3"),
    lineRow("1", "254", "2628", "total", "TCU", "48.5", "-110", "PINNACLE", "47"),
    lineRow("1", "254", "2628", "total", "UTH", "48.5", "-110", "PINNACLE", "47"),
    lineRow("1", "254", "2628", "money_line", "UTH", "", "-130", "PINNACLE"),
    lineRow("1", "254", "2628", "money_line", "TCU", "", "110", "PINNACLE"),
  ];
  // ESPN's 254 is Utah, the home side in these rows; 2628 is TCU.
  const abbr = new Map([["TCU", "2628"], ["UTH", "254"]]);
  const L = closingLines(rows, abbr);
  const g = L.get("1");
  assert.equal(g.spread, -2, "Pinnacle's home line, home favoured by 2");
  assert.equal(g.total, 48.5);
  assert.equal(g.homeML, -130);
  assert.equal(g.awayML, 110);
  assert.equal(g.book, "PINNACLE");
  assert.deepEqual(g.open, { spread: -3, total: 47 });
});

test("closingLines: without a preferred book, the median across books", () => {
  const rows = [
    lineRow("1", "254", "2628", "spread", "UTH", "-1.5", "-110", "A"), lineRow("1", "254", "2628", "spread", "UTH", "-2.5", "-110", "B"), lineRow("1", "254", "2628", "spread", "UTH", "-3", "-110", "C"),
    lineRow("1", "254", "2628", "total", "UTH", "50", "-110", "A"), lineRow("1", "254", "2628", "total", "UTH", "51", "-110", "B"),
  ];
  const g = closingLines(rows, new Map([["UTH", "254"]])).get("1");
  assert.equal(g.spread, -2.5);
  assert.equal(g.total, 50.5);
  assert.equal(g.book, "median of 3");
});

test("toGame: schedule row plus its line, FCS pooled, neutral carried, our shape", () => {
  const sched = {
    game_id: "401634197", season: "2024", week: "1", season_type: "regular", start_date: "2024-08-31T19:30:00.000Z", neutral_site: "FALSE",
    home_id: "66", home_team: "Iowa State", home_division: "fbs", home_points: "21", away_id: "155", away_team: "North Dakota", away_division: "fcs", away_points: "3",
  };
  const g = toGame(sched, { spread: -35.5, total: 48, book: "PINNACLE" });
  assert.equal(g.home.team, "Iowa State");
  assert.equal(g.away.team, "FCS", "an FCS side is pooled, as the ESPN cache does");
  assert.equal(g.home.score, 21);
  assert.equal(g.spread, -35.5);
  assert.equal(g.week, 1);
  assert.equal("neutral" in g, false);
  assert.equal(toGame(Object.assign({}, sched, { neutral_site: "TRUE" }), null).neutral, true);
  assert.equal(toGame(Object.assign({}, sched, { home_points: "" }), null), null, "unplayed");
  assert.equal(toGame(Object.assign({}, sched, { season_type: "postseason" }), null), null, "regular season only");
});
