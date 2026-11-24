#!/usr/bin/env node
/*
 * BetHouse — backtest-nba.mjs
 * Replays cached NBA seasons through nba.js and says whether the numbers
 * the board prints are true.
 *
 *   node fetch-nba.mjs --history --seasons 2024,2025,2026,2027   # once
 *   node backtest-nba.mjs                       # every cached season after the first
 *   node backtest-nba.mjs --from 2025 --to 2025 # one window (a season is the year it ends in)
 *   node backtest-nba.mjs --ladder              # every alternate line, by rung
 *   node backtest-nba.mjs --measure             # the per-game means the priors sit under
 *   node backtest-nba.mjs --set ptsDecay=0.95   # try a constant without editing the model
 *   node backtest-nba.mjs --fixed-lines --set ptsDecay=0.95 --dump cand.json
 *   node compare-stats.mjs base.json cand.json  # the paired verdict, per prop
 *
 * NO LOOKAHEAD. The walk (fetch-nba.mjs walk) hands each slate the lines
 * as they stood before it: every earlier game from that season and the
 * one before, the board's own window. A game joins the pools only after
 * every player in its slate has been priced.
 *
 * WHO IS GRADED. A player with a line in the box score: he played. One
 * the board listed who then sat is a void bet at a book and a row the
 * tracker scratches, so he is not a miss here either. One who left after
 * four minutes is a loss at a book and is one here.
 *
 * THE RULE for a model change is the README's ("The rule for every model
 * change"): fit on one window, validate on another, paired row for row
 * on fixed lines. --fixed-lines takes who is graded and at what line
 * from a reference model (the plain line: no recent-form weight, no
 * opponent, no home floor) so a base run and a candidate run grade the
 * same propositions and only the probability differs. The dump is the
 * shape compare-stats.mjs reads.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import nba from "./nba.js";
import { walk, poolEntries, contextFor, HISTORY_FILE } from "./fetch-nba.mjs";

const args = process.argv.slice(2);
const flag = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const overrides = {};
args.forEach((a, i) => {
  if (a !== "--set") return;
  const [k, v] = String(args[i + 1] || "").split("=");
  if (!k) return;
  /* A key the model does not have would run the base and print a reassuring banner. */
  if (!Object.prototype.hasOwnProperty.call(nba.DEFAULTS, k)) throw new Error(`--set ${k}: not a model constant`);
  overrides[k] = v === "null" ? null : isFinite(Number(v)) ? Number(v) : v;
});
const M = Object.keys(overrides).length ? nba.bind(overrides) : nba;
if (Object.keys(overrides).length) console.log(`overrides: ${JSON.stringify(overrides)}`);

const STAT_IDS = Object.keys(M.STATS);
const FIXED = args.includes("--fixed-lines");
/* The reference: every term that moves a projection switched off, the shipped shrink and gates kept. */
const PLAIN = { minDecay: null };
for (const s of STAT_IDS) { PLAIN[M.STATS[s].decayKey] = 1; PLAIN[M.STATS[s].oppShrinkKey] = 0; PLAIN[M.STATS[s].homeKey] = 0; }
const REF = FIXED ? nba.bind(PLAIN) : null;
if (FIXED) console.log("fixed lines: eligibility and the graded line from the plain season line (no decay, no opponent, no home floor); the model supplies the probability");
const LADDER = args.includes("--ladder");
const FROM = Number(flag("--from", 0)), TO = Number(flag("--to", 0));

if (!existsSync(HISTORY_FILE)) {
  console.error(`No ${HISTORY_FILE}. Run: node fetch-nba.mjs --history --seasons 2024,2025,2026,2027`);
  process.exit(1);
}
const history = JSON.parse(readFileSync(HISTORY_FILE, "utf8"));
const games = history.games || [];
const seasons = [...new Set(games.map((g) => g.season))].sort();
/* The first cached season is only ever a window for the second: its own games have no season behind them. */
const firstGraded = seasons.length > 1 ? seasons[1] : seasons[0];
const inWindow = (s) => s >= (FROM || firstGraded) && (!TO || s <= TO);

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const pct = (x) => (100 * x).toFixed(1) + "%";
const signed = (x, d = 1) => (x >= 0 ? "+" : "") + x.toFixed(d);

console.log(`NBA replay: ${games.length} games cached (${seasons.join(", ")}); grading ${seasons.filter(inWindow).join(", ") || "nothing"}`);

/* ---------------------------------------------------------------- *
 * --measure: what the priors and floors sit on
 * ---------------------------------------------------------------- */

if (args.includes("--measure")) {
  const rows = games.filter((g) => inWindow(g.season)).flatMap((g) => g.players);
  const rot = rows.filter((p) => p.min >= M.DEFAULTS.minMinutes);
  console.log(`\n${rows.length} player-games, ${rot.length} at ${M.DEFAULTS.minMinutes}+ minutes`);
  console.log(`  ${"stat".padEnd(6)}${"all".padStart(8)}${"15+ min".padStart(10)}${"prior".padStart(8)}`);
  for (const s of STAT_IDS) {
    console.log(`  ${s.padEnd(6)}${mean(rows.map((p) => M.gameValue(s, p))).toFixed(2).padStart(8)}${mean(rot.map((p) => M.gameValue(s, p))).toFixed(2).padStart(10)}${String(M.DEFAULTS[M.STATS[s].priorKey]).padStart(8)}`);
  }
  console.log(`  minutes  all ${mean(rows.map((p) => p.min)).toFixed(1)}   15+ ${mean(rot.map((p) => p.min)).toFixed(1)}`);
  process.exit(0);
}

/* ---------------------------------------------------------------- *
 * Walk forward
 * ---------------------------------------------------------------- */

const statRows = Object.fromEntries(STAT_IDS.map((k) => [k, []]));
const ladderRows = Object.fromEntries(STAT_IDS.map((k) => [k, []]));
const statPool = Object.fromEntries(STAT_IDS.map((k) => [k, []]));
const POOL_KEEP = M.DEFAULTS.poolKeep;
const levelled = (stat) => {
  const e = statPool[stat], recent = e.length > POOL_KEEP ? e.slice(-POOL_KEEP) : e;
  return M.sortedPool(recent.map((x) => x.exp), recent.map((x) => x.ratio), stat);
};
/* The lines graded: under, at and over the projection, the multiples the football replay uses, each through the model's own line rule (lineFor), so the middle one is the line the board offers and the tracker records. */
const MULTS = [0.6, 0.8, 1.0, 1.25, 1.6];

/* The pools want the most recent poolKeep games, so the walk starts filling them in the February before the window opens and stops when it closes: the same pools the full walk would hold by opening night, without pricing two seasons nobody is grading. */
const WALK_FROM = `${(FROM || firstGraded) - 1}0201`;
for (const d of walk(games, M, { from: WALK_FROM })) {
  if (TO && d.season > TO) break;
  if (inWindow(d.season)) {
    for (const stat of STAT_IDS) {
      const pool = levelled(stat);
      if (!M.poolSize(pool)) continue;
      for (const g of d.games) {
        for (const p of g.players) {
          const rec = d.lines.players.get(p.id);
          if (!rec) continue;
          const ctx = contextFor(M, d.lines.teamFactors, g, p, stat);
          /* The exam: who is graded and at what line. Fixed lines take both from the reference. */
          const ref = FIXED ? REF.statEligible(stat, rec, null, ctx) : M.statEligible(stat, rec, null, ctx);
          if (!ref) continue;
          const y = FIXED ? M.projectedStat(stat, rec, null, ctx) : ref;
          if (!y || !(y.exp > 0)) continue;
          const actual = M.gameValue(stat, p);
          /* The games his over is read off are the same at every line, so they are found once. */
          const reads = M.poolReads(pool, y.exp);
          for (const mult of MULTS) {
            const line = M.lineFor(ref.exp, mult);
            const prob = M.empiricalOver(y.exp, line, reads);
            if (prob == null) continue;
            statRows[stat].push({ season: g.season, day: d.day, gameId: g.id, id: p.id, name: p.name, mult, line, prob, actual: actual > line ? 1 : 0, exp: y.exp });
          }
          if (LADDER) for (const r of M.ladder(stat, y.exp, reads, { ladderEdge: 0 })) ladderRows[stat].push({ season: g.season, prob: r.prob, actual: actual > r.line ? 1 : 0, at: r.at, exp: y.exp });
        }
      }
    }
  }
  /* Only now does the slate join the pools. */
  for (const stat of STAT_IDS) for (const g of d.games) for (const e of poolEntries(stat, g, d.lines, M)) statPool[stat].push(e);
}

/* ---------------------------------------------------------------- *
 * Reporting
 * ---------------------------------------------------------------- */

const brierOf = (rows) => mean(rows.map((r) => (r.prob - r.actual) ** 2));
const biasOf = (rows) => 100 * (mean(rows.map((r) => r.prob)) - mean(rows.map((r) => r.actual)));

function bands(rows) {
  for (let lo = 0; lo < 10; lo++) {
    const inB = rows.filter((r) => r.prob >= lo / 10 && (lo === 9 ? r.prob <= 1 : r.prob < (lo + 1) / 10));
    if (inB.length < 20) continue;
    const p = mean(inB.map((r) => r.prob)), a = mean(inB.map((r) => r.actual));
    console.log(`    ${(lo * 10 + "-" + (lo * 10 + 10) + "%").padEnd(10)}${String(inB.length).padStart(7)}${pct(p).padStart(10)}${pct(a).padStart(9)}${(signed(100 * (p - a)) + "pp").padStart(9)}`);
  }
}

for (const stat of STAT_IDS) {
  const rows = statRows[stat];
  if (!rows.length) { console.log(`\n${M.STATS[stat].label}: no rows`); continue; }
  const base = mean(rows.map((r) => r.actual)), brier = brierOf(rows), naive = mean(rows.map((r) => (base - r.actual) ** 2));
  const players = new Set(rows.map((r) => r.gameId + "|" + r.id)).size;
  console.log(`\n${"=".repeat(72)}\n${M.STATS[stat].label.toUpperCase()}: ${players} player-games, ${rows.length} graded lines\n${"=".repeat(72)}`);
  console.log(`  bias ${signed(biasOf(rows), 2)}pp   Brier ${brier.toFixed(4)}   against the base rate ${naive.toFixed(4)}   skill ${(100 * (1 - brier / naive)).toFixed(1)}%`);
  console.log(`  by season   ${[...new Set(rows.map((r) => r.season))].sort().map((s) => { const r = rows.filter((x) => x.season === s); return `${s}: ${signed(biasOf(r))}pp / ${brierOf(r).toFixed(4)} (n ${r.length})`; }).join("   ")}`);
  console.log(`  by line     ${MULTS.map((m) => { const r = rows.filter((x) => x.mult === m); return `×${m}: ${pct(mean(r.map((x) => x.prob)))} → ${pct(mean(r.map((x) => x.actual)))}`; }).join("   ")}`);
  /* Thirds by projection: a shape error shows as the small projections and the large ones missing in opposite directions. */
  const atLine = rows.filter((r) => r.mult === 1).sort((a, b) => a.exp - b.exp), third = Math.floor(atLine.length / 3);
  if (third) console.log(`  by level    ${["low", "middle", "high"].map((w, i) => { const ids = new Set(atLine.slice(i * third, i === 2 ? undefined : (i + 1) * third).map((r) => r.gameId + "|" + r.id)); const r = rows.filter((x) => ids.has(x.gameId + "|" + x.id)); return `${w}: ${signed(biasOf(r))}pp`; }).join("   ")}   (every line of the players in each third of projections)`);
  console.log(`    ${"band".padEnd(10)}${"n".padStart(7)}${"said".padStart(10)}${"hit".padStart(9)}${"gap".padStart(9)}`);
  bands(rows);
  if (LADDER && ladderRows[stat].length) {
    console.log(`  the ladder, every rung offered to every graded player:`);
    for (const at of M.LADDERS[stat]) {
      const r = ladderRows[stat].filter((x) => x.at === at);
      if (r.length < 50) continue;
      console.log(`    ${(at + "+").padStart(5)}${String(r.length).padStart(8)}${pct(mean(r.map((x) => x.prob))).padStart(10)}${pct(mean(r.map((x) => x.actual))).padStart(9)}${(signed(biasOf(r)) + "pp").padStart(9)}`);
    }
    const all = ladderRows[stat];
    console.log(`    all  ${String(all.length).padStart(8)}   bias ${signed(biasOf(all), 2)}pp   Brier ${brierOf(all).toFixed(4)}`);
  }
}

/* --dump file: every graded line keyed by its proposition, so two runs pair row for row (compare-stats.mjs). */
{
  const dump = flag("--dump", null);
  if (dump) {
    const stats = Object.fromEntries(STAT_IDS.map((stat) => [stat, statRows[stat].map((r) => [`${r.season}|${r.day}|${r.gameId}|${r.id}|${r.mult}|${r.line}`, Number(r.prob.toFixed(5)), r.actual])]));
    writeFileSync(dump, JSON.stringify({ overrides, window: { from: flag("--from", null), to: flag("--to", null) }, fixedLines: FIXED, n: 0, rows: [], stats }));
    console.log(`\ndumped ${STAT_IDS.map((s) => `${statRows[s].length} ${s}`).join(", ")} to ${dump}`);
  }
}
