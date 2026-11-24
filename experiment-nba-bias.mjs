#!/usr/bin/env node
/*
 * BetHouse — experiment-nba-bias.mjs
 * Does the NBA projection run high, and does shrinking or deflating it
 * change what the board would pick against a book?
 *
 *   node experiment-nba-bias.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * The first night of NBA book lines (2026-11-24) logged 80 unders in 91
 * picks. The cause was in the pools: players land at 93 to 98% of the
 * model's projection on average and 83 to 95% at the median, so the
 * model puts the middle outcome well under its own projection while a
 * book's line sits only about 4% under it. Two fixes were asked for,
 * under the README's rule (fit 2024-25, validate 2025-26 and 2026-27):
 *
 *   more shrink     the K of every prop raised (a projection pulled
 *                   harder toward an ordinary player's line)
 *   a deflator      actual fitted against projection on the fit window,
 *                   a line per prop, and the projection replaced by it
 *
 * and the pool was to depend on the size of the projection, which it
 * already does (a quarter of the pool nearest his projection, nba.js
 * poolShare); a narrower share is tried too.
 *
 * WHAT IS MEASURED
 * ----------------
 * One walk forward, every variant on the same player-games (the shipped
 * model decides who is graded).
 *
 *   projection   mean actual over mean projection, by size of
 *                projection, and the rms miss
 *   chance       paired Brier against the shipped model at the lines
 *                the replay grades (0.6 to 1.6 times the shipped
 *                projection), with its standard error: the rule
 *   picks        THERE ARE NO HISTORICAL BOOK LINES HERE. A stand-in
 *                line is placed where the books' lines sat on the one
 *                night on file, as a fraction of the SHIPPED projection
 *                (BOOK_AT), priced -110 both ways. A pick is a chance 5
 *                points or more from 50%. Hit rate and return on stake
 *                are of those picks. The stand-in is tied to the
 *                model's own projection, so it shares the model's
 *                mistakes about a player: it says what the picks would
 *                have done against a book that knew no more than the
 *                model does, which is the generous case.
 *
 * It makes no requests.
 */
import { readFileSync, existsSync } from "node:fs";
import nba from "./nba.js";
import { walk, contextFor, HISTORY_FILE } from "./fetch-nba.mjs";

if (!existsSync(HISTORY_FILE)) { console.error(`No ${HISTORY_FILE}. Run: node fetch-nba.mjs --history --seasons 2024,2025,2026,2027`); process.exit(1); }
const games = JSON.parse(readFileSync(HISTORY_FILE, "utf8")).games;
const STATS = Object.keys(nba.STATS);
const FIT = (s) => s === 2025, VAL = (s) => s >= 2026;
/* Where the books' main lines sat against the shipped projection on 2026-11-24 (148 offers, DraftKings and FanDuel). One night. */
const BOOK_AT = { pts: 0.961, reb: 0.961, ast: 0.958, tpm: 0.924, pra: 0.997 };
const MULTS = [0.6, 0.8, 1.0, 1.25, 1.6];
const WIN = 100 / 110, GAP = 0.05;

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const kOf = (k) => Object.fromEntries(STATS.map((s) => [nba.STATS[s].kKey, k]));
const shareOf = (v) => Object.fromEntries(STATS.map((s) => [nba.STATS[s].poolShareKey, v]));

/* The variants. `model` prices; `deflate` is fitted below and applied to the shipped model's projection. */
const VARIANTS = [
  { id: "shipped", model: nba },
  { id: "K 4", model: nba.bind(kOf(4)) },
  { id: "K 8", model: nba.bind(kOf(8)) },
  { id: "K 16", model: nba.bind(kOf(16)) },
  { id: "share 0.10", model: nba.bind(shareOf(0.1)) },
  { id: "deflator", model: nba, deflate: true },
];

/* ------------------------------------------------------------------ *
 * One walk: for every slate, each variant's projection for every player
 * the shipped model would grade, and for every player a pool takes.
 * ------------------------------------------------------------------ */
const days = [];
const seasons = [...new Set(games.map((g) => g.season))].sort();
console.log(`NBA: ${games.length} games cached (${seasons.join(", ")}). Fit 2024-25, validation 2025-26 and 2026-27 to date.`);
for (const d of walk(games, nba, { from: `${seasons[1] - 1}0201` })) {
  const day = { season: d.season, rows: [], pool: [] };
  for (const stat of STATS) {
    for (const g of d.games) {
      for (const p of g.players) {
        const rec = d.lines.players.get(p.id);
        if (!rec) continue;
        const ctx = contextFor(nba, d.lines.teamFactors, g, p, stat), actual = nba.gameValue(stat, p);
        const exps = VARIANTS.map((v) => { const y = v.model.projectedStat(stat, rec, null, ctx); return y && y.exp > 0 ? y : null; });
        /* The pools: the model's own gate (fetch-nba.mjs poolEntries), each variant by its own projection. */
        if (rec.games >= 3) {
          const e = exps.map((y, i) => (y && y.base >= VARIANTS[i].model.DEFAULTS[nba.STATS[stat].poolFloorKey] ? y.exp : null));
          if (e.some((x) => x != null)) day.pool.push({ stat, actual, exp: e });
        }
        const graded = nba.statEligible(stat, rec, null, ctx);
        if (graded && d.season >= seasons[1] && exps.every(Boolean)) day.rows.push({ stat, season: d.season, actual, exp: exps.map((y) => y.exp) });
      }
    }
  }
  days.push(day);
}

/* ------------------------------------------------------------------ *
 * The deflator: actual = c + s * projection, least squares, per prop,
 * on the fit window's graded rows. "Fit actual / projection against
 * projection", in the form that does not blow up at small projections.
 * ------------------------------------------------------------------ */
const shippedI = 0, deflI = VARIANTS.findIndex((v) => v.deflate);
const DEFL = {};
for (const stat of STATS) {
  const r = days.flatMap((d) => d.rows).filter((x) => x.stat === stat && FIT(x.season));
  const mx = mean(r.map((x) => x.exp[shippedI])), my = mean(r.map((x) => x.actual));
  const s = r.reduce((a, x) => a + (x.exp[shippedI] - mx) * (x.actual - my), 0) / r.reduce((a, x) => a + (x.exp[shippedI] - mx) ** 2, 0);
  DEFL[stat] = { c: my - s * mx, s };
}
const deflated = (stat, e) => Math.max(0.05, DEFL[stat].c + DEFL[stat].s * e);
for (const d of days) {
  for (const x of d.rows) x.exp[deflI] = deflated(x.stat, x.exp[shippedI]);
  for (const x of d.pool) if (x.exp[shippedI] != null) x.exp[deflI] = deflated(x.stat, x.exp[shippedI]);
}
console.log(`\nTHE DEFLATOR, fitted on 2024-25: actual = c + s × projection`);
for (const stat of STATS) console.log(`  ${stat.padEnd(4)} c ${DEFL[stat].c.toFixed(3).padStart(7)}   s ${DEFL[stat].s.toFixed(3)}   so a projection of ${stat === "pts" ? "10 → " + deflated(stat, 10).toFixed(1) + ", 25 → " + deflated(stat, 25).toFixed(1) : stat === "pra" ? "20 → " + deflated(stat, 20).toFixed(1) + ", 40 → " + deflated(stat, 40).toFixed(1) : "3 → " + deflated(stat, 3).toFixed(2) + ", 8 → " + deflated(stat, 8).toFixed(2)}`);

/* ------------------------------------------------------------------ *
 * Price every row: each variant's chance at each line, off its own
 * levelled pool as it stood before the slate.
 * ------------------------------------------------------------------ */
const KEEP = nba.DEFAULTS.poolKeep;
const held = VARIANTS.map(() => Object.fromEntries(STATS.map((s) => [s, []])));
for (const d of days) {
  const pools = VARIANTS.map((v, i) => Object.fromEntries(STATS.map((s) => {
    const e = held[i][s], recent = e.length > KEEP ? e.slice(-KEEP) : e;
    return [s, v.model.sortedPool(recent.map((x) => x.exp), recent.map((x) => x.ratio), s)];
  })));
  for (const x of d.rows) {
    const base = x.exp[shippedI];
    x.lines = MULTS.map((m) => nba.lineFor(base, m));
    x.book = Math.max(0.5, Math.floor(BOOK_AT[x.stat] * base) + 0.5);
    x.p = VARIANTS.map((v, i) => {
      const pool = pools[i][x.stat];
      if (!v.model.poolSize(pool)) return null;
      const reads = v.model.poolReads(pool, x.exp[i]);
      return { lines: x.lines.map((l) => v.model.empiricalOver(x.exp[i], l, reads)), book: v.model.empiricalOver(x.exp[i], x.book, reads) };
    });
  }
  for (const e of d.pool) VARIANTS.forEach((v, i) => { if (e.exp[i] != null) held[i][e.stat].push({ exp: e.exp[i], ratio: e.actual / e.exp[i] }); });
}
const ROWS = days.flatMap((d) => d.rows).filter((x) => x.p && x.p.every((q) => q && q.book != null && q.lines.every((v) => v != null)));

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */
const WINDOWS = [["fit", FIT], ["validation", VAL]];
const pct = (x, d = 1) => (100 * x).toFixed(d) + "%";
const sgn = (x, d = 1) => (x >= 0 ? "+" : "") + x.toFixed(d);

console.log(`\n1. THE PROJECTION — mean actual ÷ mean projection (1.00 is unbiased), by size of the shipped projection, and the rms miss. ${ROWS.length} player-games.`);
for (const [wname, W] of WINDOWS) {
  console.log(`\n  ${wname}`);
  console.log(`  ${"variant".padEnd(12)}${STATS.map((s) => (s + "  low / mid / high").padStart(26)).join("")}${"   rms, all props".padStart(18)}`);
  VARIANTS.forEach((v, i) => {
    let line = "  " + v.id.padEnd(12), sq = [];
    for (const stat of STATS) {
      const r = ROWS.filter((x) => x.stat === stat && W(x.season)).sort((a, b) => a.exp[shippedI] - b.exp[shippedI]);
      const third = Math.floor(r.length / 3), parts = [r.slice(0, third), r.slice(third, 2 * third), r.slice(2 * third)];
      line += parts.map((q) => (mean(q.map((x) => x.actual)) / mean(q.map((x) => x.exp[i]))).toFixed(2)).join(" / ").padStart(26);
      /* The miss in units of the prop's own mean, so five props add. */
      const m = mean(r.map((x) => x.actual));
      sq = sq.concat(r.map((x) => ((x.actual - x.exp[i]) / m) ** 2));
    }
    console.log(line + Math.sqrt(mean(sq)).toFixed(4).padStart(18));
  });
}

console.log(`\n2. THE CHANCE — paired Brier against the shipped model at the replay's five lines (the rule: better on both windows, Δ/SE at or under −2 on validation, no band worse by 3pp)`);
const bandMove = (rows, i, li) => {
  let worst = 0;
  for (let lo = 0; lo < 10; lo++) {
    const inB = (j) => rows.filter((x) => { const p = x.p[j].lines[li]; return p >= lo / 10 && (lo === 9 ? p <= 1 : p < (lo + 1) / 10); });
    const a = inB(shippedI), b = inB(i);
    if (a.length < 15 || b.length < 15) continue;
    const off = (q, j) => Math.abs(mean(q.map((x) => x.p[j].lines[li])) - mean(q.map((x) => (x.actual > x.lines[li] ? 1 : 0))));
    worst = Math.max(worst, off(b, i) - off(a, shippedI));
  }
  return worst;
};
console.log(`  ${"variant".padEnd(12)}${STATS.map((s) => (s + "  fit | validation").padStart(24)).join("")}`);
VARIANTS.forEach((v, i) => {
  if (i === shippedI) return;
  let line = "  " + v.id.padEnd(12);
  for (const stat of STATS) {
    const cell = WINDOWS.map(([, W]) => {
      const r = ROWS.filter((x) => x.stat === stat && W(x.season));
      const diffs = [];
      let band = 0;
      MULTS.forEach((_, li) => { for (const x of r) { const a = x.actual > x.lines[li] ? 1 : 0; diffs.push((x.p[i].lines[li] - a) ** 2 - (x.p[shippedI].lines[li] - a) ** 2); } band = Math.max(band, bandMove(r, i, li)); });
      const se = sd(diffs) / Math.sqrt(diffs.length);
      return `${sgn(se ? mean(diffs) / se : 0)}${band >= 0.03 ? "!" : ""}`;
    }).join(" | ");
    line += cell.padStart(24);
  }
  console.log(line);
});
console.log(`  (Δ/SE; negative is better than shipped. "!" marks a calibration band moved worse by 3 points or more.)`);

console.log(`\n3. THE PICKS — against a stand-in line at the books' usual place (${STATS.map((s) => s + " " + BOOK_AT[s]).join(", ")} of the shipped projection), -110 both ways; a pick is a chance 5+ points from 50%`);
const picksOf = (rows, i) => rows.map((x) => {
  const p = x.p[i].book, side = p >= 0.5 + GAP ? "over" : p <= 0.5 - GAP ? "under" : null;
  if (!side || x.actual === x.book) return null;
  const won = side === "over" ? x.actual > x.book : x.actual < x.book;
  return { side, won, units: won ? WIN : -1 };
}).filter(Boolean);
for (const [wname, W] of WINDOWS) {
  console.log(`\n  ${wname}`);
  console.log(`  ${"variant".padEnd(12)}${"lines".padStart(8)}${"picks".padStart(8)}${"share".padStart(8)}${"unders".padStart(9)}${"hit rate".padStart(10)}${"return on stake".padStart(22)}${"   overs: n, hit".padStart(18)}${"   unders: n, hit".padStart(19)}`);
  VARIANTS.forEach((v, i) => {
    const r = ROWS.filter((x) => W(x.season)), pk = picksOf(r, i);
    const u = pk.map((p) => p.units), se = sd(u) / Math.sqrt(u.length || 1);
    const ov = pk.filter((p) => p.side === "over"), un = pk.filter((p) => p.side === "under");
    console.log(`  ${v.id.padEnd(12)}${String(r.length).padStart(8)}${String(pk.length).padStart(8)}${pct(pk.length / r.length, 0).padStart(8)}${pct(un.length / (pk.length || 1), 0).padStart(9)}${pct(mean(pk.map((p) => (p.won ? 1 : 0)))).padStart(10)}` +
      `${(sgn(100 * mean(u)) + "% ± " + (100 * 1.96 * se).toFixed(1)).padStart(22)}${(ov.length + ", " + pct(mean(ov.map((p) => (p.won ? 1 : 0))))).padStart(18)}${(un.length + ", " + pct(mean(un.map((p) => (p.won ? 1 : 0))))).padStart(19)}`);
  });
}
console.log(`\n  by prop, validation, shipped against the deflator: picks, share unders, hit rate, return`);
for (const stat of STATS) {
  const r = ROWS.filter((x) => x.stat === stat && VAL(x.season));
  const cell = (i) => { const pk = picksOf(r, i), u = pk.map((p) => p.units); return `${String(pk.length).padStart(6)} ${pct(pk.filter((p) => p.side === "under").length / (pk.length || 1), 0).padStart(5)} ${pct(mean(pk.map((p) => (p.won ? 1 : 0)))).padStart(6)} ${(sgn(100 * mean(u)) + "%").padStart(7)}`; };
  console.log(`  ${stat.padEnd(5)} shipped ${cell(shippedI)}    deflator ${cell(deflI)}`);
}
console.log(`\n  how often the stand-in line itself goes over, validation: ${STATS.map((s) => { const r = ROWS.filter((x) => x.stat === s && VAL(x.season) && x.actual !== x.book); return s + " " + pct(mean(r.map((x) => (x.actual > x.book ? 1 : 0)))); }).join(", ")}`);
console.log(`  A book whose lines went over that rarely would be giving the under away; real lines are set on tonight's news, which the stand-in does not have.\n`);
