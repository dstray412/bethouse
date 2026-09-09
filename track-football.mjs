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
 * The two player props, and -- since 2026-09-06, when the board started
 * showing which side it likes against a real line -- the game picks:
 * spread, total and moneyline. A pick shown on a page is a claim, and a
 * claim that is not recorded before kickoff cannot be checked afterwards.
 * The game picks are graded two ways: did the side win, and did the
 * closing line move toward it (closing line value, in points). The NFL
 * replay says these do not beat the close; the record is how that claim
 * gets re-tested on numbers the model never saw.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "./track-core.mjs";
import { fetchLine } from "./fetch-football.mjs";
import nfl from "./nfl.js"; // for the stat table, which every league shares
import Parlay from "./parlay.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));

const PROPS = [
  { id: "td", label: "Anytime touchdown" },
  { id: "recyds", label: "Receiving yards, over" },
  { id: "rushyds", label: "Rushing yards, over" },
  { id: "passyds", label: "Passing yards, over" },
  { id: "recs", label: "Receptions, over" },
  { id: "spread", label: "Spread, the side the model likes" },
  { id: "total", label: "Total, the side the model likes" },
  { id: "ml", label: "Moneyline, the side the model likes" },
];
const GAME_PROPS = new Set(["spread", "total", "ml"]);

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
  const poolFor = (stat) => (D.pools && D.pools[stat] && D.pools[stat].length ? D.pools[stat] : null);
  const oppFactorFor = (team) => {
    const f = D.teamFactors[team];
    return f && isFinite(f.def) ? f.def : 1;
  };
  const allowFor = (team, stat) => M.allowOf(D.teamFactors, team, stat);

  let added = 0, skippedStarted = 0, skippedNoGame = 0, skippedOut = 0;

  for (const p of D.players || []) {
    const g = gameFor[p.team];
    if (!g) { skippedNoGame++; continue; }
    // Rule 2: the clock, not the status string.
    if (core.startedAlready(g.date)) { skippedStarted++; continue; }
    /* Ruled out: the book would void him, so the board does not show him
       and the record does not carry him. The same rule as the page. */
    if (M.availability(p.status) === "out") { skippedOut++; continue; }

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

    /* The counting props, each behind the same gate the board applies
       before it will show a row -- the model's own, so the two cannot
       drift. A record of players the board never displayed would grade a
       bet nobody was offered. */
    for (const stat of Object.keys(M.STATS)) {
      const y = M.statEligible(stat, p, null, { oppFactor: p.opp ? allowFor(p.opp, stat) : null });
      if (!y) continue;
      const line = Math.round(y.exp * LINE_MULT) + 0.5;
      const over = M.empiricalOver(y.exp, line, poolFor(stat));
      if (over == null || !isFinite(over)) continue;
      const key = `${g.id}|${p.id}|${stat}`;
      if (seen.has(key)) continue;
      day.predictions.push({
        gameId: g.id, playerId: String(p.id), name: p.name, team: p.team,
        opp: p.opp || null, prop: stat, line,
        prob: Math.round(over * 10000) / 10000,
        kickoff: g.date, recordedAt: new Date().toISOString(),
      });
      seen.add(key);
      added++;
    }
  }

  /* Game picks, against the line the board carried. The same pickGame the
     page calls, so the record holds exactly the side that was shown. */
  let games = 0;
  for (const g of D.games || []) {
    if (!g.line || !g.home || !g.away) continue;
    if (core.startedAlready(g.date)) continue;
    const proj = M.projectGame(D.ratings, g.home, g.away, { neutral: !!g.neutral });
    const pick = M.pickGame(proj, g.line);
    if (!pick) continue;
    for (const prop of GAME_PROPS) {
      const k = pick[prop];
      if (!k || !isFinite(k.prob)) continue;
      const key = `${g.id}|game|${prop}`;
      if (seen.has(key)) continue;                // Rule 1: first prediction wins
      day.predictions.push({
        gameId: g.id, playerId: "game", name: `${g.away} at ${g.home}`, team: g.home, opp: g.away,
        prop, side: k.side, line: k.line ?? null, price: k.price ?? null,
        edge: k.edge != null ? Math.round(k.edge * 100) / 100 : null,
        /* Where the line opened, so the record can say whether the market
           had already moved toward the pick when it was made. */
        open: g.line.open ? (prop === "total" ? g.line.open.total : prop === "spread" ? g.line.open.spread : null) : null,
        projected: Math.round((prop === "total" ? proj.total : proj.margin) * 100) / 100,
        book: g.line.book || null,
        prob: Math.round(k.prob * 10000) / 10000,
        kickoff: g.date, recordedAt: new Date().toISOString(),
      });
      seen.add(key);
      added++; games++;
    }
  }

  day.graded = false;
  /* The slips the board would suggest -- the whole slate at 3, 4 and 5
     legs, and one game at 3 -- recorded the same way, so the number a
     parlay product would sell is measured and not only the legs. */
  const slips = recordSuggestedParlays(day, parlayCandidates(day), M.DEFAULTS.parlayLift);

  core.saveDay(HIST, day);
  if (slips) console.log(`  + ${slips} suggested parlays recorded`);
  const players = new Set(day.predictions.filter((p) => p.playerId !== "game").map((p) => p.playerId)).size;
  console.log(`snapshot ${date} (${D.season} week ${D.week}): +${added} predictions ` +
    `(${day.predictions.length} total, ${players} players, ${games} new game picks)`);
  if (skippedStarted) console.log(`  skipped ${skippedStarted} players whose game has kicked off`);
  if (skippedNoGame) console.log(`  skipped ${skippedNoGame} players with no game on this board`);
  if (skippedOut) console.log(`  skipped ${skippedOut} players ruled out`);
}

/* ---------------------------------------------------------------- *
 * grade
 * ---------------------------------------------------------------- */

/**
 * Settle a game pick the way a book would, and measure the closing line
 * against it.
 *
 *   spread  the side covers iff its margin plus its points is positive;
 *           exactly zero is a push
 *   total   over iff points exceed the line; equal is a push
 *   ml      the winner; a tie is void
 *
 * `clv` is points of closing-line movement in the pick's favour. A home
 * pick at -3 that closes -4.5 gained 1.5 points: the market moved toward
 * it. Null when there is no closing line to compare against.
 */
export function gradeGamePick(pick, result, close) {
  const margin = num(result?.homeScore) - num(result?.awayScore);
  const points = num(result?.homeScore) + num(result?.awayScore);
  const out = { actual: null, push: false, clv: null };
  if (pick.prop === "spread") {
    const edge = margin + pick.line;
    if (edge === 0) out.push = true;
    else out.actual = (pick.side === "home" ? edge > 0 : edge < 0) ? 1 : 0;
    if (close && isFinite(close.spread)) {
      out.clv = pick.side === "home" ? pick.line - close.spread : close.spread - pick.line;
    }
  } else if (pick.prop === "total") {
    if (points === pick.line) out.push = true;
    else out.actual = (pick.side === "over" ? points > pick.line : points < pick.line) ? 1 : 0;
    if (close && isFinite(close.total)) {
      out.clv = pick.side === "over" ? close.total - pick.line : pick.line - close.total;
    }
  } else if (pick.prop === "ml") {
    if (margin === 0) out.push = true;
    else out.actual = (pick.side === "home" ? margin > 0 : margin < 0) ? 1 : 0;
  }
  return out;
}

/**
 * Settle a player prop against his box-score line. 1 or 0; null for a prop
 * this file does not know. Over means strictly more than the line, which
 * is a half number so there is no push.
 */
export function settlePlayer(pred, line) {
  if (pred.prop === "td") return line.td > 0 ? 1 : 0;
  const st = nfl.STATS[pred.prop];
  if (!st) return null;
  return num(line[st.total]) > pred.line ? 1 : 0;
}

/* ------------------------------------------------------------------ *
 * Suggested parlays, recorded and settled
 * ------------------------------------------------------------------ */

/** Legs the suggester may use: this day's touchdown rows whose game has not started. */
export function parlayCandidates(day, now = Date.now()) {
  return (day.predictions || [])
    .filter((p) => p.prop === "td" && p.playerId !== "game" && !core.startedAlready(p.kickoff, now))
    .map((p) => ({ key: `${p.gameId}|${p.playerId}|td`, playerId: p.playerId, gameId: p.gameId, team: p.team, name: p.name, prob: p.prob, prop: "td" }));
}

/**
 * Record what the board would suggest: the slate at 3, 4 and 5 legs and
 * every open game at 3. One row per (scope, game, legs); first wins, so
 * a slip is what was offered when it was first offered.
 */
export function recordSuggestedParlays(day, candidates, lift, now = new Date().toISOString()) {
  day.parlays = day.parlays || [];
  const seen = new Set(day.parlays.map((s) => s.key));
  const wanted = [3, 4, 5].map((legs) => ({ scope: "slate", legs }));
  for (const gameId of [...new Set(candidates.map((c) => c.gameId))]) wanted.push({ scope: "game", gameId, legs: 3 });
  let added = 0;
  for (const w of wanted) {
    const key = `${w.scope}|${w.gameId || "all"}|${w.legs}`;
    if (seen.has(key)) continue;
    const out = Parlay.suggestParlay(candidates, { legs: w.legs, scope: w.scope, gameId: w.gameId, lift });
    if (!out) continue;
    day.parlays.push({
      key, scope: w.scope, gameId: w.gameId || null,
      legs: out.legs.map((l) => ({ gameId: l.gameId, playerId: l.playerId, name: l.name, team: l.team, prop: "td", prob: l.prob })),
      prob: out.combined.prob, adjusted: out.combined.adjusted, correlation: out.combined.correlation,
      recordedAt: now,
    });
    seen.add(key); added++;
  }
  return added;
}

/**
 * Settle recorded slips from their legs. A slip dies on the first miss,
 * pays only when every leg hit, and voids when a leg voided. Returns how
 * many were settled this call.
 */
export function gradeParlays(day) {
  const byKey = new Map((day.predictions || []).map((p) => [`${p.gameId}|${p.playerId}|${p.prop}`, p]));
  let n = 0;
  for (const s of day.parlays || []) {
    if (s.actual != null || s.scratched) continue;
    const legs = s.legs.map((l) => byKey.get(`${l.gameId}|${l.playerId}|${l.prop}`));
    if (legs.some((l) => l && l.scratched)) { s.scratched = true; n++; continue; }
    if (legs.some((l) => l && l.actual === 0)) { s.actual = 0; n++; continue; }
    if (legs.length && legs.every((l) => l && l.actual === 1)) { s.actual = 1; n++; }
  }
  return n;
}

/** The parlay record for the page: per scope, slips settled, predicted and cashed. */
export function parlaySummary(dir) {
  const out = {};
  for (const d of core.listDays(dir)) {
    for (const s of core.loadDay(dir, d).parlays || []) {
      if (s.actual == null) continue;
      const k = `${s.scope}${s.legs.length}`;
      const t = out[k] || (out[k] = { scope: s.scope, legs: s.legs.length, n: 0, predicted: 0, adjusted: 0, cashed: 0 });
      t.n++; t.predicted += s.prob; t.adjusted += s.adjusted != null ? s.adjusted : s.prob; t.cashed += s.actual;
    }
  }
  for (const t of Object.values(out)) { t.predicted /= t.n; t.adjusted /= t.n; }
  return Object.keys(out).length ? out : null;
}

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
        const cur = stat.get(pid) || { td: 0, recYds: 0, rushYds: 0, passYds: 0, recs: 0, played: false };
        cur.played = true;
        if (block.name === "rushing") { cur.td += num(s.rushingTouchdowns); cur.rushYds += num(s.rushingYards); }
        if (block.name === "receiving") {
          cur.td += num(s.receivingTouchdowns);
          cur.recYds += num(s.receivingYards);
          cur.recs += num(s.receptions);
        }
        if (block.name === "passing") cur.passYds += num(s.passingYards);
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

      /* Game picks first: the score, and the closing line -- the pregame
         entry the odds endpoint keeps on a finished game, with the in-play
         one dropped by parseOdds. */
      const gamePicks = day.predictions.filter((p) => p.gameId === id && GAME_PROPS.has(p.prop) && p.actual == null && !p.scratched);
      if (gamePicks.length) {
        const comp = summary?.header?.competitions?.[0];
        const homeC = (comp?.competitors || []).find((c) => c.homeAway === "home");
        const awayC = (comp?.competitors || []).find((c) => c.homeAway === "away");
        const result = { homeScore: num(homeC?.score), awayScore: num(awayC?.score) };
        const close = await fetchLine(league, id);
        for (const p of gamePicks) {
          const g = gradeGamePick(p, result, close);
          if (g.push) { p.scratched = true; p.push = true; continue; }
          p.actual = g.actual;
          p.result = { homeScore: result.homeScore, awayScore: result.awayScore };
          if (g.clv != null) p.clv = Math.round(g.clv * 100) / 100;
          if (close) p.close = { spread: close.spread, total: close.total, homeML: close.homeML, awayML: close.awayML };
          totalGraded++;
        }
      }

      /* The same id the board carries, so no name matching. */
      const stat = boxScoreLines(summary);
      if (!stat.size) continue;

      for (const p of day.predictions) {
        if (p.gameId !== id || p.actual != null || p.scratched || GAME_PROPS.has(p.prop)) continue;
        const s = stat.get(p.playerId);
        if (!s || !s.played) {
          /* Inactive, or never touched the ball. Not a loss -- the bet would
             have been voided, and counting it as a miss would make the model
             look worse than it is. Marked so grade() stops re-fetching it. */
          p.scratched = true;
          continue;
        }
        const settled = settlePlayer(p, s);
        if (settled == null) continue;
        p.actual = settled;
        p.result = { td: s.td, recYds: s.recYds, rushYds: s.rushYds, passYds: s.passYds, recs: s.recs };
        totalGraded++;
      }
    }

    const left = day.predictions.filter((p) => p.actual == null && !p.scratched).length;
    day.graded = left === 0;
    gradeParlays(day);
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

/**
 * The game picks, the way a bettor reads them: how often the side won,
 * against the 52.4% a -110 price needs, and whether the closing line
 * moved toward the pick. Calibration (in core.report) asks whether the
 * probabilities were true; this asks whether the picks were any good.
 */
export function gamePickSummary(dir) {
  const rows = [];
  for (const d of core.listDays(dir)) {
    for (const p of core.loadDay(dir, d).predictions) {
      if (GAME_PROPS.has(p.prop) && p.actual != null) rows.push(p);
    }
  }
  if (!rows.length) return null;
  const out = {};
  for (const prop of GAME_PROPS) {
    const r = rows.filter((p) => p.prop === prop);
    if (!r.length) continue;
    const won = r.filter((p) => p.actual === 1).length;
    const withClv = r.filter((p) => p.clv != null);
    const se = Math.sqrt(0.25 / r.length);
    out[prop] = {
      n: r.length, won, rate: Math.round((1000 * won) / r.length) / 10,
      // Two standard errors either side, so a hot week cannot be read as an edge.
      lo: Math.round(1000 * (won / r.length - 1.96 * se)) / 10,
      hi: Math.round(1000 * (won / r.length + 1.96 * se)) / 10,
      clvPts: withClv.length ? Math.round((100 * withClv.reduce((s, p) => s + p.clv, 0)) / withClv.length) / 100 : null,
      movedToward: withClv.length ? Math.round((1000 * withClv.filter((p) => p.clv > 0).length) / withClv.length) / 10 : null,
      clvN: withClv.length,
    };
  }
  return out;
}

export function report(league, writeRecord) {
  const dir = path.join(DIR, league.recordDir);
  const out = core.report(dir, PROPS, {
    title: `BetHouse ${league.label} running record`,
    hint: `Run: node ${league.fetcher} && node ${league.tracker} snapshot   (then grade after the games end)`,
  });
  const picks = gamePickSummary(dir);
  if (picks) {
    console.log("Game picks, settled like a book would:");
    for (const [prop, g] of Object.entries(picks)) {
      console.log(
        `  ${prop.padEnd(7)} n=${String(g.n).padStart(4)}  won ${g.rate}% (${g.lo}–${g.hi}%), needs 52.4%` +
          (g.clvPts != null ? `   closing line moved toward the pick ${g.movedToward}% of the time, ${g.clvPts >= 0 ? "+" : ""}${g.clvPts} pts on average (n=${g.clvN})` : ""),
      );
    }
    console.log();
    if (out) out.picks = picks;
  }
  const parlays = parlaySummary(dir);
  if (parlays && out) {
    out.parlays = parlays;
    console.log("Suggested parlays, settled like a book would:");
    for (const t of Object.values(parlays)) console.log(`  ${t.scope.padEnd(6)} ${t.legs} legs  n=${String(t.n).padStart(4)}  predicted ${(100 * t.adjusted).toFixed(1)}%  cashed ${(100 * t.cashed / t.n).toFixed(1)}%`);
    console.log();
  }
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
