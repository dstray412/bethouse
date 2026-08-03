/*
 * BetHouse — backtest.mjs
 * Replays completed games and measures whether score.js actually works.
 *
 *   node backtest.mjs                    last 10 days
 *   node backtest.mjs --days 21
 *   node backtest.mjs --start 2026-07-01 --end 2026-07-31
 *   node backtest.mjs --fit              sweep the correlation constant k
 *
 * WHY THIS EXISTS
 * ---------------
 * score.js will happily print "88.1%" next to a player's name. That number is
 * worthless until something checks it against reality. This does: it takes
 * every posted lineup in a date range, scores each hitter using only what was
 * known BEFORE the game, then looks up whether he actually got a hit, a run or
 * an RBI.
 *
 * NO LOOKAHEAD. A box score carries both the player's line for that game and
 * his season line THROUGH that game. Subtracting the former from the latter
 * gives his line ENTERING the game, which is what the model is allowed to see.
 * Using end-of-season stats to "predict" a July game would inflate every
 * number here and make a broken model look excellent.
 *
 * WHAT TO LOOK AT
 * ---------------
 *   Calibration  the only metric that matters. If the model says 80%, do 80%
 *                of those actually cash? A model that discriminates well but
 *                is calibrated 8 points high will lose money on every bet.
 *   Brier        overall accuracy, lower is better. 0.25 is a coin flip.
 *   Lift         do top-ranked players cash more often than bottom-ranked?
 *                If not, the ranking is noise and the board is decoration.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import score from "./score.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const API = "https://statsapi.mlb.com/api/v1";

const args = process.argv.slice(2);
const flag = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const has = (f) => args.includes(f);

/*
 * Reject anything this file does not understand, LOUDLY.
 *
 * `flag()` returns the default for a flag it never finds, so an unrecognised
 * name is indistinguishable from not passing one. On 2026-08-02 a run of
 * `--from 2026-07-12 --to 2026-07-25` silently ignored both, backtested the
 * default window (2026-07-23..08-01, 132 games) instead of the intended one
 * (2026-07-12..25, 141 games), and printed a calibration table that looked
 * like an answer to a question it had never been asked. The two windows were
 * then compared against each other as though only the model had changed.
 *
 * A backtest exists to be trusted. Silently answering a different question
 * than the one asked is the single worst thing it can do, so an unknown flag
 * is a hard error, not a warning.
 */
const KNOWN_FLAGS = new Set(["--days", "--fit", "--prop", "--end", "--start"]);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith("--")) continue;
  if (!KNOWN_FLAGS.has(a)) {
    console.error(`unknown flag "${a}"`);
    console.error(`known flags: ${[...KNOWN_FLAGS].join(", ")}`);
    console.error(`(dates are --start/--end, NOT --from/--to)`);
    process.exit(1);
  }
}

const DAYS = Number(flag("--days", 10));
const FIT = has("--fit");
/* Which prop to validate. "1+ total bases" is not offered because it is
   identical to 1+ hits, so the total-bases thresholds worth checking are 2
   and up. */
const PROP = flag("--prop", "hrr"); // hrr | hr | tb<N> for any N >= 1

/**
 * Total-bases props are a family, not two hardcoded cases. This used to read
 * `PROP === "tb3" ? 3 : 2`, which meant `--prop tb4` scored at threshold 2,
 * never called scoreTB at all, and graded against the H+R+RBI outcome --
 * silently reporting a 1+H/R/RBI backtest under a "4+ total bases" heading.
 * The board ships a 4+ view, so that path was reachable and wrong.
 */
const TB_N = /^tb(\d+)$/.test(PROP) ? Number(PROP.slice(2)) : null;
if (!TB_N && PROP !== "hrr" && PROP !== "hr") {
  console.error(`unknown --prop "${PROP}" (expected hrr, hr, or tb<N>)`);
  process.exit(1);
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}
function shift(dateStr, n) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

const END = flag("--end", shift(iso(new Date()), -1));
const START = flag("--start", shift(END, -(DAYS - 1)));

async function get(url, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 2) throw new Error(`${label}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}

const num = (v) => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

function parseIP(ip) {
  const [w, f] = String(ip ?? "0").split(".");
  return (Number(w) || 0) + (f === "1" ? 1 / 3 : f === "2" ? 2 / 3 : 0);
}

/* ---------------------------------------------------------------- *
 * Collect observations
 * ---------------------------------------------------------------- */

async function collect() {
  console.log(`Backtesting ${START} .. ${END}`);
  const sched = await get(
    `${API}/schedule?sportId=1&startDate=${START}&endDate=${END}&gameType=R`,
    "schedule"
  );

  const pks = [];
  for (const d of sched.dates || []) {
    for (const g of d.games || []) {
      if ((g.status?.detailedState || "") === "Final" || g.status?.codedGameState === "F") {
        pks.push(g.gamePk);
      }
    }
  }
  console.log(`  completed games found: ${pks.length}`);

  const obs = [];
  let done = 0;
  let lostBoxes = 0;
  const BATCH = 8;
  for (let i = 0; i < pks.length; i += BATCH) {
    const chunk = pks.slice(i, i + BATCH);
    const boxes = await Promise.all(
      chunk.map((pk) =>
        get(`${API}/game/${pk}/boxscore?hydrate=person`, `box ${pk}`).catch(() => null)
      )
    );
    for (const box of boxes) {
      if (box) harvest(box, obs);
      else lostBoxes++; // a game that failed all 3 retries: ~18 hitters gone
    }
    done += chunk.length;
    if (done % 40 === 0 || done === pks.length) {
      process.stdout.write(`\r  boxscores: ${done}/${pks.length}   observations: ${obs.length}   `);
    }
  }
  process.stdout.write("\n");
  /* The progress line counts boxscores ATTEMPTED, not harvested, so a game
     lost to a failed fetch used to leave no trace at all -- the run just
     quietly had fewer observations than the game count implied. Say so. */
  if (lostBoxes) {
    console.log(`  WARNING: ${lostBoxes} of ${pks.length} boxscores failed to fetch`);
    console.log(`    (~${lostBoxes * 18} hitter-games missing; results are not reproducible)`);
  }
  return obs;
}

/** Pull one game's worth of (prediction inputs, actual outcome) pairs. */
function harvest(box, obs) {
  const sides = ["away", "home"];
  // Opposing starter's line ENTERING this game, for the pitcher factor.
  const starterEntering = {};
  for (const side of sides) {
    let best = null;
    for (const p of Object.values(box.teams[side].players)) {
      const g = p.stats?.pitching;
      const s = p.seasonStats?.pitching;
      if (!g || !s || !num(g.gamesStarted)) continue;
      const ipGame = parseIP(g.inningsPitched);
      const ipSeason = parseIP(s.inningsPitched);
      const ipPrior = ipSeason - ipGame;
      // AVG allowed entering: reconstruct from hits and at-bats.
      const hPrior = num(s.hits) - num(g.hits);
      const abPrior = num(s.atBats) - num(g.atBats);
      best = {
        ip: ipPrior,
        avgAllowed: abPrior > 20 ? hPrior / abPrior : 0,
        throws: (p.person?.pitchHand || {}).code || null,
      };
    }
    starterEntering[side] = best;
  }

  for (const side of sides) {
    const opp = side === "away" ? "home" : "away";
    const faced = starterEntering[opp];
    for (const p of Object.values(box.teams[side].players)) {
      const bo = p.battingOrder;
      if (!bo || Number(bo) % 100 !== 0) continue; // starters only, not subs
      const slot = Math.floor(Number(bo) / 100);
      const g = p.stats?.batting;
      const s = p.seasonStats?.batting;
      if (!g || !s) continue;

      // Entering the game = season through the game, minus the game.
      const pa = num(s.plateAppearances) - num(g.plateAppearances);
      const hits = num(s.hits) - num(g.hits);
      const runs = num(s.runs) - num(g.runs);
      const rbi = num(s.rbi) - num(g.rbi);
      if (pa < 30) continue; // nothing to model on yet

      const doubles = num(s.doubles) - num(g.doubles);
      const triples = num(s.triples) - num(g.triples);
      const hr = num(s.homeRuns) - num(g.homeRuns);
      const gameTB = num(g.totalBases);

      const actual = num(g.hits) > 0 || num(g.runs) > 0 || num(g.rbi) > 0 ? 1 : 0;
      obs.push({
        name: p.person.fullName,
        slot,
        pa,
        hits,
        runs,
        rbi,
        doubles,
        triples,
        hr,
        gameTB,
        actualTB2: gameTB >= 2 ? 1 : 0,
        actualTB3: gameTB >= 3 ? 1 : 0,
        actualHR: num(g.homeRuns) > 0 ? 1 : 0,
        gameHR: num(g.homeRuns),
        oppAvgAllowed: faced && faced.ip > 20 ? faced.avgAllowed : 0,
        batSide: (p.person?.batSide || {}).code || null,
        pitchHand: faced ? faced.throws : null,
        isHome: side === "home",
        gameHits: num(g.hits),
        gamePA: num(g.plateAppearances),
        actual,
      });
    }
  }
}

/* ---------------------------------------------------------------- *
 * Evaluate
 * ---------------------------------------------------------------- */

function leagueRatesFrom(obs) {
  let pa = 0, h = 0, r = 0, rbi = 0;
  for (const o of obs) {
    pa += o.pa;
    h += o.hits;
    r += o.runs;
    rbi += o.rbi;
  }
  return pa > 0
    ? { hit: h / pa, run: r / pa, rbi: rbi / pa }
    : { hit: 0.217, run: 0.119, rbi: 0.114 };
}

/**
 * League platoon and home/away ratios, measured from the backtest window
 * itself rather than imported. Each is relative to that batter group's
 * OVERALL rate, which is what score.js multiplies against.
 *
 * Computed per batter handedness on purpose: pooling all batters shows a
 * misleadingly small "vs LHP" effect because righties gain and lefties lose.
 */
function leagueSplitsFrom(obs) {
  const bucket = {};
  const add = (b, key, o) => {
    bucket[b] = bucket[b] || {};
    bucket[b][key] = bucket[b][key] || { h: 0, hr: 0, tb: 0, pa: 0 };
    bucket[b][key].h += o.gameHits;
    bucket[b][key].hr += o.gameHR;
    bucket[b][key].tb += o.gameTB;
    bucket[b][key].pa += o.gamePA;
  };
  for (const o of obs) {
    if (!o.gamePA) continue;
    if (o.batSide && o.pitchHand) {
      add("b" + o.batSide, o.pitchHand, o);
      add("b" + o.batSide, "all", o);
    }
    add("venue", o.isHome ? "home" : "away", o);
    add("venue", "all", o);
  }
  // `field` picks which event the ratio is measured on. The hits table is the
  // wrong denominator for home runs and for total bases -- score.js keeps
  // separate leaguePlatoonHR / leaguePlatoonTB tables for exactly that reason,
  // and silently falls back to the hits table when they are absent. The
  // backtest used to supply only the hits table, so every tb2/tb3/hr run was
  // validating a model the board does not display.
  const on = (field) => (b, key) => {
    const g = bucket[b];
    if (!g || !g[key] || !g.all || !g[key].pa || !g.all.pa) return null;
    const base = g.all[field] / g.all.pa;
    if (!(base > 0)) return null;
    return g[key][field] / g[key].pa / base;
  };
  const ratio = on("h"), ratioHR = on("hr"), ratioTB = on("tb");
  const table = (r) => {
    const t = {};
    for (const bs of ["R", "L", "S"]) {
      const L = r("b" + bs, "L"), R = r("b" + bs, "R");
      if (L && R) t[bs] = { L, R };
    }
    return t;
  };
  const platoon = table(ratio);
  return {
    platoon,
    platoonHR: table(ratioHR),
    platoonTB: table(ratioTB),
    homeAwayHR: { home: ratioHR("venue", "home") || 1, away: ratioHR("venue", "away") || 1 },
    homeAway: { home: ratio("venue", "home") || 1, away: ratio("venue", "away") || 1 },
    counts: bucket,
  };
}

function leagueTBFrom(obs) {
  let pa = 0, s1 = 0, d = 0, t = 0, hr = 0;
  for (const o of obs) {
    pa += o.pa;
    d += o.doubles; t += o.triples; hr += o.hr;
    s1 += o.hits - o.doubles - o.triples - o.hr;
  }
  return pa > 0
    ? { single: s1 / pa, double: d / pa, triple: t / pa, hr: hr / pa }
    : { single: 0.152, double: 0.043, triple: 0.004, hr: 0.031 };
}

/** Actual outcome for whichever prop is being validated. */
function actualFor(o) {
  if (TB_N) return o.gameTB >= TB_N ? 1 : 0;
  if (PROP === "hr") return o.actualHR;
  return o.actual;
}

function predictAll(obs, k, lg, lgAvgAllowed, splits) {
  const lgTB = predictAll._lgTB;
  return obs.map((o) => {
    const player = {
      name: o.name, hits: o.hits, runs: o.runs, rbi: o.rbi, pa: o.pa, slot: o.slot,
      doubles: o.doubles, triples: o.triples, hr: o.hr,
      batSide: splits ? o.batSide : null,
    };
    const ctx = {
      correlation: k,
      leagueRates: lg,
      leagueTB: lgTB,
      oppAvgAllowed: o.oppAvgAllowed,
      leagueAvgAllowed: lgAvgAllowed,
      pitchHand: splits ? o.pitchHand : null,
      leaguePlatoon: splits ? splits.platoon : null,
      leaguePlatoonHR: splits ? splits.platoonHR : null,
      leaguePlatoonTB: splits ? splits.platoonTB : null,
      leagueHomeAway: splits ? splits.homeAway : null,
      leagueHomeAwayHR: splits ? splits.homeAwayHR : null,
      isHome: o.isHome,
      threshold: TB_N || 2,
      // NOT supplied, and deliberately so: teamRunsPerGame/leagueRunsPerGame.
      // Reconstructing a team's season-to-date scoring rate as of each past
      // date is not something the boxscore carries, so offenseFactor() runs
      // neutral here while the board applies it (measured range 0.874-1.150).
      // It is mean-1.00 across the league, so it barely moves the k fit, but
      // it does mean backtested DISCRIMINATION understates the live board.
      // reportGaps() prints this so the calibration claim is never silent.
    };
    let s;
    if (TB_N) s = score.scoreTB(player, ctx);
    else if (PROP === "hr") s = score.scoreHR(player, ctx);
    else s = score.scoreHRR(player, ctx);
    return { p: s ? s.prob : NaN, actual: actualFor(o), slot: o.slot };
  });
}

function brier(rows) {
  let sum = 0, n = 0;
  for (const r of rows) {
    if (!isFinite(r.p)) continue;
    sum += (r.p - r.actual) ** 2;
    n++;
  }
  return n ? sum / n : NaN;
}

/** Mean predicted minus mean actual. Positive means the model runs hot. */
function bias(rows) {
  let p = 0, a = 0, n = 0;
  for (const r of rows) {
    if (!isFinite(r.p)) continue;
    p += r.p;
    a += r.actual;
    n++;
  }
  return n ? p / n - a / n : NaN;
}

function calibrationTable(rows) {
  const buckets = [];
  for (let lo = 0.0; lo < 1.0; lo += 0.05) {
    const inB = rows.filter((r) => isFinite(r.p) && r.p >= lo && r.p < lo + 0.05);
    if (inB.length < 20) continue;
    const pred = inB.reduce((s, r) => s + r.p, 0) / inB.length;
    const act = inB.reduce((s, r) => s + r.actual, 0) / inB.length;
    buckets.push({ lo, n: inB.length, pred, act, gap: pred - act });
  }
  return buckets;
}

function lift(rows) {
  const ok = rows.filter((r) => isFinite(r.p)).sort((a, b) => b.p - a.p);
  const q = Math.floor(ok.length / 5) || 1;
  const top = ok.slice(0, q);
  const bot = ok.slice(-q);
  const rate = (xs) => xs.reduce((s, r) => s + r.actual, 0) / xs.length;
  return { topN: top.length, top: rate(top), bottom: rate(bot), spread: rate(top) - rate(bot) };
}

/* ---------------------------------------------------------------- *
 * Main
 * ---------------------------------------------------------------- */

async function main() {
  const obs = await collect();
  if (obs.length < 200) {
    console.error(`Only ${obs.length} observations. Widen the range with --days.`);
    process.exit(1);
  }

  const lg = leagueRatesFrom(obs);
  const withPitcher = obs.filter((o) => o.oppAvgAllowed > 0);
  const lgAvgAllowed =
    withPitcher.length > 0
      ? withPitcher.reduce((s, o) => s + o.oppAvgAllowed, 0) / withPitcher.length
      : 0.244;

  predictAll._lgTB = leagueTBFrom(obs);
  const PROP_LABEL = TB_N ? `${TB_N}+ total bases` : { hrr: "1+ hits/runs/RBI", hr: "1+ home run" }[PROP] || PROP;
  console.log(`\n  PROP: ${PROP_LABEL}`);
  // Never let a calibration number imply the board's exact model was tested.
  console.log(`  NOT exercised here: offenseFactor (team runs/game is not`);
  console.log(`    reconstructible per past date) -- the board applies it,`);
  console.log(`    range x0.874..x1.150, mean x1.00. Bias below is unaffected;`);
  console.log(`    live discrimination should be slightly BETTER than shown.`);
  const baseRate = obs.reduce((s, o) => s + actualFor(o), 0) / obs.length;
  console.log(`\n  observations:     ${obs.length} hitter-games`);
  console.log(`  actual cash rate: ${(baseRate * 100).toFixed(1)}%  <- what a coin-flip bettor beats`);
  console.log(`  league per-PA:    hit ${lg.hit.toFixed(3)}  run ${lg.run.toFixed(3)}  rbi ${lg.rbi.toFixed(3)}`);

  if (FIT) {
    console.log(`\n  Fitting correlation k (minimising |bias|, then Brier):`);
    let best = null;
    for (let k = 0; k <= 1.001; k += 0.05) {
      const rows = predictAll(obs, k, lg, lgAvgAllowed);
      const b = bias(rows), br = brier(rows);
      const mark = Math.abs(b) < 0.005 ? "  <-- calibrated" : "";
      console.log(
        `    k=${k.toFixed(2)}  mean pred ${(rows.reduce((s, r) => s + r.p, 0) / rows.length * 100).toFixed(1)}%  bias ${(b * 100 >= 0 ? "+" : "")}${(b * 100).toFixed(2)}pp  Brier ${br.toFixed(4)}${mark}`
      );
      if (!best || Math.abs(b) < Math.abs(best.b)) best = { k, b, br };
    }
    console.log(`\n  BEST k = ${best.k.toFixed(2)}  (bias ${(best.b * 100).toFixed(2)}pp, Brier ${best.br.toFixed(4)})`);
    console.log(`  Set DEFAULT_K in score.js to ${best.k.toFixed(2)}.`);
    return;
  }

  /* ---- do the new inputs actually help? ---- */
  const splits = leagueSplitsFrom(obs);
  console.log(`\n  Measured splits in this window (hits per PA, vs that group's overall):`);
  for (const bs of ["R", "L", "S"]) {
    if (splits.platoon[bs])
      console.log(`    ${bs}HB   vs LHP x${splits.platoon[bs].L.toFixed(4)}   vs RHP x${splits.platoon[bs].R.toFixed(4)}`);
  }
  console.log(`    venue  home x${splits.homeAway.home.toFixed(4)}   away x${splits.homeAway.away.toFixed(4)}`);

  console.log(`\n  Actual cash rate by matchup (does handedness move THIS prop?):`);
  const cell = {};
  for (const o of obs) {
    if (!o.batSide || !o.pitchHand) continue;
    const key = o.batSide + " vs " + o.pitchHand;
    cell[key] = cell[key] || { n: 0, w: 0 };
    cell[key].n++; cell[key].w += actualFor(o);
  }
  for (const key of Object.keys(cell).sort()) {
    const c = cell[key];
    if (c.n < 50) continue;
    console.log(`    ${key.padEnd(10)} n=${String(c.n).padStart(5)}   cashed ${(c.w / c.n * 100).toFixed(1)}%`);
  }
  const hm = obs.filter(o => o.isHome), aw = obs.filter(o => !o.isHome);
  console.log(`    home       n=${String(hm.length).padStart(5)}   cashed ${(hm.reduce((s,o)=>s+actualFor(o),0)/hm.length*100).toFixed(1)}%`);
  console.log(`    away       n=${String(aw.length).padStart(5)}   cashed ${(aw.reduce((s,o)=>s+actualFor(o),0)/aw.length*100).toFixed(1)}%`);

  const withoutS = predictAll(obs, score.DEFAULT_K, lg, lgAvgAllowed, null);
  const withS = predictAll(obs, score.DEFAULT_K, lg, lgAvgAllowed, splits);
  const bw = brier(withoutS), bs2 = brier(withS);
  console.log(`\n  A/B — do handedness + home/away improve predictions?`);
  console.log(`    without splits:  Brier ${bw.toFixed(5)}   bias ${(bias(withoutS)*100).toFixed(2)}pp`);
  console.log(`    with splits:     Brier ${bs2.toFixed(5)}   bias ${(bias(withS)*100).toFixed(2)}pp`);
  const delta = bw - bs2;
  console.log(`    delta:           ${delta >= 0 ? "-" : "+"}${Math.abs(delta).toFixed(5)}  ${delta > 0.0002 ? "-> splits HELP, keep them" : delta < -0.0002 ? "-> splits HURT, revert" : "-> no measurable difference"}`);

  if (TB_N) {
    const lgTB = predictAll._lgTB;
    let predTB = 0, actTB = 0, n = 0, predPA = 0;
    for (const o of obs) {
      const s2 = score.scoreTB(
        { name: o.name, hits: o.hits, doubles: o.doubles, triples: o.triples, hr: o.hr, pa: o.pa, slot: o.slot },
        { leagueTB: lgTB, threshold: 2 }
      );
      if (!s2) continue;
      predTB += s2.expectedTB; actTB += o.gameTB; predPA += s2.expectedPA; n++;
    }
    console.log(`\n  Where the bias comes from:`);
    console.log(`    model expects ${(predTB / n).toFixed(3)} total bases per game, actual was ${(actTB / n).toFixed(3)}`);
    console.log(`    model assumes ${(predPA / n).toFixed(2)} plate appearances per start`);
    const ratio = actTB / predTB;
    console.log(`    ratio actual/predicted: ${ratio.toFixed(4)}  ${Math.abs(ratio - 1) > 0.02 ? "-> the inputs are off, not just the threshold" : "-> inputs look right"}`);

    /* Split the blame: is it the plate-appearance assumption or the rates?
       PA_LEADOFF and PA_DECAY in score.js were reasonable-looking guesses
       and have never been measured. */
    const bySlot = {};
    for (const o of obs) {
      if (!o.gamePA) continue;
      bySlot[o.slot] = bySlot[o.slot] || { pa: 0, n: 0 };
      bySlot[o.slot].pa += o.gamePA; bySlot[o.slot].n++;
    }
    console.log(`\n  ACTUAL plate appearances by lineup slot (measured):`);
    console.log(`    slot   n       actual PA   model assumes   gap`);
    const pts = [];
    for (let sl = 1; sl <= 9; sl++) {
      const b = bySlot[sl];
      if (!b) continue;
      const act = b.pa / b.n, mod = score.expectedPA(sl);
      pts.push([sl, act]);
      console.log(`     ${sl}   ${String(b.n).padStart(5)}      ${act.toFixed(3)}        ${mod.toFixed(3)}      ${(act - mod >= 0 ? "+" : "")}${(act - mod).toFixed(3)}`);
    }
    // least-squares fit of actual PA = intercept - decay*(slot-1)
    const n2 = pts.length;
    const sx = pts.reduce((a, p2) => a + (p2[0] - 1), 0);
    const sy = pts.reduce((a, p2) => a + p2[1], 0);
    const sxx = pts.reduce((a, p2) => a + (p2[0] - 1) ** 2, 0);
    const sxy = pts.reduce((a, p2) => a + (p2[0] - 1) * p2[1], 0);
    const slope = (n2 * sxy - sx * sy) / (n2 * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n2;
    console.log(`\n    fitted:  PA_LEADOFF = ${intercept.toFixed(3)}   PA_DECAY = ${(-slope).toFixed(4)}`);
    console.log(`    current: PA_LEADOFF = ${score.PA_LEADOFF}   PA_DECAY = ${score.PA_DECAY}`);
  }

  const rows = withS;
  console.log(`\n  Using DEFAULT_K = ${score.DEFAULT_K} (with splits)`);
  console.log(`  Brier score:      ${brier(rows).toFixed(4)}   (0.25 = coin flip, lower is better)`);
  const b = bias(rows);
  console.log(`  Calibration bias: ${(b * 100 >= 0 ? "+" : "")}${(b * 100).toFixed(2)}pp  ${Math.abs(b) < 0.01 ? "(good)" : b > 0 ? "(model runs HOT — it overstates)" : "(model runs COLD)"}`);

  console.log(`\n  Calibration by bucket:`);
  console.log(`    predicted      n      predicted   actual    gap`);
  for (const c of calibrationTable(rows)) {
    console.log(
      `    ${(c.lo * 100).toFixed(0)}-${((c.lo + 0.05) * 100).toFixed(0)}%   ${String(c.n).padStart(5)}      ${(c.pred * 100).toFixed(1)}%     ${(c.act * 100).toFixed(1)}%   ${(c.gap * 100 >= 0 ? "+" : "")}${(c.gap * 100).toFixed(1)}pp`
    );
  }

  const l = lift(rows);
  console.log(`\n  Discrimination (does the ranking mean anything?):`);
  console.log(`    top 20% by model:    ${(l.top * 100).toFixed(1)}% actually cashed  (n=${l.topN})`);
  console.log(`    bottom 20% by model: ${(l.bottom * 100).toFixed(1)}% actually cashed`);
  console.log(`    spread:              ${(l.spread * 100).toFixed(1)}pp  ${l.spread > 0.08 ? "-> the ranking has real signal" : l.spread > 0.03 ? "-> weak but present" : "-> NO SIGNAL, the board is decoration"}`);

  /* The only question that decides whether any of this is worth betting:
     for each slice of the model's board, what price do you need to break
     even? If the answer is longer than books actually offer, the correct
     move is not to bet, however good the ranking is. */
  const ok = rows.filter((r) => isFinite(r.p)).sort((a, b) => b.p - a.p);
  const priceFor = (prob) => {
    const dec = 1 / prob;
    return dec >= 2 ? "+" + Math.round((dec - 1) * 100) : String(-Math.round(100 / (dec - 1)));
  };
  console.log(`\n  What price do you need? (actual cash rate of each slice)`);
  console.log(`    slice            n      cashed    break-even price`);
  for (const pct of [0.02, 0.05, 0.1, 0.2, 0.5, 1.0]) {
    const n = Math.max(1, Math.floor(ok.length * pct));
    const slice = ok.slice(0, n);
    const rate = slice.reduce((s, r) => s + r.actual, 0) / slice.length;
    const label = pct === 1 ? "every starter" : `top ${(pct * 100).toFixed(0)}%`;
    console.log(
      `    ${label.padEnd(15)} ${String(n).padStart(5)}     ${(rate * 100).toFixed(1)}%      ${priceFor(rate).padStart(6)}`
    );
  }
  console.log(`\n  Books typically price 1+ H+R+RBI around -250 to -350.`);
  console.log(`  Any slice whose break-even price is SHORTER than what you are`);
  console.log(`  offered is a losing bet no matter how well the model ranks.`);
}

main().catch((e) => {
  console.error("Backtest failed:", e.message);
  process.exit(1);
});
