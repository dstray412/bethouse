#!/usr/bin/env node
/*
 * BetHouse — experiment-nflverse.mjs
 * The three questions two seasons could not settle, asked of twenty-seven.
 *
 *   node experiment-nflverse.mjs
 *
 * Reads the nflverse cache (nflverse.mjs; ~7,000 regular-season games since
 * 1999 with closing lines, weather since 1999, injury reports and depth
 * charts since 2009). Makes no requests of its own once the cache is full.
 *
 *   1. THE MODEL vs THE CLOSE, BY ERA. The football model's spread and total
 *      projections, walked forward a week at a time exactly as production
 *      builds them (this season plus last), regressed against the closing
 *      line. The slope is the fraction of the model's edge that comes true.
 *      Two seasons said ~0 for spreads and ~0.3 for totals; here is whether
 *      that has been true for a quarter century, era by era.
 *   2. THE LINE ITSELF, BY ERA. Cover and over rates by side, spread size,
 *      total size, roof and wind. Twenty buckets over 480 games produce a
 *      false finding by chance; the same bucket holding across five eras
 *      of 1,300 games does not.
 *   3. THE STARTING QUARTERBACK. Last week's depth chart says who the
 *      starter was; this week's injury report says whether he was Out,
 *      Doubtful or Questionable. Does the market over- or under-react to
 *      a missing starter? The report is published before the close, so a
 *      systematic miss would be a real, bettable bias.
 *
 * Everything is reported against the 52.4% a -110 price needs, with a z,
 * and split by era, because the one thing a long history buys is the
 * ability to see whether an effect persists.
 */
import { loadGames, loadInjuries, loadStarters } from "./nflverse.mjs";
import nfl from "./nfl.js";
import * as prov from "./provenance.mjs";

console.log(prov.banner(prov.repoState()) + "\n");

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const pct = (x) => (100 * x).toFixed(1) + "%";
const BE = 0.5238;
const ERAS = [[1999, 2004], [2005, 2010], [2011, 2016], [2017, 2021], [2022, 2025]];
const eraOf = (s) => ERAS.find(([a, b]) => s >= a && s <= b);
const eraLabel = (e) => (e ? `${e[0]}–${e[1]}` : "?");

const games = (await loadGames()).filter((g) => g.spread != null && g.total != null);
console.log(`${games.length} regular-season games with a closing spread and total, ${games[0].season}–${games.at(-1).season}`);

/* ------------------------------------------------------------------ *
 * 1. The model, walked forward over 27 seasons
 *
 * Ratings from this season plus last, the way the board builds them, with
 * home field solved on that window rather than fixed: it was three points
 * in 2000 and two now, and a fixed constant would be wrong somewhere.
 * ------------------------------------------------------------------ */

function solveHFA(prior) {
  let hfa = 2.5;
  for (let it = 0; it < 6; it++) {
    const r = nfl.buildTeamRatings(prior, { homeField: hfa });
    const res = prior.filter((g) => !g.neutral).map((g) => g.home.score - (r.league + (r.off[g.home.team] || 0) + (r.def[g.away.team] || 0)));
    hfa = mean(res);
  }
  return hfa;
}

const weeks = [];
for (const g of games) { const k = `${g.season}|${g.week}`; if (!weeks.length || weeks.at(-1).k !== k) weeks.push({ k, season: g.season, games: [] }); weeks.at(-1).games.push(g); }
const rows = [];
for (let i = 0; i < weeks.length; i++) {
  const w = weeks[i];
  const prior = weeks.slice(0, i).flatMap((x) => x.games).filter((g) => g.season >= w.season - 1);
  if (prior.length < 64) continue;
  const hfa = solveHFA(prior);
  const rt = nfl.buildTeamRatings(prior, { homeField: hfa });
  for (const g of w.games) {
    const pr = nfl.projectGame(rt, g.home.team, g.away.team, { neutral: !!g.neutral, homeField: hfa });
    rows.push({ g, season: g.season, era: eraOf(g.season), margin: g.home.score - g.away.score, points: g.home.score + g.away.score, projM: pr.margin, projT: pr.total });
  }
}

function slopeLine(label, rs, proj, line, outcome) {
  if (rs.length < 100) return;
  let sxy = 0, sxx = 0; for (const r of rs) { const e = proj(r) - line(r); sxy += e * (outcome(r) - line(r)); sxx += e * e; }
  const bets = rs.filter((r) => Math.abs(proj(r) - line(r)) >= 3 && outcome(r) !== line(r));
  const won = bets.filter((r) => (proj(r) > line(r) ? outcome(r) > line(r) : outcome(r) < line(r))).length;
  const n = bets.length, se = Math.sqrt(0.25 / n);
  console.log(`  ${label.padEnd(12)}n=${String(rs.length).padStart(5)}  slope ${(sxx ? sxy / sxx : 0).toFixed(3).padStart(7)}  bets>=3pts ${String(n).padStart(5)} won ${pct(won / n).padStart(6)}  z ${((won / n - BE) / se).toFixed(2).padStart(5)}`);
}
console.log(`\n1. THE MODEL vs THE CLOSE — slope of (outcome − line) on (projection − line); 1 = the edge is real, 0 = the line knew`);
console.log(`   spread`);
slopeLine("all", rows, (r) => r.projM, (r) => -r.g.spread, (r) => r.margin);
for (const e of ERAS) slopeLine(eraLabel(e), rows.filter((r) => r.era === e), (r) => r.projM, (r) => -r.g.spread, (r) => r.margin);
console.log(`   total`);
slopeLine("all", rows, (r) => r.projT, (r) => r.g.total, (r) => r.points);
for (const e of ERAS) slopeLine(eraLabel(e), rows.filter((r) => r.era === e), (r) => r.projT, (r) => r.g.total, (r) => r.points);

/* ------------------------------------------------------------------ *
 * 2. The line itself, by era
 * ------------------------------------------------------------------ */

const homeCover = (g) => g.home.score - g.away.score + g.spread > 0;
const push = (g) => g.home.score - g.away.score + g.spread === 0;
const dogCover = (g) => (g.spread < 0 ? !homeCover(g) : homeCover(g));
const over = (g) => g.home.score + g.away.score > g.total;
const tpush = (g) => g.home.score + g.away.score === g.total;
function scan(label, pick, filter, skipPush) {
  const cells = [];
  let allW = 0, allN = 0;
  for (const e of ERAS) {
    const r = games.filter((g) => eraOf(g.season) === e && filter(g) && !skipPush(g));
    const won = r.filter(pick).length;
    allW += won; allN += r.length;
    cells.push(r.length >= 30 ? `${pct(won / r.length).padStart(6)} (${String(r.length).padStart(4)})` : "     —       ");
  }
  const se = Math.sqrt(0.25 / Math.max(1, allN));
  console.log(`  ${label.padEnd(30)}${cells.join("  ")}   all ${pct(allW / allN)} z ${((allW / allN - BE) / se).toFixed(2).padStart(5)}`);
}
console.log(`\n2. THE CLOSING LINE ITSELF — rate the side wins, by era: ${ERAS.map(eraLabel).join("  ")}; z is against 52.4%`);
scan("home covers", homeCover, () => true, push);
scan("underdog covers", dogCover, () => true, push);
for (const [lo, hi] of [[0, 3], [3, 7], [7, 10], [10, 99]]) scan(`underdog covers, ${lo}–${hi}`, dogCover, (g) => Math.abs(g.spread) >= lo && Math.abs(g.spread) < hi, push);
scan("over", over, () => true, tpush);
for (const [lo, hi] of [[0, 40], [40, 45], [45, 50], [50, 99]]) scan(`over, total ${lo}–${hi}`, over, (g) => g.total >= lo && g.total < hi, tpush);
scan("UNDER, total >= 50", (g) => !over(g), (g) => g.total >= 50, tpush);
scan("UNDER, wind >= 15 mph", (g) => !over(g), (g) => g.wind != null && g.wind >= 15 && /outdoors|open/i.test(g.roof || "outdoors"), tpush);
scan("UNDER, wind >= 20 mph", (g) => !over(g), (g) => g.wind != null && g.wind >= 20 && /outdoors|open/i.test(g.roof || "outdoors"), tpush);
scan("UNDER, temp <= 32F", (g) => !over(g), (g) => g.temp != null && g.temp <= 32, tpush);
scan("over, dome/closed", over, (g) => /dome|closed/i.test(g.roof || ""), tpush);
/* Is wind priced? The mean of (points − total) by wind, with a standard error. */
console.log(`\n   points − closing total, by wind (outdoor games with a wind reading)`);
for (const [lo, hi] of [[0, 5], [5, 10], [10, 15], [15, 20], [20, 99]]) {
  const r = games.filter((g) => g.wind != null && g.wind >= lo && g.wind < hi && /outdoors|open/i.test(g.roof || "outdoors"));
  if (r.length < 30) continue;
  const res = r.map((g) => g.home.score + g.away.score - g.total);
  console.log(`   ${(lo + "–" + (hi === 99 ? "" : hi) + " mph").padEnd(12)} n=${String(r.length).padStart(5)}  mean ${mean(res).toFixed(2).padStart(6)} ± ${(sd(res) / Math.sqrt(r.length)).toFixed(2)}   under ${pct(r.filter((g) => !over(g) && !tpush(g)).length / r.filter((g) => !tpush(g)).length)}`);
}

/* ------------------------------------------------------------------ *
 * 3. The starting quarterback
 * ------------------------------------------------------------------ */

const seasons = []; for (let s = 2009; s <= 2025; s++) seasons.push(s);
const injuries = await loadInjuries(seasons);
const starters = await loadStarters(seasons);
const qb1 = new Map(); // season|week|team -> gsis id of the depth chart's QB1
for (const s of starters) if (s.pos === "QB") qb1.set(`${s.season}|${s.week}|${s.team}`, s.id);
const report = new Map(); // season|week|id -> status
for (const i of injuries) if (i.status) report.set(`${i.season}|${i.week}|${i.id}`, i.status);

const qbRows = [];
for (const g of games) {
  if (g.season < 2009 || g.week < 2) continue;
  for (const [side, opp] of [["home", "away"], ["away", "home"]]) {
    const team = g[side].team;
    const starter = qb1.get(`${g.season}|${g.week - 1}|${team}`);
    if (!starter) continue;
    const status = report.get(`${g.season}|${g.week}|${starter}`) || "Active";
    const margin = side === "home" ? g.home.score - g.away.score : g.away.score - g.home.score;
    const spread = side === "home" ? g.spread : -g.spread; // this side's number
    if (margin + spread === 0) continue;
    qbRows.push({ era: eraOf(g.season), status, covered: margin + spread > 0, resid: margin + spread, favoured: spread < 0,
      under: tpush(g) ? null : !over(g), tresid: g.home.score + g.away.score - g.total });
  }
}
console.log(`\n3. THE STARTING QUARTERBACK — last week's depth-chart starter, this week's report; does his team cover? (${qbRows.length} team-games since 2009)`);
console.log(`   ${"starter listed".padEnd(16)}${ERAS.slice(1).map(eraLabel).join("  ").padStart(50)}   all       margin vs line`);
for (const st of ["Out", "Doubtful", "Questionable", "Active"]) {
  const rs = qbRows.filter((r) => r.status === st);
  if (rs.length < 30) continue;
  const cells = ERAS.slice(1).map((e) => { const r = rs.filter((x) => x.era === e); return r.length >= 30 ? `${pct(r.filter((x) => x.covered).length / r.length).padStart(6)} (${String(r.length).padStart(4)})` : "     —       "; });
  const won = rs.filter((x) => x.covered).length, se = Math.sqrt(0.25 / rs.length);
  console.log(`   ${st.padEnd(16)}${cells.join("  ")}   ${pct(won / rs.length)} z ${((won / rs.length - BE) / se).toFixed(2).padStart(5)}   ${mean(rs.map((x) => x.resid)).toFixed(2)} ± ${(sd(rs.map((x) => x.resid)) / Math.sqrt(rs.length)).toFixed(2)}`);
}
const outRows = qbRows.filter((r) => r.status === "Out" || r.status === "Doubtful");
if (outRows.length >= 30) {
  const n = outRows.length, se = Math.sqrt(0.25 / n);
  const oppCover = 1 - outRows.filter((x) => x.covered).length / n;
  console.log(`   the OPPONENT of a team without its starter covers ${pct(oppCover)} (n=${n}, z ${((oppCover - BE) / se).toFixed(2)})`);
  const t = outRows.filter((x) => x.under != null);
  const u = t.filter((x) => x.under).length, tse = Math.sqrt(0.25 / t.length);
  console.log(`   those games went UNDER the total ${pct(u / t.length)} (n=${t.length}, z ${((u / t.length - BE) / tse).toFixed(2)}); points − total ${mean(t.map((x) => x.tresid)).toFixed(2)} ± ${(sd(t.map((x) => x.tresid)) / Math.sqrt(t.length)).toFixed(2)}`);
}
console.log();
