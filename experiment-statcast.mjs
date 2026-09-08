#!/usr/bin/env node
/*
 * BetHouse — experiment-statcast.mjs
 * Do Statcast priors make the board's published probabilities truer?
 *
 *   node experiment-statcast.mjs
 *
 * HOW IT IS HONEST
 * ----------------
 * calibrate.mjs rebuilds every prediction the board actually published,
 * from the committed snapshot it was built from, and grades it against
 * what happened. This re-scores those same rows with one change at a
 * time, each a regression centre built from LAST season's Statcast
 * numbers (statcast/2025.json), which are fully known before every game
 * this season:
 *
 *   hit      1+ H/R/RBI: centre = league + w  * (xBA per PA − league)
 *   pitcher  hrr and TB: the starter's average allowed is regressed by
 *            innings (K) toward league + wp * (his xBA allowed − league)
 *   tb       total bases: centre toward xSLG per PA by wt
 *   hr       home runs: centre toward barrels-derived HR per PA by wh
 *
 * The bar, the same one CALIBRATION_SHRINK had to clear: fitted on one
 * half of the window, a setting must improve the other half on Brier and
 * on log loss, both ways round, on the raw probability. Anything that
 * fails either way is reported and not shipped.
 */
import { rebuild } from "./calibrate.mjs";
import { loadPriors, loadPitcherPriors } from "./statcast.mjs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prov from "./provenance.mjs";

console.log(prov.banner(prov.repoState()) + "\n");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const S = createRequire(import.meta.url)(path.join(DIR, "score.js"));

const priors = loadPriors(2025), pitchers = loadPitcherPriors(2025);
if (!Object.keys(priors).length) { console.error("no statcast/2025.json — run: node statcast.mjs 2025"); process.exit(1); }

const { rows, agree } = rebuild({ keepInputs: true });
const days = [...new Set(rows.map((r) => r.date))].sort();
const mid = days[Math.floor(days.length / 2)];
console.log(`rebuilt ${rows.length} predictions over ${days.length} days (${days[0]} to ${days.at(-1)}); ` +
  `reproduces the recorded number to ${(100 * agree.sum / agree.n).toFixed(3)}pp on average`);
console.log(`hitters with a prior: ${(100 * rows.filter((r) => priors[r.id]).length / rows.length).toFixed(0)}% of rows; ` +
  `starters with a prior: ${(100 * rows.filter((r) => r.pitcherId && pitchers[r.pitcherId]).length / rows.length).toFixed(0)}%\n`);

const clamp = (p) => Math.min(0.999, Math.max(0.001, p));
const brier = (s) => s.reduce((x, r) => x + (r.a - r.p) ** 2, 0) / s.length;
const logloss = (s) => -s.reduce((x, r) => x + (r.a ? Math.log(clamp(r.p)) : Math.log(1 - clamp(r.p))), 0) / s.length;

/* Score one rebuilt row under a set of model options. The shipped hit
   weight stays on throughout, since it is part of the model now. */
function score(r, o) {
  const player = Object.assign({}, r.player, { prior: priors[r.id] || null });
  const pp = r.pitcherId && pitchers[r.pitcherId] ? pitchers[r.pitcherId].xbaAllowed : null;
  const ctx = Object.assign({}, r.ctx, { pitcherPrior: pp }, o);
  const out = r.prop === "hr" ? S.scoreHR(player, ctx) : r.prop === "hrr" ? S.scoreHRR(player, ctx) : S.scoreTB(player, ctx);
  return out && isFinite(out.rawProb) ? clamp(out.rawProb) : null;
}

/* One sweep: for each prop it touches, score every row under every setting,
   then fit on each half and judge on the other. */
function sweep(title, settings, props) {
  console.log(`=== ${title} ===`);
  for (const prop of props) {
    const rs = rows.filter((r) => r.prop === prop);
    if (rs.length < 200) continue;
    const scored = settings.map((o) => rs.map((r) => ({ date: r.date, a: r.a, p: score(r, o) })).filter((x) => x.p != null));
    const label = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join(" ") || "as shipped";
    console.log(`  ${prop} (n=${rs.length})`);
    for (const [half, filt] of [["first half", (x) => x.date < mid], ["second half", (x) => x.date >= mid]]) {
      const line = settings.map((o, i) => { const s = scored[i].filter(filt); return `${label(o)}: ${brier(s).toFixed(5)}/${logloss(s).toFixed(4)}`; });
      console.log(`    ${half.padEnd(12)} Brier/logloss  ` + line.join("   "));
    }
    const verdicts = [];
    for (const [F, T, fn, tn] of [[(x) => x.date < mid, (x) => x.date >= mid, "first", "second"], [(x) => x.date >= mid, (x) => x.date < mid, "second", "first"]]) {
      let best = 0;
      settings.forEach((o, i) => { if (logloss(scored[i].filter(F)) < logloss(scored[best].filter(F))) best = i; });
      const base = scored[0].filter(T), test = scored[best].filter(T);
      const ok = brier(test) < brier(base) && logloss(test) < logloss(base);
      verdicts.push(best === 0 ? "shipped" : ok ? "better" : "worse");
      console.log(`    fitted on the ${fn} half → ${label(settings[best])}; on the ${tn} half Brier ${brier(base).toFixed(5)} → ${brier(test).toFixed(5)}, logloss ${logloss(base).toFixed(5)} → ${logloss(test).toFixed(5)}  ${best === 0 ? "(chose the shipped model)" : ok ? "BETTER ON BOTH" : "not better on both"}`);
    }
    console.log(`    verdict: ${verdicts.every((v) => v === "better") ? "SHIP the smaller of the two fitted settings" : verdicts.every((v) => v === "shipped") ? "nothing to ship" : "does not validate both ways — do not ship"}`);
  }
  console.log();
}

sweep("PITCHER: average allowed regressed by innings toward league (wp=0) or toward his xBA allowed (wp=1)",
  [{}, ...[40, 80, 160].flatMap((K) => [0, 0.5, 1].map((wp) => ({ pitcherKIP: K, pitcherPriorWeight: wp })))],
  ["hrr", "tb2", "tb3"]);
sweep("TOTAL BASES: centre toward xSLG per PA",
  [{}, ...[0.25, 0.5, 0.75, 1].map((wt) => ({ priorWeightTB: wt }))],
  ["tb2", "tb3", "tb4"]);
sweep("HOME RUNS: centre toward barrels-derived HR per PA",
  [{}, ...[0.25, 0.5, 0.75, 1].map((wh) => ({ priorWeightHR: wh }))],
  ["hr"]);
sweep("HIT (already shipped at 0.75): re-checked with everything else as shipped",
  [{ priorWeight: 0 }, { priorWeight: 0.75 }, { priorWeight: 1 }],
  ["hrr"]);
