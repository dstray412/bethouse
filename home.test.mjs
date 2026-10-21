/*
 * BetHouse — home.test.mjs
 * The home page's arithmetic: one slate out of two boards' data, which
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
const MLB = { date: "2026-10-02", games: [
  { gamePk: 1, startTime: "2026-10-02T22:08:00Z", status: "Pre-Game", abstract: "Preview", live: false, venue: "Citizens Bank Park",
    away: { team: "Philadelphia Phillies", abbrev: "PHI", teamId: 143, confirmed: true, lineup: [{ id: 1 }, { id: 2 }] },
    home: { team: "Atlanta Braves", abbrev: "ATL", teamId: 144, confirmed: false, lineup: [] },
    awayFaces: { name: "Chris Sale", era: "2.16" }, homeFaces: { name: "Chris Sale Jr", era: "3.10" } },
  { gamePk: 2, startTime: "2026-10-01T23:00:00Z", status: "Final", abstract: "Final", live: false, away: { team: "A", abbrev: "AAA", teamId: 1, confirmed: true, lineup: [{ id: 3 }] }, home: { team: "B", abbrev: "BBB", teamId: 2, confirmed: true, lineup: [{ id: 4 }] } },
] };

test("normalise: one list across the boards, each game with its keys, board and state", () => {
  const all = H.normalise({ nfl: NFL, mlb: MLB }, NOW);
  assert.equal(all.length, 5);
  const buf = all.find((g) => g.id === "nfl:2");
  assert.deepEqual({ sport: buf.sport, league: buf.league, home: buf.home, away: buf.away, board: buf.board, state: buf.state, start: buf.start },
    { sport: "football", league: "NFL", home: "BUF", away: "NE", board: "nfl.html", state: "pre", start: "2026-10-03T00:15Z" });
  assert.equal(all.find((g) => g.id === "nfl:1").state, "post", "completed is final");
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
  const all = H.normalise({ nfl: NFL, mlb: MLB }, NOW);
  const s = H.slate(all, NOW, TZ);
  assert.equal(s.when, "today");
  assert.equal(s.day, "2026-10-02");
  assert.deepEqual(s.games.map((g) => g.id), ["mlb:1", "nfl:2"], "today in New York: the 6pm MLB game, the 8:15 NFL game; yesterday's final and Sunday are not today");
});

test("slate: with nothing today, the next day that has games, and never a past day", () => {
  const all = H.normalise({ nfl: NFL, mlb: MLB }, NOW);
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
  const all = H.normalise({ nfl: NFL, mlb: MLB }, NOW);
  const s = H.slate(all, NOW, TZ);
  assert.equal(H.sentence(s, TZ), "2 games: 1 NFL, 1 MLB · first at 6:08 PM");
  assert.equal(H.sentence(H.slate([all.find((g) => g.id === "nfl:3")], NOW, TZ), TZ), "1 game: 1 NFL · Sunday at 1:00 PM");
  assert.equal(H.sentence({ when: "none", day: null, games: [] }, TZ), "No games on the boards yet.");
});

test("logoUrl: ESPN's logo CDN by league, keys sanitised, nothing without a key", () => {
  assert.equal(H.logoUrl("NFL", "CLE"), "https://a.espncdn.com/i/teamlogos/nfl/500/cle.png");
  assert.equal(H.logoUrl("MLB", "phi"), "https://a.espncdn.com/i/teamlogos/mlb/500/phi.png");
  assert.equal(H.logoUrl("NFL", "cle\"><script>"), null, "a key is letters and digits or nothing");
  assert.equal(H.logoUrl("Curling", "x"), null);
});

test("normalise: the NFL and MLB keys are abbreviations", () => {
  const all = H.normalise({ nfl: NFL, mlb: MLB }, NOW);
  assert.equal(all.find((g) => g.id === "nfl:2").homeKey, "buf", "NFL by abbreviation even when ids are missing from the file");
  assert.equal(all.find((g) => g.id === "nfl:1").awayKey, "pit", "the abbreviation, not the id the file also carries");
});

test("footballCard: the projection and the favourite the NFL board's game view shows; no pick and no price", () => {
  const all = H.normalise({ nfl: NFL }, NOW);
  const g = all.find((x) => x.id === "nfl:2");
  const c = H.footballCard(N, NFL, g);
  const pr = N.projectGame(NFL.ratings, "BUF", "NE", { neutral: false });
  assert.equal(c.homePts, Math.round(pr.homePts)); assert.equal(c.awayPts, Math.round(pr.awayPts));
  assert.equal(c.fav.team, "BUF"); assert.equal(c.fav.prob, N.winProbability(pr.margin));
  assert.equal("pick" in c, false, "a card carries no pick: the site shows chances, not odds (2026-10-17)");
  assert.doesNotMatch(JSON.stringify(c), /price|\bev\b/i);
  const noLine = H.footballCard(N, NFL, all.find((x) => x.id === "nfl:3"));
  assert.equal(noLine.fav.team, "KC");
  assert.equal(H.footballCard(N, { ratings: null }, g), null, "no ratings, no card");
});

test("favLabel, pitcherLabel: the card's words say only what the number says", () => {
  assert.equal("evLabel" in H, false, "no EV label: the site shows chances, not odds");
  assert.equal(H.favLabel({ team: "BUF", prob: 0.7295 }), "BUF 73%");
  assert.equal(H.favLabel({ team: "SF", prob: 0.5006 }), "pick 'em", "a favourite at fifty percent is not a favourite");
  assert.equal(H.favLabel(null), null);
  assert.equal(H.pitcherLabel({ name: "Lance McCullers Jr.", era: "3.21" }), "McCullers 3.21");
  assert.equal(H.pitcherLabel({ name: "Chris Sale", era: "2.16" }), "Sale 2.16");
  assert.equal(H.pitcherLabel({ name: "Ken Griffey Jr" }), "Griffey");
  assert.equal(H.pitcherLabel(null), "TBD");
});

test("counts: the tile's numbers, each only from data that loaded", () => {
  const c = H.counts({ nfl: NFL, mlb: MLB, records: [{ total: 100 }, null, { total: 5 }] }, 2);
  assert.deepEqual(c, { games: 2, players: 4 + 4, graded: 105 }, "players: football players plus batters in posted lineups (both lineups of the final, the away lineup of the pre-game)");
  assert.deepEqual(H.counts({}, 0), { games: 0, players: 0, graded: 0 });
});

/* ------------------------------------------------------------------ *
 * The vocabulary strip's record cell (2026-10-21): said and hit across
 * every record's props, weighted by graded calls. Oracle: the record
 * files' own shape (props[k] = {n, predicted, actual} in percent) and
 * the rule that a number the page does not have is a cell it does not
 * show.
 * ------------------------------------------------------------------ */
test("saidHit: said and hit across the records' props, weighted by graded calls; null with nothing graded", () => {
  const nfl = { total: 100, props: { td: { n: 60, predicted: 20, actual: 22 }, recyds: { n: 40, predicted: 50, actual: 45 } } };
  const mlb = { total: 10, props: { hrr: { n: 10, predicted: 70, actual: 60 } } };
  const r = H.saidHit([nfl, mlb]);
  assert.equal(r.n, 110);
  assert.ok(Math.abs(r.said - (60 * 20 + 40 * 50 + 10 * 70) / 110) < 1e-9, "said is not the n-weighted mean");
  assert.ok(Math.abs(r.hit - (60 * 22 + 40 * 45 + 10 * 60) / 110) < 1e-9, "hit is not the n-weighted mean");
  assert.equal(H.saidHit([null, {}, { props: { x: { n: 0, predicted: 50, actual: 50 } } }]), null, "nothing graded is a null, not a zero");
  assert.equal(H.saidHit(), null);
  assert.deepEqual(H.saidHit([{ props: { a: { n: 10, predicted: 30, actual: 31 }, b: { n: 5, predicted: "x", actual: 1 } } }]), { n: 10, said: 30, hit: 31 }, "a malformed prop is skipped, not counted");
});
