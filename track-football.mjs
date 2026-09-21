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
 * Anytime touchdown, every counting prop in the model's stat table at its
 * projection line, and -- since 2026-09-06, when the board started
 * showing which side it likes against a real line -- the game picks:
 * spread, total and moneyline. A pick shown on a page is a claim, and a
 * claim that is not recorded before kickoff cannot be checked afterwards.
 *
 * Since 2026-09-21 a counting-prop row also carries the LADDER the board
 * offers on it: `ladder` is rung -> probability for exactly the rungs the
 * page shows. A board that prices a receiver at 30+, 40+ and 50+ yards is
 * making three claims and not one, and the ladder is where a shape error
 * shows itself -- a model can be right on average and still promise too
 * much at 100 yards and too little at 30. The rungs get their own summary
 * (`ladderSummary`), apart from the per-prop tables, because thirteen
 * rungs to a player's one line would otherwise be the whole record.
 *
 * They ride on the row rather than becoming rows because a row per rung
 * does not fit: one college week came to 23,562 rung rows and a 7.5 MB
 * record file against a 1 MB limit, and nine tenths of that was the same
 * name, team and kickoff written out thirteen times.
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

/**
 * What the record reports, in the order it reports it. The counting props
 * come from the stat table rather than a list typed out here: a stat added
 * to the model (rush + rec yards, 2026-09-21) is recorded by the loop below
 * whether or not anyone remembers this file, and a stat that is recorded
 * but not reported is a number nobody ever sees.
 */
export function propsFor(M) {
  return [
    { id: "td", label: "Anytime touchdown" },
    ...Object.keys(M.STATS).map((id) => ({ id, label: `${M.STATS[id].label}, over` })),
    { id: "spread", label: "Spread, the side the model likes" },
    { id: "total", label: "Total, the side the model likes" },
    { id: "ml", label: "Moneyline, the side the model likes" },
  ];
}
const GAME_PROPS = new Set(["spread", "total", "ml"]);

/**
 * A prediction's identity, and the whole of rule 1: a row whose key is
 * already on the day is never written again. A player's ladder rides on
 * his projection-line row rather than becoming rows of its own, so this
 * is still one key per player per prop.
 *
 * Rule 1 applies to the ladder too, by consequence and correctly: a row
 * recorded before the boards showed ladders carries no ladder and never
 * will, because those rungs were never offered.
 */
export const predKey = (p) => `${p.gameId}|${p.playerId}|${p.prop}`;

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

/**
 * Every prediction one player's row on the board amounts to: his anytime
 * touchdown, and his projection line for each counting stat with that
 * stat's whole ladder on it. One row per prop, never one per rung --
 * a row per rung put 23,562 rows into a single college week and took the
 * record file to 7.5 MB against a 1 MB limit, nine tenths of it the same
 * name, team and kickoff written out again. Each row carries its own
 * `key` and no timestamp, so the caller can apply rule 1 and stamp what
 * survives.
 *
 * Pure, and separated from snapshot() for that reason: snapshot reads the
 * board off disk and writes the record back, so the part worth testing is
 * the part that turns a player into claims.
 *
 * The gate is the model's own -- `statEligible` for whether a row exists,
 * `ladder` for which rungs are offered -- so the record can never hold a
 * bet the board did not show.
 */
export function playerRows(M, D, p, g) {
  const out = [];
  /* The workload pool is a flat list of multipliers and stays one; the
     stat pools are levelled ({exp, ratio}, sorted) so a projection is
     priced off games near its own level, and that shape has no `.length`.
     `poolSize` is the one question that reads either -- asked here and
     nowhere else, because a pool mistaken for an empty one produces no
     rows at all and an empty board reads as a quiet week, not as a bug. */
  const usagePool = D.usagePool && D.usagePool.length ? D.usagePool : null;
  const poolFor = (stat) => {
    const pool = D.pools && D.pools[stat];
    return M.poolSize(pool) > 0 ? pool : null;
  };
  const teamFactors = D.teamFactors || {};
  const oppDef = (team) => {
    const f = teamFactors[team];
    return f && isFinite(f.def) ? f.def : 1;
  };
  const p4 = (v) => Math.round(v * 10000) / 10000;
  const common = {
    gameId: g.id, playerId: String(p.id), name: p.name, team: p.team,
    opp: p.opp || null,
  };
  const row = (fields) => {
    const r = { ...common, ...fields, kickoff: g.date };
    return { ...r, key: predKey(r) };
  };

  const td = M.scoreAnytimeTD(p, {
    teamFactor: (teamFactors[p.team] || {}).off || 1,
    oppFactor: p.opp ? oppDef(p.opp) : 1,
    usagePool,
  });
  if (td && isFinite(td.prob)) out.push(row({ prop: "td", prob: p4(td.prob) }));

  /* The counting props, each behind the same gate the board applies
     before it will show a row -- the model's own, so the two cannot
     drift. A record of players the board never displayed would grade a
     bet nobody was offered. */
  for (const stat of Object.keys(M.STATS)) {
    const y = M.statEligible(stat, p, null, { oppFactor: p.opp ? M.allowOf(teamFactors, p.opp, stat) : null });
    if (!y) continue;
    const pool = poolFor(stat);

    const line = Math.round(y.exp * LINE_MULT) + 0.5;
    const over = M.empiricalOver(y.exp, line, pool);
    if (over == null || !isFinite(over)) continue;

    /* The ladder: the book's other lines on the same player, which the
       board shows and so the record holds. `ladder` returns exactly the
       rungs whose chance clears DEFAULTS.ladderEdge -- the rungs the page
       prints -- so the two cannot disagree about what was offered.
       Rung -> probability, on the row the rungs belong to: a dozen
       numbers stored as a dozen numbers. Absent when nothing was
       offered, which is a different fact from a ladder of nothing. */
    const rungs = M.ladder(stat, y.exp, pool);
    const ladder = {};
    for (const r of rungs) ladder[r.at] = p4(r.prob);

    out.push(row({ prop: stat, line, prob: p4(over), ...(rungs.length ? { ladder } : {}) }));
  }
  return out;
}

export function snapshot(league) {
  const M = league.model;
  const HIST = path.resolve(DIR, league.recordDir);
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
  const seen = new Set(day.predictions.map(predKey));

  const gameFor = {};
  for (const g of D.games || []) {
    if (g.home) gameFor[g.home] = g;
    if (g.away) gameFor[g.away] = g;
  }

  let added = 0, rungs = 0, skippedStarted = 0, skippedNoGame = 0, skippedOut = 0;

  for (const p of D.players || []) {
    const g = gameFor[p.team];
    if (!g) { skippedNoGame++; continue; }
    // Rule 2: the clock, not the status string.
    if (core.startedAlready(g.date)) { skippedStarted++; continue; }
    /* Ruled out: the book would void him, so the board does not show him
       and the record does not carry him. The same rule as the page. */
    if (M.availability(p.status) === "out") { skippedOut++; continue; }

    for (const { key, ...r } of playerRows(M, D, p, g)) {
      if (seen.has(key)) continue;                // Rule 1: first prediction wins
      day.predictions.push({ ...r, recordedAt: new Date().toISOString() });
      seen.add(key);
      added++;
      rungs += r.ladder ? Object.keys(r.ladder).length : 0;
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
  const slips = recordSuggestedParlays(day, parlayCandidates(day, M.DEFAULTS.parlayProps), M.DEFAULTS.parlayLift);

  core.saveDay(HIST, day);
  if (slips) console.log(`  + ${slips} suggested parlays recorded`);
  const players = new Set(day.predictions.filter((p) => p.playerId !== "game").map((p) => p.playerId)).size;
  console.log(`snapshot ${date} (${D.season} week ${D.week}): +${added} predictions ` +
    `(${day.predictions.length} total, ${players} players, ${games} new game picks, ${rungs} new ladder rungs)`);
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
 * is a half number so there is no push. A rung settles against its own
 * line like any other row -- the line is the only thing that decides.
 *
 * `statTotal` is the model's own summation, so a stat made of two fields
 * (rush + rec yards) settles on both without this file knowing which.
 */
export function settlePlayer(pred, line) {
  if (pred.prop === "td") return line.td > 0 ? 1 : 0;
  if (!nfl.STATS[pred.prop]) return null;
  return nfl.statTotal(pred.prop, line) > pred.line ? 1 : 0;
}

/* ------------------------------------------------------------------ *
 * Suggested parlays, recorded and settled
 * ------------------------------------------------------------------ */

/**
 * Legs the suggester may use: this day's rows on the parlay-eligible props
 * (the model's parlayProps) whose game has not started. A spread pick's
 * team is the side it took; a total's is nobody's.
 *
 * A leg is the projection line and never a rung. The lift factors were
 * measured on slips built from the boards' projection lines, so a
 * 90%-rung leg would be priced by a number that measurement never saw --
 * the mistake `parlayEligible` exists to prevent on the baseball board.
 * Nothing has to be filtered out for that: a row's ladder is a field it
 * carries, and the candidate below takes the line and leaves it behind.
 */
export function parlayCandidates(day, props = ["td"], now = Date.now()) {
  const ok = new Set(props);
  return (day.predictions || [])
    .filter((p) => ok.has(p.prop) && !core.startedAlready(p.kickoff, now) && isFinite(p.prob))
    .map((p) => ({
      key: `${p.gameId}|${p.playerId}|${p.prop}`, playerId: p.playerId, gameId: p.gameId,
      team: p.playerId === "game" ? (p.prop === "spread" ? (p.side === "home" ? p.team : p.opp) : null) : p.team,
      name: p.name, prob: p.prob, prop: p.prop, line: p.line ?? null, side: p.side ?? null,
    }));
}

/**
 * Record what the board would suggest: the slate at 3, 4 and 5 legs and
 * every open game at 3. One row per (scope, game, legs); first wins, so
 * a slip is what was offered when it was first offered.
 */
export function recordSuggestedParlays(day, candidates, lift, now = new Date().toISOString(), tag = "all") {
  day.parlays = day.parlays || [];
  const seen = new Set(day.parlays.map((s) => s.key));
  const wanted = [3, 4, 5].map((legs) => ({ scope: "slate", legs }));
  for (const gameId of [...new Set(candidates.map((c) => c.gameId))]) wanted.push({ scope: "game", gameId, legs: 3 });
  let added = 0;
  for (const w of wanted) {
    /* The tag names the leg set the slip drew on (the first week's slips
       were touchdowns only), so a slip built under a different rule is a
       different row, not a revision of one. */
    const key = `${w.scope}|${w.gameId || "all"}|${w.legs}|${tag}`;
    if (seen.has(key)) continue;
    const out = Parlay.suggestParlay(candidates, { legs: w.legs, scope: w.scope, gameId: w.gameId, lift });
    if (!out) continue;
    day.parlays.push({
      key, scope: w.scope, gameId: w.gameId || null, tag,
      legs: out.legs.map((l) => ({ gameId: l.gameId, playerId: l.playerId, name: l.name, team: l.team, prop: l.prop, prob: l.prob, ...(l.line != null ? { line: l.line } : {}), ...(l.side ? { side: l.side } : {}) })),
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
  const byKey = new Map((day.predictions || []).map((p) => [predKey(p), p]));
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
      const k = `${s.scope}${s.legs.length}|${s.tag || "td"}`;
      const t = out[k] || (out[k] = { scope: s.scope, legs: s.legs.length, tag: s.tag || "td", n: 0, predicted: 0, adjusted: 0, cashed: 0 });
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
  const HIST = path.resolve(DIR, league.recordDir);
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

/**
 * The ladder's own record: per stat, per rung, how often the model said
 * the player would clear it and how often he did.
 *
 * It is kept apart from the per-prop tables because it answers a
 * different question. Those ask whether the projection line was true;
 * this asks whether the model's SHAPE is true -- a model can be right on
 * average and still promise too much at 100 yards and too little at 30,
 * and a rung is where that shows up. A per-rung bias that grows with the
 * rung is a shape error, which this repo has now made in three sports.
 */
export function ladderSummary(dir, M = nfl) {
  /* One graded row becomes one outcome per rung it offered. Nothing extra
     was stored to make this possible: the row already carries the box
     line it was settled against, and a rung is that same line read
     against a different number, by the same `settlePlayer` rule. */
  const rows = [];
  for (const d of core.listDays(dir)) {
    for (const p of core.loadDay(dir, d).predictions) {
      if (!p.ladder || p.actual == null || !p.result) continue;
      for (const [at, prob] of Object.entries(p.ladder)) {
        const rung = Number(at);
        const actual = settlePlayer({ prop: p.prop, line: rung - 0.5 }, p.result);
        if (actual == null || !isFinite(prob)) continue;
        rows.push({ prop: p.prop, rung, prob, actual });
      }
    }
  }
  if (!rows.length) return null;
  const pp = (v) => Math.round(v * 1000) / 10;
  const line = (r) => {
    const e = core.evaluate(r);
    return { n: e.n, predicted: pp(e.meanP), actual: pp(e.meanA), bias: pp(e.bias), brier: Math.round(e.brier * 10000) / 10000 };
  };
  const stats = {};
  for (const stat of Object.keys(M.STATS)) {
    const r = rows.filter((p) => p.prop === stat);
    if (!r.length) continue;
    const rungs = [...new Set(r.map((p) => p.rung))]
      .sort((a, b) => a - b)
      .map((at) => {
        const rr = r.filter((p) => p.rung === at);
        const { brier, ...rest } = line(rr);
        return { rung: at, ...rest };
      });
    stats[stat] = { label: M.STATS[stat].label, ...line(r), rungs };
  }
  return { stats, all: line(rows) };
}

export function report(league, writeRecord) {
  /* resolve, not join: a relative recordDir still hangs off the repo, and
     a test can hand this an absolute directory of its own. */
  const dir = path.resolve(DIR, league.recordDir);
  const out = core.report(dir, propsFor(league.model), {
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
  const ladder = ladderSummary(dir, league.model);
  if (ladder && out) {
    out.ladder = ladder;
    console.log("Ladder rungs, every line the board offers under and over the projection:");
    for (const s of Object.values(ladder.stats)) {
      console.log(
        `  ${s.label}  n=${String(s.n).padStart(5)}  predicted ${s.predicted.toFixed(1)}%  actual ${s.actual.toFixed(1)}%  ` +
          `bias ${s.bias >= 0 ? "+" : ""}${s.bias.toFixed(1)}pp  Brier ${s.brier.toFixed(4)}`,
      );
      for (const r of s.rungs) {
        console.log(
          `    ${String(r.rung + "+").padStart(5)}  n=${String(r.n).padStart(5)}   ` +
            `predicted ${r.predicted.toFixed(1)}%  actual ${r.actual.toFixed(1)}%  ` +
            `${r.bias >= 0 ? "+" : ""}${r.bias.toFixed(1)}pp`,
        );
      }
    }
    console.log(
      `  All rungs  n=${ladder.all.n}  predicted ${ladder.all.predicted.toFixed(1)}%  actual ${ladder.all.actual.toFixed(1)}%  ` +
        `bias ${ladder.all.bias >= 0 ? "+" : ""}${ladder.all.bias.toFixed(1)}pp  Brier ${ladder.all.brier.toFixed(4)}`,
    );
    console.log("\nA bias that grows with the rung is a shape error, not a level error.\n");
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
