#!/usr/bin/env node
/*
 * BetHouse — nflverse.mjs
 * A second NFL history: nflverse-data (github.com/nflverse/nflverse-data,
 * CC-BY-4.0), read into the same game shape the football model already
 * uses, so the backtests can run over 27 seasons instead of two.
 *
 *   node nflverse.mjs                 # download what is missing, report what is cached
 *   node nflverse.mjs --seasons 2009-2025
 *
 * WHY
 * ---
 * Every game-line question this repo asked in 2026-09 came back "inside
 * the noise" because two seasons is 480 games and separating a break-even
 * model from a coin flip needs about 1,700. The ESPN cache also has no
 * weather and no injury history. nflverse publishes, as plain CSV files on
 * GitHub releases with no key:
 *
 *   schedules      every game since 1999 with the closing spread, total,
 *                  moneylines, spread juice, roof, temperature and wind
 *   injuries       the weekly injury report since 2009, per player, with
 *                  report status and practice status
 *   depth_charts   the weekly depth chart since 2001, so "the starter" is
 *                  the depth chart's word and not a guess from stats
 *
 * WHAT IT IS NOT
 * --------------
 * Not a replacement for the ESPN cache, which carries box scores, the
 * opening line and college. Not wired into any board or record. A history
 * for asking questions, cached under nflverse/ (gitignored, ~70 MB).
 *
 * THE ONE TRAP
 * ------------
 * nflverse's spread_line is POSITIVE when the home side is favoured. Ours
 * is negative. `toGame` negates it, and nflverse.test.mjs pins the sign
 * against a game both sources hold. Team codes are nflverse's (LA, WAS,
 * OAK before 2020) and are not translated: nothing here is joined to ESPN.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(DIR, "nflverse");
const RELEASE = "https://github.com/nflverse/nflverse-data/releases/download";

/* ------------------------------------------------------------------ *
 * CSV, with no dependency
 * ------------------------------------------------------------------ */

/** RFC-4180-ish: quoted fields may hold commas, newlines and doubled quotes. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];
  const header = rows[0];
  return rows.slice(1).filter((r) => r.length > 1 || (r.length === 1 && r[0] !== "")).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i] ?? ""; });
    return o;
  });
}

const num = (v) => { const n = Number(v); return v === "" || v == null || !isFinite(n) ? null : n; };

/* ------------------------------------------------------------------ *
 * Schedules → games
 * ------------------------------------------------------------------ */

/** One schedules row → our game shape. null for a game without a score. */
export function toGame(r) {
  const hs = num(r.home_score), as = num(r.away_score);
  if (hs == null || as == null) return null;
  const spreadLine = num(r.spread_line);
  const g = {
    id: r.game_id,
    season: num(r.season),
    week: num(r.week),
    type: r.game_type,
    date: `${r.gameday}T${r.gametime || "00:00"}`,
    home: { team: r.home_team, score: hs },
    away: { team: r.away_team, score: as },
    spread: spreadLine == null ? null : -spreadLine, // nflverse: + = home favoured; ours: - = home favoured
    total: num(r.total_line),
    homeML: num(r.home_moneyline),
    awayML: num(r.away_moneyline),
    homeSpreadOdds: num(r.home_spread_odds),
    awaySpreadOdds: num(r.away_spread_odds),
    roof: r.roof || null,
    temp: num(r.temp),
    wind: num(r.wind),
    players: [],
  };
  if (/neutral/i.test(r.location || "")) g.neutral = true;
  return g;
}

export function rowsToGames(rows, opts = {}) {
  return rows
    .filter((r) => opts.playoffs || r.game_type === "REG")
    .map(toGame)
    .filter(Boolean)
    .sort((a, b) => a.season - b.season || a.week - b.week || a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ *
 * Download and cache
 * ------------------------------------------------------------------ */

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** The cached file's text, downloading it first if it is not there. */
export async function cached(name, url) {
  mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, name);
  if (!existsSync(f)) {
    process.stdout.write(`  fetching ${name} ... `);
    const text = await fetchText(url);
    writeFileSync(f, text);
    console.log(`${Math.round(text.length / 1e6 * 10) / 10} MB`);
  }
  return readFileSync(f, "utf8");
}

export async function loadGames(opts) {
  return rowsToGames(parseCSV(await cached("games.csv", `${RELEASE}/schedules/games.csv`)), opts);
}

/** Weekly injury reports: {season, week, team, id, name, pos, status, practice}. */
export async function loadInjuries(seasons) {
  const out = [];
  for (const s of seasons) {
    const rows = parseCSV(await cached(`injuries_${s}.csv`, `${RELEASE}/injuries/injuries_${s}.csv`));
    for (const r of rows) {
      if (r.game_type !== "REG") continue;
      out.push({
        season: num(r.season), week: num(r.week), team: r.team, id: r.gsis_id,
        name: r.full_name, pos: r.position, status: r.report_status || "", practice: r.practice_status || "",
      });
    }
  }
  return out;
}

/** Weekly depth charts, starters only: {season, week, team, id, name, pos}. */
export async function loadStarters(seasons) {
  const out = [];
  for (const s of seasons) {
    const rows = parseCSV(await cached(`depth_charts_${s}.csv`, `${RELEASE}/depth_charts/depth_charts_${s}.csv`));
    for (const r of rows) {
      if (r.game_type !== "REG" || r.depth_team !== "1") continue;
      out.push({ season: num(r.season), week: num(r.week), team: r.club_code, id: r.gsis_id, name: r.full_name, pos: r.position });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Main: fill the cache and say what is in it
 * ------------------------------------------------------------------ */

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--seasons");
  const [from, to] = i >= 0 ? String(args[i + 1]).split("-").map(Number) : [2009, 2025];
  const seasons = []; for (let s = from; s <= (to || from); s++) seasons.push(s);
  const games = await loadGames();
  const byS = {}; for (const g of games) byS[g.season] = (byS[g.season] || 0) + 1;
  const lined = games.filter((g) => g.spread != null && g.total != null);
  console.log(`games: ${games.length} regular-season, ${Object.keys(byS)[0]}–${Object.keys(byS).at(-1)}, ${lined.length} with a spread and total, ` +
    `${games.filter((g) => g.wind != null).length} with wind`);
  const inj = await loadInjuries(seasons);
  console.log(`injuries: ${inj.length} report rows, ${seasons[0]}–${seasons.at(-1)}`);
  const st = await loadStarters(seasons);
  console.log(`starters: ${st.length} depth-chart starters, ${st.filter((x) => x.pos === "QB").length} at QB`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
