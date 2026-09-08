#!/usr/bin/env node
/*
 * BetHouse — cfbfastr.mjs
 * Twenty seasons of college football with closing lines, from
 * sportsdataverse/cfbfastR-data (no key, CSV in the repo tree), read into
 * the game shape the football model already uses.
 *
 *   node cfbfastr.mjs            # download what is missing, report what is cached
 *
 * WHY
 * ---
 * The college line questions -- does the model's disagreement with the
 * close mean anything, does the high-total under persist, is a side simply
 * winning -- came back "leaning positive, inside the noise" on two seasons.
 * The NFL got twenty-seven from nflverse and the answers changed. This is
 * the college equivalent: schedules since 2001 with scores, divisions and
 * neutral sites, and a table of lines since 2006 from a dozen books.
 *
 * THE SHAPE OF THE LINES TABLE, AND HOW IT IS READ
 * -------------------------------------------------
 * One row per game, market, side and book: "UTH −1.5 −117 at 5Dimes". It
 * does not say which side is home. But an abbreviation appears with its
 * own team id in every game it plays and with an opponent's id only once,
 * so the mapping is counted out of the table (`abbrToTeam`) rather than
 * typed. The home side's spread is then read directly: it is already
 * home-relative in our sign (negative = home favoured). Pinnacle's number
 * is taken when it is there, because it is the sharpest book in the table;
 * otherwise the median across books. The opening line is kept where the
 * table has it.
 *
 * FCS opponents are pooled under one code from the schedule's own division
 * field, the same treatment the ESPN cache gives them.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "./nflverse.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(DIR, "cfbfastr");
const RAW = "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main";
const PREFERRED = ["PINNACLE", "bet365", "5Dimes & sportbet", "BetCRIS & BOOKMAKER"];

const num = (v) => { const n = Number(v); return v === "" || v == null || !isFinite(n) ? null : n; };

/** Abbreviation → team id, by the id it keeps co-occurring with. */
export function abbrToTeam(rows) {
  const counts = new Map();
  for (const r of rows) {
    if (!r.abbr) continue;
    for (const id of [r.home_team_id, r.away_team_id]) {
      const k = `${r.abbr}|${id}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  const best = new Map();
  for (const [k, n] of counts) {
    const [abbr, id] = k.split("|");
    if (!best.has(abbr) || n > best.get(abbr).n) best.set(abbr, { id, n });
  }
  return new Map([...best].map(([abbr, { id }]) => [abbr, id]));
}

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Per game: {spread, total, homeML, awayML, book, open?}. */
export function closingLines(rows, abbr) {
  const byGame = new Map();
  for (const r of rows) {
    if (!byGame.has(r.game_id)) byGame.set(r.game_id, []);
    byGame.get(r.game_id).push(r);
  }
  const out = new Map();
  for (const [gid, rs] of byGame) {
    const home = rs[0].home_team_id, away = rs[0].away_team_id;
    const side = (r) => (abbr.get(r.abbr) === home ? "home" : abbr.get(r.abbr) === away ? "away" : null);
    const spreads = rs.filter((r) => r.market_type === "spread" && side(r) === "home" && num(r.lines) != null);
    const totals = rs.filter((r) => r.market_type === "total" && num(r.lines) != null);
    if (!spreads.length && !totals.length) continue;
    const pick = (list) => {
      for (const b of PREFERRED) { const hit = list.find((r) => r.book === b); if (hit) return { rows: [hit], book: b }; }
      return { rows: list, book: `median of ${new Set(list.map((r) => r.book)).size}` };
    };
    const g = { spread: null, total: null, homeML: null, awayML: null, book: null };
    if (spreads.length) { const p = pick(spreads); g.spread = median(p.rows.map((r) => num(r.lines))); g.book = p.book;
      const opens = p.rows.map((r) => num(r.opening_lines)).filter((x) => x != null); if (opens.length) g.open = { spread: median(opens) }; }
    if (totals.length) { const p = pick(totals); g.total = median(p.rows.map((r) => num(r.lines))); g.book = g.book || p.book;
      const opens = p.rows.map((r) => num(r.opening_lines)).filter((x) => x != null); if (opens.length) g.open = Object.assign(g.open || {}, { total: median(opens) }); }
    const ml = rs.filter((r) => r.market_type === "money_line" && num(r.odds) != null);
    for (const s of ["home", "away"]) {
      const list = ml.filter((r) => side(r) === s);
      if (list.length) { const p = pick(list); g[s === "home" ? "homeML" : "awayML"] = median(p.rows.map((r) => num(r.odds))); }
    }
    out.set(gid, g);
  }
  return out;
}

/** Schedule row plus its line → our game shape. Regular season, played, only. */
export function toGame(r, line) {
  if (r.season_type !== "regular") return null;
  const hs = num(r.home_points), as = num(r.away_points);
  if (hs == null || as == null) return null;
  const code = (name, div) => (/fbs/i.test(div || "") ? name : "FCS");
  const g = {
    id: String(r.game_id), season: num(r.season), week: num(r.week), date: r.start_date || "",
    home: { team: code(r.home_team, r.home_division), id: r.home_id, score: hs },
    away: { team: code(r.away_team, r.away_division), id: r.away_id, score: as },
    spread: line ? line.spread : null, total: line ? line.total : null,
    homeML: line ? line.homeML : null, awayML: line ? line.awayML : null,
    book: line ? line.book : null, players: [],
  };
  if (line && line.open) g.open = line.open;
  if (/true/i.test(r.neutral_site || "")) g.neutral = true;
  return g;
}

/* ------------------------------------------------------------------ *
 * Download and cache
 * ------------------------------------------------------------------ */

async function cached(name, url, gz) {
  mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, name);
  if (!existsSync(f)) {
    process.stdout.write(`  fetching ${name} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const text = gz ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
    writeFileSync(f, text);
    console.log(`${Math.round(text.length / 1e6 * 10) / 10} MB`);
  }
  return readFileSync(f, "utf8");
}

export async function loadGames(seasons) {
  const lineRows = parseCSV(await cached("cfb_line_odds.csv", `${RAW}/betting/csv/cfb_line_odds.csv.gz`, true));
  const abbr = abbrToTeam(lineRows);
  const lines = closingLines(lineRows, abbr);
  const games = [];
  for (const s of seasons) {
    const rows = parseCSV(await cached(`cfb_schedules_${s}.csv`, `${RAW}/schedules/csv/cfb_schedules_${s}.csv`));
    for (const r of rows) {
      if (!/fbs/i.test(r.home_division || "") && !/fbs/i.test(r.away_division || "")) continue;
      const g = toGame(r, lines.get(String(r.game_id)) || null);
      if (g) games.push(g);
    }
  }
  return games.sort((a, b) => a.season - b.season || a.week - b.week || a.date.localeCompare(b.date));
}

async function main() {
  const seasons = []; for (let s = 2006; s <= 2025; s++) seasons.push(s);
  const games = await loadGames(seasons);
  const lined = games.filter((g) => g.spread != null);
  const byS = {}; for (const g of lined) byS[g.season] = (byS[g.season] || 0) + 1;
  console.log(`games: ${games.length} FBS regular-season, ${lined.length} with a closing spread, ${games.filter((g) => g.total != null).length} with a total`);
  console.log(`per season with a spread: ${Object.entries(byS).map(([s, n]) => `${s}:${n}`).join(" ")}`);
  const books = {}; for (const g of lined) books[g.book] = (books[g.book] || 0) + 1;
  console.log(`books: ${Object.entries(books).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([b, n]) => `${b} ${n}`).join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
