#!/usr/bin/env node
/*
 * BetHouse — fit-usage.mjs
 * Fit the touchdown usage regression on what the model can see at
 * prediction time, not on the game's own box score.
 *
 *   node backtest-nfl.mjs --from 2023 --to 2024 --dump fit.json
 *   node fit-usage.mjs fit.json
 *
 * Each dumped row carries the model's inputs when it made the call: his
 * per-game carries and targets to date, his per-game red-zone carries,
 * red-zone targets and goal-line carries to date (null when unknown),
 * and the outcome. The regression here is TDs-scored-next-game against
 * those, through the origin, on the rows where the red-zone inputs are
 * known: the five coefficients that predict, rather than the five that
 * describe a box score after the fact. Both are printed for the same
 * rows so the difference is visible.
 */
import { readFileSync } from "node:fs";

export function solve(X, y, cols) {
  const k = cols.length, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (let i = 0; i < X.length; i++) for (let a = 0; a < k; a++) { for (let b = 0; b < k; b++) A[a][b] += X[i][cols[a]] * X[i][cols[b]]; A[a][k] += X[i][cols[a]] * y[i]; }
  for (let c = 0; c < k; c++) {
    let piv = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r; [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < k; r++) { if (r === c || !A[c][c]) continue; const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j++) A[r][j] -= f * A[c][j]; }
  }
  return cols.map((_, i) => A[i][k] / A[i][i]);
}

export function fitUsage(rows) {
  const X = [], y = [];
  for (const r of rows) {
    const [, , actual, c, t, rzc, rzt, glc] = r;
    if (rzc == null || c == null) continue;
    X.push([c, t, rzc, rzt, glc]); y.push(actual);
  }
  if (!X.length) return null;
  const five = solve(X, y, [0, 1, 2, 3, 4]), two = solve(X, y, [0, 1]);
  const mse = (coef, cols) => X.reduce((s, row, i) => { const yh = cols.reduce((tt, cc, j) => tt + coef[j] * row[cc], 0); return s + (y[i] - yh) ** 2; }, 0) / X.length;
  return { n: X.length, five, two, mseFive: mse(five, [0, 1, 2, 3, 4]), mseTwo: mse(two, [0, 1]) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = process.argv[2];
  if (!f) { console.error("usage: node fit-usage.mjs dump.json"); process.exit(1); }
  const d = JSON.parse(readFileSync(f, "utf8"));
  const r = fitUsage(d.rows);
  if (!r) { console.log("no rows with red-zone inputs in the dump"); process.exit(0); }
  console.log(`USAGE FIT ON PREDICTION-TIME INPUTS — ${r.n} rows (scored next game against per-game usage to date)`);
  console.log(`  five: carries ${r.five[0].toFixed(4)}  targets ${r.five[1].toFixed(4)}  rzCarries ${r.five[2].toFixed(4)}  rzTargets ${r.five[3].toFixed(4)}  glCarries ${r.five[4].toFixed(4)}   mse ${r.mseFive.toFixed(5)}`);
  console.log(`  two:  carries ${r.two[0].toFixed(4)}  targets ${r.two[1].toFixed(4)}   mse ${r.mseTwo.toFixed(5)}`);
  console.log(`  --set tdRz=1 --set tdPerCarryRz=${r.five[0].toFixed(4)} --set tdPerTargetRz=${r.five[1].toFixed(4)} --set tdPerRzCarry=${r.five[2].toFixed(4)} --set tdPerRzTarget=${r.five[3].toFixed(4)} --set tdPerGlCarry=${r.five[4].toFixed(4)}`);
}
