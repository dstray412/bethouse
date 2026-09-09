/*
 * BetHouse — track.test.mjs
 * The rules that make a forward record worth having.
 *
 * These are shared by baseball and the NFL now, which is the point: the rules
 * are identical across sports and this repo has been bitten four times by one
 * rule living in two files and drifting apart. One copy, tested once.
 *
 * A forward record is the only test a model cannot quietly pass by having
 * been tuned to the data. If these rules leak, it stops being that and
 * becomes another backtest with extra steps.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as core from "./track-core.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bethouse-track-"));

/* ---------------------------------------------------------------- *
 * Rule 2: pregame only, by the clock
 * ---------------------------------------------------------------- */

const T0 = Date.parse("2026-09-10T00:20:00.000Z");

test("startedAlready: a game before its kickoff has not started", () => {
  assert.equal(core.startedAlready("2026-09-10T00:20:00.000Z", T0 - 60_000), false);
});

test("startedAlready: kickoff itself counts as started", () => {
  /* At the moment of first pitch the outcome has begun. Recording then is
     recording a result, not a prediction. */
  assert.equal(core.startedAlready("2026-09-10T00:20:00.000Z", T0), true);
  assert.equal(core.startedAlready("2026-09-10T00:20:00.000Z", T0 + 1), true);
});

test("startedAlready: an unreadable time counts as started", () => {
  /* Default-closed, and the asymmetry is the reason. A refused prediction
     costs one row. A post-hoc prediction corrupts the record it is supposed
     to be evidence for, and nothing downstream can tell the difference
     afterwards. */
  for (const bad of [undefined, null, "", "kickoff", "not a date", {}]) {
    assert.equal(core.startedAlready(bad, T0), true, `${JSON.stringify(bad)} must be refused`);
  }
});

test("startedAlready: a status string cannot override the clock", () => {
  /* Baseball's "Completed Early" read as bettable for five hours and put 90
     post-hoc rows into the record. This function takes no status at all, by
     design: there is nothing to misread. */
  assert.equal(core.startedAlready.length <= 2, true, "takes only a time and a now");
});

/* ---------------------------------------------------------------- *
 * The day file
 * ---------------------------------------------------------------- */

test("loadDay: a day never recorded reads as empty, not as an error", () => {
  const dir = tmp();
  const d = core.loadDay(dir, "2026-09-10");
  assert.equal(d.date, "2026-09-10");
  assert.deepEqual(d.predictions, []);
  assert.equal(d.graded, false);
});

test("loadDay: a corrupt file reads as empty rather than taking the run down", () => {
  /* A refresh that dies on one unreadable day stops recording every other
     day too. Losing one file is recoverable; losing the pipeline is not. */
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "2026-09-10.json"), "{ not json");
  assert.deepEqual(core.loadDay(dir, "2026-09-10").predictions, []);
});

test("loadDay: a file missing its predictions array still reads", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "2026-09-10.json"), JSON.stringify({ date: "2026-09-10" }));
  assert.deepEqual(core.loadDay(dir, "2026-09-10").predictions, []);
});

test("saveDay then loadDay returns exactly what went in", () => {
  const dir = tmp();
  const day = {
    date: "2026-09-10",
    week: 1,
    predictions: [{ gameId: "1", playerId: "2", prop: "td", prob: 0.42 }],
    graded: false,
  };
  core.saveDay(dir, day);
  assert.deepEqual(core.loadDay(dir, "2026-09-10"), day);
});

test("saveDay writes the format the committed files already have", () => {
  /* Indent 1, no trailing newline. Not taste: writing anything else makes
     every scheduled refresh reformat the whole file, so an 18,000-line diff
     lands on top of whatever actually changed. */
  const dir = tmp();
  core.saveDay(dir, { date: "2026-09-10", predictions: [], graded: false });
  const raw = fs.readFileSync(path.join(dir, "2026-09-10.json"), "utf8");
  assert.equal(raw, JSON.stringify({ date: "2026-09-10", predictions: [], graded: false }, null, 1));
  assert.equal(raw.endsWith("}"), true, "no trailing newline");
});

test("listDays: only dated files, and in order", () => {
  const dir = tmp();
  for (const n of ["2026-09-17.json", "2026-09-10.json", "record.js", "notes.txt", "2026-9-1.json"]) {
    fs.writeFileSync(path.join(dir, n), "{}");
  }
  assert.deepEqual(core.listDays(dir), ["2026-09-10", "2026-09-17"]);
});

test("listDays: a directory that does not exist yet is empty, not a crash", () => {
  assert.deepEqual(core.listDays(path.join(tmp(), "nope")), []);
});

/* ---------------------------------------------------------------- *
 * The arithmetic
 * ---------------------------------------------------------------- */

test("evaluate: bias is what the model said minus what happened", () => {
  const rows = [
    { prob: 0.8, actual: 1 },
    { prob: 0.8, actual: 0 },
    { prob: 0.6, actual: 1 },
    { prob: 0.6, actual: 1 },
  ];
  const e = core.evaluate(rows);
  assert.equal(e.n, 4);
  assert.ok(Math.abs(e.meanP - 0.7) < 1e-12);
  assert.ok(Math.abs(e.meanA - 0.75) < 1e-12);
  /* Positive bias means the model promised more than it delivered. */
  assert.ok(Math.abs(e.bias - -0.05) < 1e-12);
});

test("evaluate: nothing graded yet returns nothing, not a zero record", () => {
  assert.equal(core.evaluate([]), null);
});

test("evaluate: a bucket too thin to mean anything is not reported", () => {
  /* Fifteen is already generous. A calibration row built on three outcomes
     invites reading noise as a finding, which is the failure this whole
     record exists to avoid. */
  const rows = [];
  for (let i = 0; i < 14; i++) rows.push({ prob: 0.75, actual: 1 });
  for (let i = 0; i < 20; i++) rows.push({ prob: 0.35, actual: 0 });
  const e = core.evaluate(rows);
  assert.deepEqual(e.buckets.map((b) => b.lo.toFixed(1)), ["0.3"]);
});

test("evaluate: Brier is the mean square error, so a certainty that lands is 0", () => {
  assert.equal(core.evaluate([{ prob: 1, actual: 1 }]).brier, 0);
  assert.equal(core.evaluate([{ prob: 0, actual: 1 }]).brier, 1);
});

/* ---------------------------------------------------------------- *
 * The report
 * ---------------------------------------------------------------- */

test("report: an empty record says so and returns nothing to publish", () => {
  const dir = tmp();
  const logs = [];
  const real = console.log;
  console.log = (...a) => logs.push(a.join(" "));
  try {
    assert.equal(core.report(dir, [{ id: "td", label: "Anytime touchdown" }]), null);
  } finally {
    console.log = real;
  }
  assert.match(logs.join("\n"), /No graded predictions yet/);
});

test("report: ungraded rows are counted by nobody", () => {
  /* A pending bet is not a 0. Letting it near the arithmetic would drag every
     average toward the floor and make an open week look like a losing one. */
  const dir = tmp();
  core.saveDay(dir, {
    date: "2026-09-10",
    predictions: [
      { prop: "td", prob: 0.5, actual: 1 },
      { prop: "td", prob: 0.5, actual: 0 },
      { prop: "td", prob: 0.9 },            // still pending
    ],
    graded: false,
  });
  const real = console.log;
  console.log = () => {};
  let out;
  try {
    out = core.report(dir, [{ id: "td", label: "Anytime touchdown" }]);
  } finally {
    console.log = real;
  }
  assert.equal(out.total, 2);
  assert.equal(out.props.td.n, 2);
  assert.equal(out.props.td.predicted, 50);
  assert.equal(out.props.td.actual, 50);
});

/* ------------------------------------------------------------------ *
 * Grading a side against the score and the closing line
 *
 * Oracle: how a book settles the bet. Home covers iff margin + spread > 0
 * and pushes at zero; over wins iff points > total and pushes at equal;
 * the moneyline settles on the winner and a tie is void. Closing line
 * value is measured in points in the pick's favour: a home pick at -3
 * that closes -4.5 gained 1.5, an over at 44.5 that closes 46 gained 1.5.
 * ------------------------------------------------------------------ */
import { gradeGamePick } from "./track-football.mjs";

const score = (home, away) => ({ homeScore: home, awayScore: away });

test("gradeGamePick: a home spread pick covers, pushes, or loses by the grading rule", () => {
  const pick = { prop: "spread", side: "home", line: -3 };
  assert.equal(gradeGamePick(pick, score(24, 20)).actual, 1);   // margin 4 + (-3) > 0
  assert.equal(gradeGamePick(pick, score(23, 20)).push, true);  // exactly 3
  assert.equal(gradeGamePick(pick, score(21, 20)).actual, 0);
});

test("gradeGamePick: an away spread pick is the mirror", () => {
  const pick = { prop: "spread", side: "away", line: -3 };
  assert.equal(gradeGamePick(pick, score(21, 20)).actual, 1);
  assert.equal(gradeGamePick(pick, score(24, 20)).actual, 0);
});

test("gradeGamePick: totals", () => {
  assert.equal(gradeGamePick({ prop: "total", side: "over", line: 44.5 }, score(24, 21)).actual, 1);
  assert.equal(gradeGamePick({ prop: "total", side: "under", line: 44.5 }, score(24, 21)).actual, 0);
  assert.equal(gradeGamePick({ prop: "total", side: "over", line: 45 }, score(24, 21)).push, true);
});

test("gradeGamePick: the moneyline settles on the winner and a tie is void", () => {
  assert.equal(gradeGamePick({ prop: "ml", side: "away" }, score(20, 24)).actual, 1);
  assert.equal(gradeGamePick({ prop: "ml", side: "home" }, score(20, 24)).actual, 0);
  assert.equal(gradeGamePick({ prop: "ml", side: "home" }, score(20, 20)).push, true);
});

test("gradeGamePick: closing line value is points in the pick's favour", () => {
  const home = gradeGamePick({ prop: "spread", side: "home", line: -3 }, score(24, 20), { spread: -4.5 });
  assert.equal(home.clv, 1.5);
  const away = gradeGamePick({ prop: "spread", side: "away", line: -3 }, score(24, 20), { spread: -4.5 });
  assert.equal(away.clv, -1.5);
  const over = gradeGamePick({ prop: "total", side: "over", line: 44.5 }, score(24, 21), { total: 46 });
  assert.equal(over.clv, 1.5);
  const under = gradeGamePick({ prop: "total", side: "under", line: 44.5 }, score(24, 21), { total: 46 });
  assert.equal(under.clv, -1.5);
  // No closing line on record: graded, but no CLV to report.
  assert.equal(gradeGamePick({ prop: "spread", side: "home", line: -3 }, score(24, 20), null).clv, null);
});

/* ------------------------------------------------------------------ *
 * Settling the counting props
 *
 * Oracle: the book's rule. Over is strictly more than a half-number line,
 * so there is no push; a prop the tracker does not know is not settled.
 * ------------------------------------------------------------------ */
import { settlePlayer, boxScoreLines } from "./track-football.mjs";
import { seasonLines } from "./fetch-football.mjs";
import nflModel from "./nfl.js";

test("seasonLines: what each defence allows of a stat, regressed toward the league over six games", () => {
  // Oracle: the touchdown factors' own formula, (allowed + 6 × league) / ((games + 6) × league).
  const games = [{
    home: { team: "A" }, away: { team: "B" },
    players: [
      { id: "1", name: "QB A", team: "A", pass: { att: 30, yds: 100 } },
      { id: "2", name: "QB B", team: "B", pass: { att: 30, yds: 300 } },
      { id: "3", name: "RB B", team: "B", rush: { att: 20, yds: 90 } },
      // A team code the schedule does not use: attributed to no defence, and out of the league total.
      { id: "4", name: "QB ?", team: "BBB", pass: { att: 30, yds: 999 } },
    ],
  }];
  const { teamFactors } = seasonLines(games, nflModel);
  // League passing per team-game is 400 / 2 = 200. A allowed 300, B allowed 100.
  assert.equal(teamFactors.A.allow.passyds, Number(((300 + 6 * 200) / (7 * 200)).toFixed(4)));
  assert.equal(teamFactors.B.allow.passyds, Number(((100 + 6 * 200) / (7 * 200)).toFixed(4)));
  // League rushing per team-game is 45. A allowed 90, B allowed nothing.
  assert.equal(teamFactors.A.allow.rushyds, Number(((90 + 6 * 45) / (7 * 45)).toFixed(4)));
  assert.equal(teamFactors.B.allow.rushyds, Number(((0 + 6 * 45) / (7 * 45)).toFixed(4)));
  assert.equal(teamFactors.A.allow.recyds, 1, "a stat nobody recorded is league average for everyone");
});

test("boxScoreLines: each ESPN block feeds its own fields, summed per athlete across blocks", () => {
  // Oracle: ESPN's summary shape, the keys fetch-football.mjs already reads.
  const summary = { boxscore: { players: [{ statistics: [
    { name: "passing", keys: ["completions/passingAttempts", "passingYards", "passingTouchdowns"],
      athletes: [{ athlete: { id: "1" }, stats: ["20/30", "251", "2"] }] },
    { name: "rushing", keys: ["rushingAttempts", "rushingYards", "rushingTouchdowns"],
      athletes: [{ athlete: { id: "1" }, stats: ["3", "12", "0"] }, { athlete: { id: "2" }, stats: ["18", "84", "1"] }] },
    { name: "receiving", keys: ["receptions", "receivingYards", "receivingTouchdowns"],
      athletes: [{ athlete: { id: "2" }, stats: ["5", "61", "1"] }, { athlete: {}, stats: ["1", "9", "0"] }] },
  ] }] } };
  const s = boxScoreLines(summary);
  assert.deepEqual(s.get("1"), { td: 0, recYds: 0, rushYds: 12, passYds: 251, recs: 0, played: true },
    "a passing touchdown is not the passer's anytime touchdown");
  assert.deepEqual(s.get("2"), { td: 2, recYds: 61, rushYds: 84, passYds: 0, recs: 5, played: true });
  assert.equal(s.size, 2, "an athlete without an id cannot be graded");
  assert.equal(boxScoreLines(null).size, 0);
});

test("settlePlayer: touchdowns, then each counting prop against its own field", () => {
  const line = { td: 1, recYds: 61, rushYds: 84, passYds: 251, recs: 5 };
  assert.equal(settlePlayer({ prop: "td" }, line), 1);
  assert.equal(settlePlayer({ prop: "td" }, { ...line, td: 0 }), 0);
  assert.equal(settlePlayer({ prop: "recyds", line: 60.5 }, line), 1);
  assert.equal(settlePlayer({ prop: "recyds", line: 61.5 }, line), 0);
  assert.equal(settlePlayer({ prop: "rushyds", line: 83.5 }, line), 1);
  assert.equal(settlePlayer({ prop: "passyds", line: 250.5 }, line), 1);
  assert.equal(settlePlayer({ prop: "passyds", line: 251.5 }, line), 0);
  assert.equal(settlePlayer({ prop: "recs", line: 4.5 }, line), 1);
  assert.equal(settlePlayer({ prop: "recs", line: 5.5 }, line), 0);
  assert.equal(settlePlayer({ prop: "spread", line: -3 }, line), null, "a game prop is not a player prop");
});

/* ------------------------------------------------------------------ *
 * The parlay forward record
 *
 * Oracle: the suggester itself (parlay.js) and a book's settlement: a
 * slip dies on the first miss, pays only when every leg hits, and voids
 * when a leg voids. Recorded pregame, first prediction wins, like every
 * other row.
 * ------------------------------------------------------------------ */
import { parlayCandidates, recordSuggestedParlays, gradeParlays } from "./track-football.mjs";
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

const FUTURE = "2099-01-01T18:00Z", PAST = "2000-01-01T18:00Z";
const td = (gameId, playerId, team, prob, kickoff = FUTURE) => ({ gameId, playerId, name: "P" + playerId, team, prop: "td", prob, kickoff });

test("parlayCandidates: this day's rows on the eligible props whose game has not started", () => {
  const day = { predictions: [td("g1", "a", "X", 0.6), td("g1", "b", "Y", 0.5), td("g2", "c", "Z", 0.4, PAST),
    { gameId: "g1", playerId: "a", name: "Pa", team: "X", prop: "recyds", prob: 0.54, line: 60.5, kickoff: FUTURE },
    { gameId: "g3", playerId: "game", name: "B at A", team: "A", opp: "B", prop: "spread", side: "away", line: 3, prob: 0.5, kickoff: FUTURE },
    { gameId: "g3", playerId: "game", name: "B at A", team: "A", opp: "B", prop: "total", side: "under", line: 44.5, prob: 0.52, kickoff: FUTURE }] };
  const now = Date.parse("2050-01-01T00:00Z");
  const c = parlayCandidates(day, ["td"], now);
  assert.deepEqual(c.map((x) => x.key), ["g1|a|td", "g1|b|td"], "a started game and the other props are out");
  assert.deepEqual(c[0], { key: "g1|a|td", playerId: "a", gameId: "g1", team: "X", name: "Pa", prob: 0.6, prop: "td", line: null, side: null });
  const all = parlayCandidates(day, ["td", "recyds", "spread", "total"], now);
  assert.deepEqual(all.map((x) => x.key), ["g1|a|td", "g1|b|td", "g1|a|recyds", "g3|game|spread", "g3|game|total"]);
  assert.equal(all[3].team, "B", "a spread leg's team is the side it took");
  assert.equal(all[4].team, null, "a total is nobody's team");
  assert.equal(all[2].line, 60.5);
});

test("recordSuggestedParlays: slate slips of 3, 4 and 5 and a 3-leg slip per open game, first wins", () => {
  const day = { predictions: [
    td("g1", "a", "X", 0.6), td("g1", "b", "Y", 0.5), td("g1", "c", "X", 0.4),
    td("g2", "d", "Z", 0.55), td("g2", "e", "W", 0.3),
    td("g3", "f", "V", 0.45),
  ] };
  const lift = { game: 1, team: 0.85 };
  const added = recordSuggestedParlays(day, parlayCandidates(day, ["td"], 0), lift, "2026-09-09T00:00:00Z");
  assert.equal(added, 2, "a 3-leg slate slip and g1's slip; 4 and 5 legs need 4 and 5 games; g2 and g3 have too few legs");
  const slate = day.parlays.find((s) => s.scope === "slate");
  assert.deepEqual(slate.legs.map((l) => l.playerId), ["a", "d", "f"]);
  close(slate.prob, 0.6 * 0.55 * 0.45); assert.equal(slate.correlation, "none"); close(slate.adjusted, slate.prob);
  const g1 = day.parlays.find((s) => s.scope === "game");
  assert.equal(g1.gameId, "g1"); assert.deepEqual(g1.legs.map((l) => l.playerId), ["a", "b", "c"]);
  assert.equal(g1.correlation, "mixed", "two of three on one team"); close(g1.adjusted, 0.6 * 0.5 * 0.4, 1e-9);
  assert.equal(g1.tag, "all"); assert.match(g1.key, /\|all$/, "the key names the leg set the slip drew on");
  // Run again with a better leg now on the board: first prediction wins.
  day.predictions.push(td("g1", "z", "Y", 0.9));
  assert.equal(recordSuggestedParlays(day, parlayCandidates(day, ["td"], 0), lift), 0);
  assert.deepEqual(day.parlays.find((s) => s.scope === "game").legs.map((l) => l.playerId), ["a", "b", "c"]);
});

test("gradeParlays: dies on the first miss, cashes when every leg hits, voids with a voided leg", () => {
  const day = { predictions: [td("g1", "a", "X", 0.6), td("g1", "b", "Y", 0.5), td("g2", "c", "Z", 0.4), td("g3", "d", "V", 0.4)],
    parlays: [
      { key: "s1", legs: [{ gameId: "g1", playerId: "a", prop: "td" }, { gameId: "g2", playerId: "c", prop: "td" }] },
      { key: "s2", legs: [{ gameId: "g1", playerId: "a", prop: "td" }, { gameId: "g1", playerId: "b", prop: "td" }] },
      { key: "s3", legs: [{ gameId: "g1", playerId: "a", prop: "td" }, { gameId: "g3", playerId: "d", prop: "td" }] },
    ] };
  day.predictions[0].actual = 1; day.predictions[1].actual = 0; day.predictions[2].scratched = true;
  assert.equal(gradeParlays(day), 2, "s2 lost on b, s1 voided on c; s3 waits for d");
  assert.equal(day.parlays[1].actual, 0);
  assert.equal(day.parlays[0].scratched, true);
  assert.equal(day.parlays[2].actual, undefined, "an open leg keeps the slip open");
  day.predictions[3].actual = 1;
  assert.equal(gradeParlays(day), 1); assert.equal(day.parlays[2].actual, 1, "every leg hit");
  assert.equal(gradeParlays(day), 0, "nothing settles twice");
});
