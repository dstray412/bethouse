/*
 * BetHouse — home.test.mjs
 * The home page's arithmetic: one slate out of three boards' data, which
 * day it shows, what a game card says, and what the tile counts.
 *
 * Oracle: the data files' own shapes (nfl-data.js games[], mlb-data.js
 * games[]), nfl.js for the projection, favourite and pick (the card must
 * say what the NFL board's game view says for the same game), and the
 * rule that a number the page does not have is a cell it does not show.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import H from "./home.js";
import N from "./nfl.js";
import E from "./edge.js";

const TZ = "America/New_York";
const NOW = Date.parse("2026-10-02T20:00:00Z"); // Friday 4pm Eastern

const NFL = { games: [
  { id: "1", date: "2026-10-02T00:15Z", name: "Pittsburgh Steelers at Cleveland Browns", completed: true, home: "CLE", away: "PIT", homeId: "5", awayId: "23" },
  { id: "2", date: "2026-10-03T00:15Z", name: "A at B", completed: false, home: "BUF", away: "NE", line: { spread: -6.5, total: 44.5, homeSpreadOdds: -110, awaySpreadOdds: -110, overOdds: -105, underOdds: -115, homeML: -280, awayML: 230 } },
  { id: "3", date: "2026-10-04T17:00Z", name: "C at D", completed: false, home: "KC", away: "DEN" },
], ratings: { off: { CLE: 2, PIT: -1, BUF: 4, NE: -3, KC: 3, DEN: 0 }, def: { CLE: 0, PIT: 1, BUF: -1, NE: 2, KC: 0, DEN: 1 }, league: 21, homeField: 2 },
  teamFactors: { BUF: { off: 1.1, def: 0.9 }, NE: { off: 0.9, def: 1.2 }, KC: { off: 1.2, def: 1 }, DEN: { off: 1, def: 1 } },
  usagePool: [], players: [
    { id: "a", name: "James Cook", team: "BUF", opp: "NE", pos: "RB", games: 4, tds: 4, carries: 70, targets: 12, recYds: 60, rushYds: 380, recs: 10 },
    { id: "b", name: "Josh Allen", team: "BUF", opp: "NE", pos: "QB", games: 4, tds: 2, carries: 30, targets: 0, recYds: 0, rushYds: 150, recs: 0 },
    { id: "c", name: "Out Guy", team: "NE", opp: "BUF", pos: "WR", games: 4, tds: 5, carries: 0, targets: 40, recYds: 400, rushYds: 0, recs: 28, status: "Out" },
    { id: "d", name: "Travis Kelce", team: "KC", opp: "DEN", pos: "TE", games: 4, tds: 3, carries: 0, targets: 36, recYds: 300, rushYds: 0, recs: 24 },
  ] };
const CFB = { games: [{ id: "9", date: "2026-10-02T23:30Z", name: "X at Y", completed: false, home: "UTAH", away: "BYU", homeId: "254", awayId: "252" }], ratings: null, players: [], teamFactors: {} };
const MLB = { date: "2026-10-02", games: [
  { gamePk: 1, startTime: "2026-10-02T22:08:00Z", status: "Pre-Game", abstract: "Preview", live: false, venue: "Citizens Bank Park",
    away: { team: "Philadelphia Phillies", abbrev: "PHI", teamId: 143, confirmed: true, lineup: [{ id: 1 }, { id: 2 }] },
    home: { team: "Atlanta Braves", abbrev: "ATL", teamId: 144, confirmed: false, lineup: [] },
    awayFaces: { name: "Chris Sale", era: "2.16" }, homeFaces: { name: "Chris Sale Jr", era: "3.10" } },
  { gamePk: 2, startTime: "2026-10-01T23:00:00Z", status: "Final", abstract: "Final", live: false, away: { team: "A", abbrev: "AAA", teamId: 1, confirmed: true, lineup: [{ id: 3 }] }, home: { team: "B", abbrev: "BBB", teamId: 2, confirmed: true, lineup: [{ id: 4 }] } },
] };

test("normalise: one list across the boards, each game with its keys, board and state", () => {
  const all = H.normalise({ nfl: NFL, cfb: CFB, mlb: MLB }, NOW);
  assert.equal(all.length, 6);
  const buf = all.find((g) => g.id === "nfl:2");
  assert.deepEqual({ sport: buf.sport, league: buf.league, home: buf.home, away: buf.away, board: buf.board, state: buf.state, start: buf.start },
    { sport: "football", league: "NFL", home: "BUF", away: "NE", board: "nfl.html", state: "pre", start: "2026-10-03T00:15Z" });
  assert.equal(all.find((g) => g.id === "nfl:1").state, "post", "completed is final");
  assert.equal(all.find((g) => g.id === "cfb:9").board, "cfb.html");
  const phi = all.find((g) => g.id === "mlb:1");
  assert.deepEqual({ sport: phi.sport, league: phi.league, home: phi.home, away: phi.away, homeKey: phi.homeKey, awayKey: phi.awayKey, state: phi.state, board: phi.board },
    { sport: "baseball", league: "MLB", home: "ATL", away: "PHI", homeKey: "atl", awayKey: "phi", state: "pre", board: "baseball.html" });
  assert.equal(all.find((g) => g.id === "mlb:2").state, "post");
  assert.equal(H.normalise({}, NOW).length, 0, "no data files: no games, no throw");
});

test("state: a football game past its kickoff but not marked complete reads as started, not final", () => {
  const all = H.normalise({ nfl: { games: [{ id: "s", date: "2026-10-02T19:00Z", completed: false, home: "A", away: "B" }] } }, NOW);
  assert.equal(all[0].state, "in");
});

test("localDay: the calendar day where the reader is, not UTC", () => {
  assert.equal(H.localDay("2026-10-03T00:15Z", TZ), "2026-10-02", "a Friday-night kickoff is Friday in New York");
  assert.equal(H.localDay("2026-10-03T00:15Z", "UTC"), "2026-10-03");
});

test("slate: today's games when there are any, in start order, finished ones kept", () => {
  const all = H.normalise({ nfl: NFL, cfb: CFB, mlb: MLB }, NOW);
  const s = H.slate(all, NOW, TZ);
  assert.equal(s.when, "today");
  assert.equal(s.day, "2026-10-02");
  assert.deepEqual(s.games.map((g) => g.id), ["mlb:1", "cfb:9", "nfl:2"], "today in New York: the 6pm MLB game, the 7:30 college game, the 8:15 NFL game; yesterday's final and Sunday are not today");
});

test("slate: with nothing today, the next day that has games, and never a past day", () => {
  const all = H.normalise({ nfl: NFL, cfb: CFB, mlb: MLB }, NOW);
  const later = Date.parse("2026-10-03T12:00:00Z"); // Saturday morning Eastern
  const s = H.slate(all, later, TZ);
  assert.equal(s.when, "next");
  assert.equal(s.day, "2026-10-04");
  assert.deepEqual(s.games.map((g) => g.id), ["nfl:3"]);
  assert.deepEqual(H.slate([], NOW, TZ), { when: "none", day: null, games: [] });
});

test("dayLabel and sentence: measured words for the heading", () => {
  assert.equal(H.dayLabel("2026-10-02", NOW, TZ), "Today");
  assert.equal(H.dayLabel("2026-10-03", NOW, TZ), "Tomorrow");
  assert.equal(H.dayLabel("2026-10-04", NOW, TZ), "Sunday");
  const all = H.normalise({ nfl: NFL, cfb: CFB, mlb: MLB }, NOW);
  const s = H.slate(all, NOW, TZ);
  assert.equal(H.sentence(s, TZ), "3 games: 1 NFL, 1 college, 1 MLB · first at 6:08 PM");
  assert.equal(H.sentence(H.slate([all.find((g) => g.id === "nfl:3")], NOW, TZ), TZ), "1 game: 1 NFL · Sunday at 1:00 PM");
  assert.equal(H.sentence({ when: "none", day: null, games: [] }, TZ), "No games on the boards yet.");
});

test("logoUrl: ESPN's logo CDN by league, keys sanitised, nothing without a key", () => {
  assert.equal(H.logoUrl("NFL", "CLE"), "https://a.espncdn.com/i/teamlogos/nfl/500/cle.png");
  assert.equal(H.logoUrl("MLB", "phi"), "https://a.espncdn.com/i/teamlogos/mlb/500/phi.png");
  assert.equal(H.logoUrl("College football", "254"), "https://a.espncdn.com/i/teamlogos/ncaa/500/254.png");
  assert.equal(H.logoUrl("College football", null), null, "college needs the numeric id");
  assert.equal(H.logoUrl("NFL", "cle\"><script>"), null, "a key is letters and digits or nothing");
  assert.equal(H.logoUrl("Curling", "x"), null);
});

test("normalise: college keys are the numeric ids; the NFL and MLB keys are abbreviations", () => {
  const all = H.normalise({ nfl: NFL, cfb: CFB, mlb: MLB }, NOW);
  assert.deepEqual([all.find((g) => g.id === "cfb:9").homeKey, all.find((g) => g.id === "cfb:9").awayKey], ["254", "252"]);
  assert.equal(all.find((g) => g.id === "nfl:2").homeKey, "buf", "NFL by abbreviation even when ids are missing from the file");
  assert.equal(H.normalise({ cfb: { games: [{ id: "z", date: "2026-10-02T23:30Z", home: "UTAH", away: "BYU" }] } }, NOW)[0].homeKey, null, "a college game without ids has no logo key");
});

test("footballCard: the projection, favourite and pick the NFL board's game view shows", () => {
  const all = H.normalise({ nfl: NFL }, NOW);
  const g = all.find((x) => x.id === "nfl:2");
  const c = H.footballCard(N, E, NFL, g);
  const pr = N.projectGame(NFL.ratings, "BUF", "NE", { neutral: false });
  assert.equal(c.homePts, Math.round(pr.homePts)); assert.equal(c.awayPts, Math.round(pr.awayPts));
  assert.equal(c.fav.team, "BUF"); assert.equal(c.fav.prob, N.winProbability(pr.margin));
  const pick = N.pickGame(pr, NFL.games[1].line);
  const evs = ["spread", "total"].map((p) => pick[p] ? E.evPct(pick[p].prob, E.americanToDecimal(pick[p].price)) : -Infinity);
  assert.equal(c.pick.ev, Math.max(...evs), "the better of spread and total by EV; never the moneyline");
  assert.match(c.pick.text, /^(BUF|NE) [+-]\d|^[ou]\d/);
  const noLine = H.footballCard(N, E, NFL, all.find((x) => x.id === "nfl:3"));
  assert.equal(noLine.pick, null, "no line, no pick"); assert.equal(noLine.fav.team, "KC");
  assert.equal(H.footballCard(N, E, { ratings: null }, g), null, "no ratings, no card");
});

test("topTD: the best touchdown chance among players in the slate's open football games, nobody ruled out", () => {
  const all = H.normalise({ nfl: NFL, cfb: CFB, mlb: MLB }, NOW);
  const s = H.slate(all, NOW, TZ);
  const top = H.topTD(N, { nfl: NFL, cfb: CFB }, s.games);
  assert.ok(top && top.prob > 0 && top.prob < 1);
  assert.notEqual(top.name, "Out Guy");
  assert.notEqual(top.name, "Travis Kelce", "Sunday's game is not on today's slate");
  assert.equal(top.board, "nfl.html");
  assert.equal(H.topTD(N, { nfl: NFL }, []), null, "no games, no card");
});

test("topEdge: the game pick with the most positive EV on the slate, or nothing", () => {
  const all = H.normalise({ nfl: NFL, cfb: CFB, mlb: MLB }, NOW);
  const cards = H.slate(all, NOW, TZ).games.map((g) => ({ game: g, card: g.sport === "football" ? H.footballCard(N, E, g.league === "NFL" ? NFL : CFB, g) : null }));
  // The model shrinks a cover chance toward a coin flip (the replay found no edge on the lines), so at -110 nothing here is an edge.
  assert.ok(cards.every((c) => !c.card || !c.card.pick || c.card.pick.ev < 0));
  assert.equal(H.topEdge(cards), null, "a pick that loses money at its price is not an edge, however it ranks");
  assert.equal(H.topEdge([]), null);
  const g = cards[0].game;
  const some = [{ game: g, card: { pick: { text: "a", ev: 0.012, prob: 0.55, price: -110 } } }, { game: g, card: { pick: { text: "b", ev: 0.031, prob: 0.56, price: -105 } } }, { game: g, card: null }];
  assert.equal(H.topEdge(some).card.pick.text, "b", "the most EV among the positive ones");
});

test("counts: the tile's numbers, each only from data that loaded", () => {
  const c = H.counts({ nfl: NFL, cfb: CFB, mlb: MLB, records: [{ total: 100 }, null, { total: 5 }] }, 3);
  assert.deepEqual(c, { games: 3, players: 4 + 0 + 4, graded: 105 }, "players: football players plus batters in posted lineups (both lineups of the final, the away lineup of the pre-game)");
  assert.deepEqual(H.counts({}, 0), { games: 0, players: 0, graded: 0 });
});

test("golfLine: the current event when it starts within the week", () => {
  const P = { event: { name: "Bank of Utah Championship", date: "2026-10-01T04:00Z", state: "pre", cut: 65 }, field: new Array(120) };
  assert.equal(H.golfLine(P, Date.parse("2026-09-29T20:00:00Z"), TZ), "Bank of Utah Championship starts Thursday · 120 in the field");
  assert.equal(H.golfLine(Object.assign({}, P, { event: Object.assign({}, P.event, { state: "in" }) }), NOW, TZ), "Bank of Utah Championship is under way · 120 in the field");
  assert.equal(H.golfLine(P, Date.parse("2026-09-20T20:00:00Z"), TZ), null, "more than a week out: nothing");
  assert.equal(H.golfLine(P, Date.parse("2026-09-29T20:00:00Z"), "America/Los_Angeles"), "Bank of Utah Championship starts Thursday · 120 in the field", "the tour's day is Eastern: midnight Eastern is not Wednesday evening in Los Angeles");
  assert.equal(H.golfLine(null, NOW, TZ), null);
});
