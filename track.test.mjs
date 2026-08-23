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
