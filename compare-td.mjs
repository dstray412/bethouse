#!/usr/bin/env node
/*
 * BetHouse — compare-td.mjs
 * Two touchdown replays, row for row.
 *
 *   node backtest-nfl.mjs --from 2025 --dump base.json
 *   node backtest-nfl.mjs --from 2025 --set tdScript=0.5 --dump cand.json
 *   node compare-td.mjs base.json cand.json
 *
 * The rows are keyed season|week|game|player, so the comparison is paired:
 * the difference in squared error on each row, its mean and its standard
 * error, which is the number that says whether a change is real. A mean
 * Brier that moves by less than two standard errors of the paired
 * difference is noise (tasks/lessons.md: compare residuals, never raw
 * outcomes). Calibration bands and the top/bottom-fifth lift are printed
 * for both so a Brier gain that comes with a worse band is visible.
 */
import { readFileSync } from "node:fs";

export function paired(base, cand) {
  const b = new Map(base.rows.map((r) => [r[0], r]));
  const pairs = [];
  for (const r of cand.rows) { const x = b.get(r[0]); if (x && x[2] === r[2]) pairs.push({ pb: x[1], pc: r[1], a: r[2] }); }
  const n = pairs.length;
  const mean = (f) => pairs.reduce((s, p) => s + f(p), 0) / n;
  const brierB = mean((p) => (p.pb - p.a) ** 2), brierC = mean((p) => (p.pc - p.a) ** 2);
  const diffs = pairs.map((p) => (p.pc - p.a) ** 2 - (p.pb - p.a) ** 2);
  const d = diffs.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(diffs.reduce((s, v) => s + (v - d) ** 2, 0) / Math.max(1, n - 1));
  const se = sd / Math.sqrt(n);
  const biasB = mean((p) => p.pb - p.a), biasC = mean((p) => p.pc - p.a);
  const bands = (key) => {
    const out = [];
    for (let lo = 0; lo < 1; lo += 0.1) {
      const rows = pairs.filter((p) => p[key] >= lo && p[key] < lo + 0.1);
      if (rows.length < 15) continue;
      out.push({ lo, n: rows.length, predicted: rows.reduce((s, p) => s + p[key], 0) / rows.length, actual: rows.reduce((s, p) => s + p.a, 0) / rows.length });
    }
    return out;
  };
  const lift = (key) => {
    const s = [...pairs].sort((x, y) => y[key] - x[key]);
    const k = Math.max(1, Math.floor(n / 5));
    const top = s.slice(0, k).reduce((t, p) => t + p.a, 0) / k, bot = s.slice(-k).reduce((t, p) => t + p.a, 0) / k;
    return { top, bot };
  };
  return { n, unmatched: cand.rows.length - n, brierB, brierC, delta: d, se, z: se > 0 ? d / se : 0, biasB, biasC, bandsB: bands("pb"), bandsC: bands("pc"), liftB: lift("pb"), liftC: lift("pc") };
}

export function verdict(r) {
  const worstBand = Math.max(0, ...r.bandsC.map((c) => { const b = r.bandsB.find((x) => x.lo === c.lo); const gapC = Math.abs(c.predicted - c.actual), gapB = b ? Math.abs(b.predicted - b.actual) : 0; return gapC - gapB; }));
  const better = r.delta < 0 && r.z <= -2;
  const worse = r.delta > 0 && r.z >= 2;
  return { better, worse, worstBand, text: better ? (worstBand > 0.03 ? "BETTER on Brier, but a band moved worse by more than 3pp" : "BETTER") : worse ? "WORSE" : "NOISE (within two standard errors)" };
}

export function report(r, labelB = "base", labelC = "candidate") {
  const pp = (v) => ((100 * v >= 0 ? "+" : "") + (100 * v).toFixed(2)) + "pp";
  const lines = [];
  lines.push(`paired rows ${r.n}${r.unmatched ? ` (${r.unmatched} in the candidate not in the base)` : ""}`);
  lines.push(`Brier  ${labelB} ${r.brierB.toFixed(5)}   ${labelC} ${r.brierC.toFixed(5)}   Δ ${(r.delta >= 0 ? "+" : "") + r.delta.toFixed(5)}   SE ${r.se.toFixed(5)}   Δ/SE ${r.z.toFixed(2)}`);
  lines.push(`bias   ${labelB} ${pp(r.biasB)}   ${labelC} ${pp(r.biasC)}`);
  lines.push(`lift   ${labelB} top ${(100 * r.liftB.top).toFixed(1)}% / bottom ${(100 * r.liftB.bot).toFixed(1)}%   ${labelC} top ${(100 * r.liftC.top).toFixed(1)}% / bottom ${(100 * r.liftC.bot).toFixed(1)}%`);
  lines.push(`bands  predicted → actual (gap), ${labelB} | ${labelC}`);
  for (const c of r.bandsC) {
    const b = r.bandsB.find((x) => x.lo === c.lo);
    const f = (x) => (x ? `${(100 * x.predicted).toFixed(1)}→${(100 * x.actual).toFixed(1)} (${pp(x.predicted - x.actual)}) n=${x.n}` : "—");
    lines.push(`  ${String(Math.round(100 * c.lo)).padStart(2)}-${String(Math.round(100 * c.lo) + 10).padEnd(3)} ${f(b).padEnd(34)} | ${f(c)}`);
  }
  const v = verdict(r);
  lines.push(`verdict: ${v.text}`);
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [a, b] = process.argv.slice(2);
  if (!a || !b) { console.error("usage: node compare-td.mjs base.json candidate.json"); process.exit(1); }
  const base = JSON.parse(readFileSync(a, "utf8")), cand = JSON.parse(readFileSync(b, "utf8"));
  console.log(`base ${a} ${JSON.stringify(base.overrides)}  candidate ${b} ${JSON.stringify(cand.overrides)}`);
  console.log(report(paired(base, cand)));
}
