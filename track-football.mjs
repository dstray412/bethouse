/*
 * BetHouse — track-football.mjs
 * What a football board predicted, and whether it was any good.
 *
 *   node track-nfl.mjs snapshot     record this week's PREGAME predictions
 *   node track-cfb.mjs grade        grade any recorded week whose games are final
 *   node track-nfl.mjs report       print the running record
 *   node track-cfb.mjs report --write-record   also emit the record the page loads
 *
 * Shared between the NFL and college boards for the same reason
 * track-core.mjs is shared between football and baseball: the rules that
 * keep a forward record honest are not sport-shaped, and this repo has been
 * bitten repeatedly by one rule living in two files. Everything that IS
 * league-shaped -- which board, which model, which ESPN host, which
 * directory -- comes from football-leagues.mjs.
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
 * A week that is not recorded before it starts cannot be recovered
 * afterwards — see rule 3 in track-core.mjs, which is where the rules that
 * keep this honest live.
 *
 * WHAT IT RECORDS
 * ---------------
 * The two props the board says are worth reading. The spread and total are
 * deliberately absent: the NFL board itself says they do not beat the
 * closing line, and a record of them would be measuring something nobody
 * should bet.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "./track-core.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));

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

function board(league) {
  const f = path.join(DIR, league.dataFile);
  if (!fs.existsSync(f)) {
    console.error(`No ${league.dataFile}. Run node ${league.fetcher} first.`);
    process.exit(1);
  }
  global.window = {};
  new Function("window", fs.readFileSync(f, "utf8"))(global.window);
  const D = global.window[league.dataGlobal];
  if (!D) {
    console.error(`${league.dataFile} did not define a board.`);
    process.exit(1);
  }
  return D;
}

/* ---------------------------------------------------------------- *
 * snapshot
 * ---------------------------------------------------------------- */

export function snapshot(league) {
  const M = league.model;
  const HIST = path.join(DIR, league.recordDir);
  const D = board(league);
  /* A week, not a day: a football slate spans several days, and every
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

    const td = M.scoreAnytimeTD(p, { teamFactor: tf, oppFactor: of, usagePool });
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

    /* The same gate the board applies before it will show a yards row --
       the model's own, so the two cannot drift. A record of players the
       board never displayed would grade a bet nobody was offered. */
    const y = M.yardsEligible(p);
    if (y) {
      const line = Math.round(y.exp * LINE_MULT) + 0.5;
      const over = M.empiricalOver(y.exp, line, yardPool);
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

/** Every player who took a snap that mattered, by ESPN athlete id. */
export function boxScoreLines(summary) {
  const stat = new Map();
  for (const side of summary?.boxscore?.players || []) {
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
  return stat;
}

export async function grade(league) {
  const HIST = path.join(DIR, league.recordDir);
  const weeks = core.listDays(HIST);
  if (!weeks.length) {
    console.log(`Nothing recorded yet. Run node ${league.tracker} snapshot.`);
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
        summary = await get(`${league.site}/summary?event=${id}`, `summary ${id}`);
      } catch (e) {
        console.log(`  ${id}: ${e.message}`);
        continue;
      }
      const status = summary?.header?.competitions?.[0]?.status?.type;
      if (!status?.completed) continue;

      /* The same id the board carries, so no name matching. */
      const stat = boxScoreLines(summary);
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
 * report
 * ---------------------------------------------------------------- */

export function report(league, writeRecord) {
  const out = core.report(path.join(DIR, league.recordDir), PROPS, {
    title: `BetHouse ${league.label} running record`,
    hint: `Run: node ${league.fetcher} && node ${league.tracker} snapshot   (then grade after the games end)`,
  });
  if (writeRecord) {
    /* Written even when empty, from the first run. The board loads it as a
       plain <script>, so the file has to exist before there is anything in
       it -- and a page that says "nothing graded yet" is better than one
       that silently omits the section until week 2. */
    const record = out || { days: [], total: 0, props: {} };
    fs.writeFileSync(
      path.join(DIR, league.recordFile),
      `/* Generated by ${league.tracker}. The ${league.label} board's running record. */\n` +
        `window.${league.recordGlobal} = ${JSON.stringify(record)};\n`,
    );
    console.log(`\nWrote ${league.recordFile} (${record.total} graded)`);
  }
  return out;
}

/* ---------------------------------------------------------------- *
 * main
 * ---------------------------------------------------------------- */

export async function run(league, argv) {
  const args = argv || process.argv.slice(2);
  const CMD = args[0] || "report";
  try {
    if (CMD === "snapshot") snapshot(league);
    else if (CMD === "grade") await grade(league);
    else if (CMD === "report") report(league, args.includes("--write-record"));
    else {
      console.error(`Unknown command "${CMD}". Use snapshot, grade or report.`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`${league.tracker} failed:`, e.message);
    process.exit(1);
  }
}
