/*
 * BetHouse — track-nfl.mjs
 * What the NFL board predicted, and whether it was any good.
 *
 *   node track-nfl.mjs snapshot     record this week's PREGAME predictions
 *   node track-nfl.mjs grade        grade any recorded week whose games are final
 *   node track-nfl.mjs report       print the running record
 *   node track-nfl.mjs report --write-record   also emit nfl-record.js
 *
 * WHY THIS EXISTS, AND WHY NOW
 * ----------------------------
 * backtest-nfl.mjs replayed two seasons and said the player props were
 * calibrated. The baseball board said the same thing, from the same kind of
 * evidence, and on 2026-08-22 its FORWARD record — 4,330 numbers it had
 * actually published — showed it was over-confident in a way no backtest
 * could see. A backtest grades a model against history the model was then
 * fitted to; only a forward record grades it against nothing at all.
 *
 * The NFL model has less evidence behind it than baseball did, not more: the
 * game lines already failed outright (48.1% against the closing line) and the
 * two player props have never been checked forward. So this needs to be
 * running BEFORE week 1 kicks off on 2026-09-10. A week that is not recorded
 * before it starts cannot be recovered afterwards — see rule 3 in
 * track-core.mjs, which is where the rules that keep this honest live.
 *
 * WHAT IT RECORDS
 * ---------------
 * The two props the board says are worth reading. The spread and total are
 * deliberately absent: the board itself says they do not beat the closing
 * line, and a record of them would be measuring something nobody should bet.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nfl from "./nfl.js";
import * as core from "./track-core.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const HIST = path.join(DIR, "nfl-record");
const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

const args = process.argv.slice(2);
const CMD = args[0] || "report";
const has = (f) => args.includes(f);

const PROPS = [
  { id: "td", label: "Anytime touchdown" },
  { id: "recyds", label: "Receiving yards, over" },
];

/* The board's default view. Recording a different line from the one on
   screen would grade a bet the board never offered. */
const LINE_MULT = 1;

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

function board() {
  const f = path.join(DIR, "nfl-data.js");
  if (!fs.existsSync(f)) {
    console.error("No nfl-data.js. Run node fetch-nfl.mjs first.");
    process.exit(1);
  }
  global.window = {};
  new Function("window", fs.readFileSync(f, "utf8"))(global.window);
  const D = global.window.BetHouseNFLData;
  if (!D) {
    console.error("nfl-data.js did not define a board.");
    process.exit(1);
  }
  return D;
}

/* ---------------------------------------------------------------- *
 * snapshot
 * ---------------------------------------------------------------- */

function snapshot() {
  const D = board();
  /* A week, not a day: the NFL slate spans Thursday to Monday, and every
     game in it belongs to the same board. The file is named for the first
     kickoff so it sorts and reads like the baseball ones. */
  const kickoffs = (D.games || []).map((g) => g.date).filter(Boolean).sort();
  if (!kickoffs.length) {
    console.log("No games on the board yet — nothing to record.");
    return;
  }
  const date = kickoffs[0].slice(0, 10);

  const day = core.loadDay(HIST, date);
  day.season = D.season;
  day.week = D.week;
  const seen = new Set(day.predictions.map((p) => `${p.gameId}|${p.playerId}|${p.prop}`));

  const gameFor = {};
  for (const g of D.games || []) {
    if (g.home) gameFor[g.home] = g;
    if (g.away) gameFor[g.away] = g;
  }

  const usagePool = D.usagePool && D.usagePool.length ? D.usagePool : null;
  const yardPool = D.yardPool && D.yardPool.length ? D.yardPool : null;
  const oppFactorFor = (team) => {
    const f = D.teamFactors[team];
    return f && isFinite(f.def) ? f.def : 1;
  };

  let added = 0, skippedStarted = 0, skippedNoGame = 0;

  for (const p of D.players || []) {
    const g = gameFor[p.team];
    if (!g) { skippedNoGame++; continue; }
    // Rule 2: the clock, not the status string.
    if (core.startedAlready(g.date)) { skippedStarted++; continue; }

    const tf = (D.teamFactors[p.team] || {}).off || 1;
    const of = p.opp ? oppFactorFor(p.opp) : 1;

    const td = nfl.scoreAnytimeTD(p, { teamFactor: tf, oppFactor: of, usagePool });
    if (td && isFinite(td.prob)) {
      const key = `${g.id}|${p.id}|td`;
      if (!seen.has(key)) {                       // Rule 1: first prediction wins
        day.predictions.push({
          gameId: g.id, playerId: String(p.id), name: p.name, team: p.team,
          opp: p.opp || null, prop: "td",
          prob: Math.round(td.prob * 10000) / 10000,
          kickoff: g.date, recordedAt: new Date().toISOString(),
        });
        seen.add(key);
        added++;
      }
    }

    /* The same gates the board applies before it will show a yards row. A
       record of players the board never displayed would grade a bet nobody
       was offered. */
    if (num(p.targets) >= 10 && num(p.games) >= 3) {
      const exp = nfl.expectedVolume(p.recYds, p.games, 25);
      if (exp >= 20) {
        const line = Math.round(exp * LINE_MULT) + 0.5;
        const over = nfl.empiricalOver(exp, line, yardPool);
        if (over != null && isFinite(over)) {
          const key = `${g.id}|${p.id}|recyds`;
          if (!seen.has(key)) {
            day.predictions.push({
              gameId: g.id, playerId: String(p.id), name: p.name, team: p.team,
              opp: p.opp || null, prop: "recyds", line,
              prob: Math.round(over * 10000) / 10000,
              kickoff: g.date, recordedAt: new Date().toISOString(),
            });
            seen.add(key);
            added++;
          }
        }
      }
    }
  }

  day.graded = false;
  core.saveDay(HIST, day);
  const players = new Set(day.predictions.map((p) => p.playerId)).size;
  console.log(`snapshot ${date} (${D.season} week ${D.week}): +${added} predictions ` +
    `(${day.predictions.length} total, ${players} players)`);
  if (skippedStarted) console.log(`  skipped ${skippedStarted} players whose game has kicked off`);
  if (skippedNoGame) console.log(`  skipped ${skippedNoGame} players with no game on this board`);
}

/* ---------------------------------------------------------------- *
 * grade
 * ---------------------------------------------------------------- */

async function grade() {
  const weeks = core.listDays(HIST);
  if (!weeks.length) {
    console.log("Nothing recorded yet. Run node track-nfl.mjs snapshot.");
    return;
  }
  let totalGraded = 0;

  for (const date of weeks) {
    const day = core.loadDay(HIST, date);
    const ungraded = day.predictions.filter((p) => p.actual == null && !p.scratched);
    if (!ungraded.length) continue;

    const ids = [...new Set(ungraded.map((p) => p.gameId))];
    for (const id of ids) {
      let summary;
      try {
        summary = await get(`${SITE}/summary?event=${id}`, `summary ${id}`);
      } catch (e) {
        console.log(`  ${id}: ${e.message}`);
        continue;
      }
      const status = summary?.header?.competitions?.[0]?.status?.type;
      if (!status?.completed) continue;

      /* Every player who took a snap that mattered, by ESPN athlete id --
         the same id the board carries, so no name matching. */
      const stat = new Map();
      for (const side of summary.boxscore?.players || []) {
        for (const block of side.statistics || []) {
          for (const ath of block.athletes || []) {
            const pid = String(ath?.athlete?.id ?? "");
            if (!pid) continue;
            const keys = block.keys || [];
            const vals = ath.stats || [];
            const s = {};
            keys.forEach((k, i) => { s[k] = num(vals[i]); });
            const cur = stat.get(pid) || { td: 0, recYds: 0, played: false };
            cur.played = true;
            if (block.name === "rushing") cur.td += num(s.rushingTouchdowns);
            if (block.name === "receiving") {
              cur.td += num(s.receivingTouchdowns);
              cur.recYds += num(s.receivingYards);
            }
            stat.set(pid, cur);
          }
        }
      }
      if (!stat.size) continue;

      for (const p of day.predictions) {
        if (p.gameId !== id || p.actual != null || p.scratched) continue;
        const s = stat.get(p.playerId);
        if (!s || !s.played) {
          /* Inactive, or never touched the ball. Not a loss -- the bet would
             have been voided, and counting it as a miss would make the model
             look worse than it is. Marked so grade() stops re-fetching it. */
          p.scratched = true;
          continue;
        }
        if (p.prop === "td") p.actual = s.td > 0 ? 1 : 0;
        else if (p.prop === "recyds") p.actual = s.recYds > p.line ? 1 : 0;
        else continue;
        p.result = { td: s.td, recYds: s.recYds };
        totalGraded++;
      }
    }

    const left = day.predictions.filter((p) => p.actual == null && !p.scratched).length;
    day.graded = left === 0;
    core.saveDay(HIST, day);
    const done = day.predictions.filter((p) => p.actual != null).length;
    const scratched = day.predictions.filter((p) => p.scratched).length;
    console.log(`${date}: ${done} graded, ${scratched} did not play, ${left} still pending`);
  }
  console.log(totalGraded ? `\ngraded ${totalGraded} predictions` : "\nnothing new to grade");
}

/* ---------------------------------------------------------------- *
 * main
 * ---------------------------------------------------------------- */

const report = () =>
  core.report(HIST, PROPS, {
    title: "BetHouse NFL running record",
    hint: "Run: node fetch-nfl.mjs && node track-nfl.mjs snapshot   (then grade after the games end)",
  });

(async () => {
  if (CMD === "snapshot") snapshot();
  else if (CMD === "grade") await grade();
  else if (CMD === "report") {
    const out = report();
    if (has("--write-record")) {
      /* Written even when empty, from the first run. The board loads it as a
         plain <script>, so the file has to exist before there is anything in
         it -- and a page that says "nothing graded yet" is better than one
         that silently omits the section until week 2. */
      const record = out || { days: [], total: 0, props: {} };
      fs.writeFileSync(
        path.join(DIR, "nfl-record.js"),
        "/* Generated by track-nfl.mjs. The NFL board's running record. */\n" +
          "window.BETHOUSE_NFL_RECORD = " + JSON.stringify(record) + ";\n",
      );
      console.log(`\nWrote nfl-record.js (${record.total} graded)`);
    }
  } else {
    console.error(`Unknown command "${CMD}". Use snapshot, grade or report.`);
    process.exit(1);
  }
})().catch((e) => {
  console.error("track-nfl failed:", e.message);
  process.exit(1);
});
