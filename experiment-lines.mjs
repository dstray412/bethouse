#!/usr/bin/env node
/*
 * BetHouse — experiment-lines.mjs
 * Does any reconfiguration of the game model carry information about the
 * spread or the total that the closing line does not already carry?
 *
 *   node experiment-lines.mjs                 # NFL
 *   node experiment-lines.mjs --league cfb
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-09-06 the football boards started picking a side against a live
 * line, and the replay said the model's spread picks win about half the
 * time: the calibration slope of its cover probability is ~0 in both
 * leagues. "If the model is losing, reconfigure it." This is the
 * reconfiguration, done as an experiment rather than as a change, because
 * the constraint is not a constant but the information available: box
 * scores. Every scheme below is something a box score can support.
 *
 * THE QUESTION, STATED SO IT CANNOT BE GAMED
 * ------------------------------------------
 * For each scheme, walk forward a week at a time (ratings from earlier
 * weeks only) and regress (actual margin + spread) on (projected margin +
 * spread). The slope is the fraction of the model's disagreement with the
 * line that comes true. 1 means the model is right about its edge; 0 means
 * the line already knew everything the model knows; negative means the
 * model should be faded. Reported per season, because a scheme has to
 * help on both to be believed (tasks/lessons.md, "fit on one window").
 *
 * WHAT IT FOUND (2026-09-06, README "Reconfiguring the model")
 * ------------------------------------------------------------
 * Nothing. Seven rating schemes on points, two on efficiency (yards per
 * play and turnovers, fitted on 2024 and tested on 2025), and a scan of
 * the closing line for exploitable biases: no slope clears 0.1 on both
 * seasons of either league, and no bias clears two standard errors after
 * twenty buckets were looked at. The NFL close is efficient with respect
 * to everything a box score contains; the college close nearly so.
 *
 * Like calibrate.mjs and lineup-context.mjs, this is an analysis tool that
 * exists to keep a negative result reproducible. It makes no requests.
 */
import { readFileSync, existsSync } from "node:fs";
import { leagueFromArgs } from "./football-leagues.mjs";
import * as prov from "./provenance.mjs";

console.log(prov.banner(prov.repoState()) + "\n");

const args = process.argv.slice(2);
const league = leagueFromArgs(args);
const M = league.model;
if (!existsSync(league.historyFile)) {
  console.error(`no ${league.historyFile} — run: node ${league.fetcher} --history`);
  process.exit(1);
}
const H = JSON.parse(readFileSync(league.historyFile, "utf8"));
const ALL = H.games.slice().sort((a, b) => a.season - b.season || a.week - b.week || String(a.date).localeCompare(String(b.date)));
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const pct = (x) => (100 * x).toFixed(1) + "%";
const HFA = M.DEFAULTS.homeField, K = M.DEFAULTS.teamK;
const R = (o, t) => (o[t] != null ? o[t] : 0);
const BREAK_EVEN = 0.5238;

/* ------------------------------------------------------------------ *
 * A two-way ridge on any per-side quantity, with the knobs the schemes
 * need: per-game weights, a cap on margins, a prior rating per team, and
 * a home-advantage term that is either fixed or solved.
 * ------------------------------------------------------------------ */
function solve(games, q, { weight = () => 1, cap = Infinity, prior = null, priorK = 0, hfa = HFA } = {}) {
  const obs = [];
  for (const g of games) {
    let hv = q(g.home, g), av = q(g.away, g);
    const m = hv - av;
    if (Math.abs(m) > cap) { const ex = Math.abs(m) - cap; if (m > 0) hv -= ex; else av -= ex; }
    const w = weight(g);
    obs.push({ off: g.home.team, def: g.away.team, v: hv, home: g.neutral ? 0 : 1, w });
    obs.push({ off: g.away.team, def: g.home.team, v: av, home: 0, w });
  }
  const league = obs.reduce((s, x) => s + x.w * x.v, 0) / obs.reduce((s, x) => s + x.w, 0);
  const off = new Map(), def = new Map();
  for (const x of obs) { off.set(x.off, 0); def.set(x.def, 0); }
  const pO = (t) => (prior ? R(prior.off, t) : 0), pD = (t) => (prior ? R(prior.def, t) : 0);
  let h = hfa == null ? 0 : hfa;
  for (let it = 0; it < 50; it++) {
    const oS = new Map(), oN = new Map();
    for (const x of obs) { const r = x.v - league - def.get(x.def) - (x.home ? h : 0); oS.set(x.off, (oS.get(x.off) || 0) + x.w * r); oN.set(x.off, (oN.get(x.off) || 0) + x.w); }
    for (const t of off.keys()) off.set(t, ((oS.get(t) || 0) + priorK * pO(t)) / ((oN.get(t) || 0) + K + priorK));
    const dS = new Map(), dN = new Map();
    for (const x of obs) { const r = x.v - league - off.get(x.off) - (x.home ? h : 0); dS.set(x.def, (dS.get(x.def) || 0) + x.w * r); dN.set(x.def, (dN.get(x.def) || 0) + x.w); }
    for (const t of def.keys()) def.set(t, ((dS.get(t) || 0) + priorK * pD(t)) / ((dN.get(t) || 0) + K + priorK));
    if (hfa == null) h = mean(obs.filter((x) => x.home).map((x) => x.v - league - off.get(x.off) - def.get(x.def)));
  }
  return { off: Object.fromEntries(off), def: Object.fromEntries(def), league, hfa: h };
}
const margin = (rt, g) => R(rt.off, g.home.team) + R(rt.def, g.away.team) + (g.neutral ? 0 : rt.hfa) - R(rt.off, g.away.team) - R(rt.def, g.home.team);
const total = (rt, g) => 2 * rt.league + R(rt.off, g.home.team) + R(rt.def, g.away.team) + R(rt.off, g.away.team) + R(rt.def, g.home.team) + (g.neutral ? 0 : rt.hfa);

/* Team strength as the market sees it: the closing spreads of prior games,
   solved for a rating per team and a home advantage. */
function marketSolve(games) {
  const r = new Map();
  const lined = games.filter((g) => g.spread != null);
  for (const g of lined) { r.set(g.home.team, 0); r.set(g.away.team, 0); }
  let hfa = 0;
  for (let it = 0; it < 60; it++) {
    const S = new Map(), N = new Map();
    let hs = 0, hn = 0;
    for (const g of lined) {
      const mm = -g.spread - (g.neutral ? 0 : hfa);
      const h = g.home.team, a = g.away.team;
      S.set(h, (S.get(h) || 0) + (mm + r.get(a))); N.set(h, (N.get(h) || 0) + 1);
      S.set(a, (S.get(a) || 0) + (r.get(h) - mm)); N.set(a, (N.get(a) || 0) + 1);
      if (!g.neutral) { hs += -g.spread - (r.get(h) - r.get(a)); hn++; }
    }
    for (const t of r.keys()) r.set(t, (S.get(t) || 0) / ((N.get(t) || 0) + 2));
    hfa = hn ? hs / hn : 0;
  }
  return (g) => (r.get(g.home.team) ?? 0) - (r.get(g.away.team) ?? 0) + (g.neutral ? 0 : hfa);
}

const pts = (s) => s.score;
const ypp = (s) => s.stats.yards / s.stats.plays;
const tov = (s) => s.stats.turnovers;
const hasStats = (g) => g.home.stats && g.away.stats && g.home.stats.plays > 20 && g.away.stats.plays > 20;

/* ------------------------------------------------------------------ *
 * Walk forward by week
 * ------------------------------------------------------------------ */
const weeks = [];
for (const g of ALL) { const k = `${g.season}|${g.week}`; if (!weeks.length || weeks[weeks.length - 1].k !== k) weeks.push({ k, season: g.season, games: [] }); weeks[weeks.length - 1].games.push(g); }
const rows = [];
const lastSeason = {};
for (let i = 1; i < weeks.length; i++) {
  const w = weeks[i];
  const prior = weeks.slice(0, i).flatMap((x) => x.games);
  if (prior.length < 60) continue;
  const inSeason = prior.filter((g) => g.season === w.season);
  const ls = prior.filter((g) => g.season === w.season - 1);
  if (ls.length && !lastSeason[w.season - 1]) lastSeason[w.season - 1] = solve(ls, pts);
  const ps = lastSeason[w.season - 1];
  const age = (g) => (Date.parse(w.games[0].date) - Date.parse(g.date)) / 86400000;
  const withStats = prior.filter(hasStats);
  const schemes = {
    points: solve(prior, pts),
    capped: solve(prior, pts, { cap: league.id === "cfb" ? 28 : 21 }),
    recent90: solve(prior, pts, { weight: (g) => Math.exp(-age(g) / 90) }),
    recent180: solve(prior, pts, { weight: (g) => Math.exp(-age(g) / 180) }),
    seasonPrior: ps && inSeason.length ? solve(inSeason, pts, { prior: { off: Object.fromEntries(Object.entries(ps.off).map(([t, v]) => [t, v / 2])), def: Object.fromEntries(Object.entries(ps.def).map(([t, v]) => [t, v / 2])) }, priorK: 6 }) : null,
  };
  const eff = withStats.length >= 60 ? { y: solve(withStats, ypp, { hfa: null }), t: solve(withStats, tov, { hfa: 0 }) } : null;
  const market = marketSolve(prior);
  for (const g of w.games) {
    if (g.spread == null) continue;
    const row = { season: w.season, spread: g.spread, total: g.total, actual: g.home.score - g.away.score, points: g.home.score + g.away.score, m: {}, t: {} };
    for (const [name, rt] of Object.entries(schemes)) if (rt) { row.m[name] = margin(rt, g); row.t[name] = total(rt, g); }
    row.m.marketRatings = market(g);
    row.m.blendHalf = 0.5 * row.m.points + 0.5 * row.m.marketRatings;
    if (eff) { row.yppM = margin(eff.y, g); row.tovM = margin(eff.t, g); }
    rows.push(row);
  }
}

/* Efficiency: points per unit fitted on the FIRST season only, applied to the rest. */
const fitRows = rows.filter((r) => r.season === Math.min(...rows.map((x) => x.season)) && r.yppM != null);
function ols(rs, cols) {
  const n = cols.length, A = Array.from({ length: n }, () => Array(n).fill(0)), b = Array(n).fill(0);
  for (const r of rs) { const x = cols.map((c) => r[c]); for (let i = 0; i < n; i++) { b[i] += x[i] * r.actual; for (let j = 0; j < n; j++) A[i][j] += x[i] * x[j]; } }
  for (let i = 0; i < n; i++) { const p = A[i][i]; for (let j = i; j < n; j++) A[i][j] /= p; b[i] /= p;
    for (let k = 0; k < n; k++) if (k !== i) { const f = A[k][i]; for (let j = i; j < n; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; } }
  return b;
}
if (fitRows.length >= 100) {
  for (const r of rows) r.ptsM = r.m.points;
  const cE = ols(fitRows.map((r) => ({ ...r, ptsM: r.m.points })), ["yppM", "tovM"]);
  const cB = ols(fitRows.map((r) => ({ ...r, ptsM: r.m.points })), ["ptsM", "yppM", "tovM"]);
  console.log(`\nefficiency coefficients fitted on ${fitRows[0].season} (${fitRows.length} games): ` +
    `margin = ${cE[0].toFixed(2)}*ypp + ${cE[1].toFixed(2)}*tov;  with points: ${cB[0].toFixed(2)}*pts + ${cB[1].toFixed(2)}*ypp + ${cB[2].toFixed(2)}*tov`);
  for (const r of rows) if (r.yppM != null) {
    r.m.efficiency = cE[0] * r.yppM + cE[1] * r.tovM;
    r.m.pointsPlusEff = cB[0] * r.m.points + cB[1] * r.yppM + cB[2] * r.tovM;
  }
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */
const seasons = [...new Set(rows.map((r) => r.season))].sort();
function line(name, sf, r, proj, line_, outcome) {
  const rr = r.filter((x) => proj(x) != null && line_(x) != null);
  if (rr.length < 30) return;
  let sxy = 0, sxx = 0;
  for (const x of rr) { const e = proj(x) - line_(x); sxy += e * (outcome(x) - line_(x)); sxx += e * e; }
  const slope = sxx ? sxy / sxx : 0;
  const bets = rr.filter((x) => Math.abs(proj(x) - line_(x)) >= 3 && outcome(x) !== line_(x));
  const won = bets.filter((x) => (proj(x) > line_(x) ? outcome(x) > line_(x) : outcome(x) < line_(x))).length;
  const n = bets.length, se = n ? Math.sqrt(0.25 / n) : 1;
  console.log(`  ${name.padEnd(14)}${String(sf).padEnd(6)}n=${String(rr.length).padStart(5)}  err sd ${sd(rr.map((x) => outcome(x) - proj(x))).toFixed(2)}  slope ${slope.toFixed(3).padStart(7)}  bets>=3pts ${String(n).padStart(4)} won ${pct(n ? won / n : 0).padStart(6)}  z vs 52.4% ${(n ? (won / n - BREAK_EVEN) / se : 0).toFixed(2).padStart(5)}`);
}
console.log(`\n${league.label}: ${ALL.length} games, ${rows.length} with a closing spread, graded a week at a time`);
console.log(`the closing spread's own error: sd ${sd(rows.map((r) => r.actual + r.spread)).toFixed(2)}`);
console.log(`\nSPREAD — slope of (actual + spread) on (projected + spread). 1 = the model's edge is real, 0 = the line knew`);
for (const name of Object.keys(rows[rows.length - 1].m)) {
  line(name, "all", rows, (x) => x.m[name], (x) => -x.spread, (x) => x.actual);
  for (const s of seasons) line(name, s, rows.filter((x) => x.season === s), (x) => x.m[name], (x) => -x.spread, (x) => x.actual);
}
console.log(`\nTOTAL — the same, on points against the closing total`);
for (const name of Object.keys(rows[0].t)) {
  line(name, "all", rows, (x) => x.t[name], (x) => x.total, (x) => x.points);
  for (const s of seasons) line(name, s, rows.filter((x) => x.season === s), (x) => x.t[name], (x) => x.total, (x) => x.points);
}

/* The line itself: is there a side that simply wins? */
console.log(`\nTHE CLOSING LINE ITSELF — cover rates, z against the 52.4% a -110 price needs`);
const lined = ALL.filter((g) => g.spread != null && g.home.score - g.away.score + g.spread !== 0);
const homeCover = (g) => g.home.score - g.away.score + g.spread > 0;
const dogCover = (g) => (g.spread < 0 ? !homeCover(g) : homeCover(g));
const scan = (label, r, pick) => {
  if (r.length < 30) return;
  const won = r.filter(pick).length, n = r.length, se = Math.sqrt(0.25 / n);
  console.log(`  ${label.padEnd(30)} n=${String(n).padStart(5)}  ${pct(won / n).padStart(6)}  z ${((won / n - BREAK_EVEN) / se).toFixed(2).padStart(5)}`);
};
scan("home covers", lined, homeCover);
scan("underdog covers", lined, dogCover);
for (const [lo, hi] of [[0, 3], [3, 7], [7, 14], [14, 21], [21, 28], [28, 99]]) scan(`underdog covers, ${lo}-${hi}`, lined.filter((g) => Math.abs(g.spread) >= lo && Math.abs(g.spread) < hi), dogCover);
const tot = ALL.filter((g) => g.total != null && g.home.score + g.away.score !== g.total);
const over = (g) => g.home.score + g.away.score > g.total;
scan("over", tot, over);
for (const [lo, hi] of [[0, 40], [40, 48], [48, 56], [56, 99]]) scan(`over, total ${lo}-${hi}`, tot.filter((g) => g.total >= lo && g.total < hi), over);
for (const s of seasons) { scan(`home covers, ${s}`, lined.filter((g) => g.season === s), homeCover); scan(`over, ${s}`, tot.filter((g) => g.season === s), over); scan(`under when total >= 56, ${s}`, tot.filter((g) => g.season === s && g.total >= 56), (g) => !over(g)); }
console.log(`\nTwenty-odd buckets were looked at. One of them at two standard errors is what chance looks like.\n`);
