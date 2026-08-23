/*
 * BetHouse — calibrate.mjs
 * Is the board's own forward record calibrated, and by how much is it not?
 *
 *   node calibrate.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * backtest.mjs measures the model against history it can replay. This
 * measures it against ITS OWN SHIPPED PREDICTIONS: what the board actually
 * said, on the lineups actually posted, graded by track.mjs at the time.
 * That is the only number a model cannot flatter itself with.
 *
 * It found the model's probabilities were spread too wide -- confident
 * numbers too confident, timid numbers too timid, on all five props. The
 * correction lives in score.js as CALIBRATION_SHRINK.
 *
 * HOW IT REBUILDS THE INPUTS
 * --------------------------
 * history/ stores the probability but not the season line behind it, so the
 * model cannot be re-run from history alone. The committed board snapshots
 * can: `git log mlb-data.js` keeps a few dozen a day, each holding every
 * lineup with the stats as they stood. Taking the EARLIEST snapshot that
 * contains a player reproduces the pregame number track.mjs recorded to
 * within 0.08pp, which is what makes re-fitting honest rather than
 * approximate. Nothing is fetched and nothing can look ahead.
 *
 * THE BAR A CONSTANT HAS TO CLEAR
 * -------------------------------
 * Fitted on one half of the window, it must improve the OTHER half, and it
 * must do that on Brier and on log loss, for every prop. A constant that
 * only looks good on the window it was fitted on is the temperature slope
 * again, and that one is still switched off in score.js for exactly this
 * reason.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const S = createRequire(import.meta.url)(path.join(DIR, "score.js"));
const PROPS = [["hrr", null], ["tb2", 2], ["tb3", 3], ["tb4", 4], ["hr", null]];

/* ---------------------------------------------------------------- *
 * Rebuild what the board actually used
 * ---------------------------------------------------------------- */

function rebuild() {
  const log = execSync('git log --format="%H %ct %s" --all -- mlb-data.js',
    { encoding: "utf8", maxBuffer: 1e8, cwd: DIR });
  const byDate = new Map();
  for (const line of log.split("\n")) {
    const m = line.match(/^([0-9a-f]{40}) (\d+) board: (\d{4}-\d\d-\d\d)/);
    if (!m) continue;
    if (!byDate.has(m[3])) byDate.set(m[3], []);
    byDate.get(m[3]).push({ sha: m[1], ts: Number(m[2]) });
  }

  const rows = [];
  let agree = { n: 0, sum: 0, max: 0 };
  for (const [date, list] of [...byDate].sort()) {
    let hist;
    try { hist = JSON.parse(fs.readFileSync(path.join(DIR, "history", `${date}.json`), "utf8")).predictions || []; }
    catch { continue; }
    const outcome = new Map(), stored = new Map();
    for (const p of hist) {
      if (p.actual == null) continue;
      outcome.set(`${p.gamePk}|${p.playerId}|${p.prop}`, p.actual);
      stored.set(`${p.gamePk}|${p.playerId}|${p.prop}`, p.prob);
    }
    if (!outcome.size) continue;

    list.sort((a, b) => a.ts - b.ts);          // earliest = closest to the recorded number
    const seen = new Set();
    for (const s of list) {
      let src;
      try { src = execSync(`git show ${s.sha}:mlb-data.js`, { encoding: "utf8", maxBuffer: 1e8, cwd: DIR }); }
      catch { continue; }
      const w = {};
      try { new Function("window", src)(w); } catch { continue; }
      const D = w.BETHOUSE_MLB;
      if (!D || D.date !== date || !D.league) continue;
      const L = D.league;

      for (const g of D.games) for (const side of ["away", "home"]) {
        const t = g[side];
        // Confirmed orders only: a projected slot is a guess at the PA count.
        if (!t.confirmed || !(t.lineup || []).length) continue;
        const faces = g[side + "Faces"], hand = faces && faces.throws;
        for (const p of t.lineup) {
          if (seen.has(`${g.gamePk}|${p.id}`)) continue;
          const sp = p.splits || {};
          const vs = hand === "L" ? sp.vl : hand === "R" ? sp.vr : null;
          const player = Object.assign({}, p, {
            vsHand: vs ? { hits: vs.hits, pa: vs.pa } : null,
            vsHandHR: vs ? { hits: vs.hr, pa: vs.pa } : null,
            homeAway: sp.venue ? { hits: sp.venue.hits, pa: sp.venue.pa } : null,
            homeAwayHR: sp.venue ? { hits: sp.venue.hr, pa: sp.venue.pa } : null,
            sofar: null,
          });
          let any = false;
          for (const [prop, thr] of PROPS) {
            const key = `${g.gamePk}|${p.id}|${prop}`;
            if (!outcome.has(key)) continue;
            const ctx = {
              leagueRates: L.rates, oppAvgAllowed: faces && faces.avgAllowed,
              leagueAvgAllowed: L.avgAllowed, teamRunsPerGame: t.runsPerGame,
              leagueRunsPerGame: L.runsPerGame, pitcherHr9: faces && faces.hr9,
              leagueHr9: L.hr9, pitchHand: hand, leaguePlatoon: L.platoon,
              leagueHomeAway: L.homeAway, leaguePlatoonHR: L.platoonHR,
              leaguePlatoonTB: L.platoonTB, leagueTB: L.tb,
              leagueHomeAwayHR: L.homeAwayHR, isHome: side === "home", threshold: thr,
            };
            const r = prop === "hr" ? S.scoreHR(player, ctx)
                    : prop === "hrr" ? S.scoreHRR(player, ctx)
                    : S.scoreTB(player, ctx);
            if (!r || !isFinite(r.rawProb)) continue;
            rows.push({ date, prop, raw: r.rawProb, a: outcome.get(key) });
            /* rawProb, not prob: the recorded number predates the
               correction, so comparing the corrected one would report the
               fix as if it were reconstruction error. */
            const d = Math.abs(r.rawProb - stored.get(key));
            agree.n++; agree.sum += d; agree.max = Math.max(agree.max, d);
            any = true;
          }
          if (any) seen.add(`${g.gamePk}|${p.id}`);
        }
      }
    }
  }
  return { rows, agree };
}

/* ---------------------------------------------------------------- *
 * Measure
 * ---------------------------------------------------------------- */

const clamp = (p) => Math.min(0.999, Math.max(0.001, p));
const logit = (p) => Math.log(p / (1 - p));
const sig = (z) => 1 / (1 + Math.exp(-z));
const brier = (s) => s.reduce((x, r) => x + (r.a - r.p) ** 2, 0) / s.length;
const bias = (s) => s.reduce((x, r) => x + (r.a - r.p), 0) / s.length;
const logloss = (s) => -s.reduce((x, r) => x + (r.a ? Math.log(clamp(r.p)) : Math.log(1 - clamp(r.p))), 0) / s.length;

const { rows, agree } = rebuild();
const days = [...new Set(rows.map((r) => r.date))].sort();
console.log(`\n${"=".repeat(72)}`);
console.log("CALIBRATION — the board against its own shipped predictions");
console.log("=".repeat(72));
console.log(`rebuilt ${rows.length} predictions over ${days.length} days, ${days[0]} to ${days[days.length - 1]}`);
console.log(`rebuild reproduces the recorded number to ${(100 * agree.sum / agree.n).toFixed(3)}pp on average, ${(100 * agree.max).toFixed(2)}pp at worst`);

const mid = days[Math.floor(days.length / 2)];
const SHRINK = S.CALIBRATION_SHRINK;

for (const [prop] of PROPS) {
  const all = rows.filter((r) => r.prop === prop);
  if (all.length < 200) continue;
  const centre = S.CALIBRATION_CENTRE[prop];
  const m = logit(centre);
  const asIs = (s) => s.map((r) => ({ p: clamp(r.raw), a: r.a }));
  const fixed = (s, b) => s.map((r) => ({ p: sig(m + b * (logit(clamp(r.raw)) - m)), a: r.a }));

  console.log(`\n--- ${prop} ---  n=${all.length}, base rate ${(100 * all.reduce((x, r) => x + r.a, 0) / all.length).toFixed(1)}%, centre ${(100 * centre).toFixed(1)}%`);
  for (const [name, set] of [["first half ", all.filter((r) => r.date < mid)], ["second half", all.filter((r) => r.date >= mid)]]) {
    const u = asIs(set), c = fixed(set, SHRINK);
    console.log(`  ${name}  uncorrected Brier ${brier(u).toFixed(5)} logloss ${logloss(u).toFixed(5)} bias ${(100 * bias(u)).toFixed(2).padStart(6)}pp`);
    console.log(`               shrink ${SHRINK}  Brier ${brier(c).toFixed(5)} logloss ${logloss(c).toFixed(5)} bias ${(100 * bias(c)).toFixed(2).padStart(6)}pp   ` +
      `${brier(c) < brier(u) && logloss(c) < logloss(u) ? "better on both" : "NOT better on both"}`);
  }

  // What this half would have chosen on its own, judged on the other.
  for (const [fn, F, tn, T] of [["first", all.filter((r) => r.date < mid), "second", all.filter((r) => r.date >= mid)],
                                ["second", all.filter((r) => r.date >= mid), "first", all.filter((r) => r.date < mid)]]) {
    let best = null;
    for (let b = 0.3; b <= 1.001; b += 0.01) {
      const v = logloss(fixed(F, b));
      if (!best || v < best.v) best = { b, v };
    }
    const before = asIs(T), after = fixed(T, best.b);
    console.log(`  fitted on the ${fn} half alone -> ${best.b.toFixed(2)}; on the ${tn} half that is ` +
      `${brier(after) < brier(before) && logloss(after) < logloss(before) ? "an improvement" : "NOT an improvement"}`);
  }
}
console.log(`\nshipped: CALIBRATION_SHRINK = ${SHRINK}. 1.00 would mean no correction.`);
