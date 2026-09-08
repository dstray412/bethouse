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
 *   4. THE TOUCHDOWN MODEL, BY ERA. nflverse's weekly player stats carry
 *      carries, targets and touchdowns per player per game since 2000, so
 *      the anytime-touchdown model's constants (touchdowns per carry and
 *      per target, the league rate) can be measured on twenty-five seasons
 *      of regulars and the model walked forward and graded by era with
 *      the constants it ships. Two seasons fitted them; here is whether
 *      they have drifted.
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
import { loadGames, loadInjuries, loadStarters, loadWeeklyStats } from "./nflverse.mjs";
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

/* ------------------------------------------------------------------ *
 * 4. The touchdown model, by era
 * ------------------------------------------------------------------ */
{
  const seasonsW = []; for (let s = 2000; s <= 2025; s++) seasonsW.push(s);
  const weekly = await loadWeeklyStats(seasonsW);
  console.log(`4. THE TOUCHDOWN MODEL — ${weekly.length} skill player-games, ${seasonsW[0]}–${seasonsW.at(-1)}`);
  /* Regulars: players with three or more games that season, the board's population. */
  const gamesBy = new Map();
  for (const r of weekly) { const k = `${r.season}|${r.id}`; gamesBy.set(k, (gamesBy.get(k) || 0) + 1); }
  const regular = (r) => (gamesBy.get(`${r.season}|${r.id}`) || 0) >= 3;
  console.log(`   ${"era".padEnd(11)}${"player-games".padStart(13)}${"TD/carry".padStart(10)}${"TD/target".padStart(11)}${"league λ".padStart(10)}   (shipped: ${nfl.DEFAULTS.tdPerCarry}, ${nfl.DEFAULTS.tdPerTarget}, ${nfl.DEFAULTS.leagueLambda})`);
  for (const e of [...ERAS, null]) {
    const rs = weekly.filter((r) => regular(r) && (r.carries || r.targets) && (!e || eraOf(r.season) === e));
    let Scc = 0, Scr = 0, Srr = 0, Sct = 0, Srt = 0, td = 0;
    for (const r of rs) { const c = r.carries, t = r.targets; Scc += c * c; Scr += c * t; Srr += t * t; Sct += c * r.tds; Srt += t * r.tds; td += r.tds; }
    const det = Scc * Srr - Scr * Scr;
    console.log(`   ${(e ? eraLabel(e) : "all").padEnd(11)}${String(rs.length).padStart(13)}${((Sct * Srr - Srt * Scr) / det).toFixed(4).padStart(10)}${((Srt * Scc - Sct * Scr) / det).toFixed(4).padStart(11)}${(td / rs.length).toFixed(3).padStart(10)}`);
  }
  /* Walk forward with the shipped constants: season lines from this season
     plus last, team factors the same way, and grade by era. */
  const byWeek = new Map();
  for (const r of weekly) { const k = `${r.season}|${r.week}`; if (!byWeek.has(k)) byWeek.set(k, []); byWeek.get(k).push(r); }
  const keys = [...byWeek.keys()].sort((a, b) => { const [sa, wa] = a.split("|").map(Number), [sb, wb] = b.split("|").map(Number); return sa - sb || wa - wb; });
  const tdRows = [];
  for (let i = 0; i < keys.length; i++) {
    const [season, week] = keys[i].split("|").map(Number);
    const prior = keys.slice(0, i).map((k) => k.split("|").map(Number)).filter(([s]) => s >= season - 1).flatMap(([s, w]) => byWeek.get(`${s}|${w}`));
    if (prior.length < 400) continue;
    const players = new Map(), usage = new Map(), teamTD = new Map(), teamTDA = new Map(), teamG = new Map();
    const seenTeamGame = new Set();
    for (const r of prior) {
      const p = players.get(r.id) || { games: 0, tds: 0, carries: 0, targets: 0 };
      p.games++; p.tds += r.tds; p.carries += r.carries; p.targets += r.targets; players.set(r.id, p);
      const u = nfl.usageTDs(r.carries, r.targets); if (u > 0) { if (!usage.has(r.id)) usage.set(r.id, []); usage.get(r.id).push(u); }
      teamTD.set(r.team, (teamTD.get(r.team) || 0) + r.tds); teamTDA.set(r.opp, (teamTDA.get(r.opp) || 0) + r.tds);
      const tg = `${r.season}|${r.week}|${r.team}`; if (!seenTeamGame.has(tg)) { seenTeamGame.add(tg); teamG.set(r.team, (teamG.get(r.team) || 0) + 1); }
    }
    const lgTD = [...teamTD.values()].reduce((a, b) => a + b, 0) / Math.max(1, [...teamG.values()].reduce((a, b) => a + b, 0));
    const factor = (m, t) => { const n = teamG.get(t) || 0; return n && lgTD ? ((m.get(t) || 0) + lgTD * 6) / ((n + 6) * lgTD) : 1; };
    const pool = nfl.usagePoolFrom([...usage.values()], 6);
    for (const r of byWeek.get(keys[i])) {
      const rec = players.get(r.id); if (!rec || rec.games < 3) continue;
      const s = nfl.scoreAnytimeTD(rec, { teamFactor: factor(teamTD, r.team), oppFactor: factor(teamTDA, r.opp), usagePool: pool });
      if (s) tdRows.push({ era: eraOf(season), prob: s.prob, actual: r.tds > 0 ? 1 : 0 });
    }
  }
  console.log(`\n   walked forward with the shipped constants (${tdRows.length} predictions):`);
  console.log(`   ${"era".padEnd(11)}${"n".padStart(8)}${"predicted".padStart(11)}${"actual".padStart(9)}${"bias".padStart(9)}${"Brier".padStart(9)}${"top decile: pred/actual".padStart(26)}`);
  for (const e of [...ERAS, null]) {
    const rs = tdRows.filter((r) => !e || r.era === e); if (rs.length < 500) continue;
    const pred = mean(rs.map((r) => r.prob)), act = mean(rs.map((r) => r.actual));
    const top = rs.slice().sort((a, b) => b.prob - a.prob).slice(0, Math.round(rs.length / 10));
    console.log(`   ${(e ? eraLabel(e) : "all").padEnd(11)}${String(rs.length).padStart(8)}${pct(pred).padStart(11)}${pct(act).padStart(9)}${((100 * (pred - act) >= 0 ? "+" : "") + (100 * (pred - act)).toFixed(1) + "pp").padStart(9)}${mean(rs.map((r) => (r.prob - r.actual) ** 2)).toFixed(4).padStart(9)}${(pct(mean(top.map((r) => r.prob))) + " / " + pct(mean(top.map((r) => r.actual)))).padStart(26)}`);
  }
  console.log();
}
