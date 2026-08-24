/*
 * BetHouse — clv.mjs
 * Does the model's number beat the number the market closed at?
 *
 *   node clv.mjs              every day with both a record and closing prices
 *   node clv.mjs --day 2026-08-23
 *   node clv.mjs --edge 0.035 threshold for calling a leg a bet (default 0.035)
 *
 * WHY THIS EXISTS
 * ---------------
 * `track.mjs` already answers "were the published probabilities true?" That is
 * calibration, and it is necessary. It is also not enough to know whether any
 * of this is worth doing, because a perfectly calibrated model still loses
 * money at these prices.
 *
 * The measured hold on 1+ H/R/RBI is 6.96% (odds-data.js, 2026-08-24, n=180).
 * Feed a correct 66.6% leg into that and the per-leg multiplier is 0.9304, so a
 * three-leg slip returns -15.4%. Being right is not the same as being paid.
 *
 * What decides it is whether the model is a BETTER predictor than the closing
 * line. The close is the market's final answer after everyone else has pushed
 * on it, and beating it is the only claim in this business that cannot be
 * manufactured by picking favourites or by choosing a flattering start date.
 * It is also, not coincidentally, the measure books use to decide who to limit.
 *
 * Brier score is the yardstick, applied identically to both sides: mean squared
 * error against what actually happened. Lower wins.
 *
 * WHAT MAKES IT HONEST
 * --------------------
 * Both numbers were fixed before the game and neither can be edited afterwards.
 * `track.mjs:173` writes the model's probability pregame and never recomputes
 * it. `close-odds.mjs` overwrites the market price only while the game is still
 * open, and stops touching it the moment it starts. Remove either property and
 * this stops being evidence.
 *
 * WHAT IT CANNOT TELL YOU
 * -----------------------
 * What you would actually have been paid. The record stores the model's
 * probability but not the price on offer at the time it was published, so the
 * realised-return figure below is computed AT THE CLOSING PRICE. If the model
 * is genuinely beating the close then the price you could have taken earlier
 * was better than that, which makes the figure a floor rather than an estimate.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeName } from "./fetch-odds-espn.mjs";
import * as prov from "./provenance.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ *
 * Which market answers which prop
 *
 * The model and the feed count the same events under different names. The
 * model's "1+ H/R/RBI" is the market's "hrr over 0.5"; its "2+ total bases" is
 * "tb over 1.5". The feed carries far more hrr|1.5 than hrr|0.5 (225 against 60
 * on 2026-08-23), so a join that matched on the market name alone would pick up
 * the wrong line most of the time and report a large, entirely fictional edge.
 * ------------------------------------------------------------------ */

export function marketFor(prop) {
  if (prop === "hrr") return { market: "hrr", line: 0.5 };
  const tb = /^tb(\d+)$/.exec(String(prop));
  if (tb) return { market: "tb", line: Number(tb[1]) - 0.5 };
  /* Home runs are priced as their own market, which this feed does not carry.
     Null keeps those predictions out rather than matching them to something
     adjacent and plausible. */
  return null;
}

/* ------------------------------------------------------------------ *
 * The join
 * ------------------------------------------------------------------ */

export function join(predictions, closed) {
  const rows = [];
  for (const p of predictions || []) {
    if (p == null || p.actual == null) continue;      // pending is not a zero
    const m = marketFor(p.prop);
    if (!m) continue;
    const hit = (closed || {})[`${normalizeName(p.name)}|${m.market}|${m.line}`];
    if (!hit) continue;                                // never priced: no comparison exists
    const market = Number(hit.noVigOver);
    const model = Number(p.prob);
    if (!(market > 0 && market < 1) || !(model > 0 && model < 1)) continue;
    rows.push({
      name: p.name,
      prop: p.prop,
      model,
      market,
      actual: Number(p.actual),
      price: hit.over,
      startTime: hit.startTime,
    });
  }
  return rows;
}

/* ------------------------------------------------------------------ *
 * The comparison
 * ------------------------------------------------------------------ */

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const brier = (rows, side) => mean(rows.map((r) => (r[side] - r.actual) ** 2));

export function score(rows) {
  if (!rows || !rows.length) return null;
  const modelBrier = brier(rows, "model");
  const marketBrier = brier(rows, "market");
  return {
    n: rows.length,
    modelBrier,
    marketBrier,
    /* Positive means the model is the better predictor. Reported in the same
       units as the Brier scores so it can be compared across props. */
    edgeOverClose: marketBrier - modelBrier,
    beatsClose: modelBrier < marketBrier,
    modelMean: mean(rows.map((r) => r.model)),
    marketMean: mean(rows.map((r) => r.market)),
    actualMean: mean(rows.map((r) => r.actual)),
    /* How far the model sits from the close, in percentage points. Says
       nothing about who is right; it is the size of the disagreement. */
    disagreement: 100 * mean(rows.map((r) => r.model - r.market)),
  };
}

/* ------------------------------------------------------------------ *
 * The business question
 *
 * Beating the no-vig number is not enough to make money, because you pay the
 * vig on the way in. On a two-way market each side carries roughly half the
 * hold, so a leg has to beat the closing no-vig probability by more than that
 * share before it is a bet rather than a rounding error.
 * ------------------------------------------------------------------ */

export function edges(rows, minEdge = 0.035) {
  return (rows || []).filter((r) => r.model - r.market > minEdge);
}

/** American price to decimal payout, for the realised-return figure. */
export function payout(american) {
  const a = Number(String(american).replace("+", ""));
  if (!isFinite(a) || a === 0) return null;
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

/** What a flat stake on every row would have returned at the closing price. */
export function realised(rows) {
  const priced = (rows || []).filter((r) => payout(r.price) != null);
  if (!priced.length) return null;
  const ret = mean(priced.map((r) => (r.actual === 1 ? payout(r.price) : 0)));
  return { n: priced.length, ret: ret - 1 };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function readDays() {
  const hist = path.join(DIR, "history");
  const close = path.join(DIR, "odds-close");
  if (!fs.existsSync(hist) || !fs.existsSync(close)) return [];
  const dated = (d) =>
    fs.readdirSync(d).filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)).map((f) => f.slice(0, 10));
  const withClose = new Set(dated(close));
  return dated(hist).filter((d) => withClose.has(d)).sort();
}

const load = (dir, day) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, dir, `${day}.json`), "utf8"));
  } catch {
    return null;
  }
};

const pct = (x) => (x * 100).toFixed(1) + "%";
const sign = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const flag = (name, dflt) => {
    const i = argv.indexOf(name);
    return i === -1 ? dflt : argv[i + 1];
  };
  /* Unknown flags exit rather than silently defaulting. This repo has been
     bitten by that exact hole before -- see tasks/lessons.md. */
  for (const a of argv) {
    if (a.startsWith("--") && !["--day", "--edge"].includes(a)) {
      console.error(`Unknown flag ${a}. Use --day <YYYY-MM-DD> or --edge <fraction>.`);
      process.exit(1);
    }
  }
  const only = flag("--day", null);
  const minEdge = Number(flag("--edge", 0.035));

  /* Provenance first, always, even when everything is fine. On 2026-08-24 this
     tool's numbers were read off a tree 77 commits behind origin and reported
     as current; a stale number and a fresh one look identical, so the only
     defence is that the output says which it is. */
  console.log(prov.banner(prov.repoState()) + "\n");

  const days = readDays().filter((d) => !only || d === only);
  if (!days.length) {
    console.log("No day has both a graded record and frozen closing prices yet.");
    console.log("Closing prices start from the first run of close-odds.mjs.");
    process.exit(0);
  }

  const all = [];
  for (const day of days) {
    const h = load("history", day);
    const c = load("odds-close", day);
    if (!h || !c) continue;
    const rows = join(h.predictions, c.closed);
    all.push(...rows);
    const s = score(rows);
    console.log(
      `${day}: ${String(rows.length).padStart(4)} of ${h.predictions.length} predictions had a closing price` +
        (s ? `   model Brier ${s.modelBrier.toFixed(4)}  close ${s.marketBrier.toFixed(4)}` : ""),
    );
  }

  const s = score(all);
  if (!s) {
    console.log("\nNothing joined. The prop-to-market mapping may have drifted.");
    process.exit(0);
  }

  console.log(`\nMODEL vs CLOSING LINE — ${s.n} graded predictions across ${days.length} day(s)\n`);
  console.log(`  model said   ${pct(s.modelMean)}`);
  console.log(`  close said   ${pct(s.marketMean)}`);
  console.log(`  happened     ${pct(s.actualMean)}`);
  console.log(`  disagreement ${sign(s.disagreement)}pp   (model minus close)\n`);
  console.log(`  Brier, model ${s.modelBrier.toFixed(4)}`);
  console.log(`  Brier, close ${s.marketBrier.toFixed(4)}`);
  console.log(
    `  ${s.beatsClose ? "MODEL BEATS THE CLOSE" : "the close is the better predictor"} ` +
      `by ${Math.abs(s.edgeOverClose).toFixed(4)}\n`,
  );

  for (const prop of [...new Set(all.map((r) => r.prop))].sort()) {
    const ps = score(all.filter((r) => r.prop === prop));
    console.log(
      `  ${prop.padEnd(5)} n=${String(ps.n).padStart(4)}  model ${ps.modelBrier.toFixed(4)}  ` +
        `close ${ps.marketBrier.toFixed(4)}  ${ps.beatsClose ? "model" : "close"} ahead`,
    );
  }

  const e = edges(all, minEdge);
  console.log(`\nLEGS THE MODEL CALLS A BET (more than ${(minEdge * 100).toFixed(1)}pp above the close)\n`);
  if (!e.length) {
    console.log(`  none of ${all.length}. The model is not finding anything the market missed.`);
  } else {
    const es = score(e);
    const r = realised(e);
    console.log(`  ${e.length} of ${all.length} legs`);
    console.log(`  model said ${pct(es.modelMean)}, close said ${pct(es.marketMean)}, happened ${pct(es.actualMean)}`);
    if (r) {
      console.log(`  flat stake at the CLOSING price: ${sign(r.ret * 100)}% over ${r.n} legs`);
      console.log(`  (a floor, not an estimate -- the price when published was not recorded)`);
    }
  }

  console.log(
    `\nOne day proves nothing. Beating the close is only a claim once n is in the thousands.`,
  );
}
