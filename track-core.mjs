/*
 * BetHouse — track-core.mjs
 * The parts of a forward record that are not about any one sport.
 *
 * WHY THIS EXISTS
 * ---------------
 * `track.mjs` keeps a running record of what the BASEBALL board predicted,
 * graded after the fact. That record is the only test a model cannot quietly
 * pass by having been tuned to the data, and on 2026-08-22 it earned its keep:
 * it exposed an over-dispersion the backtests could not see, because a
 * backtest replays history the model is then fitted to.
 *
 * The NFL board needed the same thing. The rules that make such a record
 * honest are identical across sports, and this repo has been bitten four
 * times by the same rule living in two files and drifting. So the rules live
 * here, once, and each sport supplies only what is genuinely sport-shaped:
 * where the board is, how to score a player, how to read a box score.
 *
 * THE RULES
 * ---------
 *   1. FIRST PREDICTION WINS. Once a player is recorded for a day he is never
 *      overwritten. Without it a refresh loop would keep updating him and by
 *      the fourth quarter the board would be "predicting" something it can
 *      already half see. Graded that way a model looks superb and means
 *      nothing.
 *   2. PREGAME ONLY, BY THE CLOCK. Status strings are a wider vocabulary than
 *      any match expects -- baseball's "Completed Early" read as bettable for
 *      five hours and put 90 post-hoc rows into the record. A wall clock
 *      cannot be misread, so anything at or past its own kickoff is refused
 *      whatever the status says.
 *   3. NOTHING IS BACKFILLED. A day that was not snapshotted before it started
 *      is lost, permanently and on purpose. Reconstructing it afterwards is
 *      indistinguishable from choosing it afterwards.
 */
import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------ *
 * The day file
 * ------------------------------------------------------------------ */

export function loadDay(dir, date) {
  const f = path.join(dir, `${date}.json`);
  if (!fs.existsSync(f)) return { date, predictions: [], graded: false };
  try {
    const d = JSON.parse(fs.readFileSync(f, "utf8"));
    if (!Array.isArray(d.predictions)) d.predictions = [];
    return d;
  } catch {
    return { date, predictions: [], graded: false };
  }
}

export function saveDay(dir, day) {
  fs.mkdirSync(dir, { recursive: true });
  /* Indent 1, no trailing newline. Not a preference -- it is the shape the
     committed files already have, and a refresh that reformats them would
     put an 18,000-line diff into every scheduled commit and bury whatever
     actually changed. */
  fs.writeFileSync(path.join(dir, `${day.date}.json`), JSON.stringify(day, null, 1));
}

export function listDays(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

/* ------------------------------------------------------------------ *
 * Rule 2, in the form that cannot be misread
 * ------------------------------------------------------------------ */

/**
 * True once the clock says this game has begun. An unreadable or missing
 * start time counts as started: refusing to record is the safe failure, and
 * a missing prediction costs a row while a post-hoc one corrupts the record.
 */
export function startedAlready(startTime, now = Date.now()) {
  const t = Date.parse(startTime);
  if (!isFinite(t)) return true;
  return now >= t;
}

/* ------------------------------------------------------------------ *
 * Grading arithmetic
 * ------------------------------------------------------------------ */

export function evaluate(rows) {
  const n = rows.length;
  if (!n) return null;
  const meanP = rows.reduce((s, r) => s + r.prob, 0) / n;
  const meanA = rows.reduce((s, r) => s + r.actual, 0) / n;
  const brier = rows.reduce((s, r) => s + (r.prob - r.actual) ** 2, 0) / n;
  const buckets = [];
  for (let lo = 0; lo < 1; lo += 0.1) {
    const inB = rows.filter((r) => r.prob >= lo && r.prob < lo + 0.1);
    if (inB.length < 15) continue;
    buckets.push({
      lo,
      n: inB.length,
      pred: inB.reduce((s, r) => s + r.prob, 0) / inB.length,
      act: inB.reduce((s, r) => s + r.actual, 0) / inB.length,
    });
  }
  return { n, meanP, meanA, bias: meanP - meanA, brier, buckets };
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

/**
 * Prints the running record and returns the object the board reads.
 * `props` is [{id, label}] in the order they should appear.
 */
export function report(dir, props, opts = {}) {
  const days = listDays(dir);
  const all = [];
  for (const d of days) {
    for (const p of loadDay(dir, d).predictions) {
      if (p.actual == null) continue;
      all.push({ ...p, date: d });
    }
  }
  if (!all.length) {
    console.log("No graded predictions yet.");
    if (opts.hint) console.log(opts.hint);
    return null;
  }

  const gradedDays = [...new Set(all.map((r) => r.date))];
  console.log(`\n${opts.title || "BetHouse running record"} — ${gradedDays.length} day(s), ${all.length} graded predictions`);
  console.log(`Days: ${gradedDays.join(", ")}\n`);

  const out = { days: gradedDays, total: all.length, props: {} };

  for (const prop of props) {
    const rows = all.filter((r) => r.prop === prop.id);
    const e = evaluate(rows);
    if (!e) continue;
    out.props[prop.id] = {
      label: prop.label,
      n: e.n,
      predicted: Math.round(e.meanP * 1000) / 10,
      actual: Math.round(e.meanA * 1000) / 10,
      bias: Math.round(e.bias * 1000) / 10,
      brier: Math.round(e.brier * 10000) / 10000,
    };
    console.log(`${prop.label}`);
    console.log(
      `  n=${e.n}   predicted ${(e.meanP * 100).toFixed(1)}%   actual ${(e.meanA * 100).toFixed(1)}%   ` +
        `bias ${(e.bias * 100 >= 0 ? "+" : "")}${(e.bias * 100).toFixed(2)}pp   Brier ${e.brier.toFixed(4)}`,
    );
    if (e.buckets.length) {
      for (const b of e.buckets) {
        console.log(
          `    ${(b.lo * 100).toFixed(0)}-${((b.lo + 0.1) * 100).toFixed(0)}%  n=${String(b.n).padStart(4)}   ` +
            `predicted ${(b.pred * 100).toFixed(1)}%  actual ${(b.act * 100).toFixed(1)}%  ` +
            `${((b.pred - b.act) * 100 >= 0 ? "+" : "")}${((b.pred - b.act) * 100).toFixed(1)}pp`,
        );
      }
    } else {
      console.log(`    (not enough yet for a calibration table)`);
    }
    console.log();
  }

  console.log("A day or two proves nothing. Bias only means something once n is in the thousands.");
  return out;
}
