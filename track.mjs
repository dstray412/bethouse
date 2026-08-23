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
import * as core from "./track-core.mjs";

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
  // index.html ships a 4+ view; without this it was the one board surface
  // nothing graded and nothing backtested.
  { id: "tb4", label: "4+ total bases" },
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

/* The day file, the pregame clock rule and the report arithmetic are the
   same for every sport and live in track-core.mjs, so baseball and the NFL
   cannot drift apart on what "honest" means. */
const loadDay = (date) => core.loadDay(HIST, date);
const saveDay = (day) => core.saveDay(HIST, day);
const listDays = () => core.listDays(HIST);

function scoreOne(prop, player, ctx) {
  if (prop === "hrr") return score.scoreHRR(player, ctx);
  if (prop === "hr") return score.scoreHR(player, ctx);
  const tb = /^tb(\d+)$/.exec(prop);
  if (tb) return score.scoreTB(player, { ...ctx, threshold: Number(tb[1]) });
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
    if (!score.gameIsOpen(g)) {
      skippedLive++;
      continue;
    }
    /* Belt and braces. Rule 2 used to be enforced only by matching status
       strings, and MLB's vocabulary is wider than the match: "Completed
       Early" read as bettable for five hours and put 90 post-hoc rows into
       the record for a game that had already finished. A wall clock cannot
       be misread the way a status string can, so refuse anything at or past
       its own first pitch regardless of what the status says. */
    if (g.startTime && core.startedAlready(g.startTime)) {
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
        // Without this, score.js falls back to the HITS home/away table for
        // home runs (`ctx.leagueHomeAwayHR || ctx.leagueHomeAway`) and the
        // live record would grade a number the board never displayed.
        leagueHomeAwayHR: L.homeAwayHR,
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
    // `!p.scratched` matters: a scratched row keeps actual == null forever, so
    // without it every past day containing a scratch re-fetched its whole
    // boxscore set on every run -- growing API cost, permanently, for rows
    // that can never be graded.
    const ungraded = day.predictions.filter((p) => p.actual == null && !p.scratched);
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
      // The old chain ended in a bare `: homeRuns > 0`, so ANY prop id it did
      // not recognise was silently graded as a home run. Match explicitly and
      // leave anything unknown ungraded rather than scoring it against the
      // wrong outcome.
      const tbn = /^tb(\d+)$/.exec(p.prop);
      if (p.prop === "hrr") p.actual = num(st.hits) || num(st.runs) || num(st.rbi) ? 1 : 0;
      else if (tbn) p.actual = tb >= Number(tbn[1]) ? 1 : 0;
      else if (p.prop === "hr") p.actual = num(st.homeRuns) > 0 ? 1 : 0;
      else continue; // unknown prop: never invent a grade for it
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

const report = () =>
  core.report(HIST, PROPS, {
    title: "BetHouse running record",
    hint: "Run: node fetch-mlb.mjs && node track.mjs snapshot   (then grade after games end)",
  });

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
