#!/usr/bin/env node
/*
 * BetHouse — experiment-statcast.mjs
 * Does regressing a hitter toward his own expected rate, rather than the
 * league's, make the board's published probabilities truer?
 *
 *   node experiment-statcast.mjs
 *
 * HOW IT IS HONEST
 * ----------------
 * calibrate.mjs rebuilds every prediction the board actually published,
 * from the committed snapshot it was built from, and grades it against
 * what happened. This re-scores those same rows with one change: the
 * regression centre for the hit rate becomes league + w * (prior − league),
 * where the prior is LAST season's Statcast expected batting average per
 * PA (statcast/2025.json). Last season is fully known before every game
 * this season, so nothing looks ahead. w = 0 is the shipped model.
 *
 * The bar, the same one CALIBRATION_SHRINK had to clear: fitted on one half
 * of the window, w must improve the other half on Brier and on log loss,
 * both ways round. It is measured on the raw probability and again after
 * the shipped calibration (shrink toward the solved centre), because a
 * prior that helps the raw number and hurts the calibrated one has only
 * moved the level, not the ranking.
 */
import { rebuild } from "./calibrate.mjs";
import { loadPriors } from "./statcast.mjs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prov from "./provenance.mjs";

console.log(prov.banner(prov.repoState()) + "\n");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const S = createRequire(import.meta.url)(path.join(DIR, "score.js"));

const priors = loadPriors(2025);
if (!Object.keys(priors).length) { console.error("no statcast/2025.json — run: node statcast.mjs 2025"); process.exit(1); }

const { rows, agree } = rebuild({ keepInputs: true });
const days = [...new Set(rows.map((r) => r.date))].sort();
const mid = days[Math.floor(days.length / 2)];
console.log(`rebuilt ${rows.length} predictions over ${days.length} days (${days[0]} to ${days.at(-1)}); ` +
  `reproduces the recorded number to ${(100 * agree.sum / agree.n).toFixed(3)}pp on average`);

const clamp = (p) => Math.min(0.999, Math.max(0.001, p));
const logit = (p) => Math.log(p / (1 - p));
const sig = (z) => 1 / (1 + Math.exp(-z));
const brier = (s) => s.reduce((x, r) => x + (r.a - r.p) ** 2, 0) / s.length;
const logloss = (s) => -s.reduce((x, r) => x + (r.a ? Math.log(clamp(r.p)) : Math.log(1 - clamp(r.p))), 0) / s.length;
const bias = (s) => s.reduce((x, r) => x + (r.p - r.a), 0) / s.length;

/* The hit prior enters the 1+ H/R/RBI model through regressedPerPA. Total
   bases and home runs have their own rate models and no prior yet. */
const hrr = rows.filter((r) => r.prop === "hrr");
const withPrior = hrr.filter((r) => priors[r.id]);
console.log(`hrr rows ${hrr.length}; ${withPrior.length} (${(100 * withPrior.length / hrr.length).toFixed(0)}%) are hitters with a 2025 prior\n`);

function score(r, w) {
  const player = Object.assign({}, r.player, { prior: priors[r.id] || null });
  const ctx = Object.assign({}, r.ctx, { priorWeight: w });
  const out = S.scoreHRR(player, ctx);
  return out && isFinite(out.rawProb) ? out.rawProb : null;
}

const W = [0, 0.25, 0.5, 0.75, 1];
const scored = new Map(); // w -> rows with p (raw) and c (calibrated)
const m = logit(S.CALIBRATION_CENTRE.hrr), shrink = S.CALIBRATION_SHRINK;
for (const w of W) {
  scored.set(w, hrr.map((r) => { const p = score(r, w); return p == null ? null : { date: r.date, a: r.a, p: clamp(p), c: sig(m + shrink * (logit(clamp(p)) - m)), hasPrior: !!priors[r.id] }; }).filter(Boolean));
}
/* Sanity: w = 0 must reproduce the shipped raw number exactly. */
const w0 = scored.get(0);
const drift = hrr.reduce((x, r, i) => x + Math.abs(r.raw - (w0[i]?.p ?? r.raw)), 0) / hrr.length;
console.log(`w = 0 reproduces the rebuilt raw probability to ${(100 * drift).toFixed(4)}pp (should be ~0)\n`);

const line = (label, set, key) => `${label.padEnd(14)} Brier ${brier(set.map((r) => ({ a: r.a, p: r[key] }))).toFixed(5)}  logloss ${logloss(set.map((r) => ({ a: r.a, p: r[key] }))).toFixed(5)}  bias ${(100 * bias(set.map((r) => ({ a: r.a, p: r[key] })))).toFixed(2).padStart(6)}pp`;

for (const [title, key] of [["RAW probability", "p"], ["AFTER the shipped calibration", "c"]]) {
  console.log(`=== 1+ H/R/RBI, ${title} ===`);
  for (const [half, filt] of [["first half", (r) => r.date < mid], ["second half", (r) => r.date >= mid]]) {
    console.log(`  ${half} (n=${scored.get(0).filter(filt).length})`);
    for (const w of W) console.log("    " + line(`w = ${w}`, scored.get(w).filter(filt), key));
  }
  /* Only the hitters who have a prior, so the comparison is not diluted by
     the ones for whom nothing changed. */
  console.log(`  hitters WITH a prior only, whole window (n=${scored.get(0).filter((r) => r.hasPrior).length})`);
  for (const w of W) console.log("    " + line(`w = ${w}`, scored.get(w).filter((r) => r.hasPrior), key));
  /* Fit on one half, judge on the other, both ways. */
  for (const [fn, F, tn, T] of [["first", (r) => r.date < mid, "second", (r) => r.date >= mid], ["second", (r) => r.date >= mid, "first", (r) => r.date < mid]]) {
    let best = null;
    for (const w of W) { const v = logloss(scored.get(w).filter(F).map((r) => ({ a: r.a, p: r[key] }))); if (!best || v < best.v) best = { w, v }; }
    const base = scored.get(0).filter(T).map((r) => ({ a: r.a, p: r[key] }));
    const test = scored.get(best.w).filter(T).map((r) => ({ a: r.a, p: r[key] }));
    const ok = brier(test) < brier(base) && logloss(test) < logloss(base);
    console.log(`  fitted on the ${fn} half: w = ${best.w}; on the ${tn} half Brier ${brier(base).toFixed(5)} → ${brier(test).toFixed(5)}, logloss ${logloss(base).toFixed(5)} → ${logloss(test).toFixed(5)}  ${best.w === 0 ? "(chose the shipped model)" : ok ? "BETTER ON BOTH" : "not better on both"}`);
  }
  console.log();
}
console.log("A prior that helps only after re-solving the calibration centre has moved the level, not the ranking; that is not what this asks.\n");
