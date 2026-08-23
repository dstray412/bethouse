/*
 * BetHouse — track-pga.mjs
 * What the golf board predicted, and whether it was any good.
 *
 *   node track-pga.mjs snapshot     record this week's PRE-TOURNAMENT board
 *   node track-pga.mjs grade        grade any recorded event that has finished
 *   node track-pga.mjs report       print the running record
 *   node track-pga.mjs report --write-record   also emit pga-record.js
 *
 * WHY THIS EXISTS
 * ---------------
 * The third and last board to get a forward record. `backtest-pga.mjs`
 * replays completed tournaments and fits the constants to them; this records
 * what the board actually PUBLISHED before a ball was struck, and grades it
 * afterwards. The baseball board looked calibrated by backtest right up until
 * its forward record showed it was over-confident, and that is not a fact
 * about baseball.
 *
 * The rules live in track-core.mjs and are shared with the other two boards:
 * first prediction wins, pre-tournament only by the clock, nothing backfilled.
 *
 * WHAT GOLF DOES DIFFERENTLY
 * --------------------------
 * Two things, and both are about honesty rather than plumbing.
 *
 * 1. MOST WEEKS HAVE A CUT. Some do not. A limited-field event guarantees
 *    everyone four rounds, so every player is 100% to "make the cut" and
 *    there is no bet to record. Those weeks are skipped rather than recorded
 *    as 50 free wins, which would flatter the record permanently.
 *
 * 2. GRADING COSTS NOTHING. `pga-history.json` is committed and refreshed by
 *    fetch-pga.mjs on the same schedule as the board, and it already carries
 *    `madeCut` per player. So this reads a local file and makes no requests
 *    at all -- unlike the NFL, which has to go and ask ESPN.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import golf from "./golf.js";
import * as core from "./track-core.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const HIST = path.join(DIR, "pga-record");

const args = process.argv.slice(2);
const CMD = args[0] || "report";
const has = (f) => args.includes(f);

const PROPS = [{ id: "cut", label: "Makes the cut" }];

function board() {
  const f = path.join(DIR, "pga-data.js");
  if (!fs.existsSync(f)) {
    console.error("No pga-data.js. Run node fetch-pga.mjs first.");
    process.exit(1);
  }
  global.window = {};
  new Function("window", fs.readFileSync(f, "utf8"))(global.window);
  const D = global.window.BetHousePGAData;
  if (!D) {
    console.error("pga-data.js did not define a board.");
    process.exit(1);
  }
  return D;
}

function history() {
  const f = path.join(DIR, "pga-history.json");
  if (!fs.existsSync(f)) return [];
  try {
    const h = JSON.parse(fs.readFileSync(f, "utf8"));
    const list = h.events || h;
    return Array.isArray(list) ? list : Object.values(list);
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------- *
 * snapshot
 * ---------------------------------------------------------------- */

function snapshot() {
  const D = board();
  const ev = D.event;
  if (!ev || !ev.id) {
    console.log("No event on the board — nothing to record.");
    return;
  }

  /* Rule: a week with no cut has no bet in it. Recording 50 players at 100%
     would add free wins to the record for ever and make every later number
     meaningless. */
  if (ev.cut == null) {
    console.log(`${ev.name}: no cut this week — nothing to record.`);
    return;
  }

  /* Pre-tournament only, checked two ways for the same reason baseball
     checks two ways: a status string is a vocabulary someone else controls,
     and the clock is not. ESPN's `state` going past "pre" is the first
     signal; the earliest tee time is the one that cannot be reworded. */
  if (ev.state && ev.state !== "pre") {
    console.log(`${ev.name}: already under way (state "${ev.state}") — too late to record.`);
    return;
  }
  const field = D.field || [];
  const tees = field.map((p) => p.teeTime).filter(Boolean).sort();
  const firstTee = tees[0] || ev.date;
  if (core.startedAlready(firstTee)) {
    console.log(`${ev.name}: first tee time has passed — too late to record.`);
    return;
  }
  if (!field.length) {
    console.log(`${ev.name}: field not posted yet — nothing to record.`);
    return;
  }

  const residuals = D.residuals ? Float64Array.from(D.residuals) : null;
  const sim = golf.simulateCut(
    field.map((p) => ({
      id: p.id, name: p.name, skill: p.skill, rounds: p.rounds,
      teeTime: p.teeTime, amateur: p.amateur,
    })),
    { cutN: ev.cut, residuals },
  );
  if (!sim || !sim.length) {
    console.log(`${ev.name}: the simulation returned nothing — not recording.`);
    return;
  }

  const date = String(ev.date || firstTee).slice(0, 10);
  const day = core.loadDay(HIST, date);
  day.eventId = String(ev.id);
  day.eventName = ev.name;
  day.cutRule = ev.cut;
  const seen = new Set(day.predictions.map((p) => `${p.eventId}|${p.playerId}`));

  let added = 0;
  for (const r of sim) {
    if (!isFinite(r.prob)) continue;
    const key = `${ev.id}|${r.id}`;
    if (seen.has(key)) continue;                  // Rule 1: first prediction wins
    day.predictions.push({
      eventId: String(ev.id),
      playerId: String(r.id),
      name: r.name,
      prop: "cut",
      prob: Math.round(r.prob * 10000) / 10000,
      rounds: r.rounds || 0,
      firstTee,
      recordedAt: new Date().toISOString(),
    });
    seen.add(key);
    added++;
  }

  day.graded = false;
  core.saveDay(HIST, day);
  console.log(`snapshot ${date} — ${ev.name} (cut: low ${ev.cut} and ties): ` +
    `+${added} predictions (${day.predictions.length} total)`);
}

/* ---------------------------------------------------------------- *
 * grade
 *
 * Reads pga-history.json, which fetch-pga.mjs keeps current on the same
 * schedule as the board. No requests.
 * ---------------------------------------------------------------- */

function grade() {
  const dates = core.listDays(HIST);
  if (!dates.length) {
    console.log("Nothing recorded yet. Run node track-pga.mjs snapshot.");
    return;
  }
  const events = new Map(history().map((e) => [String(e.id), e]));
  let totalGraded = 0;

  for (const date of dates) {
    const day = core.loadDay(HIST, date);
    const ungraded = day.predictions.filter((p) => p.actual == null && !p.scratched);
    if (!ungraded.length) continue;

    const ev = events.get(String(day.eventId));
    if (!ev) {
      console.log(`${date}: ${day.eventName} is not in pga-history.json yet`);
      continue;
    }
    const outcome = new Map((ev.players || []).map((p) => [String(p.id), p]));

    for (const p of day.predictions) {
      if (p.actual != null || p.scratched) continue;
      const got = outcome.get(p.playerId);
      /* Only a real true/false counts. A player still scheduled, withdrawn,
         disqualified, or absent from the field entirely is marked and left
         alone: a bet that never resolved is void, not lost, and scoring it
         as a miss would make the model look worse than it is. The flag also
         stops grade() looking at him again on every future run. */
      if (!got || typeof got.madeCut !== "boolean") {
        if (got && got.status === "STATUS_SCHEDULED") continue;   // still to play
        p.scratched = true;
        p.scratchReason = got ? got.status || "no result" : "not in the field";
        continue;
      }
      p.actual = got.madeCut ? 1 : 0;
      p.result = { status: got.status, rounds: (got.rounds || []).length };
      totalGraded++;
    }

    const left = day.predictions.filter((p) => p.actual == null && !p.scratched).length;
    day.graded = left === 0;
    core.saveDay(HIST, day);
    const done = day.predictions.filter((p) => p.actual != null).length;
    const scratched = day.predictions.filter((p) => p.scratched).length;
    console.log(`${date} ${day.eventName}: ${done} graded, ${scratched} did not resolve, ${left} pending`);
  }
  console.log(totalGraded ? `\ngraded ${totalGraded} predictions` : "\nnothing new to grade");
}

/* ---------------------------------------------------------------- *
 * main
 * ---------------------------------------------------------------- */

const report = () =>
  core.report(HIST, PROPS, {
    title: "BetHouse PGA running record",
    hint: "Run: node fetch-pga.mjs && node track-pga.mjs snapshot   (then grade once the event finishes)",
  });

(async () => {
  if (CMD === "snapshot") snapshot();
  else if (CMD === "grade") grade();
  else if (CMD === "report") {
    const out = report();
    if (has("--write-record")) {
      /* Written even when empty so golf.html can load it from the first run
         and say "nothing graded yet" rather than omitting the section. */
      const record = out || { days: [], total: 0, props: {} };
      fs.writeFileSync(
        path.join(DIR, "pga-record.js"),
        "/* Generated by track-pga.mjs. The golf board's running record. */\n" +
          "window.BETHOUSE_PGA_RECORD = " + JSON.stringify(record) + ";\n",
      );
      console.log(`\nWrote pga-record.js (${record.total} graded)`);
    }
  } else {
    console.error(`Unknown command "${CMD}". Use snapshot, grade or report.`);
    process.exit(1);
  }
})().catch((e) => {
  console.error("track-pga failed:", e.message);
  process.exit(1);
});
