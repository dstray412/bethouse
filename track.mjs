/*
 * BetHouse — track.mjs
 * Keeps a running record of what the board actually predicted, and whether
 * those predictions were any good.
 *
 *   node track.mjs snapshot     record today's PREGAME predictions
 *   node track.mjs grade        grade any recorded day whose games are final
 *   node track.mjs report       print the running record
 *   node track.mjs report --write-record   also emit record.js for the board
 *
 * WHY THIS EXISTS
 * ---------------
 * backtest.mjs answers "does the model work on history." It runs on demand,
 * against games chosen after the fact. This answers a different and harder
 * question: does the board YOU look at, with the lineups that were actually
 * posted at the time, hold up going forward. That is the only test the model
 * cannot quietly pass by being tuned to the data.
 *
 * TWO RULES THAT MAKE IT HONEST
 * -----------------------------
 * 1. FIRST PREDICTION WINS. Once a player is recorded for a day he is never
 *    overwritten. Without this the every-30-minutes refresh would keep
 *    updating him, and by the 7th inning the board would be "predicting" a
 *    bet it can already half see the answer to. Graded that way the model
 *    would look superb and mean nothing.
 * 2. PREGAME ONLY. Nothing is recorded once a game is underway, for the
 *    same reason.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import score from "./score.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const HIST = path.join(DIR, "history");
const API = "https://statsapi.mlb.com/api/v1";

const args = process.argv.slice(2);
const CMD = args[0] || "report";
const has = (f) => args.includes(f);

const PROPS = [
  { id: "hrr", label: "1+ H/R/RBI" },
  { id: "tb2", label: "2+ total bases" },
  { id: "tb3", label: "3+ total bases" },
  { id: "hr", label: "1+ home run" },
];

const num = (v) => (isFinite(Number(v)) ? Number(v) : 0);

async function get(url, label) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (a === 2) throw new Error(`${label}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 400 * (a + 1)));
    }
  }
}

function loadDay(date) {
  const f = path.join(HIST, `${date}.json`);
  if (!fs.existsSync(f)) return { date, predictions: [], graded: false };
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return { date, predictions: [], graded: false };
  }
}

function saveDay(day) {
  fs.mkdirSync(HIST, { recursive: true });
  fs.writeFileSync(path.join(HIST, `${day.date}.json`), JSON.stringify(day, null, 1));
}

function listDays() {
  if (!fs.existsSync(HIST)) return [];
  return fs
    .readdirSync(HIST)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(".json", ""))
    .sort();
}

/* ---------------------------------------------------------------- *
 * snapshot
 * ---------------------------------------------------------------- */

function scoreOne(prop, player, ctx) {
  if (prop === "hrr") return score.scoreHRR(player, ctx);
  if (prop === "hr") return score.scoreHR(player, ctx);
  if (prop === "tb2") return score.scoreTB(player, { ...ctx, threshold: 2 });
  if (prop === "tb3") return score.scoreTB(player, { ...ctx, threshold: 3 });
  return null;
}

function snapshot() {
  const dataPath = path.join(DIR, "mlb-data.js");
  if (!fs.existsSync(dataPath)) {
    console.error("No mlb-data.js. Run node fetch-mlb.mjs first.");
    process.exit(1);
  }
  global.window = {};
  const src = fs.readFileSync(dataPath, "utf8");
  new Function("window", src)(global.window);
  const D = global.window.BETHOUSE_MLB;
  if (!D) {
    console.error("mlb-data.js did not define a board.");
    process.exit(1);
  }

  const day = loadDay(D.date);
  const seen = new Set(day.predictions.map((p) => `${p.gamePk}|${p.playerId}|${p.prop}`));
  const L = D.league;
  let added = 0,
    skippedLive = 0,
    skippedProjected = 0;

  for (const g of D.games) {
    // Rule 2: never record a prediction for a game already underway.
    if (g.live || /Final|Game Over/i.test(g.status)) {
      skippedLive++;
      continue;
    }
    for (const side of ["away", "home"]) {
      const s = g[side];
      // A projected lineup is a guess about who is even playing. Grading it
      // would measure the guess, not the model.
      if (!s.confirmed) {
        skippedProjected++;
        continue;
      }
      const faces = g[side + "Faces"];
      const ctx = {
        leagueRates: L.rates,
        leagueTB: L.tb,
        oppAvgAllowed: faces && faces.avgAllowed,
        leagueAvgAllowed: L.avgAllowed,
        teamRunsPerGame: s.runsPerGame,
        leagueRunsPerGame: L.runsPerGame,
        pitcherHr9: faces && faces.hr9,
        leagueHr9: L.hr9,
        pitchHand: faces && faces.throws,
        leaguePlatoon: L.platoon,
        leaguePlatoonHR: L.platoonHR,
        leaguePlatoonTB: L.platoonTB,
        leagueHomeAway: L.homeAway,
        isHome: side === "home",
      };
      for (const p of s.lineup) {
        const sp = p.splits || {};
        const vs = ctx.pitchHand === "L" ? sp.vl : ctx.pitchHand === "R" ? sp.vr : null;
        const player = {
          ...p,
          sofar: null, // pregame by construction
          vsHand: vs ? { hits: vs.hits, pa: vs.pa } : null,
          vsHandHR: vs ? { hits: vs.hr, pa: vs.pa } : null,
          homeAway: sp.venue ? { hits: sp.venue.hits, pa: sp.venue.pa } : null,
          homeAwayHR: sp.venue ? { hits: sp.venue.hr, pa: sp.venue.pa } : null,
        };
        for (const prop of PROPS) {
          const key = `${g.gamePk}|${p.id}|${prop.id}`;
          if (seen.has(key)) continue; // Rule 1: first prediction wins
          const r = scoreOne(prop.id, player, ctx);
          if (!r || !isFinite(r.prob)) continue;
          day.predictions.push({
            gamePk: g.gamePk,
            playerId: p.id,
            name: p.name,
            team: s.team,
            slot: p.slot,
            prop: prop.id,
            prob: Math.round(r.prob * 10000) / 10000,
            pa: p.pa,
            recordedAt: new Date().toISOString(),
          });
          seen.add(key);
          added++;
        }
      }
    }
  }

  day.graded = false;
  saveDay(day);
  const players = new Set(day.predictions.map((p) => p.gamePk + "|" + p.playerId)).size;
  console.log(`snapshot ${D.date}: +${added} predictions (${day.predictions.length} total, ${players} players)`);
  if (skippedLive) console.log(`  skipped ${skippedLive} games already underway or finished`);
  if (skippedProjected) console.log(`  skipped ${skippedProjected} sides whose lineup was not posted yet`);
}

/* ---------------------------------------------------------------- *
 * grade
 * ---------------------------------------------------------------- */

async function grade() {
  const days = listDays();
  if (!days.length) {
    console.log("Nothing recorded yet. Run node track.mjs snapshot.");
    return;
  }
  let totalGraded = 0;

  for (const date of days) {
    const day = loadDay(date);
    const ungraded = day.predictions.filter((p) => p.actual == null);
    if (!ungraded.length) continue;

    const pks = [...new Set(ungraded.map((p) => p.gamePk))];
    const sched = await get(`${API}/schedule?sportId=1&date=${date}`, "schedule");
    const finalPks = new Set();
    for (const d of sched.dates || []) {
      for (const g of d.games || []) {
        const st = g.status?.detailedState || "";
        if (/Final|Game Over|Completed/i.test(st)) finalPks.add(g.gamePk);
      }
    }
    const todo = pks.filter((pk) => finalPks.has(pk));
    if (!todo.length) {
      console.log(`${date}: ${pks.length} games still unfinished, nothing to grade yet`);
      continue;
    }

    const boxes = {};
    for (let i = 0; i < todo.length; i += 8) {
      const chunk = todo.slice(i, i + 8);
      const got = await Promise.all(
        chunk.map((pk) => get(`${API}/game/${pk}/boxscore`, `box ${pk}`).catch(() => null))
      );
      chunk.forEach((pk, j) => (boxes[pk] = got[j]));
    }

    let graded = 0;
    for (const p of ungraded) {
      const box = boxes[p.gamePk];
      if (!box) continue;
      let st = null;
      for (const side of ["away", "home"]) {
        const rec = box.teams[side].players["ID" + p.playerId];
        if (rec && rec.stats?.batting) st = rec.stats.batting;
      }
      if (!st) {
        /* In the lineup at snapshot time but no batting line: scratched
           before first pitch. Not a miss, so it is dropped rather than
           counted against the model. */
        p.actual = null;
        p.scratched = true;
        continue;
      }
      const tb = num(st.totalBases);
      p.result = {
        pa: num(st.plateAppearances),
        hits: num(st.hits),
        runs: num(st.runs),
        rbi: num(st.rbi),
        tb,
        hr: num(st.homeRuns),
      };
      p.actual =
        p.prop === "hrr" ? (num(st.hits) || num(st.runs) || num(st.rbi) ? 1 : 0)
        : p.prop === "tb2" ? (tb >= 2 ? 1 : 0)
        : p.prop === "tb3" ? (tb >= 3 ? 1 : 0)
        : num(st.homeRuns) > 0 ? 1 : 0;
      graded++;
    }

    const scratched = day.predictions.filter((x) => x.scratched).length;
    day.graded = day.predictions.every((x) => x.actual != null || x.scratched);
    saveDay(day);
    totalGraded += graded;
    console.log(
      `${date}: graded ${graded}${scratched ? `, ${scratched} scratched and dropped` : ""}` +
        `${day.graded ? " (complete)" : " (partial)"}`
    );
  }
  if (!totalGraded) console.log("Nothing new to grade.");
}

/* ---------------------------------------------------------------- *
 * report
 * ---------------------------------------------------------------- */

function evaluate(rows) {
  const n = rows.length;
  if (!n) return null;
  const meanP = rows.reduce((s, r) => s + r.prob, 0) / n;
  const meanA = rows.reduce((s, r) => s + r.actual, 0) / n;
  const brier = rows.reduce((s, r) => s + (r.prob - r.actual) ** 2, 0) / n;
  const buckets = [];
  for (let lo = 0; lo < 1; lo += 0.1) {
    const inB = rows.filter((r) => r.prob >= lo && r.prob < lo + 0.1);
    if (inB.length < 15) continue;
    buckets.push({
      lo,
      n: inB.length,
      pred: inB.reduce((s, r) => s + r.prob, 0) / inB.length,
      act: inB.reduce((s, r) => s + r.actual, 0) / inB.length,
    });
  }
  return { n, meanP, meanA, bias: meanP - meanA, brier, buckets };
}

function report() {
  const days = listDays();
  const all = [];
  for (const d of days) {
    for (const p of loadDay(d).predictions) {
      if (p.actual == null) continue;
      all.push({ ...p, date: d });
    }
  }
  if (!all.length) {
    console.log("No graded predictions yet.");
    console.log("Run: node fetch-mlb.mjs && node track.mjs snapshot   (then grade after games end)");
    return null;
  }

  const gradedDays = [...new Set(all.map((r) => r.date))];
  console.log(`\nBetHouse running record — ${gradedDays.length} day(s), ${all.length} graded predictions`);
  console.log(`Days: ${gradedDays.join(", ")}\n`);

  const out = { days: gradedDays, total: all.length, props: {} };

  for (const prop of PROPS) {
    const rows = all.filter((r) => r.prop === prop.id);
    const e = evaluate(rows);
    if (!e) continue;
    out.props[prop.id] = {
      label: prop.label, n: e.n,
      predicted: Math.round(e.meanP * 1000) / 10,
      actual: Math.round(e.meanA * 1000) / 10,
      bias: Math.round(e.bias * 1000) / 10,
      brier: Math.round(e.brier * 10000) / 10000,
    };
    console.log(`${prop.label}`);
    console.log(`  n=${e.n}   predicted ${(e.meanP * 100).toFixed(1)}%   actual ${(e.meanA * 100).toFixed(1)}%   ` +
      `bias ${(e.bias * 100 >= 0 ? "+" : "")}${(e.bias * 100).toFixed(2)}pp   Brier ${e.brier.toFixed(4)}`);
    if (e.buckets.length) {
      for (const b of e.buckets) {
        console.log(`    ${(b.lo * 100).toFixed(0)}-${((b.lo + 0.1) * 100).toFixed(0)}%  n=${String(b.n).padStart(4)}   ` +
          `predicted ${(b.pred * 100).toFixed(1)}%  actual ${(b.act * 100).toFixed(1)}%  ` +
          `${((b.pred - b.act) * 100 >= 0 ? "+" : "")}${((b.pred - b.act) * 100).toFixed(1)}pp`);
      }
    } else {
      console.log(`    (not enough yet for a calibration table)`);
    }
    console.log();
  }

  console.log("A day or two proves nothing. Bias only means something once n is in the thousands.");
  return out;
}

/* ---------------------------------------------------------------- *
 * main
 * ---------------------------------------------------------------- */

(async () => {
  if (CMD === "snapshot") snapshot();
  else if (CMD === "grade") await grade();
  else if (CMD === "report") {
    const out = report();
    if (out && has("--write-record")) {
      fs.writeFileSync(
        path.join(DIR, "record.js"),
        "/* Generated by track.mjs. The board's running record. */\n" +
          "window.BETHOUSE_RECORD = " + JSON.stringify(out) + ";\n"
      );
      console.log("\nWrote record.js");
    }
  } else {
    console.error(`Unknown command "${CMD}". Use snapshot, grade or report.`);
    process.exit(1);
  }
})().catch((e) => {
  console.error("track failed:", e.message);
  process.exit(1);
});
