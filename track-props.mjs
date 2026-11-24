#!/usr/bin/env node
/*
 * BetHouse — track-props.mjs
 * Prop picks at a book's price: logged, closed, graded and reported.
 *
 *   node track-props.mjs log      log today's picks and refresh the close on open ones
 *   node track-props.mjs grade    settle picks whose games are final (ESPN box scores)
 *   node track-props.mjs report   print the record; --write-record also emits nfl-props-record.js
 *   … --league nba                the NBA board's, into nba-props-record/ (props-leagues.mjs)
 *
 * The forward record's other half. track-nfl.mjs asks whether the
 * board's chances were true; this asks whether the gap between the
 * board and a book is worth anything, which only money can answer.
 *
 * THE RULES
 *   1. A pick is the side the gap favours when the gap is MIN_GAP points
 *      or more (props.js quote), logged once per player and prop at the
 *      book a unit expects most from: the first one wins, as everywhere
 *      else on this site, and the other book never becomes a second pick.
 *   2. It is logged only for a game that has not kicked off, at the line
 *      and price on file, and graded at that line and price forever.
 *   3. The close is this site's own last look before kickoff at the same
 *      book: each `log` run before kickoff overwrites it, and the first
 *      run after kickoff leaves it alone. A pick the feed never showed
 *      again has no close and is in none of the closing-line figures.
 *   4. No price, no pick. A player with no line in the box score is a
 *      void (returned stake, counted nowhere); a stat landing on a
 *      whole-number line is a push.
 *
 * One file a week in nfl-props-record/, holding picks only: the record
 * never keeps a line it did not act on (fetch-props.mjs says why).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import P from "./props.js";
import nfl from "./nfl.js";
import { PROPS_LEAGUES, propsLeague } from "./props-leagues.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const r4 = (v) => (v == null ? null : Math.round(v * 1e4) / 1e4);

/* One pick a player and prop, whichever book: two books on one prop are one bet (2026-11-24). */
export const pickKey = (p) => `${p.gameId}|${p.playerId}|${p.stat}`;
export const weekFile = (season, week) => PROPS_LEAGUES.nfl.recName({ season, week });

/**
 * Log this run's picks into the week's record and refresh the close on
 * the ones still open. Pure: the record goes in and comes back changed,
 * with what was added and closed counted.
 */
export function logPicks(record, payload, D, M = nfl, now = Date.now(), opts = {}) {
  const picks = record.picks || (record.picks = []);
  const games = new Map(((D && D.games) || []).map((g) => [String(g.id), g]));
  const players = new Map(((D && D.players) || []).map((p) => [String(p.id), p]));
  let added = 0, closed = 0, merged = 0;
  const offers = (payload && payload.offers) || {};
  /* A price is acted on only while it is fresh, and only against the board it was fetched beside: an old price next to a projection rebuilt after news reads as a gap that is not there, and the first pick wins for good. */
  if (payload && payload.offers) {
    const got = Date.parse(payload.fetched);
    if (!(now - got <= P.MAX_PICK_AGE)) return { added, closed, stale: "prices" };
    if (D && D.generated && Date.parse(D.generated) > got) return { added, closed, stale: "board" };
  }
  const returnOf = (p) => (Number.isFinite(p.site) && Number.isFinite(p.decimal) ? p.site * (p.decimal - 1) - (1 - p.site) : -Infinity);
  /* Picks from before the one-a-prop rule: where two books hold the same player and prop in a game still to come, the better-priced one stays. A game that has kicked off is history and is left as recorded. */
  const best = new Map();
  for (const p of picks) {
    if (p.outcome || !(Date.parse(p.kickoff) > now)) continue;
    const k = pickKey(p), had = best.get(k);
    if (!had || returnOf(p) > returnOf(had)) best.set(k, p);
  }
  for (let i = picks.length - 1; i >= 0; i--) {
    const p = picks[i];
    if (p.outcome || !(Date.parse(p.kickoff) > now)) continue;
    if (best.get(pickKey(p)) !== p) { picks.splice(i, 1); merged++; }
  }
  const seen = new Map(picks.map((p) => [pickKey(p), p]));
  const cuts = P.cutsOf(payload);
  const roleFor = (p) => {
    const r = typeof opts.roleOf === "function" ? opts.roleOf(p) : null, moved = P.roleMoved(r);
    return r && moved != null ? { season: r.season, recent: r.recent, moved } : null;
  };
  for (const playerId of Object.keys(offers)) {
    const p = players.get(playerId);
    if (!p) continue;
    for (const stat of Object.keys(offers[playerId])) {
      const books = offers[playerId][stat];
      const live = Object.keys(books).filter((b) => { const g = games.get(String(books[b].g)); return g && Date.parse(g.date) > now; });   // rule 2: pregame only
      if (!live.length) continue;
      const g = games.get(String(books[live[0]].g));
      const had = seen.get(pickKey({ gameId: String(g.id), playerId, stat }));
      if (had) {
        /* Rule 3: the last look before kickoff, at the pick's own book, is the close. */
        const o = books[had.book];
        if (o && live.indexOf(had.book) >= 0) { had.close = { line: o.line, over: o.over, under: o.under, at: payload.fetched }; closed++; }
        if (!had.role) { const role = roleFor(p); if (role) had.role = role; }
        continue;
      }
      /* One pick a player and prop: of the books whose gap clears the bar, the one a unit expects most from. */
      let pickOf = null;
      for (const book of live) {
        const o = books[book];
        const q = P.quote(M, D, p, { stat, book, line: o.line, over: o.over, under: o.under, ...(Number.isFinite(cuts[book]) ? { cut: cuts[book] } : {}) });
        if (q && q.log && (!pickOf || q.ev > pickOf.q.ev)) pickOf = { q, o, book };
      }
      if (!pickOf) continue;
      const { q, o, book } = pickOf, role = roleFor(p);
      const pick = {
        gameId: String(g.id), playerId, name: p.name, team: p.team, opp: p.opp || null,
        stat, side: q.side, book, line: q.line, price: q.price, decimal: r4(P.decimal(q.price)),
        fair: r4(q.fair), site: r4(q.site), gap: Math.round(q.gap * 10) / 10,
        ...(q.oneSided ? { oneSided: true, cut: r4(q.cut) } : {}),
        /* His role when the pick was made, so the record can say whether the losses are the model missing a change of role. */
        ...(role ? { role } : {}),
        at: payload.fetched, source: payload.source, kickoff: g.date,
        /* The close starts as the pick's own look, so a pick made on the last run before kickoff still has one. */
        close: { line: o.line, over: o.over, under: o.under, at: payload.fetched },
      };
      picks.push(pick); seen.set(pickKey(pick), pick); added++;
    }
  }
  return { added, closed, merged };
}

/** A box-score line's value of a prop, the way the board counts it. */
export function valueOf(stat, line, M = nfl) {
  if (!line || !line.played) return null;
  return stat === "td" ? (line.td > 0 ? 1 : 0) : M.STATS[stat] ? M.statTotal(stat, line) : null;
}

/** Whether a final game's box score has players on both sides: a feed that has caught up on one team would void the other's picks for good. */
export function boxComplete(summary) {
  const sides = (summary && summary.boxscore && summary.boxscore.players) || [];
  return sides.length >= 2 && sides.every((s) => (s.statistics || []).some((b) => (b.athletes || []).length > 0));
}

/** Settle one final game's picks from its box-score lines. Pure. */
export function gradeGame(record, gameId, lines, M = nfl) {
  let graded = 0;
  for (const p of record.picks || []) {
    if (String(p.gameId) !== String(gameId) || p.outcome) continue;
    const value = valueOf(p.stat, lines.get(String(p.playerId)), M);
    const g = P.grade(p, value);
    p.outcome = g.outcome; p.units = g.units;
    if (value != null) p.result = value;
    const move = P.closeMove(p, p.close);
    if (move) { p.clvPts = move.pts; p.clvProb = move.prob; }
    /* Minutes between the close and the start: the last look is only the closing line if it was close to it. */
    const lead = p.close ? Math.round((Date.parse(p.kickoff) - Date.parse(p.close.at)) / 60000) : NaN;
    if (Number.isFinite(lead)) p.closeLead = lead;
    graded++;
  }
  return graded;
}

/** The record the page prints: one summary a market, and all of them together. Pure. */
export function reportOf(records, M = nfl) {
  const picks = records.flatMap((r) => r.picks || []).filter((p) => p.outcome);
  const label = (stat) => (stat === "td" ? "Anytime touchdown" : M.STATS[stat] ? M.STATS[stat].label : stat);
  const markets = {};
  for (const stat of ["td"].concat(Object.keys(M.STATS))) {
    const s = P.summarise(picks.filter((p) => p.stat === stat));
    if (s) markets[stat] = Object.assign({ label: label(stat) }, s);
  }
  const all = P.summarise(picks);
  /* The same picks by the size of the gap and by whether the role had moved: where the losses come from, so a cap can be set from data. */
  const gaps = {}, roles = {};
  for (const b of ["5-10", "10-20", "20+"]) { const s2 = P.summarise(picks.filter((p) => Number.isFinite(p.gap) && P.gapBucket(p.gap) === b)); if (s2) gaps[b] = s2; }
  for (const [k, f] of [["moved", (p) => p.role && p.role.moved === true], ["steady", (p) => p.role && p.role.moved === false], ["unknown", (p) => !p.role]]) { const s2 = P.summarise(picks.filter(f)); if (s2) roles[k] = s2; }
  const days = picks.map((p) => String(p.at || "").slice(0, 10)).filter(Boolean).sort();
  return { total: all ? all.n : 0, open: records.flatMap((r) => r.picks || []).filter((p) => !p.outcome).length, since: days[0] || null, minGap: P.MIN_GAP, all, markets, gaps, roles };
}

/* ------------------------------ files ------------------------------ */

function readGlobal(file, name) {
  const f = path.join(DIR, file);
  if (!fs.existsSync(f)) return null;
  const w = {};
  new Function("window", fs.readFileSync(f, "utf8"))(w);
  return w[name] || null;
}
/* One pick a line: readable in a diff, and a slate of picks stays well under the 1 MB pre-commit ceiling. */
export const serialise = (rec) => {
  const { picks, ...head } = rec;
  const open = JSON.stringify(head).slice(0, -1);
  return `${open}${open.length > 1 ? "," : ""}"picks":[\n${(picks || []).map((p) => JSON.stringify(p)).join(",\n")}\n]}\n`;
};
const files = (league) => {
  const dir = path.join(DIR, league.recDir), at = (name) => path.join(dir, name);
  return {
    at,
    /* A week of football (2026-w12) or a night of basketball (2026-11-24). */
    list: () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d{4}-(w\d\d|\d\d-\d\d)\.json$/.test(f)).sort() : []),
    load: (name) => JSON.parse(fs.readFileSync(at(name), "utf8")),
    save: (name, rec) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(at(name), serialise(rec)); },
  };
};

async function get(url) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (a === 2) throw e;
      await new Promise((r) => setTimeout(r, 400 * (a + 1)));
    }
  }
}

async function run(cmd, args) {
  const league = propsLeague(args), M = league.model, F = files(league);
  if (cmd === "log") {
    const D = readGlobal(league.dataFile, league.dataGlobal), payload = readGlobal(league.out, league.global);
    if (!D) throw new Error(`no ${league.dataFile}`);
    if (!payload || !payload.offers) { console.log(`no ${league.out}: nothing to log.`); return; }
    /* A file from another slate prices players the board has since re-projected. */
    if (P.slateOf(payload) == null || P.slateOf(payload) !== P.slateOf(D)) { console.log(`${league.out} is for ${P.slateOf(payload)}, the board is ${P.slateOf(D)}: nothing logged.`); return; }
    const name = league.recName(D);
    const rec = fs.existsSync(F.at(name)) ? F.load(name) : { season: D.season, ...(D.week != null ? { week: D.week } : { date: D.date }), picks: [] };
    const { added, closed, merged, stale } = logPicks(rec, payload, D, M, Date.now(), { roleOf: league.roleOf });
    if (added || closed || merged) F.save(name, rec);
    console.log(stale ? `${name}: nothing logged, the ${stale === "board" ? "board was rebuilt after the prices were fetched" : "prices are more than 90 minutes old"} (fetched ${payload.fetched})`
      : `${name}: ${added} picks logged, ${closed} closes refreshed${merged ? `, ${merged} second-book picks merged away` : ""}, ${rec.picks.length} on file`);
  } else if (cmd === "grade") {
    let total = 0;
    for (const name of F.list()) {
      const rec = F.load(name);
      const ids = [...new Set(rec.picks.filter((p) => !p.outcome && Date.parse(p.kickoff) < Date.now()).map((p) => String(p.gameId)))];
      let graded = 0;
      for (const id of ids) {
        if (!/^\d+$/.test(id)) continue;
        let summary;
        try { summary = await get(`${league.site}/summary?event=${id}`); } catch (e) { console.log(`  ${id}: ${e.message}`); continue; }
        if (!summary?.header?.competitions?.[0]?.status?.type?.completed) continue;
        const lines = league.boxScoreLines(summary);
        /* An empty or one-sided box score on a final game is a feed that has not caught up, not a slate of voids. */
        if (!lines.size || !boxComplete(summary)) continue;
        graded += gradeGame(rec, id, lines, M);
      }
      if (graded) F.save(name, rec);
      total += graded;
    }
    console.log(`${total} picks graded`);
  } else if (cmd === "report") {
    const R = reportOf(F.list().map(F.load), M);
    console.log(JSON.stringify(R, null, 1));
    if (args.includes("--write-record")) {
      fs.writeFileSync(path.join(DIR, league.recFile), `/* Written by track-props.mjs: prop picks at a book's price, settled for money. */\nwindow.${league.recGlobal} = ${JSON.stringify(R)};\n`);
      console.log(`wrote ${league.recFile}`);
    }
  } else {
    console.error("usage: node track-props.mjs log | grade | report [--write-record] [--league nfl|nba]");
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv[2], process.argv.slice(3)).catch((e) => { console.error(e.message); process.exit(1); });
}
