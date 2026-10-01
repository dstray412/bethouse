#!/usr/bin/env node
/*
 * BetHouse — experiment-wind.mjs
 * Does wind belong in the total? Measured over 27 seasons of nflverse
 * games (1999–2025, closing totals, roof and a wind reading).
 *
 *   node experiment-wind.mjs
 *
 * experiment-nflverse.mjs (2026-09-08) found the closing total does not
 * price wind: the under at 15+ mph hit 56% across every era. That is a
 * fact about the LINE. This asks the model's question: walked forward the
 * way the board builds it (this season and last, ratings from
 * nfl.buildTeamRatings), does taking windK points per mph over windFloor
 * off the projected total of an outdoor game make the total pick better,
 * on a window it was not fitted on?
 *
 * The rule is the README's ("The rule for every model change"): fit on
 * one window, validate on a disjoint one, paired rows. This harness
 * applies the Brier conditions (both windows improve, Δ/SE ≤ −2 on
 * validation) and not the band check; the pairing is complete by
 * construction (the same rows, graded twice), so the 98% guard does
 * not arise. A value that clears here still owes the band check before
 * it ships. Here the fit is 1999–2021 (four eras) and the validation
 * 2022–2025 (the last era, the one the board's replay lives in).
 * The term itself is nfl.projectGame's (opts wind, indoor, windK,
 * windFloor), called, not re-typed, so the shape measured is the shape
 * the board runs. The
 * rows are the total picks at every outdoor game with a wind reading;
 * the probability is nfl.totalProbability off the adjusted projection,
 * the outcome whether the game went over the close. Paired on the game,
 * the base being windK 0.
 */
import { loadGames } from "./nflverse.mjs";
import nfl from "./nfl.js";

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const pct = (x) => (100 * x).toFixed(1) + "%";
const BE = 0.5238;
const outdoors = (g) => /outdoors|open/i.test(g.roof || "outdoors");

const games = (await loadGames()).filter((g) => g.spread != null && g.total != null);
console.log(`${games.length} regular-season games with a closing spread and total, ${games[0].season}–${games.at(-1).season}`);

/* The walk-forward, as experiment-nflverse.mjs section 1 builds it. */
const weeks = [];
for (const g of games) { const k = `${g.season}|${g.week}`; if (!weeks.length || weeks.at(-1).k !== k) weeks.push({ k, season: g.season, games: [] }); weeks.at(-1).games.push(g); }
const rows = [];
for (let i = 0; i < weeks.length; i++) {
  const w = weeks[i];
  const prior = weeks.slice(0, i).flatMap((x) => x.games).filter((g) => g.season >= w.season - 1);
  if (prior.length < 64) continue;
  const rt = nfl.buildTeamRatings(prior);
  for (const g of w.games) {
    const pr = nfl.projectGame(rt, g.home.team, g.away.team, { neutral: !!g.neutral });
    rows.push({ g, rt, season: g.season, points: g.home.score + g.away.score, projT: pr.total, wind: g.wind, out: outdoors(g) });
  }
}
const windy = rows.filter((r) => r.out && r.wind != null);
console.log(`${rows.length} projected games; ${windy.length} outdoors with a wind reading\n`);

/* 1. The raw effect: points against the projection and against the close, by wind. */
console.log("1. POINTS − PROJECTION and POINTS − CLOSE, outdoor games by wind (the model does not see wind; nor, it seems, does the line)");
for (const [lo, hi] of [[0, 5], [5, 10], [10, 15], [15, 20], [20, 99]]) {
  const r = windy.filter((x) => x.wind >= lo && x.wind < hi);
  if (r.length < 50) continue;
  const dp = r.map((x) => x.points - x.projT), dc = r.map((x) => x.points - x.g.total);
  const se = (a) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)) / a.length);
  console.log(`  wind ${String(lo).padStart(2)}–${String(hi).padEnd(2)} n=${String(r.length).padStart(5)}   vs projection ${mean(dp).toFixed(2).padStart(6)} ± ${se(dp).toFixed(2)}   vs close ${mean(dc).toFixed(2).padStart(6)} ± ${se(dc).toFixed(2)}   under ${pct(r.filter((x) => x.points < x.g.total).length / r.filter((x) => x.points !== x.g.total).length)}`);
}

/* 2. The term: windK points per mph over windFloor, off the projected total. */
const FIT = (r) => r.season <= 2021, VAL = (r) => r.season >= 2022;
const adjust = (r, K, floor) => nfl.projectGame(r.rt, r.g.home.team, r.g.away.team, { neutral: !!r.g.neutral, wind: r.wind, indoor: !r.out, windK: K, windFloor: floor }).total;
function grade(rs, K, floor) {
  const out = [];
  for (const r of rs) {
    if (r.points === r.g.total) continue;
    const tp = nfl.totalProbability(adjust(r, K, floor), r.g.total);
    out.push({ key: r.g.id, prob: tp.overProb, actual: r.points > r.g.total ? 1 : 0, pick: tp.overProb >= 0.5, edge: Math.abs(tp.edge) });
  }
  return out;
}
function compare(base, cand) {
  const b = new Map(base.map((r) => [r.key, r]));
  const pairs = cand.map((c) => ({ c, x: b.get(c.key) })).filter((p) => p.x);
  const n = pairs.length;
  const diffs = pairs.map(({ c, x }) => (c.prob - c.actual) ** 2 - (x.prob - x.actual) ** 2);
  const d = mean(diffs), sd = Math.sqrt(mean(diffs.map((v) => (v - d) ** 2)) * n / Math.max(1, n - 1)), se = sd / Math.sqrt(n);
  const brier = (rs) => mean(rs.map((r) => (r.prob - r.actual) ** 2));
  const picks = (rs) => { const bets = rs.filter((r) => r.edge >= 3); return { n: bets.length, won: bets.filter((r) => r.pick === !!r.actual).length }; };
  const pb = picks(pairs.map((p) => p.x)), pc = picks(pairs.map((p) => p.c));
  return { n, brierB: brier(pairs.map((p) => p.x)), brierC: brier(pairs.map((p) => p.c)), delta: d, z: se > 0 ? d / se : 0, pb, pc };
}
for (const floor of [10, 15]) {
  console.log(`\n2. windK points per mph over ${floor} mph, outdoor games with a wind reading; paired Brier against windK 0; picks are the total side at 3+ points of edge, won against the close (needs ${pct(BE)})`);
  console.log(`  ${"K".padEnd(6)}${"window".padEnd(12)}${"n".padStart(6)}${"Brier 0".padStart(10)}${"Brier K".padStart(10)}${"Δ".padStart(10)}${"Δ/SE".padStart(7)}   picks: base won / n → K won / n`);
  for (const K of [0.2, 0.3, 0.5, 0.7, 1.0]) {
    for (const [label, win] of [["fit 99–21", FIT], ["val 22–25", VAL]]) {
      const rs = windy.filter(win);
      const r = compare(grade(rs, 0, floor), grade(rs, K, floor));
      console.log(`  ${String(K).padEnd(6)}${label.padEnd(12)}${String(r.n).padStart(6)}${r.brierB.toFixed(5).padStart(10)}${r.brierC.toFixed(5).padStart(10)}${((r.delta >= 0 ? "+" : "") + r.delta.toFixed(5)).padStart(10)}${r.z.toFixed(2).padStart(7)}   ${r.pb.won}/${r.pb.n} (${pct(r.pb.won / Math.max(1, r.pb.n))}) → ${r.pc.won}/${r.pc.n} (${pct(r.pc.won / Math.max(1, r.pc.n))})`);
    }
  }
}
console.log("\nA value ships only if Δ/SE is at or below −2 on the validation window and the fit window improves too, and then passes the band check this harness does not run; the pick rate is reported, not the rule.");
