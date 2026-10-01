#!/usr/bin/env node
/*
 * BetHouse — compare-sweep.mjs
 * A whole sweep as one table, the README's, printed from the dumps by
 * the comparison tools' own arithmetic rather than by eye, with the
 * rule as written in the last column (Brier improves on both windows,
 * validation Δ/SE at or below −2, no band both runs have moves worse
 * than 3pp on either). Written for A4's vacated share after a table
 * typed by hand got two band figures wrong.
 *
 *   node compare-sweep.mjs <dir> <prefix> [strengths]
 *
 * Reads <dir>/vfit-0.json and <dir>/vval-0.json as the base and
 * <dir>/<prefix>fit-<k>.json, <dir>/<prefix>val-<k>.json for each
 * strength k (default 025,05,075,1, as --dump names them).
 */
import { readFileSync } from "node:fs";
import { paired, verdict, rowsOf } from "./compare-td.mjs";
const S = process.argv[2], prefix = process.argv[3] || "w", KS = (process.argv[4] || "025,05,075,1").split(",");
if (!S) { console.error("usage: node compare-sweep.mjs <dir> <prefix> [strengths]"); process.exit(1); }
const load = (f) => JSON.parse(readFileSync(`${S}/${f}`, "utf8"));
const base = { fit: load("vfit-0.json"), val: load("vval-0.json") };
const z = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
console.log("| prop | strength | fit Brier | fit Δ/SE | fit band | val Brier | val Δ/SE | val band | rule |");
for (const prop of ["td", "recyds", "rushyds", "recs", "rushrec"]) {
  for (const k of KS) {
    const cells = [];
    const res = {};
    for (const w of ["fit", "val"]) {
      const cand = load(`${prefix}${w}-${k}.json`);
      const b = prop === "td" ? base[w] : rowsOf(base[w], prop), c = prop === "td" ? cand : rowsOf(cand, prop);
      const r = paired(b, c);
      const v = verdict(r);
      res[w] = { r, v };
      cells.push(`${r.brierB.toFixed(5)} → ${r.brierC.toFixed(5)}`, z(r.z), v.worstBand != null ? z(100 * v.worstBand) + "pp" : "—");
    }
    /* The rule as written: Brier improves on both; validation Δ/SE ≤ −2; no band both runs have moves worse by more than 3pp on either. */
    const improves = res.fit.r.delta < 0 && res.val.r.delta < 0;
    const bar = res.val.r.z <= -2;
    const bands = [res.fit.v.worstBand, res.val.v.worstBand].every((x) => x == null || x <= 0.03);
    const ok = improves && bar && bands;
    const why = ok ? "clears" : !improves ? "Brier worse on a window" : !bar ? "validation inside the noise" : "a band moved past 3pp";
    console.log(`| ${prop} | ${k.replace(/^0(\d)/, "0.$1").replace(/^0\.(\d)5$/, "0.$15")} | ${cells.join(" | ")} | ${why} |`);
  }
}
