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
 *   pbp            every play since 1999, gzipped, 372 columns: the play
 *                  call, where the ball went, EPA, and the pass rate the
 *                  situation expected. What a box score cannot see.
 *   ftn_charting   FTN's charting since 2022: play action, RPOs, screens,
 *                  motion, how many rushers came. Joins to pbp on
 *                  game_id + play_id (97.6% of 2024–2026 snaps).
 *
 * WHAT IT IS NOT
 * --------------
 * Not a replacement for the ESPN cache, which carries box scores, the
 * opening line and college. Not wired into any board or record. A history
 * for asking questions, cached under nflverse/ (gitignored, ~70 MB plus
 * 19 MB per season of gzipped play-by-play). tendencies.mjs is what reads
 * the play-by-play.
 *
 * THE ONE TRAP
 * ------------
 * nflverse's spread_line is POSITIVE when the home side is favoured. Ours
 * is negative. `toGame` negates it, and nflverse.test.mjs pins the sign
 * against a game both sources hold. Team codes on the SCHEDULE path are
 * nflverse's (LA, WAS, OAK before 2020) and are not translated: nothing
 * there is joined to ESPN. The play-by-play path is the other way round —
 * `loadPlayByPlay` runs every code through `toEspnTeam`, because those
 * plays are meant to sit next to a board that speaks LAR and WSH.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(DIR, "nflverse");
const RELEASE = "https://github.com/nflverse/nflverse-data/releases/download";

/* ------------------------------------------------------------------ *
 * CSV, with no dependency
 * ------------------------------------------------------------------ */

/**
 * RFC-4180-ish: quoted fields may hold commas, newlines and doubled quotes.
 *
 * `keep` (an array or Set of column names) is a memory door, not a
 * convenience. A season of play-by-play is 372 columns by ~50,000 rows, and
 * building an object with all of them costs about 18 million strings for
 * the forty this repo reads — `desc`, the play's English, being the
 * largest field in the file. With `keep` the parser still walks every
 * character (it must, or a comma inside `desc` would shift every column
 * after it) but never builds the strings it was not asked for.
 */
export function parseCSV(text, keep) {
  const s = String(text || "");
  const wanted = keep == null ? null : (keep instanceof Set ? keep : new Set(keep));
  const out = [];
  let header = null, keepCol = null;
  let cells = [], field = "", quoted = false, col = 0, grab = true;
  // Whether column 0 held anything, kept or not: a one-field row is a
  // blank line unless its one field says something, and that has to be
  // decided even when the first column is not among the kept ones.
  let firstHas = false;

  const endField = () => {
    if (grab) cells[col] = field;
    field = ""; col++;
    grab = keepCol === null || keepCol[col] === true;
  };
  const endRow = () => {
    endField();
    if (header === null) {
      header = cells;
      keepCol = wanted ? header.map((h) => wanted.has(h)) : null;
    } else if (col > 1 || firstHas) {
      const o = {};
      for (let i = 0; i < header.length; i++) {
        if (keepCol && !keepCol[i]) continue;
        o[header[i]] = cells[i] ?? "";
      }
      out.push(o);
    }
    cells = []; col = 0; firstHas = false; grab = keepCol === null || keepCol[0] === true;
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { if (grab) field += '"'; if (col === 0) firstHas = true; i++; }
        else quoted = false;
      } else { if (grab) field += c; if (col === 0) firstHas = true; }
    } else if (c === '"') quoted = true;
    else if (c === ",") endField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      endRow();
    } else { if (grab) field += c; if (col === 0) firstHas = true; }
  }
  if (col > 0 || field.length) endRow();
  return out;
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

/**
 * The cached file's contents, downloading it first if it is not there.
 * `binary` keeps the bytes as they arrived, which is what the gzipped
 * play-by-play releases need: `res.text()` would mangle them.
 */
/**
 * How old a cached release file may be before it is fetched again. A
 * finished season never changes; the season under way grows every week,
 * and a cache that is restored between CI runs (the NFL refresh carries
 * nflverse/ the way it carries the box scores) would otherwise freeze the
 * in-progress play-by-play at whichever week was first downloaded.
 */
export function maxAgeHoursFor(season, now = new Date()) {
  return Number(season) >= now.getUTCFullYear() ? 12 : Infinity;
}

/** Is a file whose mtime is `mtimeMs` older than `maxAgeHours`? */
export function isStale(mtimeMs, maxAgeHours, nowMs = Date.now()) {
  if (!(maxAgeHours < Infinity)) return false;
  return nowMs - mtimeMs > maxAgeHours * 3600 * 1000;
}

export async function cached(name, url, opts = {}) {
  mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, name);
  if (existsSync(f) && opts.maxAgeHours != null && isStale(statSync(f).mtimeMs, opts.maxAgeHours)) {
    process.stdout.write(`  ${name} is older than ${opts.maxAgeHours}h, `);
    unlinkSync(f);
  }
  if (!existsSync(f)) {
    process.stdout.write(`  fetching ${name} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const body = opts.binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
    writeFileSync(f, body);
    console.log(`${Math.round(body.length / 1e6 * 10) / 10} MB`);
  }
  return opts.binary ? readFileSync(f) : readFileSync(f, "utf8");
}

/** A gzipped cache file as text. Exported so the gz path is testable offline. */
export function gunzipFile(file) {
  return gunzipSync(readFileSync(file)).toString("utf8");
}

/**
 * A gzipped release file's text. The .gz is what stays on disk: 2 MB
 * instead of 11 for the 2026 play-by-play so far, 19 MB instead of ~120 for
 * a finished season. Decompressing on every load costs a second or two and
 * saves a hundred megabytes per season.
 */
export async function cachedGz(name, url, opts = {}) {
  await cached(name, url, { ...opts, binary: true });
  return gunzipFile(path.join(CACHE, name));
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

/**
 * Weekly player stats, skill positions, regular season:
 * {season, week, team, opp, id, name, pos, carries, targets, recs, recYds, rushYds, tds}.
 * The touchdown and yards models' inputs, per player per game, since 1999.
 */
export async function loadWeeklyStats(seasons) {
  const out = [];
  for (const s of seasons) {
    const rows = parseCSV(await cached(`stats_player_week_${s}.csv`, `${RELEASE}/stats_player/stats_player_week_${s}.csv`));
    for (const r of rows) {
      if (r.season_type !== "REG" || !/^(RB|WR|TE|QB|FB)$/.test(r.position)) continue;
      out.push({
        season: num(r.season), week: num(r.week), team: r.team, opp: r.opponent_team, id: r.player_id,
        name: r.player_display_name || r.player_name || "", pos: r.position,
        carries: num(r.carries) || 0, targets: num(r.targets) || 0, recs: num(r.receptions) || 0,
        recYds: num(r.receiving_yards) || 0, rushYds: num(r.rushing_yards) || 0,
        tds: (num(r.rushing_tds) || 0) + (num(r.receiving_tds) || 0),
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
 * Play-by-play, and the FTN charting that joins to it
 *
 * `loadPlayByPlay` is the one place in this repo that translates team
 * codes. nflverse writes LA and WAS; ESPN — and therefore every cache,
 * board and record here — writes LAR and WSH. The other thirty agree.
 * `loadGames` above deliberately does NOT translate, because nothing is
 * joined to ESPN on that path; these plays are meant to be.
 * ------------------------------------------------------------------ */

const ESPN_TEAM = { LA: "LAR", WAS: "WSH" };

/** An nflverse team code in ESPN's spelling. Measured against nfl-history.json. */
export const toEspnTeam = (code) => ESPN_TEAM[code] || code || "";

/* The forty columns the tendencies work reads, out of 372. Anything else a
   caller wants comes in through `keep`. */
export const PBP_COLUMNS = [
  "game_id", "play_id", "season", "week", "season_type", "posteam", "defteam", "play_type",
  "yards_gained", "shotgun", "no_huddle", "qb_dropback", "qb_kneel", "qb_spike", "qb_scramble",
  "pass_length", "pass_location", "air_yards", "yards_after_catch", "run_location", "run_gap",
  "down", "ydstogo", "yardline_100", "score_differential", "game_seconds_remaining",
  "epa", "success", "pass", "rush", "sack", "qb_hit", "complete_pass", "incomplete_pass",
  "interception", "fumble_lost", "touchdown", "xpass", "pass_oe", "cpoe", "wp", "vegas_wp",
  "spread_line", "total_line", "passer_player_id", "rusher_player_id", "receiver_player_id",
  "aborted_play", "special",
];

const PBP_NUM = new Set([
  "play_id", "season", "week", "yards_gained", "shotgun", "no_huddle", "qb_dropback",
  "qb_kneel", "qb_spike", "qb_scramble", "air_yards", "yards_after_catch", "down", "ydstogo",
  "yardline_100", "score_differential", "game_seconds_remaining", "epa", "success",
  "pass", "rush", "sack", "qb_hit", "complete_pass", "incomplete_pass", "interception",
  "fumble_lost", "touchdown", "xpass", "pass_oe", "cpoe", "wp", "vegas_wp",
  "spread_line", "total_line", "aborted_play", "special",
]);

/**
 * Is this a snap from scrimmage that a play-call profile should count?
 *
 * `play_type` in (pass, run) already drops kickoffs, punts, kicks, kneels,
 * spikes and the GAME / END QUARTER markers. It also drops `no_play` — 567
 * rows in 2026 weeks 1–2 — where a penalty wiped the snap out and
 * yards_gained, epa and success describe the penalty rather than the call.
 *
 * The second clause is the important one. nflverse sets `pass` on sacks AND
 * on scrambles, which carry play_type "run" with rush=0. Reading `rush` or
 * `play_type` alone would file 149 scrambles (2026 weeks 1–2) as designed
 * runs. `qb_dropback` would be the obvious flag instead, but it is 0 on ten
 * of those 149, so `pass` is the one that counts snaps correctly.
 */
export function isScrimmage(p) {
  return (p.play_type === "pass" || p.play_type === "run")
    && (p.pass === 1 || p.rush === 1)
    && p.aborted_play !== 1 && p.special !== 1 && p.qb_kneel !== 1 && p.qb_spike !== 1;
}

/** Parsed play-by-play rows → plays: numbers coerced, team codes translated. */
export function toPlays(rows, opts = {}) {
  const out = [];
  for (const r of rows) {
    if (!opts.postseason && r.season_type !== "REG") continue;
    if (!r.posteam) continue;
    const p = {};
    for (const k in r) p[k] = PBP_NUM.has(k) ? num(r[k]) : r[k];
    p.posteam = toEspnTeam(p.posteam);
    p.defteam = toEspnTeam(p.defteam);
    if (opts.scrimmageOnly !== false && !isScrimmage(p)) continue;
    out.push(p);
  }
  return out;
}

/**
 * Regular-season plays from scrimmage for the given seasons.
 *   loadPlayByPlay([2024, 2025, 2026])
 *   loadPlayByPlay([2026], { keep: ["desc"], scrimmageOnly: false })
 */
export async function loadPlayByPlay(seasons, opts = {}) {
  const keep = new Set(PBP_COLUMNS);
  for (const k of opts.keep || []) keep.add(k);
  const out = [];
  for (const s of seasons) {
    const text = await cachedGz(`play_by_play_${s}.csv.gz`, `${RELEASE}/pbp/play_by_play_${s}.csv.gz`, { maxAgeHours: maxAgeHoursFor(s) });
    for (const p of toPlays(parseCSV(text, keep), opts)) out.push(p);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * FTN charting
 *
 * What the box score cannot see: play action, RPOs, screens, motion, how
 * many rushers came. Plain CSV, not gzipped, ~8 MB a season, 2022 onward.
 * The join is nflverse_game_id + nflverse_play_id against pbp's game_id +
 * play_id; both are the same "2026_01_NE_SEA" / 64 pair, and `main` below
 * reports the join rate rather than assuming it.
 * ------------------------------------------------------------------ */

/** The key a play and its charting row meet on. */
export const ftnKey = (gameId, playId) => `${gameId}|${Number(playId)}`;

const bool = (v) => (v === "TRUE" || v === "1" ? true : v === "FALSE" || v === "0" ? false : null);

const FTN_BOOL = [
  "is_no_huddle", "is_motion", "is_play_action", "is_screen_pass", "is_rpo", "is_trick_play",
  "is_qb_out_of_pocket", "is_interception_worthy", "is_throw_away", "is_catchable_ball",
  "is_contested_ball", "is_created_reception", "is_drop", "is_qb_sneak", "is_qb_fault_sack",
];
const FTN_NUM = ["n_offense_backfield", "n_defense_box", "n_blitzers", "n_pass_rushers", "read_thrown"];
const FTN_TEXT = ["starting_hash", "qb_location"];

export const FTN_COLUMNS = [
  "nflverse_game_id", "nflverse_play_id", "season", "week",
  ...FTN_BOOL, ...FTN_NUM, ...FTN_TEXT,
];

/** Parsed charting rows → Map keyed by ftnKey. */
export function toFtnMap(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!r.nflverse_game_id || r.nflverse_play_id === "") continue;
    const o = { season: num(r.season), week: num(r.week) };
    for (const k of FTN_BOOL) o[k] = bool(r[k]);
    for (const k of FTN_NUM) o[k] = num(r[k]);
    for (const k of FTN_TEXT) o[k] = r[k] || "";
    m.set(ftnKey(r.nflverse_game_id, r.nflverse_play_id), o);
  }
  return m;
}

/** FTN charting for the given seasons, keyed so a play can look itself up. */
export async function loadFtnCharting(seasons) {
  const m = new Map();
  for (const s of seasons) {
    const text = await cached(`ftn_charting_${s}.csv`, `${RELEASE}/ftn_charting/ftn_charting_${s}.csv`, { maxAgeHours: maxAgeHoursFor(s) });
    for (const [k, v] of toFtnMap(parseCSV(text, new Set(FTN_COLUMNS)))) m.set(k, v);
  }
  return m;
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

  /* Play-by-play and charting are reported, not fetched: a season of
     play-by-play is 19 MB gzipped and nothing here needs 27 of them.
     `node tendencies.mjs` pulls the seasons it actually reads. */
  const have = (re) => (existsSync(CACHE) ? readdirSync(CACHE) : []).filter((f) => re.test(f)).sort();
  const mb = (f) => Math.round(statSync(path.join(CACHE, f)).size / 1e5) / 10;
  const show = (label, files, hint) => {
    if (!files.length) return console.log(`${label}: nothing cached — ${hint}`);
    console.log(`${label}: ${files.length} cached, ${files.map((f) => `${f.match(/(\d{4})/)[1]} ${mb(f)} MB`).join(", ")}`);
  };
  show("play-by-play", have(/^play_by_play_\d{4}\.csv\.gz$/), "node tendencies.mjs fetches what it reads");
  show("ftn charting", have(/^ftn_charting_\d{4}\.csv$/), "2022 onward, ~8 MB a season");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
