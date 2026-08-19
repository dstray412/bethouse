#!/usr/bin/env node
/*
 * BetHouse — backtest-pga.mjs
 * Does the make-the-cut model actually work?
 *
 * Replays the season one tournament at a time. For event k it builds player
 * ratings from events 1..k-1 ONLY, simulates event k's real field, and then
 * checks who actually made the cut.
 *
 * THE NO-LOOKAHEAD RULE
 * ---------------------
 * The baseball backtest has to reconstruct a hitter's line entering a game
 * by subtracting the box score from his season total. Golf is easier and
 * the discipline is the same: ratings for event k are rebuilt from scratch
 * using only tournaments that had already finished. Nothing about event k
 * — not its scores, not its round difficulty, not its cut line — is
 * visible to the model that predicts it.
 *
 * What IS allowed to be known beforehand, because it genuinely is:
 *   - who is in the field (entry lists are public before the first tee time)
 *   - the cut rule (published; "low 65 and ties" is not an outcome)
 *
 * What is never used: the cut LINE, which is an outcome, not a rule.
 *
 *   node backtest-pga.mjs             # the report
 *   node backtest-pga.mjs --fit       # re-derive the constants
 *   node backtest-pga.mjs --sims 5000 # faster, noisier
 */

import { readFileSync, existsSync } from "node:fs";
import golf from "./golf.js";

const {
  buildRatings,
  simulateCut,
  standardizedResiduals,
  cutRuleFor,
  fairPrice,
  DEFAULTS,
} = golf;

const HISTORY_FILE = "pga-history.json";
const MIN_PRIOR_EVENTS = 6; // before this, ratings are noise

/*
 * Every fitted constant in this project is one window away from being
 * wrong. This is printed under every sweep result so the number never
 * leaves the terminal wearing more authority than it earned.
 */
const UNVALIDATED = [
  "",
  "  ^ CANDIDATE, NOT A CONSTANT.",
  "",
  "  These values won on ONE window. That is a hypothesis. On 2026-08-19 a",
  "  temperature slope fitted this way had a clean interior optimum, better",
  "  Brier, and converging cold/hot bias -- everything about it looked",
  "  finished -- and it was WORSE than doing nothing on the other half of",
  "  the season, whose own optimum was zero.",
  "",
  "  Before adopting them, re-run on a window that shares no events:",
  "      --start / --end for a different date range",
  "  and require the values to help BOTH. If the two windows disagree, the",
  "  disagreement is the finding.",
  "",
].join("\n");

function load() {
  if (!existsSync(HISTORY_FILE)) {
    console.error(`no ${HISTORY_FILE} — run: node fetch-pga.mjs --history-only`);
    process.exit(1);
  }
  const h = JSON.parse(readFileSync(HISTORY_FILE, "utf8"));
  const events = (h.events || [])
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return events;
}

/**
 * One tournament's worth of predictions.
 * Returns [] when the event is not a make-the-cut market.
 */
function predictEvent(event, priorEvents, opts) {
  const rule = cutRuleFor(event.name);
  if (rule.excluded || rule.cut == null) return [];

  const { players: ratings } = buildRatings(priorEvents, opts);

  // The field is everyone who teed off, rated or not: the cut depends on
  // the whole field, so an unrated Monday qualifier still takes up a spot.
  const field = (event.players || [])
    .filter((p) => p.madeCut !== null || (p.rounds || []).length > 0)
    .map((p) => {
      const r = ratings[p.id];
      return {
        id: p.id,
        name: p.name,
        skill: r ? r.skill : null,
        rounds: r ? r.rounds : 0,
      };
    });
  if (field.length < 40) return [];

  // The shape of scoring is rebuilt from prior tournaments too. Borrowing
  // this week's own score distribution would be lookahead of the worst
  // kind: it leaks how bunched the field turned out to be, which is most
  // of what decides where the cut lands.
  const sim = simulateCut(
    field,
    Object.assign({}, opts, {
      cutN: rule.cut,
      residuals: standardizedResiduals(priorEvents),
    }),
  );
  const truth = new Map(
    (event.players || []).map((p) => [p.id, p.madeCut]),
  );

  return sim
    .filter((p) => typeof truth.get(p.id) === "boolean")
    .map((p) => ({
      event: event.name,
      date: event.date,
      id: p.id,
      name: p.name,
      prob: p.prob,
      rated: p.rated,
      rounds: p.rounds,
      actual: truth.get(p.id) ? 1 : 0,
    }));
}

/** Walk the season forward, predicting each event from its past. */
function runBacktest(events, opts) {
  const preds = [];
  const perEvent = [];
  for (let k = 0; k < events.length; k++) {
    if (k < MIN_PRIOR_EVENTS) continue;
    const rows = predictEvent(events[k], events.slice(0, k), opts);
    if (!rows.length) continue;
    preds.push(...rows);
    const n = rows.length;
    const pred = rows.reduce((a, r) => a + r.prob, 0) / n;
    const act = rows.reduce((a, r) => a + r.actual, 0) / n;
    perEvent.push({ name: events[k].name, n, pred, act });
  }
  return { preds, perEvent };
}

/* -------------------------------------------------------------------- *
 * Scoring
 * -------------------------------------------------------------------- */

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

function brier(preds) {
  return mean(preds.map((r) => (r.prob - r.actual) ** 2));
}

function calibrationTable(preds, edges) {
  const rows = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i], hi = edges[i + 1];
    const inBucket = preds.filter((r) => r.prob >= lo && (i === edges.length - 2 ? r.prob <= hi : r.prob < hi));
    if (!inBucket.length) continue;
    rows.push({
      lo, hi,
      n: inBucket.length,
      pred: mean(inBucket.map((r) => r.prob)),
      act: mean(inBucket.map((r) => r.actual)),
    });
  }
  return rows;
}

function sliceRate(preds, frac, fromTop) {
  const sorted = preds.slice().sort((a, b) => b.prob - a.prob);
  const n = Math.max(1, Math.round(sorted.length * frac));
  const slice = fromTop ? sorted.slice(0, n) : sorted.slice(-n);
  return { n, rate: mean(slice.map((r) => r.actual)), pred: mean(slice.map((r) => r.prob)) };
}

const pct = (x) => (100 * x).toFixed(1) + "%";

function report(events, opts) {
  const { preds, perEvent } = runBacktest(events, opts);
  if (!preds.length) {
    console.log("no predictions — not enough history");
    return null;
  }

  const base = mean(preds.map((r) => r.actual));
  const pred = mean(preds.map((r) => r.prob));
  const bias = pred - base;
  const b = brier(preds);
  const naive = mean(preds.map((r) => (base - r.actual) ** 2));

  console.log(`\nMAKE THE CUT — out of sample, ${perEvent.length} tournaments, ${preds.length} player-events`);
  console.log("=".repeat(74));
  console.log(`  base rate (actually made the cut)   ${pct(base)}`);
  console.log(`  mean predicted                      ${pct(pred)}`);
  console.log(`  calibration bias                    ${(100 * bias >= 0 ? "+" : "") + (100 * bias).toFixed(2)}pp`);
  console.log(`  Brier score                         ${b.toFixed(4)}`);
  console.log(`  Brier, predicting the base rate     ${naive.toFixed(4)}  ${b < naive ? "(model is better)" : "(MODEL IS NO BETTER)"}`);
  console.log(`  skill score vs base rate            ${(100 * (1 - b / naive)).toFixed(2)}%`);

  console.log(`\n  CALIBRATION — does 60% mean 60%?`);
  console.log(`  ${"bucket".padEnd(14)}${"n".padStart(6)}${"predicted".padStart(12)}${"actual".padStart(10)}${"error".padStart(10)}`);
  for (const r of calibrationTable(preds, [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0])) {
    const err = 100 * (r.pred - r.act);
    console.log(
      `  ${(pct(r.lo) + "-" + pct(r.hi)).padEnd(14)}${String(r.n).padStart(6)}${pct(r.pred).padStart(12)}${pct(r.act).padStart(10)}${((err >= 0 ? "+" : "") + err.toFixed(1) + "pp").padStart(10)}`,
    );
  }

  console.log(`\n  DOES THE RANKING SEPARATE?`);
  const top20 = sliceRate(preds, 0.2, true);
  const bot20 = sliceRate(preds, 0.2, false);
  console.log(`  top 20% actually cashed             ${pct(top20.rate)}`);
  console.log(`  bottom 20% actually cashed          ${pct(bot20.rate)}`);
  console.log(`  spread                              ${(100 * (top20.rate - bot20.rate)).toFixed(1)}pp`);

  console.log(`\n  WHAT PRICE DOES EACH SLICE NEED?`);
  console.log(`  ${"slice".padEnd(14)}${"n".padStart(7)}${"predicted".padStart(12)}${"cashed".padStart(10)}${"break-even".padStart(13)}`);
  for (const frac of [0.02, 0.05, 0.1, 0.2, 0.5]) {
    const s = sliceRate(preds, frac, true);
    const be = fairPrice(s.rate);
    console.log(
      `  top ${(100 * frac).toFixed(0)}%`.padEnd(16) +
        String(s.n).padStart(7) +
        pct(s.pred).padStart(12) +
        pct(s.rate).padStart(10) +
        String(be > 0 ? "+" + be : be).padStart(13),
    );
  }
  const all = { n: preds.length, rate: base };
  console.log(
    `  every entrant`.padEnd(16) +
      String(all.n).padStart(7) +
      pct(pred).padStart(12) +
      pct(all.rate).padStart(10) +
      String(fairPrice(all.rate) > 0 ? "+" + fairPrice(all.rate) : fairPrice(all.rate)).padStart(13),
  );

  console.log(`\n  RATED vs UNRATED`);
  for (const [label, rows] of [
    ["rated players", preds.filter((r) => r.rated)],
    ["no prior rounds", preds.filter((r) => !r.rated)],
  ]) {
    if (!rows.length) continue;
    console.log(
      `  ${label.padEnd(18)}n=${String(rows.length).padStart(5)}  predicted ${pct(mean(rows.map((r) => r.prob)))}  actual ${pct(mean(rows.map((r) => r.actual)))}`,
    );
  }

  console.log(`\n  PER TOURNAMENT`);
  for (const e of perEvent) {
    console.log(
      `  ${e.name.slice(0, 40).padEnd(42)}n=${String(e.n).padStart(4)}  pred ${pct(e.pred).padStart(6)}  act ${pct(e.act).padStart(6)}`,
    );
  }

  return { preds, bias, brier: b, naive, top20, bot20 };
}

/* -------------------------------------------------------------------- *
 * Fitting
 *
 * Same idea as `backtest.mjs --fit` on the baseball side: sweep the
 * constants against real outcomes instead of trusting the first guess.
 * Brier is the objective because it punishes both miscalibration and a
 * ranking that does not separate.
 * -------------------------------------------------------------------- */

function fit(events, sims) {
  console.log(`\nFITTING (sims=${sims} per event — noisier but fast)\n`);
  const base = Object.assign({}, DEFAULTS, { sims });

  const sweeps = [
    ["K", [2, 4, 6, 8, 12, 16, 24, 32]],
    ["priorSkill", [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.5]],
    ["formSD", [0.6, 0.8, 1.03, 1.3, 1.6]],
    ["roundSD", [2.4, 2.55, 2.71, 2.85, 3.0]],
  ];

  /*
   * Coordinate descent, twice.
   *
   * One pass is not enough and the first draft proved it: K was swept while
   * priorSkill was still at 0, so every unrated player in the field was
   * being simulated as tour-average. That distorts the whole cut line, and
   * K got fitted against a field that did not exist. The second pass
   * re-visits each constant once the others have moved.
   */
  const current = Object.assign({}, base);
  for (let pass = 1; pass <= 2; pass++) {
    console.log(`  --- pass ${pass} ---`);
    for (const [name, values] of sweeps) {
      let best = null;
      console.log(`  ${name}:`);
      for (const v of values) {
        const opts = Object.assign({}, current, { [name]: v });
        const { preds } = runBacktest(events, opts);
        if (!preds.length) continue;
        const b = brier(preds);
        const bias = mean(preds.map((r) => r.prob)) - mean(preds.map((r) => r.actual));
        const mark = v === current[name] ? " *" : "";
        console.log(
          `    ${String(v).padStart(6)}  brier ${b.toFixed(5)}  bias ${((100 * bias >= 0 ? "+" : "") + (100 * bias).toFixed(2)).padStart(6)}pp${mark}`,
        );
        if (!best || b < best.b) best = { v, b };
      }
      if (best) {
        if (values.indexOf(best.v) === 0 || values.indexOf(best.v) === values.length - 1) {
          console.log(`    !! ${name}=${best.v} is at the edge of the sweep — widen the range`);
        }
        current[name] = best.v;
        console.log(`    -> ${name} = ${best.v}\n`);
      }
    }
  }
  console.log(UNVALIDATED);
  console.log("fitted constants:");
  for (const [name] of sweeps) console.log(`  ${name}: ${current[name]}`);
  return current;
}

/* -------------------------------------------------------------------- *
 * Main
 * -------------------------------------------------------------------- */

const args = process.argv.slice(2);
const simsArg = args.indexOf("--sims");
const sims = simsArg >= 0 ? Number(args[simsArg + 1]) : DEFAULTS.sims;
const events = load();

console.log(`loaded ${events.length} completed events from ${HISTORY_FILE}`);

if (args.includes("--fit")) {
  const fitted = fit(events, Math.min(sims, 4000));
  console.log("\nre-running the full report with fitted constants:");
  report(events, Object.assign({}, fitted, { sims }));
} else {
  report(events, Object.assign({}, DEFAULTS, { sims }));
}
