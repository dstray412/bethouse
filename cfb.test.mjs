/*
 * BetHouse — cfb.test.mjs
 * College football: the binding, and the parsing that is particular to it.
 *
 * The model's arithmetic is nfl.js's and is tested there. What is tested
 * here is that college is genuinely bound to its own constants, that the
 * receiving term reads receptions, and that the three college traps in
 * fetch-football.mjs -- neutral sites, outsiders, a box score with no
 * targets -- are handled where the header says they are.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import nfl from "./nfl.js";
import cfb from "./cfb.js";
import { CFB, NFL, leagueFromArgs } from "./football-leagues.mjs";
import { parseGame, parseScheduleEvent, parseMembers, teamCode } from "./fetch-football.mjs";

const close = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `expected ${a} ≈ ${b} (tol ${tol})`);

/* ------------------------------------------------------------------ *
 * The binding
 * ------------------------------------------------------------------ */

test("cfb: is the NFL model bound to its own constants", () => {
  assert.equal(cfb.DEFAULTS.receivingStat, "recs");
  assert.equal(nfl.DEFAULTS.receivingStat, "targets");
  // Every constant the NFL has, college has too: nothing falls through
  // to an NFL number by omission.
  for (const k of Object.keys(nfl.DEFAULTS)) {
    assert.ok(k in cfb.DEFAULTS, `cfb.DEFAULTS is missing ${k}`);
  }
});

test("cfb: constants are measured on college games, not copied from the NFL", () => {
  // Oracle: the sport. College teams score more, at home by more, with
  // wider margins. If any of these equals the NFL's number to the decimal
  // the placeholder was never replaced.
  assert.notEqual(cfb.DEFAULTS.leaguePoints, nfl.DEFAULTS.leaguePoints);
  assert.ok(cfb.DEFAULTS.leaguePoints > nfl.DEFAULTS.leaguePoints);
  assert.notEqual(cfb.DEFAULTS.homeField, nfl.DEFAULTS.homeField);
  assert.ok(cfb.DEFAULTS.marginSD > nfl.DEFAULTS.marginSD);
  assert.notEqual(cfb.DEFAULTS.leagueLambda, nfl.DEFAULTS.leagueLambda);
  // A reception is a target that succeeded, so it is worth more.
  assert.ok(cfb.DEFAULTS.tdPerTarget > nfl.DEFAULTS.tdPerTarget);
});

test("cfb: the touchdown model reads receptions and ignores targets", () => {
  const p = { games: 6, tds: 3, carries: 0, targets: 0, recs: 30 };
  const s = cfb.scoreAnytimeTD(p);
  assert.equal(s.perGameReceiving, 5);
  assert.ok(s.usageRate > 0, "receptions must count as opportunity");
  // The NFL model, fed the same player, sees no receiving workload at all.
  assert.equal(nfl.scoreAnytimeTD(p).perGameReceiving, 0);
});

test("cfb: the yards gate counts receptions", () => {
  assert.ok(cfb.yardsEligible({ games: 4, recs: 20, targets: 0, recYds: 300 }));
  assert.equal(cfb.yardsEligible({ games: 4, recs: 0, targets: 40, recYds: 300 }), null);
});

test("cfb: a neutral-site projection withholds home field", () => {
  const r = cfb.buildTeamRatings([
    { home: { team: "A", score: 35 }, away: { team: "B", score: 21 } },
    { home: { team: "B", score: 28 }, away: { team: "A", score: 31 } },
  ]);
  const home = cfb.projectGame(r, "A", "B");
  const neutral = cfb.projectGame(r, "A", "B", { neutral: true });
  close(home.margin - neutral.margin, cfb.DEFAULTS.homeField);
});

test("football-leagues: the two leagues differ where they should and nowhere else", () => {
  assert.equal(NFL.model, nfl);
  assert.equal(CFB.model, cfb);
  assert.equal(NFL.outsiderCode, null);
  assert.equal(CFB.outsiderCode, "FCS");
  assert.match(CFB.scoreboardQuery, /groups=80/);
  assert.match(CFB.membersUrl(2025), /seasons\/2025\/types\/2\/groups\/80\/teams/);
  assert.equal(leagueFromArgs([]), NFL);
  assert.equal(leagueFromArgs(["--league", "cfb"]), CFB);
  assert.throws(() => leagueFromArgs(["--league", "xfl"]));
  // Neither league writes into the other's files.
  for (const k of ["historyFile", "dataFile", "dataGlobal", "recordDir", "recordFile", "recordGlobal"]) {
    assert.notEqual(NFL[k], CFB[k], `${k} is shared between leagues`);
  }
});

/* ------------------------------------------------------------------ *
 * Parsing: the college traps
 *
 * Oracle: ESPN's own payloads, read on 2026-09-05. Iowa State-Kansas
 * State in Dublin (neutral), a box score whose receiving block carries
 * receptions and no targets, and the core API's group-80 membership list.
 * ------------------------------------------------------------------ */

const members = new Set(["66", "2306"]); // ISU, KSU

const summary = (over) =>
  Object.assign({
    header: {
      id: "401756846",
      season: { year: 2025, type: 2 },
      week: 1,
      competitions: [{
        date: "2025-08-23T16:00Z",
        neutralSite: true,
        competitors: [
          { homeAway: "home", score: "21", team: { id: "2306", abbreviation: "KSU" } },
          { homeAway: "away", score: "24", team: { id: "66", abbreviation: "ISU" } },
        ],
      }],
    },
    boxscore: {
      players: [{
        team: { abbreviation: "ISU" },
        statistics: [
          {
            name: "rushing",
            keys: ["rushingAttempts", "rushingYards", "yardsPerRushAttempt", "rushingTouchdowns", "longRushing"],
            athletes: [{ athlete: { id: "5077502", displayName: "Carson Hansen" }, stats: ["16", "71", "4.4", "0", "15"] }],
          },
          {
            name: "receiving",
            keys: ["receptions", "receivingYards", "yardsPerReception", "receivingTouchdowns", "longReception"],
            athletes: [{ athlete: { id: "5148535", displayName: "Brett Eskildsen" }, stats: ["3", "46", "15.3", "1", "24"] }],
          },
        ],
      }],
    },
  }, over || {});

test("parseGame: a neutral site is carried through, and only when it is one", () => {
  assert.equal(parseGame(summary()).neutral, true);
  const home = summary();
  home.header.competitions[0].neutralSite = false;
  assert.equal("neutral" in parseGame(home), false, "a home game carries no flag at all");
});

test("parseGame: a receiver with no target count is still kept, on receptions", () => {
  const g = parseGame(summary());
  const wr = g.players.find((p) => p.id === "5148535");
  assert.ok(wr, "a player with receptions but no targets must not be dropped");
  assert.equal(wr.rec.rec, 3);
  assert.equal(wr.rec.tgt, 0);
  assert.equal(wr.rec.yds, 46);
  assert.equal(wr.rec.td, 1);
});

test("parseGame: a side that is not a member is recorded as the outsider, players included", () => {
  const s = summary();
  s.header.competitions[0].competitors[1].team = { id: "2504", abbreviation: "SDAK" };
  s.boxscore.players[0].team = { abbreviation: "SDAK" };
  const g = parseGame(s, { members, outsiderCode: "FCS" });
  assert.equal(g.away.team, "FCS");
  assert.equal(g.home.team, "KSU");
  for (const p of g.players) assert.equal(p.team, "FCS", `${p.name} should be filed under FCS`);
});

test("parseGame: without a membership list every team is itself", () => {
  const g = parseGame(summary());
  assert.equal(g.home.team, "KSU");
  assert.equal(g.away.team, "ISU");
});

test("teamCode: membership is by id, because abbreviations collide across divisions", () => {
  assert.equal(teamCode({ id: "66", abbreviation: "ISU" }, members, "FCS"), "ISU");
  assert.equal(teamCode({ id: "9999", abbreviation: "ISU" }, members, "FCS"), "FCS");
  assert.equal(teamCode({ id: "9999", abbreviation: "ISU" }, null, "FCS"), "ISU");
});

test("parseScheduleEvent: outsiders and neutral sites, the same way", () => {
  const e = {
    id: "1", date: "2026-09-12T16:00Z", name: "South Dakota Coyotes at Iowa State Cyclones",
    status: { type: { completed: false } },
    competitions: [{
      neutralSite: false,
      competitors: [
        { homeAway: "home", team: { id: "66", abbreviation: "ISU" } },
        { homeAway: "away", team: { id: "2504", abbreviation: "SDAK" } },
      ],
    }],
  };
  const row = parseScheduleEvent(e, 2026, 3, { members, outsiderCode: "FCS" });
  assert.equal(row.home, "ISU");
  assert.equal(row.away, "FCS");
  assert.equal("neutral" in row, false);
  e.competitions[0].neutralSite = true;
  assert.equal(parseScheduleEvent(e, 2026, 3, { members, outsiderCode: "FCS" }).neutral, true);
});

test("parseMembers: reads team ids off the core API's reference list", () => {
  const ids = parseMembers({
    count: 2,
    items: [
      { $ref: "http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2025/teams/2?lang=en" },
      { $ref: "http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2025/teams/2306?lang=en" },
    ],
  });
  assert.deepEqual([...ids].sort(), ["2", "2306"]);
  assert.equal(parseMembers(null).size, 0);
});
