#!/usr/bin/env node
/*
 * BetHouse — experiment-tendencies.mjs
 * Does anything in the play-by-play tell the counting props something the
 * yards-allowed factor does not already know?
 *
 *   node experiment-tendencies.mjs
 *   node experiment-tendencies.mjs --no-ladder                # ~2 min instead of ~6
 *   node experiment-tendencies.mjs --strengths 0.125,0.25,0.5,0.75,1
 *
 * WHY
 * ---
 * The model already carries one opponent term: `allow`, a defence's yards
 * allowed for a stat against the league's, regressed by six games
 * (fetch-football.mjs), shipped at half strength for rushing and passing
 * yards and at zero for receiving. tendencies.mjs knows things a box score
 * cannot: what share of plays a defence faces as runs, what it gives up per
 * deep throw, how fast an offence goes. This asks whether any of that moves
 * the props OUT OF SAMPLE, on the same walk-forward the backtest runs.
 *
 * HOW A CANDIDATE IS GRADED — the one choice worth arguing with
 * ------------------------------------------------------------
 * THE LINE COMES FROM THE BASELINE PROJECTION, always, for every variant.
 *
 * backtest-nfl.mjs prices each player at `round(exp * mult) + 0.5` for five
 * mults, where `exp` is its own projection. If a candidate moved the
 * projection AND the line with it, every variant would be graded on a
 * different question — worse, a variant that moved the line toward the
 * player's true mean would score WORSE (a line at the mean is a coin flip)
 * while looking like it had helped. So the lines are fixed by the baseline
 * and each variant answers P(over that same line) with its own projection
 * and its own pool. The baseline row is therefore the backtest, exactly,
 * which is what the first table checks.
 *
 * Strength 0 is not run: `1 + 0*(f-1) = 1` IS the baseline.
 *
 * WHAT CLEARS THE BAR
 * -------------------
 * Better Brier in BOTH full seasons at the same strength, AND by more than
 * twice the paired standard error. The first half is the rule the opponent
 * factor had to pass (README, "The opponent's defence"); the second is
 * because with no effect at all a quarter of candidates win both seasons by
 * luck. 2026 is 31 games and is printed for interest, not as evidence.
 *
 * And read the strength column before believing anything: a candidate whose
 * best strength is the SMALLEST one swept has its optimum outside the
 * sweep, and outside the low end of a strength dial is zero — the shipped
 * model. tasks/lessons.md, "edge-of-range means the range is wrong".
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { leagueFromArgs } from "./football-leagues.mjs";
import { seasonLines } from "./fetch-football.mjs";
import { loadPlayByPlay, loadFtnCharting } from "./nflverse.mjs";
import { profilesThrough } from "./tendencies.mjs";

const args = process.argv.slice(2);
const flag = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const LADDER = !args.includes("--no-ladder");

/*
 * The model this replay measures is a file somebody else may be editing.
 * On 2026-09-21 three runs of this script disagreed about rush + rec yards
 * by four points of bias; the cause was not in the script, it was nfl.js
 * being rewritten twice while it ran. A baseline that silently stops
 * matching the backtest looks like a finding. So the model's bytes are
 * hashed at both ends of the run and the hash is printed, and a reader can
 * tell whether this table and a given backtest run mean the same model.
 */
const MODEL_FILES = ["nfl.js", "cfb.js", "fetch-football.mjs", "football-leagues.mjs"];
const modelHash = () => {
  const h = createHash("sha256");
  for (const f of MODEL_FILES) h.update(readFileSync(f));
  return h.digest("hex").slice(0, 12);
};
const MODEL_AT_START = modelHash();

const league = leagueFromArgs(args);
const M = league.model;
const { STATS, statOpportunity, statEligible, projectedStat, gameLine, gameValue, opponentIn, allowOf, ladder } = M;
const STAT_IDS = Object.keys(STATS);
const POOL_KEEP = M.DEFAULTS.poolKeep;
const MULTS = [0.6, 0.8, 1.0, 1.25, 1.6];

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const pp = (x) => ((100 * x >= 0 ? "+" : "") + (100 * x).toFixed(2)) + "pp";
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

if (!existsSync(league.historyFile)) {
  console.error(`no ${league.historyFile} — run: node ${league.fetcher} --history`);
  process.exit(1);
}
const history = JSON.parse(readFileSync(league.historyFile, "utf8"));
const ALL = (history.games || []).slice()
  .sort((a, b) => a.season - b.season || a.week - b.week || String(a.date).localeCompare(String(b.date)));
const START_INDEX = league.warmupGames;
console.log(`${league.label}: ${ALL.length} games ${JSON.stringify(history.seasons)}, ` +
  `predicting from game ${START_INDEX}, model ${MODEL_AT_START}`);

/* ---------------------------------------------------------------- *
 * The tendencies, walk-forward, one table per (season, week)
 * ---------------------------------------------------------------- */

const [sFrom, sTo] = String(flag("--seasons", "2024-2026")).split("-").map(Number);
const seasons = []; for (let s = sFrom; s <= sTo; s++) seasons.push(s);
const t0 = Date.now();
const plays = await loadPlayByPlay(seasons);
const ftn = await loadFtnCharting(seasons);
const TEND = new Map();
for (const g of ALL) {
  const k = `${g.season}|${g.week}`;
  if (!TEND.has(k)) TEND.set(k, profilesThrough(plays, g.season, g.week, { ftn }));
}
console.log(`tendencies: ${plays.length} plays, ${TEND.size} (season, week) profiles built in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

/* ---------------------------------------------------------------- *
 * The candidates
 *
 * Each is a multiplier on the projection, 1 = league average, applied as
 * `clamp(1 + s*(f-1), 0.6, 1.6)` — the same shape and the same clamp as
 * nfl.js statOppFactor, so a candidate that ships would be one more term
 * of the thing already there rather than a new mechanism.
 *
 * Anything missing (a team with no profile, a rate under the null floor,
 * a game with no closing line) gives f = 1: no information, no adjustment.
 * That is deliberately the same failure the opponent factor has.
 *
 * `ratio` is for quantities around a positive league mean — yards per
 * carry, plays per game, a share. EPA per play is signed and sits near
 * zero, so a ratio explodes; for those the factor is `1 + (team − league)`,
 * reading a tenth of a point of EPA as ten percent of projection. That is a
 * CONVENTION, not a measurement, picked so the EPA factors span the same
 * range as the yards-per-attempt ratios (Denver, 2026: ypa 5.12/6.0 = 0.85,
 * EPA per dropback −0.075 against +0.02 = 0.90) and a strength means the
 * same thing across candidates. A different scale would want its own grid.
 * ---------------------------------------------------------------- */

const PASS = ["recyds", "passyds", "recs", "rushrec"];
const RUSH = ["rushyds", "rushrec"];
const REC = ["recyds", "recs", "rushrec"];
const EVERY = STAT_IDS;

const ratio = (a, b) => (a != null && b != null && a > 0 && b > 0 ? a / b : null);
const shift = (a, b) => (a != null && b != null ? 1 + (a - b) : null);

const CANDIDATES = [
  { id: "defYpc", stats: RUSH, label: "opp D: yards per carry allowed / league",
    f: (c) => ratio(c.def.ypc, c.lg.ypc) },
  { id: "defYpa", stats: PASS, label: "opp D: yards per dropback allowed / league",
    f: (c) => ratio(c.def.ypa, c.lg.ypa) },
  { id: "defSuccPass", stats: PASS, label: "opp D: success rate allowed on dropbacks / league",
    f: (c) => ratio(c.def.successPass, c.lg.successPass) },
  { id: "defEpaPass", stats: PASS, label: "opp D: EPA per dropback allowed, 1 + (team − league)",
    f: (c) => shift(c.def.epaPerPass, c.lg.epaPerPass) },
  { id: "defEpaRush", stats: RUSH, label: "opp D: EPA per rush allowed, 1 + (team − league)",
    f: (c) => shift(c.def.epaPerRush, c.lg.epaPerRush) },
  { id: "defRunRate", stats: RUSH, label: "opp D: share of plays faced that are runs / league",
    f: (c) => ratio(c.def.rushRate, c.lg.rushRate) },
  { id: "defPassRate", stats: PASS, label: "opp D: share of plays faced that are dropbacks / league",
    f: (c) => ratio(c.def.passRate, c.lg.passRate) },
  { id: "defPace", stats: EVERY, label: "opp D: plays per game faced / league per team",
    f: (c) => ratio(c.def.playsPerGame, c.lgPPG) },
  { id: "offPace", stats: EVERY, label: "own offence: plays per game / league per team",
    f: (c) => ratio(c.off.playsPerGame, c.lgPPG) },
  { id: "total", stats: EVERY, label: "closing total / running mean total",
    f: (c) => ratio(c.g.total, c.meanTotal) },
  { id: "defExplPass", stats: REC, label: "opp D: explosive pass rate allowed / league",
    f: (c) => ratio(c.def.explosivePassRate, c.lg.explosivePassRate) },
  /* The two that cleared on the receiving props, multiplied. A pair that
     each help alone can be measuring the same thing twice; the only way to
     know is to run them together and see whether the gains add. */
  { id: "succ*total", stats: PASS, label: "defSuccPass x total, the two winners multiplied",
    f: (c) => { const a = ratio(c.def.successPass, c.lg.successPass), b = ratio(c.g.total, c.meanTotal);
      return a == null || b == null ? null : a * b; } },
  { id: "succ*pace", stats: PASS, label: "defSuccPass x defPace, the two winners multiplied",
    f: (c) => { const a = ratio(c.def.successPass, c.lg.successPass), b = ratio(c.def.playsPerGame, c.lgPPG);
      return a == null || b == null ? null : a * b; } },
];

/* The closing spread, as a slope. `t` is the team's own spread, negative
   when it is favoured, so a negative beta means favourites get MORE (they
   run when ahead) and a positive beta means dogs get more (they throw when
   behind). Run at strength 1 only: `1 + s*beta*t` is just a smaller beta,
   so the grid already covers every strength. */
const BETAS = [-0.010, -0.005, 0.005, 0.010];
for (const b of BETAS) {
  CANDIDATES.push({
    id: `spread${b > 0 ? "+" : ""}${b}`, stats: EVERY, strengths: [1], beta: b,
    label: `closing spread: 1 + ${b} x (team spread, − = favoured)`,
    f: (c) => (c.teamSpread == null ? null : 1 + b * c.teamSpread),
  });
}

/* One variant per (candidate, strength) per stat, plus the baseline. */
/* --strengths 0.25,0.5,0.75,1 sweeps the dial instead of testing two points.
   tasks/lessons.md: an optimum at the end of a sweep means the optimum is
   outside it — and for a strength dial, outside the low end is zero, i.e.
   the candidate does nothing. */
const STRENGTHS = String(flag("--strengths", "0.5,1")).split(",").map(Number).filter((x) => x > 0);
const VARIANTS = [{ id: "baseline", stats: EVERY, s: 0, f: () => null, label: "the shipped model" }];
for (const c of CANDIDATES) for (const s of c.strengths || STRENGTHS) {
  VARIANTS.push({ id: `${c.id}@${s}`, cand: c.id, stats: c.stats, s, f: c.f, label: c.label });
}
const variantsFor = (stat) => VARIANTS.filter((v) => v.stats.includes(stat));
console.log(`${CANDIDATES.length} candidates, ${VARIANTS.length - 1} variants + baseline, ` +
  `${STAT_IDS.reduce((a, s) => a + variantsFor(s).length, 0)} variant-stat pairs`);

/* ---------------------------------------------------------------- *
 * How hard does each candidate actually pull?
 *
 * "No effect" is only a finding if the factors moved. A candidate stuck at
 * 1.00 because the join failed or the rate is under its null floor prints
 * the same table of zeroes as one that swung 20% and said nothing. So every
 * raw factor's spread is printed BEFORE the replay, over every (game, team)
 * it will see: the 5th-95th band is how much projection the candidate moves
 * at full strength.
 * ---------------------------------------------------------------- */

function factorSpread() {
  const seen = Object.fromEntries(CANDIDATES.map((c) => [c.id, []]));
  let sum = 0, n = 0;
  for (let i = START_INDEX; i < ALL.length; i++) {
    const g = ALL[i];
    const T = TEND.get(`${g.season}|${g.week}`);
    const lg = (T && T.league) || {};
    const lgPPG = lg.playsPerGame != null ? lg.playsPerGame / 2 : null;
    const meanTotal = n ? sum / n : null;
    for (const [team, opp] of [[g.home.team, g.away.team], [g.away.team, g.home.team]]) {
      const c = {
        g, off: (T && T.off[team]) || {}, def: (T && T.def[opp]) || {}, lg, lgPPG, meanTotal,
        teamSpread: g.spread == null ? null : (team === g.home.team ? g.spread : -g.spread),
      };
      for (const cand of CANDIDATES) {
        const f = cand.f(c);
        if (f != null && isFinite(f)) seen[cand.id].push(f);
      }
    }
    if (g.total != null) { sum += g.total; n++; }
  }
  console.log(`\nHOW HARD EACH CANDIDATE PULLS — the raw factor over every team-game the replay grades`);
  console.log(`  ${"candidate".padEnd(16)}${"n".padStart(7)}${"5th".padStart(9)}${"median".padStart(9)}${"95th".padStart(9)}${"sd".padStart(9)}`);
  for (const cand of CANDIDATES) {
    const v = seen[cand.id].sort((a, b) => a - b);
    if (!v.length) { console.log(`  ${cand.id.padEnd(16)}${"0".padStart(7)}   never fired — the join or the null floor is eating it`); continue; }
    const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
    const m = mean(v), sd = Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
    console.log(`  ${cand.id.padEnd(16)}${String(v.length).padStart(7)}${q(0.05).toFixed(3).padStart(9)}${q(0.5).toFixed(3).padStart(9)}${q(0.95).toFixed(3).padStart(9)}${sd.toFixed(3).padStart(9)}`);
  }
}
factorSpread();

/* ---------------------------------------------------------------- *
 * Rolling state, rebuilt from prior games only (backtest-nfl.mjs stateFrom)
 * ---------------------------------------------------------------- */

function stateFrom(priorGames) {
  /* Byte for byte the backtest's own stateFrom, including the two results
     nothing here reads. A trimmed copy was the first thing suspected when
     the baseline stopped matching; keeping it whole costs a second a game
     and removes the question. */
  const { players, usageByPlayer, teamFactors } = seasonLines(priorGames, M);
  return {
    players,
    ratings: M.buildTeamRatings(priorGames),
    teamFactor: (t) => (teamFactors[t] || {}).off ?? 1,
    oppFactor: (t) => (teamFactors[t] || {}).def ?? 1,
    allow: (t, stat) => allowOf(teamFactors, t, stat),
    usagePool: M.usagePoolFrom([...usageByPlayer.values()], 6),
  };
}

/*
 * backtest-nfl.mjs's own `levelled`, INCLUDING the stat. A levelled pool
 * carries which stat it is, because `poolReads` gives each stat its own
 * share of the pool nearest the projection: half for receiving, rushing and
 * rush+rec, all of it for passing and receptions. A pool built without the
 * stat falls back to the global `poolShare` of 0, the whole pool — which is
 * why an earlier version of this script reproduced the backtest EXACTLY on
 * passing yards and receptions (share 0 either way) and missed it on the
 * other three. One dropped argument changed the model under the replay and
 * nothing failed.
 */
const levelled = (stat, entries) => {
  const recent = entries.length > POOL_KEEP ? entries.slice(-POOL_KEEP) : entries;
  return M.sortedPool(recent.map((x) => x.exp), recent.map((x) => x.ratio), stat);
};

/* rows[stat][variantId] = graded observations; pool[stat][variantId] = {exp, ratio} */
const rows = {}, ladderRows = {}, pools = {};
for (const stat of STAT_IDS) {
  rows[stat] = {}; ladderRows[stat] = {}; pools[stat] = {};
  for (const v of variantsFor(stat)) { rows[stat][v.id] = []; ladderRows[stat][v.id] = []; pools[stat][v.id] = []; }
}

/* ---------------------------------------------------------------- *
 * Walk forward
 * ---------------------------------------------------------------- */

let totalSum = 0, totalN = 0; // the running mean closing total, prior games only
const t1 = Date.now();
for (let i = START_INDEX; i < ALL.length; i++) {
  const g = ALL[i];
  const st = stateFrom(ALL.slice(0, i));
  const T = TEND.get(`${g.season}|${g.week}`);
  const lg = (T && T.league) || {};
  const lgPPG = lg.playsPerGame != null ? lg.playsPerGame / 2 : null; // league profile counts both sides
  const meanTotal = totalN ? totalSum / totalN : null;

  const ctxFor = (p, opp) => ({
    g, p, off: (T && T.off[p.team]) || {}, def: (T && T.def[opp]) || {}, lg, lgPPG, meanTotal,
    teamSpread: g.spread == null ? null : (p.team === g.home.team ? g.spread : -g.spread),
  });
  /* The factor, at strength, clamped exactly as statOppFactor clamps. */
  const adjust = (v, c) => {
    if (!v.cand) return 1;
    const f = v.f(c);
    return f == null || !isFinite(f) ? 1 : clamp(1 + v.s * (f - 1), 0.6, 1.6);
  };

  for (const stat of STAT_IDS) {
    const vs = variantsFor(stat);
    const levels = {};
    for (const v of vs) levels[v.id] = levelled(stat, pools[stat][v.id]);

    for (const p of g.players) {
      if (!(statOpportunity(stat, gameLine(p)) >= 1)) continue;
      const opp = opponentIn(g, p);
      if (!opp) continue;
      const y = statEligible(stat, st.players.get(p.id), null, { oppFactor: st.allow(opp, stat) });
      if (!y) continue;
      const c = ctxFor(p, opp);
      const actual = gameValue(stat, p);
      /* THE LINES ARE THE BASELINE'S, for every variant. See the header. */
      const lines = MULTS.map((m) => Math.round(y.exp * m) + 0.5);

      for (const v of vs) {
        const exp = y.exp * adjust(v, c);
        const pool = levels[v.id];
        MULTS.forEach((mult, k) => {
          const pOver = M.empiricalOver(exp, lines[k], pool);
          if (pOver == null) return;
          rows[stat][v.id].push({ season: g.season, mult, prob: pOver, actual: actual > lines[k] ? 1 : 0 });
        });
        if (LADDER) for (const r of ladder(stat, exp, pool, { ladderEdge: 0 })) {
          ladderRows[stat][v.id].push({ season: g.season, prob: r.prob, actual: actual > r.line ? 1 : 0 });
        }
      }
    }
  }

  /* Only now does this game join the pools — one pool per variant, each
     divided by ITS OWN adjusted projection, because a pool is the shape of
     what the factor does not explain (fetch-football.mjs). Membership is on
     `y.base`, the player's own level, and is therefore identical in every
     pool: the factor moves the price, never who is on the board. */
  for (const stat of STAT_IDS) {
    const floor = M.DEFAULTS[STATS[stat].poolFloorKey];
    const vs = variantsFor(stat);
    for (const p of g.players) {
      if (!(statOpportunity(stat, gameLine(p)) >= 1)) continue;
      const rec = st.players.get(p.id);
      if (!rec || rec.games < 3) continue;
      const opp = opponentIn(g, p);
      if (!opp) continue;
      const y = projectedStat(stat, rec, null, { oppFactor: st.allow(opp, stat) });
      if (!y || !(y.base >= floor)) continue;
      const c = ctxFor(p, opp);
      const actual = gameValue(stat, p);
      for (const v of vs) {
        const exp = y.exp * adjust(v, c);
        if (exp > 0) pools[stat][v.id].push({ exp, ratio: actual / exp });
      }
    }
  }

  if (g.total != null) { totalSum += g.total; totalN++; }
  if ((i - START_INDEX) % 100 === 0) process.stdout.write(`  game ${i}/${ALL.length}\r`);
}
console.log(`walk-forward done in ${((Date.now() - t1) / 1000).toFixed(0)}s${" ".repeat(20)}`);

/* ---------------------------------------------------------------- *
 * Reporting
 * ---------------------------------------------------------------- */

const brier = (rs) => mean(rs.map((r) => (r.prob - r.actual) ** 2));
/*
 * The paired standard error of a Brier difference.
 *
 * Every number in the tables below is a difference of a ten-thousandth or
 * two, and "better in both seasons" is a coin flip twice when the effect is
 * zero — a quarter of pure noise clears that bar by itself. So each variant
 * is differenced against the baseline OBSERVATION BY OBSERVATION (the same
 * player, the same game, the same line, so the pairing removes almost all
 * of the variance) and the spread of those differences says how big a Δ has
 * to be before it is worth reading. Under 2 SE is not a finding.
 *
 * The two arrays are built in lockstep — same loop, same skips, same pool
 * emptiness — so they pair by index. That is asserted rather than assumed.
 */
function pairedSE(rs, base) {
  if (rs.length !== base.length || !rs.length) return null;
  let sum = 0, sq = 0;
  for (let i = 0; i < rs.length; i++) {
    const d = (rs[i].prob - rs[i].actual) ** 2 - (base[i].prob - base[i].actual) ** 2;
    sum += d; sq += d * d;
  }
  const n = rs.length, m = sum / n;
  return Math.sqrt(Math.max(0, sq / n - m * m) / n);
}
const bias = (rs) => mean(rs.map((r) => r.prob)) - mean(rs.map((r) => r.actual));
const score = (rs) => ({ n: rs.length, brier: brier(rs), bias: bias(rs) });
const bySeason = (rs, s) => rs.filter((r) => r.season === s);
const SEASONS = [...new Set(ALL.map((g) => g.season))].sort();
const FULL = SEASONS.filter((s) => ALL.filter((g) => g.season === s).length >= 200);

console.log(`\n${"#".repeat(96)}`);
console.log("BASELINE — this must match `node backtest-nfl.mjs`");
console.log("#".repeat(96));
console.log(`  ${"stat".padEnd(18)}${"n".padStart(8)}${"bias".padStart(10)}${"Brier".padStart(10)}   per season (n / bias / Brier)`);
for (const stat of STAT_IDS) {
  const b = rows[stat].baseline, s = score(b);
  const per = SEASONS.map((y) => { const r = bySeason(b, y); return r.length < 200 ? null : `${y} ${r.length} ${pp(bias(r))} ${brier(r).toFixed(4)}`; }).filter(Boolean);
  console.log(`  ${STATS[stat].label.padEnd(18)}${String(s.n).padStart(8)}${pp(s.bias).padStart(10)}${s.brier.toFixed(4).padStart(10)}   ${per.join("  ")}`);
}

for (const stat of STAT_IDS) {
  const base = rows[stat].baseline;
  const bAll = score(base), bSeason = Object.fromEntries(SEASONS.map((y) => [y, score(bySeason(base, y))]));
  const bOne = score(base.filter((r) => r.mult === 1.0));
  const bLad = LADDER ? score(ladderRows[stat].baseline) : null;

  console.log(`\n${"=".repeat(96)}`);
  console.log(`${STATS[stat].label.toUpperCase()} — baseline Brier ${bAll.brier.toFixed(4)} (n ${bAll.n}), ` +
    `at the projection line ${bOne.brier.toFixed(4)} (n ${bOne.n})` + (bLad ? `, ladder ${bLad.brier.toFixed(4)}` : ""));
  console.log("=".repeat(96));
  console.log(`  ${"candidate".padEnd(16)}${"s".padStart(4)}${"Brier Δ".padStart(10)}${"bias".padStart(10)}` +
    SEASONS.map((y) => `${y} Δ`.padStart(11)).join("") + `${"line-1.0 Δ".padStart(12)}${(LADDER ? "ladder Δ" : "").padStart(11)}${"Δ/SE".padStart(8)}  verdict`);

  const scored = [];
  for (const v of variantsFor(stat)) {
    if (v.id === "baseline") continue;
    const rs = rows[stat][v.id], s = score(rs);
    const d = s.brier - bAll.brier;
    const dS = Object.fromEntries(SEASONS.map((y) => {
      const r = bySeason(rs, y);
      return [y, r.length < 200 ? null : brier(r) - bSeason[y].brier];
    }));
    const dOne = brier(rs.filter((r) => r.mult === 1.0)) - bOne.brier;
    const dLad = LADDER ? brier(ladderRows[stat][v.id]) - bLad.brier : null;
    const se = pairedSE(rs, base);
    const bothSeasons = FULL.every((y) => dS[y] != null && dS[y] < 0);
    const real = se != null && d <= -2 * se;
    scored.push({ v, s, d, dS, dOne, dLad, se, bothSeasons, clears: bothSeasons && real });
  }
  scored.sort((a, b) => a.d - b.d);
  const f4 = (x) => (x == null ? "—" : (x >= 0 ? "+" : "") + x.toFixed(4));
  for (const r of scored) {
    console.log(`  ${(r.v.cand || "").padEnd(16)}${String(r.v.s).padStart(4)}${f4(r.d).padStart(10)}${pp(r.s.bias).padStart(10)}` +
      SEASONS.map((y) => f4(r.dS[y]).padStart(11)).join("") +
      `${f4(r.dOne).padStart(12)}${(LADDER ? f4(r.dLad) : "").padStart(11)}` +
      `${(r.se ? (r.d / r.se).toFixed(1) : "—").padStart(8)}  ${r.clears ? "CLEARS" : r.bothSeasons ? "both seasons, inside the noise" : ""}`);
  }
  const win = scored.filter((r) => r.clears);
  const soft = scored.filter((r) => r.bothSeasons && !r.clears);
  console.log(`  ${win.length ? `CLEARS: ${win.map((r) => `${r.v.cand}@${r.v.s}`).join(", ")}`
    : "nothing clears: no candidate is better in both full seasons by more than twice the paired standard error"}` +
    (soft.length ? `   (better in both seasons but inside the noise: ${soft.map((r) => `${r.v.cand}@${r.v.s}`).join(", ")})` : ""));
}

const MODEL_AT_END = modelHash();
console.log(`\nmodel fingerprint ${MODEL_AT_START} (${MODEL_FILES.join(", ")})`);
if (MODEL_AT_END !== MODEL_AT_START) {
  console.log(`\n!!! THE MODEL CHANGED WHILE THIS RAN: ${MODEL_AT_START} -> ${MODEL_AT_END}`);
  console.log(`    Every number above is measuring two different models at once. Re-run it.`);
}

console.log([
  "", "=".repeat(96), "WHAT THE COLUMNS MEAN", "=".repeat(96),
  "  Brier Δ      variant minus baseline over all five mults. NEGATIVE IS BETTER.",
  "  <year> Δ     the same, that season alone; seasons under 200 games are \"—\".",
  "  line-1.0 Δ   the projection line only. Near zero for everything, by construction:",
  "               a line at the projection is a coin flip, so it says almost nothing about",
  "               whether the projection moved the right way. The five-mult column is where",
  "               a real improvement has to show.",
  "  Δ/SE         the overall Δ in paired standard errors. Below −2 is a real move; anything",
  "               between −2 and +2 is a number this much data cannot resolve.",
  "  verdict      CLEARS = better in BOTH 2024 and 2025 AND beyond twice the paired standard",
  "               error. Both halves are needed: with no effect at all, a quarter of",
  "               candidates win both seasons by luck alone.",
  "",
  ...CANDIDATES.map((c) => `  ${c.id.padEnd(16)} ${c.label}`),
  "",
  "  ^ ANY \"CLEARS\" ABOVE IS A CANDIDATE, NOT A CONSTANT.",
  "",
  "  Two seasons of NFL football is 544 games. On 2026-08-19 a temperature slope fitted on",
  "  one window had a clean interior optimum, better Brier and converging bias, and was",
  "  WORSE than doing nothing on the other half of the season. Before anything here ships,",
  "  re-run it on a window that shares no games and require it to help both, and check that",
  "  it still helps once the factor it overlaps with (allow, already shipped at half",
  "  strength) is re-fitted beside it rather than held fixed.",
  "",
].join("\n"));
