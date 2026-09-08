#!/usr/bin/env node
/*
 * BetHouse — experiment-cfbfastr.mjs
 * The college line questions, asked of twenty seasons instead of two.
 *
 *   node experiment-cfbfastr.mjs
 *
 * Reads the cfbfastR-data cache (cfbfastr.mjs). Two questions, by era, the
 * same way experiment-nflverse.mjs asks them of the NFL:
 *
 *   1. THE MODEL vs THE CLOSE. The college model (cfb.js: the NFL model
 *      bound to college constants, FCS pooled) walked forward a week at a
 *      time on this season plus last, regressed against the closing spread
 *      and total. Slope 1 = the edge is real; 0 = the line knew.
 *   2. THE LINE ITSELF. Cover and over rates by side, spread size and
 *      total size. Two seasons found unders on totals of 56+ at 55.6% and
 *      55.4%; here is whether that has been true since 2006.
 *
 * College lines in this table are thin before 2013 and after 2019 (one or
 * two books), so every number carries its n.
 */
import { loadGames } from "./cfbfastr.mjs";
import cfb from "./cfb.js";
import * as prov from "./provenance.mjs";

console.log(prov.banner(prov.repoState()) + "\n");

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const pct = (x) => (100 * x).toFixed(1) + "%";
const BE = 0.5238;
const ERAS = [[2006, 2010], [2011, 2015], [2016, 2019], [2020, 2025]];
const eraOf = (s) => ERAS.find(([a, b]) => s >= a && s <= b);
const eraLabel = (e) => (e ? `${e[0]}–${e[1]}` : "?");

const seasons = []; for (let s = 2006; s <= 2025; s++) seasons.push(s);
const all = await loadGames(seasons);
const games = all.filter((g) => g.spread != null);
console.log(`${all.length} FBS regular-season games 2006–2025, ${games.length} with a closing spread, ${all.filter((g) => g.total != null).length} with a total`);

/* 1. The model, walked forward. */
const weeks = [];
for (const g of all) { const k = `${g.season}|${g.week}`; if (!weeks.length || weeks.at(-1).k !== k) weeks.push({ k, season: g.season, games: [] }); weeks.at(-1).games.push(g); }
const rows = [];
for (let i = 0; i < weeks.length; i++) {
  const w = weeks[i];
  const prior = weeks.slice(0, i).flatMap((x) => x.games).filter((g) => g.season >= w.season - 1);
  if (prior.length < 250) continue;
  const rt = cfb.buildTeamRatings(prior);
  for (const g of w.games) {
    if (g.spread == null) continue;
    const pr = cfb.projectGame(rt, g.home.team, g.away.team, { neutral: !!g.neutral });
    rows.push({ g, era: eraOf(g.season), margin: g.home.score - g.away.score, points: g.home.score + g.away.score, projM: pr.margin, projT: pr.total });
  }
}
function slopeLine(label, rs, proj, line, outcome) {
  rs = rs.filter((r) => line(r) != null);
  if (rs.length < 100) return;
  let sxy = 0, sxx = 0; for (const r of rs) { const e = proj(r) - line(r); sxy += e * (outcome(r) - line(r)); sxx += e * e; }
  const bets = rs.filter((r) => Math.abs(proj(r) - line(r)) >= 3 && outcome(r) !== line(r));
  const won = bets.filter((r) => (proj(r) > line(r) ? outcome(r) > line(r) : outcome(r) < line(r))).length;
  const n = bets.length, se = Math.sqrt(0.25 / Math.max(1, n));
  console.log(`  ${label.padEnd(12)}n=${String(rs.length).padStart(5)}  slope ${(sxx ? sxy / sxx : 0).toFixed(3).padStart(7)}  bets>=3pts ${String(n).padStart(5)} won ${pct(n ? won / n : 0).padStart(6)}  z ${(n ? (won / n - BE) / se : 0).toFixed(2).padStart(5)}`);
}
console.log(`\n1. THE MODEL vs THE CLOSE — slope of (outcome − line) on (projection − line)`);
console.log(`   spread`);
slopeLine("all", rows, (r) => r.projM, (r) => -r.g.spread, (r) => r.margin);
for (const e of ERAS) slopeLine(eraLabel(e), rows.filter((r) => r.era === e), (r) => r.projM, (r) => -r.g.spread, (r) => r.margin);
console.log(`   total`);
slopeLine("all", rows, (r) => r.projT, (r) => r.g.total, (r) => r.points);
for (const e of ERAS) slopeLine(eraLabel(e), rows.filter((r) => r.era === e), (r) => r.projT, (r) => r.g.total, (r) => r.points);

/* 2. The line itself. */
const homeCover = (g) => g.home.score - g.away.score + g.spread > 0;
const push = (g) => g.home.score - g.away.score + g.spread === 0;
const dogCover = (g) => (g.spread < 0 ? !homeCover(g) : homeCover(g));
const over = (g) => g.home.score + g.away.score > g.total;
const tpush = (g) => g.home.score + g.away.score === g.total;
function scan(label, pick, filter, skipPush, pool) {
  const cells = []; let allW = 0, allN = 0;
  for (const e of ERAS) {
    const r = pool.filter((g) => eraOf(g.season) === e && filter(g) && !skipPush(g));
    const won = r.filter(pick).length; allW += won; allN += r.length;
    cells.push(r.length >= 30 ? `${pct(won / r.length).padStart(6)} (${String(r.length).padStart(4)})` : "     —       ");
  }
  const se = Math.sqrt(0.25 / Math.max(1, allN));
  console.log(`  ${label.padEnd(30)}${cells.join("  ")}   all ${pct(allN ? allW / allN : 0)} (${allN}) z ${(allN ? (allW / allN - BE) / se : 0).toFixed(2).padStart(5)}`);
}
const tot = all.filter((g) => g.total != null);
console.log(`\n2. THE CLOSING LINE ITSELF — by era: ${ERAS.map(eraLabel).join("  ")}; z is against 52.4%`);
scan("home covers", homeCover, () => true, push, games);
scan("underdog covers", dogCover, () => true, push, games);
for (const [lo, hi] of [[0, 3], [3, 7], [7, 14], [14, 21], [21, 28], [28, 99]]) scan(`underdog covers, ${lo}–${hi}`, dogCover, (g) => Math.abs(g.spread) >= lo && Math.abs(g.spread) < hi, push, games);
scan("over", over, () => true, tpush, tot);
for (const [lo, hi] of [[0, 45], [45, 52], [52, 56], [56, 62], [62, 99]]) scan(`over, total ${lo}–${hi}`, over, (g) => g.total >= lo && g.total < hi, tpush, tot);
scan("UNDER, total >= 56", (g) => !over(g), (g) => g.total >= 56, tpush, tot);
scan("UNDER, total >= 60", (g) => !over(g), (g) => g.total >= 60, tpush, tot);
scan("home FAVOURITE covers", homeCover, (g) => g.spread < 0, push, games);
scan("FCS opponent: FBS side covers", (g) => (g.away.team === "FCS" ? homeCover(g) : !homeCover(g)), (g) => g.away.team === "FCS" || g.home.team === "FCS", push, games);
console.log(`\nTwenty-odd buckets. One at two standard errors is chance; the same bucket in every era is not.\n`);
