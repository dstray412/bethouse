#!/usr/bin/env node
/*
 * BetHouse — backtest-nfl.mjs
 * Do any of the three football models actually work?
 *
 * Replays two seasons a game at a time. Everything used to predict a game
 * comes from games that had already finished: team ratings, player season
 * lines, and the pool of real outcomes the yardage model reads its shape
 * from. Nothing about a game is visible to the thing predicting it.
 *
 * One backtest, two leagues. `--league cfb` replays the college cache with
 * the college model; the default is the NFL. The models are the same code
 * bound to different constants (cfb.js), so anything this finds about the
 * shape of a model it finds for both.
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
 *   node backtest-nfl.mjs --league cfb
 *   node backtest-nfl.mjs --from 2025           # only grade 2025
 *   node backtest-nfl.mjs --to 2024             # only grade 2024
 *   node backtest-nfl.mjs --measure             # the constants, read straight off the data
 *   node backtest-nfl.mjs --fit                 # sweep tdK and tdShrink
 */

import { readFileSync, existsSync } from "node:fs";
import { leagueFromArgs } from "./football-leagues.mjs";
import { seasonLines } from "./fetch-football.mjs";

const args = process.argv.slice(2);
const flag = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const league = leagueFromArgs(args);
/* --set key=value overrides a constant for this run, so a hypothesis can be
   tried without editing the model: --set tdShrink=1 --set tdK=14 */
const overrides = {};
args.forEach((a, i) => {
  if (a !== "--set") return;
  const [k, v] = String(args[i + 1] || "").split("=");
  if (k) overrides[k] = isFinite(Number(v)) ? Number(v) : v;
});
const M = Object.keys(overrides).length ? league.model.bind(overrides) : league.model;
if (Object.keys(overrides).length) console.log(`overrides: ${JSON.stringify(overrides)}`);
const {
  buildTeamRatings, projectGame, spreadProbability, totalProbability,
  scoreAnytimeTD, expectedVolume, empiricalOver, usagePoolFrom, yardsEligible, receivingOpportunity,
} = M;

const HISTORY = league.historyFile;
/* Games of history before predictions begin: about four weeks of either
   league, so the first graded week has real ratings behind it. */
const START_INDEX = league.warmupGames;
const BREAK_EVEN = 0.5238; // -110

if (!existsSync(HISTORY)) {
  console.error(`no ${HISTORY} — run: node ${league.fetcher} --history`);
  process.exit(1);
}
const history = JSON.parse(readFileSync(HISTORY, "utf8"));
const ALL = (history.games || [])
  .slice()
  .sort((a, b) => a.season - b.season || a.week - b.week || String(a.date).localeCompare(String(b.date)));

const FROM = Number(flag("--from", 0));
const TO = Number(flag("--to", 0));
const inWindow = (g) => (!FROM || g.season >= FROM) && (!TO || g.season <= TO);

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
const pct = (x) => (100 * x).toFixed(1) + "%";
const gameLine = (p) => ({ targets: p.rec?.tgt || 0, recs: p.rec?.rec || 0 });

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
  "      --from / --to for a different season",
  "  and require the value to help BOTH. If the two windows disagree, the",
  "  disagreement is the finding.",
  "",
].join("\n");

console.log(`${league.label}: loaded ${ALL.length} games (${JSON.stringify(history.seasons)})`);

/* ---------------------------------------------------------------- *
 * --measure: the constants, read directly
 *
 * "Prefer a direct measurement to a fitted one." Everything here is a
 * population quantity the history already contains; nothing is fitted
 * against Brier. Each is printed with its n so it can be re-read next
 * season and compared.
 * ---------------------------------------------------------------- */

if (args.includes("--measure")) {
  const games = ALL.filter(inWindow);

  /* Points and home field. Home field is NOT the raw home margin: in
     college the home team is usually the better team (the buy game), so
     the raw margin overstates it. Solve the ratings with a trial home
     field, read the mean residual on genuine home games, and iterate. */
  const teamGames = games.flatMap((g) => [g.home.score, g.away.score]);
  console.log(`\nSCORING — ${games.length} games`);
  console.log(`  leaguePoints        ${mean(teamGames).toFixed(2)}   points per team per game`);
  let hfa = M.DEFAULTS.homeField;
  for (let it = 0; it < 12; it++) {
    const r = buildTeamRatings(games, { homeField: hfa });
    const res = [];
    for (const g of games) {
      if (g.neutral) continue;
      const exp = r.league + r.off[g.home.team] + r.def[g.away.team];
      res.push(g.home.score - exp);
    }
    hfa = mean(res);
  }
  const rawHome = mean(games.filter((g) => !g.neutral).map((g) => g.home.score - g.away.score));
  console.log(`  homeField           ${hfa.toFixed(2)}   solved with team strength held fixed ` +
    `(raw home margin ${rawHome.toFixed(2)}, ${games.filter((g) => g.neutral).length} neutral games excluded)`);

  /* Touchdowns from opportunity: TDs = a * carries + b * receiving, by
     least squares through the origin over every player-game. */
  let Scc = 0, Scr = 0, Srr = 0, Sct = 0, Srt = 0, n = 0, tdSum = 0;
  for (const g of games) {
    for (const p of g.players) {
      const c = p.rush?.att || 0, r = receivingOpportunity(gameLine(p));
      if (!(c || r)) continue;
      const t = (p.rush?.td || 0) + (p.rec?.td || 0);
      Scc += c * c; Scr += c * r; Srr += r * r; Sct += c * t; Srt += r * t;
      n++; tdSum += t;
    }
  }
  const det = Scc * Srr - Scr * Scr;
  const a = (Sct * Srr - Srt * Scr) / det;
  const b = (Srt * Scc - Sct * Scr) / det;
  const stat = M.DEFAULTS.receivingStat === "recs" ? "reception" : "target";
  console.log(`\nTOUCHDOWNS — ${n} player-games with a carry or a ${stat}`);
  console.log(`  tdPerCarry          ${a.toFixed(4)}`);
  console.log(`  tdPer${stat === "reception" ? "Reception" : "Target   "}      ${b.toFixed(4)}   (stored as tdPerTarget; receivingStat says which)`);
  console.log(`  leagueLambda        ${(tdSum / n).toFixed(3)}   touchdowns per player-game`);

  /* The same three numbers on the population the board actually scores:
     players with three or more games that season. A roster of 120 carries
     a long tail of one-game players whose per-touch rate need not be a
     regular's, and the constants should describe whom they are applied to. */
  const gamesBy = new Map();
  for (const g of games) for (const p of g.players) {
    const k = `${g.season}|${p.id}`;
    gamesBy.set(k, (gamesBy.get(k) || 0) + 1);
  }
  let Rcc = 0, Rcr = 0, Rrr = 0, Rct = 0, Rrt = 0, rn = 0, rtd = 0;
  for (const g of games) {
    for (const p of g.players) {
      if ((gamesBy.get(`${g.season}|${p.id}`) || 0) < 3) continue;
      const c = p.rush?.att || 0, r = receivingOpportunity(gameLine(p));
      if (!(c || r)) continue;
      const t = (p.rush?.td || 0) + (p.rec?.td || 0);
      Rcc += c * c; Rcr += c * r; Rrr += r * r; Rct += c * t; Rrt += r * t;
      rn++; rtd += t;
    }
  }
  const rdet = Rcc * Rrr - Rcr * Rcr;
  console.log(`  on regulars only (3+ games that season), ${rn} player-games:`);
  console.log(`    tdPerCarry        ${((Rct * Rrr - Rrt * Rcr) / rdet).toFixed(4)}`);
  console.log(`    tdPer${stat === "reception" ? "Reception" : "Target   "}    ${((Rrt * Rcc - Rct * Rcr) / rdet).toFixed(4)}`);
  console.log(`    leagueLambda      ${(rtd / rn).toFixed(3)}`);

  /* Receiving yards: what an unknown receiver does. */
  const ydsGames = [];
  for (const g of games) for (const p of g.players) if (receivingOpportunity(gameLine(p)) >= 1) ydsGames.push(p.rec?.yds || 0);
  console.log(`\nRECEIVING YARDS — ${ydsGames.length} player-games with a catch`);
  console.log(`  mean per game       ${mean(ydsGames).toFixed(1)}   sd ${sd(ydsGames).toFixed(1)}`);
  console.log(`  (yardPrior is a replacement-level figure a little under this mean; the NFL uses 25 against a mean of 29)`);

  /* How wrong the closing line is, for reference against the model's own
     error, which the walk-forward below prints. */
  const lined = games.filter((g) => g.spread != null);
  const lineErr = lined.map((g) => g.home.score - g.away.score + g.spread);
  const totErr = games.filter((g) => g.total != null).map((g) => g.home.score + g.away.score - g.total);
  console.log(`\nTHE CLOSING LINE — ${lined.length} games`);
  console.log(`  spread error        mean ${mean(lineErr).toFixed(2)}   sd ${sd(lineErr).toFixed(2)}`);
  console.log(`  total error         mean ${mean(totErr).toFixed(2)}   sd ${sd(totErr).toFixed(2)}`);
  console.log(`  home covered        ${pct(mean(lineErr.filter((e) => e !== 0).map((e) => (e > 0 ? 1 : 0))))}`);
  console.log(`\n  marginSD / totalSD are the MODEL's error, printed by the walk-forward: run without --measure.`);
  process.exit(0);
}

/* ---------------------------------------------------------------- *
 * Rolling state, rebuilt from prior games only
 * ---------------------------------------------------------------- */

function stateFrom(priorGames) {
  // The same season-line builder the board uses, so the replay and the
  // page cannot count a touchdown or a team factor differently.
  const { players, usageByPlayer, teamFactors } = seasonLines(priorGames, M);
  return {
    players,
    ratings: buildTeamRatings(priorGames),
    teamFactor: (t) => (teamFactors[t] || {}).off ?? 1,
    oppFactor: (t) => (teamFactors[t] || {}).def ?? 1,
    usagePool: usagePoolFrom([...usageByPlayer.values()], 6),
  };
}

/* ---------------------------------------------------------------- *
 * Walk forward
 * ---------------------------------------------------------------- */

const tdRows = [], yardRows = [], gameRows = [];
const tdRowsRaw = []; // inputs kept so --fit can re-derive without refetching
const yardPool = []; // actual/expected ratios, appended only after a game is used
const marginErr = [], totalErr = []; // the model's own projection error

for (let i = START_INDEX; i < ALL.length; i++) {
  const g = ALL[i];
  if (!inWindow(g)) continue;
  const prior = ALL.slice(0, i);
  // Rebuilding state per game is wasteful but unambiguous: there is no way
  // for a later game to leak in. 1,760 games is still under a minute.
  const st = stateFrom(prior);

  /* ---- spread and total, against the closing line ---- */
  const proj = projectGame(st.ratings, g.home.team, g.away.team, { neutral: !!g.neutral });
  const margin = g.home.score - g.away.score;
  marginErr.push(margin - proj.margin);
  totalErr.push(g.home.score + g.away.score - proj.total);
  if (g.spread != null) {
    const sp = spreadProbability(proj.margin, g.spread);
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
  const uPool = st.usagePool;
  for (const p of g.players) {
    const rec = st.players.get(p.id);
    if (!rec || rec.games < 3) continue;
    const opp = p.team === g.home.team ? g.away.team : g.home.team;
    const tf = st.teamFactor(p.team), of = st.oppFactor(opp);
    const s = scoreAnytimeTD(rec, { teamFactor: tf, oppFactor: of, usagePool: uPool });
    if (!s) continue;
    const scored = (p.rush?.td || 0) + (p.rec?.td || 0) > 0 ? 1 : 0;
    tdRows.push({ prob: s.prob, actual: scored, name: p.name, games: rec.games });
    tdRowsRaw.push({
      tds: rec.tds, games: rec.games, usageRate: s.usageRate,
      teamFactor: s.teamFactor, oppFactor: s.oppFactor, pool: uPool, actual: scored,
    });
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
   *
   * The population is the board's: whoever `yardsEligible` would show.
   */
  const pool = yardPool.slice(-4000);
  for (const p of g.players) {
    if (!(receivingOpportunity(gameLine(p)) >= 1)) continue;
    const y = yardsEligible(st.players.get(p.id));
    if (!y) continue;
    for (const mult of [0.6, 0.8, 1.0, 1.25, 1.6]) {
      const line = Math.round(y.exp * mult) + 0.5;
      const pOver = empiricalOver(y.exp, line, pool);
      if (pOver == null) continue;
      yardRows.push({ prob: pOver, actual: (p.rec?.yds || 0) > line ? 1 : 0 });
    }
  }

  /* Only now does this game's result join the pool, so no prediction above
     was ever informed by a game that had not been played. The population is
     the board's own (see fetch-football.mjs, "which population goes in the
     pool"): three games and an expectation of at least 5. */
  for (const p of g.players) {
    if (!(receivingOpportunity(gameLine(p)) >= 1)) continue;
    const rec = st.players.get(p.id);
    if (!rec || rec.games < 3) continue;
    const exp = expectedVolume(rec.recYds, rec.games);
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

/* Re-score every recorded touchdown row under other constants, from the
   stored inputs. No refetch, no re-walk. */
function rescoreTD(K, shrink) {
  const bar = M.DEFAULTS.leagueLambda;
  return tdRowsRaw.map((r) => {
    const base = (r.tds + K * r.usageRate) / (r.games + K);
    const raw = Math.max(0, base * r.teamFactor * r.oppFactor);
    const lam = Math.max(0, bar + shrink * (raw - bar));
    let p;
    if (r.pool && r.pool.length) {
      let sum = 0;
      for (const u of r.pool) sum += 1 - Math.exp(-lam * u);
      p = sum / r.pool.length;
    } else p = 1 - Math.exp(-lam);
    return { prob: Math.min(0.95, p), actual: r.actual };
  });
}

function sweep(label, values, score) {
  console.log(`\n  ${label.padEnd(10)}${"brier".padStart(10)}${"bias".padStart(9)}${"top bucket gap".padStart(17)}${"bottom gap".padStart(13)}`);
  let best = null;
  values.forEach((v, i) => {
    const rows = score(v);
    const brier = mean(rows.map((x) => (x.prob - x.actual) ** 2));
    const bias = mean(rows.map((x) => x.prob)) - mean(rows.map((x) => x.actual));
    const top = rows.filter((x) => x.prob >= 0.4);
    const gap = top.length ? mean(top.map((x) => x.prob)) - mean(top.map((x) => x.actual)) : 0;
    const bot = rows.filter((x) => x.prob < 0.1);
    const bgap = bot.length ? mean(bot.map((x) => x.prob)) - mean(bot.map((x) => x.actual)) : 0;
    console.log(
      `  ${String(v).padEnd(10)}${brier.toFixed(5).padStart(10)}${((100 * bias >= 0 ? "+" : "") + (100 * bias).toFixed(2)).padStart(8)}pp${((100 * gap >= 0 ? "+" : "") + (100 * gap).toFixed(1)).padStart(15)}pp${((100 * bgap >= 0 ? "+" : "") + (100 * bgap).toFixed(1)).padStart(11)}pp`,
    );
    if (!best || brier < best.brier) best = { v, brier, i };
  });
  const edge = best.i === 0 || best.i === values.length - 1;
  console.log(`  -> ${label} = ${best.v}${edge ? "   WARNING: at the end of the sweep, so the optimum is outside it" : ""}`);
  return best.v;
}

if (args.includes("--fit")) {
  console.log(`\nFITTING tdK and tdShrink against ${tdRows.length} touchdown observations`);
  console.log(`  Coordinate descent, two passes: K with the shrink held, then the shrink, then K again.`);
  const Ks = [2, 4, 6, 8, 10, 14, 20];
  const shrinks = [0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 1.0];
  let K = M.DEFAULTS.tdK, sh = M.DEFAULTS.tdShrink;
  K = sweep("tdK", Ks, (k) => rescoreTD(k, sh));
  sh = sweep("tdShrink", shrinks, (s) => rescoreTD(K, s));
  K = sweep("tdK", Ks, (k) => rescoreTD(k, sh));
  console.log(`\n  -> tdK = ${K}, tdShrink = ${sh}   (currently ${M.DEFAULTS.tdK}, ${M.DEFAULTS.tdShrink})`);
  console.log(UNVALIDATED);
}

console.log(`predicting from game ${START_INDEX} onward` +
  (FROM || TO ? `, grading seasons ${FROM || "…"}–${TO || "…"}` : ""));

if (tdRows.length) {
  summarise(tdRows, "ANYTIME TOUCHDOWN");
  calibration(tdRows, [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 1], "anytime TD");
  lift(tdRows, "anytime TD");
}

if (yardRows.length) {
  summarise(yardRows, "RECEIVING YARDS, OVER/UNDER");
  calibration(yardRows, [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1], "receiving yards over");
}

/* ---- the model's own error, which is what marginSD / totalSD hold ---- */
if (marginErr.length) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`PROJECTION ERROR — ${marginErr.length} games`);
  console.log("=".repeat(72));
  console.log(`  margin              mean ${mean(marginErr).toFixed(2)}   sd ${sd(marginErr).toFixed(2)}   (marginSD is ${M.DEFAULTS.marginSD})`);
  console.log(`  total               mean ${mean(totalErr).toFixed(2)}   sd ${sd(totalErr).toFixed(2)}   (totalSD is ${M.DEFAULTS.totalSD})`);
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
