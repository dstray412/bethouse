/*
 * BetHouse — live.test.mjs
 * The live tracker's arithmetic: reading a player's line out of the two
 * public feeds, and turning a tracked prop into a count, a target and a
 * status. The page polls; this file never does.
 *
 * Oracle: the feeds' own shapes (ESPN's game summary boxscore.players,
 * MLB's live feed boxscore.teams.*.players), the model's gameValue for
 * what a counting prop sums, and the tracker's settlement rule: a game
 * that is not final is not settled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import L from "./live.js";
import nfl from "./nfl.js";

/* An ESPN summary, cut to what the tracker reads. */
const SUMMARY = (state) => ({
  header: { competitions: [{ status: { type: { state, completed: state === "post", detail: state === "in" ? "12:41 - 3rd" : state === "post" ? "Final" : "Sun 1:00 PM" }, displayClock: "12:41", period: 3 } }] },
  boxscore: { players: [
    { team: { abbreviation: "IND" }, statistics: [
      { name: "passing", keys: ["completions/passingAttempts", "passingYards", "yardsPerPassAttempt", "passingTouchdowns"], athletes: [{ athlete: { id: "3917792", displayName: "Daniel Jones" }, stats: ["22/31", "210", "6.8", "1"] }] },
      { name: "rushing", keys: ["rushingAttempts", "rushingYards", "yardsPerRushAttempt", "rushingTouchdowns"], athletes: [{ athlete: { id: "4242335", displayName: "Jonathan Taylor" }, stats: ["24", "92", "3.8", "2"] }] },
      { name: "receiving", keys: ["receptions", "receivingYards", "yardsPerReception", "receivingTouchdowns", "longReception", "receivingTargets"], athletes: [
        { athlete: { id: "4688813", displayName: "Josh Downs" }, stats: ["7", "72", "10.3", "0", "20", "9"] },
        { athlete: { id: "4242335", displayName: "Jonathan Taylor" }, stats: ["4", "40", "10.0", "0", "18", "4"] },
      ] },
    ] },
    { team: { abbreviation: "KC" }, statistics: [] },
  ] },
});

test("footballLine: a player's live line in the model's box shape, summed across the blocks he appears in; nobody without a line", () => {
  const line = L.footballLine(SUMMARY("in"), "4242335");
  assert.deepEqual(line, { pass: { yds: 0, td: 0 }, rush: { yds: 92, td: 2 }, rec: { rec: 4, yds: 40, td: 0 }, tds: 2 });
  assert.equal(nfl.gameValue("rushrec", line), 132, "the model reads it like a box line");
  assert.equal(nfl.gameValue("recs", line), 4);
  assert.deepEqual(L.footballLine(SUMMARY("in"), "3917792").pass, { yds: 210, td: 1 });
  assert.equal(L.footballLine(SUMMARY("in"), "nobody"), null);
  assert.equal(L.footballLine(null, "4242335"), null);
});

test("footballLine and footballState read the cdn feed's wrapper the same as the bare summary", () => {
  const wrapped = { gameId: 401872945, gamepackageJSON: SUMMARY("in") };
  assert.deepEqual(L.footballLine(wrapped, "4242335"), L.footballLine(SUMMARY("in"), "4242335"));
  assert.deepEqual(L.footballState(wrapped), L.footballState(SUMMARY("in")));
});

test("footballState: pre, in, post, with the clock the feed gives; postponed and cancelled are not final", () => {
  assert.deepEqual(L.footballState(SUMMARY("in")), { state: "in", detail: "12:41 - 3rd" });
  assert.equal(L.footballState(SUMMARY("post")).state, "post");
  const off = SUMMARY("post"); off.header.competitions[0].status.type = { state: "post", completed: false, detail: "Postponed" };
  assert.equal(L.footballState(off).state, "pre", "ESPN says post for a postponed game too; only completed settles");
  assert.equal(L.footballState(SUMMARY("pre")).state, "pre");
  assert.deepEqual(L.footballState(null), { state: "pre", detail: "" });
});

const FEED = (abstract) => ({
  gameData: { status: { abstractGameState: abstract, detailedState: abstract === "Live" ? "In Progress" : abstract } },
  liveData: { boxscore: { teams: {
    away: { players: { ID607208: { person: { id: 607208, fullName: "Trea Turner" }, stats: { batting: { hits: 2, runs: 1, rbi: 0, totalBases: 5, homeRuns: 1, plateAppearances: 3 } } },
                        ID1: { person: { id: 1, fullName: "Bench Guy" }, stats: {} } } },
    home: { players: {} },
  } }, linescore: { currentInning: 6, inningHalf: "Top" } },
});

test("mlbLine and mlbState: the batting line by player id, and the game's state", () => {
  assert.deepEqual(L.mlbLine(FEED("Live"), 607208), { hits: 2, runs: 1, rbi: 0, totalBases: 5, homeRuns: 1, pa: 3 });
  assert.equal(L.mlbLine(FEED("Live"), 1), null, "in the box with no batting line: not a line");
  assert.equal(L.mlbLine(FEED("Live"), 99), null);
  assert.deepEqual(L.mlbState(FEED("Live")), { state: "in", detail: "Top 6" });
  assert.equal(L.mlbState(FEED("Final")).state, "post");
  assert.equal(L.mlbState(FEED("Preview")).state, "pre");
  const off = FEED("Final"); off.gameData.status.detailedState = "Postponed";
  assert.equal(L.mlbState(off).state, "pre", "MLB says Final for a postponed game too");
});

test("target and current: what a tracked prop counts toward, for every prop the boards offer", () => {
  const line = L.footballLine(SUMMARY("in"), "4242335");
  const t = (prop, rung) => ({ sport: "football", prop, rung });
  assert.equal(L.target(t("td")), 1);
  assert.equal(L.target(t("recyds", 60)), 60);
  assert.equal(L.current(t("td"), line, nfl), 2);
  assert.equal(L.current(t("rushyds", 100), line, nfl), 92);
  assert.equal(L.current(t("rushrec", 100), line, nfl), 132);
  assert.equal(L.current(t("recs", 5), line, nfl), 4);
  const bat = L.mlbLine(FEED("Live"), 607208);
  const b = (prop) => ({ sport: "baseball", prop });
  assert.equal(L.target(b("hrr")), 1); assert.equal(L.current(b("hrr"), bat, nfl), 3);
  assert.equal(L.target(b("tb2")), 2); assert.equal(L.current(b("tb2"), bat, nfl), 5);
  assert.equal(L.target(b("hr")), 1); assert.equal(L.current(b("hr"), bat, nfl), 1);
  assert.equal(L.current(t("recyds", 60), null, nfl), null, "no line, no count");
  for (const bad of ["constructor", "__proto__", "toString", "nothing"]) assert.equal(L.current(t(bad, 1), line, nfl), null, "a stored prop the model does not know: " + bad);
});

test("progress: scheduled, in play, one away, reached, cashed, missed, void, by the numbers and the game's state", () => {
  const p = (track, current, state) => L.progress(track, current, state).status;
  const yds = { sport: "football", prop: "recyds", rung: 60 };
  assert.equal(p(yds, null, "pre"), "scheduled");
  assert.equal(p(yds, 12, "in"), "in play");
  assert.equal(p(yds, 52, "in"), "one away", "within ten yards");
  assert.equal(p(yds, 60, "in"), "reached");
  assert.equal(p(yds, 60, "post"), "cashed", "reached and final");
  assert.equal(p(yds, 40, "post"), "missed");
  assert.equal(p(yds, null, "post"), "void", "final with no line: he did not play");
  assert.equal(p(yds, null, "in"), "in play", "no line yet in a live game is not a miss");
  const td = { sport: "football", prop: "td" };
  assert.equal(p(td, 0, "in"), "one away", "a touchdown is always one away");
  assert.equal(p(td, 1, "in"), "reached");
  const recs = { sport: "football", prop: "recs", rung: 5 };
  assert.equal(p(recs, 4, "in"), "one away"); assert.equal(p(recs, 3, "in"), "in play");
  const tb = { sport: "baseball", prop: "tb2" };
  assert.equal(p(tb, 1, "in"), "one away"); assert.equal(p(tb, 2, "post"), "cashed");
  assert.deepEqual(L.progress(yds, 52, "in"), { current: 52, target: 60, status: "one away", remaining: 8 });
  const zero = { sport: "football", prop: "recyds", rung: 0 };
  assert.equal(p(zero, 0, "post"), "void", "nothing to count toward is never reached, let alone cashed");
  assert.equal(p(zero, 0, "in"), "in play");
  const box = L.footballLine(SUMMARY("post"), "4242335");
  assert.equal(p({ sport: "football", prop: "mystery" }, L.current({ sport: "football", prop: "mystery" }, box, nfl), "post"), "void", "an unknown prop counts nothing");
});

test("summarise and pollInterval: the strip's counts, and how often to ask", () => {
  const items = [{ status: "in play" }, { status: "one away" }, { status: "reached" }, { status: "scheduled" }, { status: "cashed" }, { status: "missed" }];
  assert.deepEqual(L.summarise(items), { all: 6, inPlay: 2, oneAway: 1, reached: 2 });
  assert.equal(L.pollInterval(["in", "pre"]), 20000, "a live game: every twenty seconds");
  assert.equal(L.pollInterval(["pre", "pre"]), 300000, "nothing started: every five minutes");
  assert.equal(L.pollInterval(["post", "post"]), 0, "all final: stop");
  assert.equal(L.pollInterval([]), 0);
});

test("feedUrl: each tracked prop knows where its game is", () => {
  // The cdn host, not site.api.espn.com: the latter answers 403 to a browser's user agent.
  assert.equal(L.feedUrl({ sport: "football", league: "NFL", gameId: "401872945" }), "https://cdn.espn.com/core/nfl/boxscore?xhr=1&gameId=401872945");
  assert.equal(L.feedUrl({ sport: "football", league: "College football", gameId: "9" }), "https://cdn.espn.com/core/college-football/boxscore?xhr=1&gameId=9");
  assert.equal(L.feedUrl({ sport: "baseball", gameId: 849845 }), "https://statsapi.mlb.com/api/v1.1/game/849845/feed/live");
  assert.equal(L.feedUrl({ sport: "curling", gameId: 1 }), null);
});
