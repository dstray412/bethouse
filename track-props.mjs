#!/usr/bin/env node
/*
 * BetHouse — track-props.mjs
 * Prop picks at a book's price: logged, closed, graded and reported.
 *
 *   node track-props.mjs log      log today's picks and refresh the close on open ones
 *   node track-props.mjs grade    settle picks whose games are final (ESPN box scores)
 *   node track-props.mjs report   print the record; --write-record also emits nfl-props-record.js
 *
 * The forward record's other half. track-nfl.mjs asks whether the
 * board's chances were true; this asks whether the gap between the
 * board and a book is worth anything, which only money can answer.
 *
 * THE RULES
 *   1. A pick is the side the gap favours when the gap is MIN_GAP points
 *      or more (props.js quote), logged once per player, prop and book:
 *      the first one wins, as everywhere else on this site.
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
import { NFL } from "./football-leagues.mjs";
import { boxScoreLines } from "./track-football.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const REC_DIR = "nfl-props-record", REC_FILE = "nfl-props-record.js", REC_GLOBAL = "BetHouseNFLPropsRecord";
const r4 = (v) => (v == null ? null : Math.round(v * 1e4) / 1e4);

export const pickKey = (p) => `${p.gameId}|${p.playerId}|${p.stat}|${p.book}`;
export const weekFile = (season, week) => `${season}-w${String(week).padStart(2, "0")}.json`;

/**
 * Log this run's picks into the week's record and refresh the close on
 * the ones still open. Pure: the record goes in and comes back changed,
 * with what was added and closed counted.
 */
export function logPicks(record, payload, D, M = nfl, now = Date.now()) {
  const picks = record.picks || (record.picks = []);
  const seen = new Map(picks.map((p) => [pickKey(p), p]));
  const games = new Map(((D && D.games) || []).map((g) => [String(g.id), g]));
  const players = new Map(((D && D.players) || []).map((p) => [String(p.id), p]));
  let added = 0, closed = 0;
  const offers = (payload && payload.offers) || {};
  /* A price is acted on only while it is fresh, and only against the board it was fetched beside: an old price next to a projection rebuilt after news reads as a gap that is not there, and the first pick wins for good. */
  if (payload && payload.offers) {
    const got = Date.parse(payload.fetched);
    if (!(now - got <= P.MAX_PICK_AGE)) return { added, closed, stale: "prices" };
    if (D && D.generated && Date.parse(D.generated) > got) return { added, closed, stale: "board" };
  }
  for (const playerId of Object.keys(offers)) {
    const p = players.get(playerId);
    if (!p) continue;
    for (const stat of Object.keys(offers[playerId])) {
      for (const book of Object.keys(offers[playerId][stat])) {
        const o = offers[playerId][stat][book], g = games.get(String(o.g));
        if (!g || !(Date.parse(g.date) > now)) continue;       // rule 2: pregame only
        const key = pickKey({ gameId: String(g.id), playerId, stat, book });
        const had = seen.get(key);
        if (had) {
          /* Rule 3: the last look before kickoff is the close. */
          had.close = { line: o.line, over: o.over, under: o.under, at: payload.fetched };
          closed++;
          continue;
        }
        const q = P.quote(M, D, p, { stat, book, line: o.line, over: o.over, under: o.under });
        if (!q || !q.log) continue;
        const pick = {
          gameId: String(g.id), playerId, name: p.name, team: p.team, opp: p.opp || null,
          stat, side: q.side, book, line: q.line, price: q.price, decimal: r4(P.decimal(q.price)),
          fair: r4(q.fair), site: r4(q.site), gap: Math.round(q.gap * 10) / 10,
          ...(q.oneSided ? { oneSided: true } : {}),
          at: payload.fetched, source: payload.source, kickoff: g.date,
          /* The close starts as the pick's own look, so a pick made on the last run before kickoff still has one. */
          close: { line: o.line, over: o.over, under: o.under, at: payload.fetched },
        };
        picks.push(pick); seen.set(key, pick); added++;
      }
    }
  }
  return { added, closed };
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
  const days = picks.map((p) => String(p.at || "").slice(0, 10)).filter(Boolean).sort();
  return { total: all ? all.n : 0, open: records.flatMap((r) => r.picks || []).filter((p) => !p.outcome).length, since: days[0] || null, minGap: P.MIN_GAP, all, markets };
}

/* ------------------------------ files ------------------------------ */

function readGlobal(file, name) {
  const f = path.join(DIR, file);
  if (!fs.existsSync(f)) return null;
  const w = {};
  new Function("window", fs.readFileSync(f, "utf8"))(w);
  return w[name] || null;
}
const recPath = (name) => path.join(DIR, REC_DIR, name);
const listRecords = () => (fs.existsSync(path.join(DIR, REC_DIR)) ? fs.readdirSync(path.join(DIR, REC_DIR)).filter((f) => /^\d{4}-w\d\d\.json$/.test(f)).sort() : []);
const load = (name) => JSON.parse(fs.readFileSync(recPath(name), "utf8"));
/* One pick a line: readable in a diff, and a week of picks stays well under the 1 MB pre-commit ceiling. */
export const serialise = (rec) => `{"season":${JSON.stringify(rec.season ?? null)},"week":${JSON.stringify(rec.week ?? null)},"picks":[\n${(rec.picks || []).map((p) => JSON.stringify(p)).join(",\n")}\n]}\n`;
const save = (name, rec) => { fs.mkdirSync(path.join(DIR, REC_DIR), { recursive: true }); fs.writeFileSync(recPath(name), serialise(rec)); };

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
  if (cmd === "log") {
    const D = readGlobal("nfl-data.js", "BetHouseNFLData"), payload = readGlobal("nfl-props.js", "BetHouseNFLProps");
    if (!D) throw new Error("no nfl-data.js");
    if (!payload || !payload.offers) { console.log("no nfl-props.js: nothing to log."); return; }
    /* A file from an earlier week prices players the board has since re-projected. */
    if (payload.season !== D.season || payload.week !== D.week) { console.log(`nfl-props.js is week ${payload.week}, the board is week ${D.week}: nothing logged.`); return; }
    const name = weekFile(D.season, D.week);
    const rec = fs.existsSync(recPath(name)) ? load(name) : { season: D.season, week: D.week, picks: [] };
    const { added, closed, stale } = logPicks(rec, payload, D);
    if (added || closed) save(name, rec);
    console.log(stale ? `${name}: nothing logged, the ${stale === "board" ? "board was rebuilt after the prices were fetched" : "prices are more than 90 minutes old"} (fetched ${payload.fetched})`
      : `${name}: ${added} picks logged, ${closed} closes refreshed, ${rec.picks.length} on file`);
  } else if (cmd === "grade") {
    let total = 0;
    for (const name of listRecords()) {
      const rec = load(name);
      const ids = [...new Set(rec.picks.filter((p) => !p.outcome && Date.parse(p.kickoff) < Date.now()).map((p) => String(p.gameId)))];
      let graded = 0;
      for (const id of ids) {
        if (!/^\d+$/.test(id)) continue;
        let summary;
        try { summary = await get(`${NFL.site}/summary?event=${id}`); } catch (e) { console.log(`  ${id}: ${e.message}`); continue; }
        if (!summary?.header?.competitions?.[0]?.status?.type?.completed) continue;
        const lines = boxScoreLines(summary);
        /* An empty or one-sided box score on a final game is a feed that has not caught up, not a slate of voids. */
        if (!lines.size || !boxComplete(summary)) continue;
        graded += gradeGame(rec, id, lines);
      }
      if (graded) save(name, rec);
      total += graded;
    }
    console.log(`${total} picks graded`);
  } else if (cmd === "report") {
    const R = reportOf(listRecords().map(load));
    console.log(JSON.stringify(R, null, 1));
    if (args.includes("--write-record")) {
      fs.writeFileSync(path.join(DIR, REC_FILE), `/* Written by track-props.mjs: prop picks at a book's price, settled for money. */\nwindow.${REC_GLOBAL} = ${JSON.stringify(R)};\n`);
      console.log(`wrote ${REC_FILE}`);
    }
  } else {
    console.error("usage: node track-props.mjs log | grade | report [--write-record]");
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv[2], process.argv.slice(3)).catch((e) => { console.error(e.message); process.exit(1); });
}
