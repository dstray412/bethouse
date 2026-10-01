#!/usr/bin/env node
/*
 * BetHouse — compare-stats.mjs
 * One line per counting prop for a candidate against its base, on one
 * window: the paired Brier delta, its standard error, Δ/SE, the worst
 * calibration band move, and the verdict compare-td.mjs would give.
 *
 *   node compare-stats.mjs base.json cand.json [cand2.json …]
 *
 * The rule is stated once, in the README under "The rule for every
 * model change"; this prints the numbers it needs, per prop, since a
 * term can help one and hurt another. Both dumps must be the same exam
 * (same window, both --fixed-lines; the tool refuses otherwise). The
 * `drop` column is rows only the candidate has + rows only the base
 * has; under fixed lines both are 0, and past 2% there is no verdict.
 */
import { readFileSync } from "node:fs";
import { paired, verdict, rowsOf, pp } from "./compare-td.mjs";

const [baseFile, ...cands] = process.argv.slice(2);
if (!baseFile || !cands.length) { console.error("usage: node compare-stats.mjs base.json cand.json [cand2.json …]"); process.exit(1); }
const base = JSON.parse(readFileSync(baseFile, "utf8"));
for (const f of cands) {
  const cand = JSON.parse(readFileSync(f, "utf8"));
  console.log(`\n${f}  ${JSON.stringify(cand.overrides)}  vs ${baseFile}`);
  console.log(`  ${"prop".padEnd(9)}${"n".padStart(7)}${"drop".padStart(10)}${"base".padStart(9)}${"cand".padStart(9)}${"Δ".padStart(10)}${"Δ/SE".padStart(7)}${"band".padStart(8)}  verdict`);
  for (const stat of Object.keys(cand.stats || {})) {
    if (!base.stats || !base.stats[stat]) { console.log(`  ${stat.padEnd(9)}  the base dump has no rows for it (dumped before --dump wrote the counting props?)`); continue; }
    const r = paired(rowsOf(base, stat), rowsOf(cand, stat));
    if (!r.n) { console.log(`  ${stat.padEnd(9)}  no paired rows`); continue; }
    const v = verdict(r);
    const drop = `${r.notInBase}+${r.notInCand}`;
    console.log(`  ${stat.padEnd(9)}${String(r.n).padStart(7)}${drop.padStart(10)}${r.brierB.toFixed(5).padStart(9)}${r.brierC.toFixed(5).padStart(9)}${((r.delta >= 0 ? "+" : "") + r.delta.toFixed(5)).padStart(10)}${r.z.toFixed(2).padStart(7)}${pp(v.worstBand).padStart(8)}  ${v.text}`);
  }
}
