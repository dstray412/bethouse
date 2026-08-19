#!/usr/bin/env node
/*
 * BetHouse — backtest-nfl.mjs
 * Do any of the three NFL models actually work?
 *
 * Replays two seasons a week at a time. Everything used to predict week W
 * comes from games that had already finished: team ratings, player season
 * lines, and the pool of real outcomes the yardage model reads its shape
 * from. Nothing about week W is visible to the thing predicting week W.
 *
 * WHAT EACH ANSWER MEANS
 * ----------------------
 *   Anytime TD   calibration. If it says 30%, do 30% score?
 *   Yards        same question, on a prop that needs a distribution.
 *   Spread/total THE ONLY ONE GRADED AGAINST A MARKET. The others are
 *                graded against reality; this one is graded against the
 *                closing line, which is a much harder opponent. Betting
 *                at -110 needs 52.4% to break even, so anything under
 *                that is a losing model no matter how pretty the Brier is.
 *
 *   node backtest-nfl.mjs
 *   node backtest-nfl.mjs --from 2025      # only replay 2025
 */

import { readFileSync, existsSync } from "node:fs";
import nfl from "./nfl.js";

const {
  buildTeamRatings, projectGame, spreadProbability, totalProbability,
  scoreAnytimeTD, expectedVolume, empiricalOver, ratioPool, usagePoolFrom, fairPrice,
} = nfl;

const HISTORY = "nfl-history.json";
const START_INDEX = 64; // games of history before predictions begin (~4 weeks)
const BREAK_EVEN = 0.5238; // -110

const args = process.argv.slice(2);
const flag = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

if (!existsSync(HISTORY)) {
  console.error(`no ${HISTORY} — run: node fetch-nfl.mjs --history`);
  process.exit(1);
}
const history = JSON.parse(readFileSync(HISTORY, "utf8"));
const ALL = (history.games || [])
  .slice()
  .sort((a, b) => a.season - b.season || a.week - b.week || String(a.date).localeCompare(String(b.date)));

const FROM = Number(flag("--from", 0));

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const pct = (x) => (100 * x).toFixed(1) + "%";

/*
 * Every fitted constant in this project is one window away from being
 * wrong. This is printed under every sweep result so the number never
 * leaves the terminal wearing more authority than it earned.
 */
const UNVALIDATED = [
  "",
  "  ^ CANDIDATE, NOT A CONSTANT.",
  "",
  "  This value won on ONE window. That is a hypothesis. On 2026-08-19 a",
  "  temperature slope fitted this way had a clean interior optimum, better",
  "  Brier, and converging cold/hot bias -- everything about it looked",
  "  finished -- and it was WORSE than doing nothing on the other half of",
  "  the season, whose own optimum was zero.",
  "",
  "  Before adopting it, re-run on a window that shares no games:",
  "      --start / --end for a different date range",
  "  and require the value to help BOTH. If the two windows disagree, the",
  "  disagreement is the finding.",
  "",
].join("\n");

/* ---------------------------------------------------------------- *
 * Rolling state, rebuilt from prior games only
 * ---------------------------------------------------------------- */

function stateFrom(priorGames) {
  const players = new Map();
  const teamTDfor = new Map(), teamTDagainst = new Map(), teamGames = new Map();

  for (const g of priorGames) {
    const tdBy = { [g.home.team]: 0, [g.away.team]: 0 };
    for (const p of g.players) {
      const rec = players.get(p.id) || {
        id: p.id, name: p.name, team: p.team,
        games: 0, tds: 0, carries: 0, targets: 0, recYds: 0, rushYds: 0, recs: 0,
      };
      rec.team = p.team;
      rec.games++;
      const td = (p.rush?.td || 0) + (p.rec?.td || 0);
      rec.tds += td;
      rec.carries += p.rush?.att || 0;
      rec.targets += p.rec?.tgt || 0;
      rec.recYds += p.rec?.yds || 0;
      rec.rushYds += p.rush?.yds || 0;
      rec.recs += p.rec?.rec || 0;
      players.set(p.id, rec);
      if (tdBy[p.team] != null) tdBy[p.team] += td;
    }
    for (const [t, opp] of [[g.home.team, g.away.team], [g.away.team, g.home.team]]) {
      teamTDfor.set(t, (teamTDfor.get(t) || 0) + tdBy[t]);
      teamTDagainst.set(opp, (teamTDagainst.get(opp) || 0) + tdBy[t]);
      teamGames.set(t, (teamGames.get(t) || 0) + 1);
    }
  }

  const leagueTD =
    [...teamTDfor.values()].reduce((a, b) => a + b, 0) /
    Math.max(1, [...teamGames.values()].reduce((a, b) => a + b, 0));

  const factor = (map, team) => {
    const n = teamGames.get(team) || 0;
    if (!n || !leagueTD) return 1;
    // Regressed toward 1: four games of scoring is not an offence.
    const per = (map.get(team) || 0) / n;
    const K = 6;
    return (per * n + leagueTD * K) / ((n + K) * leagueTD);
  };

  return {
    players,
    ratings: buildTeamRatings(priorGames),
    teamFactor: (t) => factor(teamTDfor, t),
    oppFactor: (t) => factor(teamTDagainst, t),
  };
}

/* ---------------------------------------------------------------- *
 * Walk forward
 * ---------------------------------------------------------------- */

const tdRows = [], yardRows = [], gameRows = [];
const tdRowsRaw = []; // raw lambdas kept so --fit can re-derive without refetching
const yardPool = []; // actual/expected ratios, appended only after a game is used
/* One-game-over-average workload ratios, so the TD model can average over
   real week-to-week variation instead of evaluating at the mean. Rebuilt
   from prior games only, same as everything else here. */
const usageByPlayer = new Map();
const usagePoolNow = () => usagePoolFrom([...usageByPlayer.values()], 6);

for (let i = START_INDEX; i < ALL.length; i++) {
  const g = ALL[i];
  if (FROM && g.season < FROM) continue;
  const prior = ALL.slice(0, i);
  // Rebuilding state per game is wasteful but unambiguous: there is no way
  // for a later game to leak in. 544 games is small enough to afford it.
  const st = stateFrom(prior);

  /* ---- spread and total, against the closing line ---- */
  if (g.spread != null) {
    const proj = projectGame(st.ratings, g.home.team, g.away.team);
    const sp = spreadProbability(proj.margin, g.spread);
    const margin = g.home.score - g.away.score;
    const edge = margin + g.spread;
    if (edge !== 0) {
      gameRows.push({
        kind: "spread",
        modelEdge: sp.edge,
        prob: sp.homeCoverProb,
        actual: edge > 0 ? 1 : 0,
      });
    }
    if (g.total != null) {
      const tp = totalProbability(proj.total, g.total);
      const points = g.home.score + g.away.score;
      if (points !== g.total) {
        gameRows.push({
          kind: "total",
          modelEdge: tp.edge,
          prob: tp.overProb,
          actual: points > g.total ? 1 : 0,
        });
      }
    }
  }

  /* ---- anytime touchdown ---- */
  const uPool = usagePoolNow();
  for (const p of g.players) {
    const rec = st.players.get(p.id);
    if (!rec || rec.games < 3) continue;
    const opp = p.team === g.home.team ? g.away.team : g.home.team;
    const s = scoreAnytimeTD(rec, {
      teamFactor: st.teamFactor(p.team),
      oppFactor: st.oppFactor(opp),
      usagePool: uPool,
    });
    if (!s) continue;
    const scored = (p.rush?.td || 0) + (p.rec?.td || 0) > 0 ? 1 : 0;
    tdRows.push({ prob: s.prob, actual: scored, name: p.name, games: rec.games });
    tdRowsRaw.push({ raw: s.rawLambda, pool: uPool, actual: scored });
  }

  /*
   * Receiving yards, over/under.
   *
   * The pool is (actual / that player's own expectation at the time), built
   * only from games already played. The first version of this hardcoded
   * `expected: 30` for every receiver, which made the pool the league's raw
   * yardage distribution divided by a constant. Rescaling that by a real
   * expectation then double-counted the player's own level: a 60-yard
   * receiver got the whole league's spread stretched over 60 instead of the
   * spread of players like him. It ran 7.5 points cold and the calibration
   * table sloped the wrong way, which is what a shape error looks like.
   */
  const pool = yardPool.slice(-4000);
  for (const p of g.players) {
    if (!(p.rec?.tgt >= 1)) continue;
    const rec = st.players.get(p.id);
    if (!rec || rec.games < 3 || rec.targets < 8) continue;
    const exp = expectedVolume(rec.recYds, rec.games, 25);
    if (!(exp >= 20)) continue;
    for (const mult of [0.6, 0.8, 1.0, 1.25, 1.6]) {
      const line = Math.round(exp * mult) + 0.5;
      const pOver = empiricalOver(exp, line, pool);
      if (pOver == null) continue;
      yardRows.push({ prob: pOver, actual: (p.rec?.yds || 0) > line ? 1 : 0 });
    }
  }

  /* Only now do this week's results join the pools, so no prediction above
     was ever informed by a game that had not been played. */
  for (const p of g.players) {
    const u = nfl.usageTDs(p.rush?.att || 0, p.rec?.tgt || 0);
    if (!(u > 0)) continue;
    if (!usageByPlayer.has(p.id)) usageByPlayer.set(p.id, []);
    usageByPlayer.get(p.id).push(u);
  }
  for (const p of g.players) {
    if (!(p.rec?.tgt >= 1)) continue;
    const rec = st.players.get(p.id);
    if (!rec || rec.games < 3 || rec.targets < 8) continue;
    const exp = expectedVolume(rec.recYds, rec.games, 25);
    if (exp >= 5) yardPool.push((p.rec?.yds || 0) / exp);
  }
}

/* ---------------------------------------------------------------- *
 * Reporting
 * ---------------------------------------------------------------- */

function calibration(rows, edges, label) {
  console.log(`\n  CALIBRATION — ${label}`);
  console.log(`  ${"bucket".padEnd(14)}${"n".padStart(7)}${"predicted".padStart(12)}${"actual".padStart(10)}${"gap".padStart(10)}`);
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i], hi = edges[i + 1];
    const inB = rows.filter((r) => r.prob >= lo && (i === edges.length - 2 ? r.prob <= hi : r.prob < hi));
    if (inB.length < 20) continue;
    const p = mean(inB.map((r) => r.prob)), a = mean(inB.map((r) => r.actual));
    const gap = 100 * (p - a);
    console.log(
      `  ${(pct(lo) + "-" + pct(hi)).padEnd(14)}${String(inB.length).padStart(7)}${pct(p).padStart(12)}${pct(a).padStart(10)}${((gap >= 0 ? "+" : "") + gap.toFixed(1) + "pp").padStart(10)}`,
    );
  }
}

function summarise(rows, label) {
  const base = mean(rows.map((r) => r.actual));
  const pred = mean(rows.map((r) => r.prob));
  const brier = mean(rows.map((r) => (r.prob - r.actual) ** 2));
  const naive = mean(rows.map((r) => (base - r.actual) ** 2));
  console.log(`\n${"=".repeat(72)}`);
  console.log(`${label} — ${rows.length} observations`);
  console.log("=".repeat(72));
  console.log(`  base rate           ${pct(base)}`);
  console.log(`  mean predicted      ${pct(pred)}`);
  console.log(`  calibration bias    ${((100 * (pred - base) >= 0 ? "+" : "") + (100 * (pred - base)).toFixed(2))}pp`);
  console.log(`  Brier               ${brier.toFixed(4)}`);
  console.log(`  Brier, base rate    ${naive.toFixed(4)}  ${brier < naive ? "(model is better)" : "(MODEL IS NO BETTER)"}`);
  console.log(`  skill score         ${(100 * (1 - brier / naive)).toFixed(2)}%`);
  return { base, pred, brier, naive };
}

function lift(rows, label) {
  const s = rows.slice().sort((a, b) => b.prob - a.prob);
  const n = Math.max(1, Math.round(s.length * 0.2));
  const top = mean(s.slice(0, n).map((r) => r.actual));
  const bot = mean(s.slice(-n).map((r) => r.actual));
  console.log(`\n  DOES THE RANKING SEPARATE? (${label})`);
  console.log(`  top 20% actual      ${pct(top)}`);
  console.log(`  bottom 20% actual   ${pct(bot)}`);
  console.log(`  spread              ${(100 * (top - bot)).toFixed(1)}pp`);
}

if (args.includes("--fit")) {
  console.log(`\nFITTING tdShrink against ${tdRows.length} touchdown observations`);
  console.log(`  ${"tdShrink".padEnd(10)}${"brier".padStart(10)}${"bias".padStart(9)}${"top bucket gap".padStart(17)}`);
  let best = null;
  for (const sh of [0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 1.0]) {
    // Re-derive each probability from the stored raw lambda: no refetch.
    const rows = tdRowsRaw.map((r) => {
      const bar = nfl.DEFAULTS.leagueLambda;
      const lam = Math.max(0, bar + sh * (r.raw - bar));
      let p;
      if (r.pool && r.pool.length) {
        let sum = 0;
        for (const u of r.pool) sum += 1 - Math.exp(-lam * u);
        p = sum / r.pool.length;
      } else p = 1 - Math.exp(-lam);
      return { prob: Math.min(0.95, p), actual: r.actual };
    });
    const brier = mean(rows.map((x) => (x.prob - x.actual) ** 2));
    const bias = mean(rows.map((x) => x.prob)) - mean(rows.map((x) => x.actual));
    const top = rows.filter((x) => x.prob >= 0.4);
    const gap = top.length ? mean(top.map((x) => x.prob)) - mean(top.map((x) => x.actual)) : 0;
    console.log(
      `  ${String(sh).padEnd(10)}${brier.toFixed(5).padStart(10)}${((100 * bias >= 0 ? "+" : "") + (100 * bias).toFixed(2)).padStart(8)}pp${((100 * gap >= 0 ? "+" : "") + (100 * gap).toFixed(1)).padStart(15)}pp`,
    );
    if (!best || brier < best.brier) best = { sh, brier };
  }
  console.log(`  -> tdShrink = ${best.sh}`);
  console.log(UNVALIDATED);
}

console.log(`loaded ${ALL.length} games (${JSON.stringify(history.seasons)})`);
console.log(`predicting from game ${START_INDEX} onward`);

if (tdRows.length) {
  summarise(tdRows, "ANYTIME TOUCHDOWN");
  calibration(tdRows, [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 1], "anytime TD");
  lift(tdRows, "anytime TD");
}

if (yardRows.length) {
  summarise(yardRows, "RECEIVING YARDS, OVER/UNDER");
  calibration(yardRows, [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1], "receiving yards over");
}

/* ---- the market test ---- */
for (const kind of ["spread", "total"]) {
  const rows = gameRows.filter((r) => r.kind === kind);
  if (!rows.length) continue;
  const label = kind === "spread" ? "SPREAD vs THE CLOSING LINE" : "TOTAL vs THE CLOSING LINE";
  console.log(`\n${"=".repeat(72)}`);
  console.log(`${label} — ${rows.length} games`);
  console.log("=".repeat(72));
  console.log(`  Betting at -110 needs ${pct(BREAK_EVEN)} to break even.\n`);
  console.log(
    `  ${"model edge".padEnd(14)}${"bets".padStart(6)}${"won".padStart(6)}${"win rate".padStart(10)}${"95% range".padStart(16)}${"verdict".padStart(24)}`,
  );
  for (const thr of [0, 1, 2, 3, 4, 6]) {
    // Bet the side the model disagrees with the market about.
    const bets = rows.filter((r) => Math.abs(r.modelEdge) >= thr);
    if (bets.length < 20) continue;
    const won = bets.filter((r) => (r.modelEdge > 0 ? r.actual === 1 : r.actual === 0)).length;
    const n = bets.length, rate = won / n;
    /*
     * A win rate without an error bar is a number pretending to be a
     * result. The first draft of this printed "profitable" next to 52.5%
     * on 478 bets -- one tenth of a point over break-even, against a
     * standard error of 2.3 points. Reading that as an edge is precisely
     * the mistake this project keeps trying not to make.
     */
    const se = Math.sqrt(0.25 / n);
    const lo = rate - 1.96 * se, hi = rate + 1.96 * se;
    const z = (rate - BREAK_EVEN) / se;
    const verdict =
      z >= 2 ? "beats the vig" :
      z <= -2 ? "clearly losing" :
      "indistinguishable from noise";
    console.log(
      `  ${(">= " + thr + " pts").padEnd(14)}${String(n).padStart(6)}${String(won).padStart(6)}${pct(rate).padStart(10)}${(pct(lo) + "-" + pct(hi)).padStart(16)}${verdict.padStart(24)}`,
    );
  }
  const need = Math.ceil(0.25 / Math.pow((BREAK_EVEN - 0.5) / 1.96, 2));
  console.log(
    `\n  To separate a break-even model from a coin flip at 95% confidence you`,
  );
  console.log(`  would need about ${need} bets. This sample has ${rows.length}.`);
}

console.log("");
