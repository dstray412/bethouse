/*
 * BetHouse — enrich-nfl.mjs
 *
 * What the ESPN box score cannot see, per player per game, from nflverse:
 * snap share, target share, air-yards share, red-zone and goal-line
 * touches. The box score is the record of what happened; these are the
 * record of how much of the offence ran through him while it happened,
 * which is what a projection actually wants to know.
 *
 * Three nflverse files, three id systems, one crosswalk:
 *   stats_player_week_<season>.csv   keyed by gsis id  (target_share, air_yards_share ...)
 *   snap_counts_<season>.csv         keyed by pfr id   (offense_pct)
 *   play_by_play_<season>.csv.gz     keyed by gsis id  (yardline_100 per carry / target)
 *   players.csv                      gsis_id, pfr_id, espn_id  -> the join
 * Everything is keyed to ESPN's athlete id on the way out, because that is
 * what nfl-history.json and nfl-data.js carry.
 *
 * The result is a cache, nfl-enrich.json, keyed "season|week|espnId":
 *   { snap, tsh, ays, ay, rzc, rzt, glc }
 * Pure functions here take parsed rows and are tested on fixtures; the
 * loader at the bottom is the only I/O. A player-game with no row in a
 * file has no field for it, and a consumer must treat that as unknown,
 * never as zero: the term it feeds multiplies by one instead.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parseCSV, cached, loadPlayByPlay, maxAgeHoursFor, toEspnTeam } from "./nflverse.mjs";

const RELEASE = "https://github.com/nflverse/nflverse-data/releases/download";
const num = (v) => { const n = Number(v); return v === "" || v == null || !isFinite(n) ? null : n; };
const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
export const enrichKey = (season, week, espnId) => `${season}|${week}|${espnId}`;

/** players.csv rows -> { gsis: Map gsis->espn, pfr: Map pfr->espn }. Rows with no espn id are skipped. */
export function crosswalk(rows) {
  const gsis = new Map(), pfr = new Map();
  for (const r of rows) {
    const espn = String(r.espn_id || "").trim();
    if (!espn) continue;
    if (r.gsis_id) gsis.set(String(r.gsis_id).trim(), espn);
    if (r.pfr_id) pfr.set(String(r.pfr_id).trim(), espn);
  }
  return { gsis, pfr };
}

/** Weekly stat rows (regular season, skill positions) -> entries keyed by season|week|espn: target share, air-yards share, air yards. */
export function weeklyEntries(rows, xw) {
  const out = new Map();
  let matched = 0, seen = 0;
  for (const r of rows) {
    if (r.season_type !== "REG" || !/^(RB|WR|TE|QB|FB)$/.test(r.position)) continue;
    seen++;
    const espn = xw.gsis.get(String(r.player_id || "").trim());
    if (!espn) continue;
    matched++;
    const e = { };
    const tsh = num(r.target_share), ays = num(r.air_yards_share), ay = num(r.receiving_air_yards);
    if (tsh != null) e.tsh = r3(tsh);
    if (ays != null) e.ays = r3(ays);
    if (ay != null) e.ay = ay;
    if (!Object.keys(e).length) continue; // nothing measured: no row, so attach cannot count a hit
    out.set(enrichKey(num(r.season), num(r.week), espn), e);
  }
  return { entries: out, seen, matched };
}

/** Snap-count rows -> entries keyed by season|week|espn: the offensive snap share (0..1). */
export function snapEntries(rows, xw) {
  const out = new Map();
  let matched = 0, seen = 0;
  for (const r of rows) {
    if (r.game_type && r.game_type !== "REG") continue;
    if (!/^(RB|WR|TE|QB|FB)$/.test(r.position)) continue;
    seen++;
    const espn = xw.pfr.get(String(r.pfr_player_id || "").trim());
    if (!espn) continue;
    matched++;
    const pct = num(r.offense_pct);
    if (pct == null) continue;
    out.set(enrichKey(num(r.season), num(r.week), espn), { snap: r3(pct) });
  }
  return { entries: out, seen, matched };
}

/* Red-zone and goal-line touches from the plays. A carry inside the 20
   is a red-zone carry; a target inside the 20 a red-zone target; a carry
   inside the 5 a goal-line carry. A scramble is a carry (nflverse marks
   it pass=1, rush=0, qb_scramble=1 with the rusher set; the box score
   counts it as a rush attempt). A two-point try is neither: the box
   score records no attempt for it, so it is skipped. Precondition: the
   plays are regular-season scrimmage plays, which loadPlayByPlay gives
   by default. Returns the entries and the set of season|week the plays
   covered, so a week the file has not reached yet stays unknown. */
export function playEntries(plays, xw) {
  const out = new Map();
  const weeks = new Set();
  let matched = 0, seen = 0;
  const touch = (season, week, gsis, fields) => {
    seen++;
    const espn = xw.gsis.get(String(gsis || "").trim());
    if (!espn) return;
    matched++;
    const k = enrichKey(season, week, espn);
    const e = out.get(k) || { rzc: 0, rzt: 0, glc: 0 };
    for (const f of fields) e[f]++;
    out.set(k, e);
  };
  for (const p of plays) {
    weeks.add(`${p.season}|${p.week}`);
    if (p.two_point_attempt === 1) continue;
    const yl = num(p.yardline_100);
    if (yl == null || yl > 20) continue;
    const carry = (p.rush === 1 || p.qb_scramble === 1) && p.rusher_player_id;
    if (carry) touch(p.season, p.week, p.rusher_player_id, yl <= 5 ? ["rzc", "glc"] : ["rzc"]);
    else if (p.pass === 1 && p.receiver_player_id) touch(p.season, p.week, p.receiver_player_id, ["rzt"]);
  }
  return { entries: out, seen, matched, weeks };
}

/* A player-game the weekly stats or the snap counts saw is a game he
   played; if the play-by-play covered that week and no play put him
   inside the 20, his red-zone touches are zero, not unknown. A week the
   play-by-play has not reached yet (it can lag the box scores) stays
   unknown, and so does a player-game no file saw. */
export function fillZeroTouches(enrich, coveredWeeks) {
  let filled = 0;
  for (const k of Object.keys(enrich)) {
    const e = enrich[k];
    const [season, week] = k.split("|");
    if (coveredWeeks && !coveredWeeks.has(`${season}|${week}`)) continue;
    if (e.rzc == null && (e.tsh != null || e.snap != null || e.ay != null)) { e.rzc = 0; e.rzt = 0; e.glc = 0; filled++; }
  }
  return filled;
}

/** Merge entry maps by key into one object; later maps add fields, never remove them. */
export function mergeEntries(...maps) {
  const out = {};
  for (const m of maps) for (const [k, e] of m) out[k] = Object.assign(out[k] || {}, e);
  return out;
}

/** Put each game's rows on its players as `p.x`, in place; a player with no row gets no `x`. */
export function attach(games, enrich) {
  let hit = 0, total = 0;
  for (const g of games || []) {
    for (const p of g.players || []) {
      total++;
      const e = enrich && enrich[enrichKey(g.season, g.week, p.id)];
      if (e) { p.x = e; hit++; } else delete p.x;
    }
  }
  return { hit, total };
}

/* A player's usage over his games, for the board: the mean share where a
   share is known, the sum of touches where they are, and how many games
   each was known for. `recent` limits to his last n games (games must be
   in date order, oldest first). Nothing is zero-filled: a mean over no
   games is absent. */
export function usageOf(playerGames, recent) {
  const rows = recent ? playerGames.slice(-recent) : playerGames;
  const acc = { snap: [], tsh: [], ays: [], rzc: 0, rzt: 0, glc: 0, rzN: 0 };
  for (const g of rows) {
    const x = g.x; if (!x) continue;
    if (x.snap != null) acc.snap.push(x.snap);
    if (x.tsh != null) acc.tsh.push(x.tsh);
    if (x.ays != null) acc.ays.push(x.ays);
    if (x.rzc != null || x.rzt != null || x.glc != null) { acc.rzN++; acc.rzc += x.rzc || 0; acc.rzt += x.rzt || 0; acc.glc += x.glc || 0; }
  }
  const mean = (a) => (a.length ? r3(a.reduce((s, v) => s + v, 0) / a.length) : null);
  const out = { n: rows.length };
  if (acc.snap.length) { out.snap = mean(acc.snap); out.snapN = acc.snap.length; }
  if (acc.tsh.length) { out.tsh = mean(acc.tsh); out.tshN = acc.tsh.length; }
  if (acc.ays.length) { out.ays = mean(acc.ays); out.aysN = acc.ays.length; }
  if (acc.rzN) { out.rzc = acc.rzc; out.rzt = acc.rzt; out.glc = acc.glc; out.rzN = acc.rzN; }
  return out;
}

/** Games grouped per player, oldest first: Map espnId -> [{date, x, ...}]. */
export function gamesByPlayer(games) {
  const by = new Map();
  const sorted = [...games].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const g of sorted) for (const p of g.players || []) {
    if (!by.has(p.id)) by.set(p.id, []);
    by.get(p.id).push(p);
  }
  return by;
}

/* ------------------------------------------------------------------ *
 * I/O: build or read the cache.
 * ------------------------------------------------------------------ */
export const ENRICH_FILE = "nfl-enrich.json";

export async function loadCrosswalk() {
  return crosswalk(parseCSV(await cached("players.csv", `${RELEASE}/players/players.csv`, { maxAgeHours: 24 })));
}

/** Build the enrichment for the seasons given, from the three nflverse files, and write the cache. */
export async function buildEnrichment(seasons, opts = {}) {
  const xw = await loadCrosswalk();
  const log = opts.log || console.log;
  const maps = [];
  const report = [];
  const covered = new Set();
  for (const s of seasons) {
    const age = { maxAgeHours: maxAgeHoursFor(s) };
    const weekly = weeklyEntries(parseCSV(await cached(`stats_player_week_${s}.csv`, `${RELEASE}/stats_player/stats_player_week_${s}.csv`, age)), xw);
    let snaps = { entries: new Map(), seen: 0, matched: 0 };
    try {
      snaps = snapEntries(parseCSV(await cached(`snap_counts_${s}.csv`, `${RELEASE}/snap_counts/snap_counts_${s}.csv`, age)), xw);
    } catch (e) { log(`  snap counts ${s}: ${e.message} (skipped)`); }
    const plays = playEntries(await loadPlayByPlay([s], { keep: ["two_point_attempt"] }), xw);
    for (const w of plays.weeks) covered.add(w);
    maps.push(weekly.entries, snaps.entries, plays.entries);
    report.push(`${s}: weekly ${weekly.matched}/${weekly.seen} joined, snaps ${snaps.matched}/${snaps.seen}, red-zone touches ${plays.matched}/${plays.seen}`);
  }
  /* The seasons rebuilt replace their rows; every other season already in
     the cache stays, so a board build for two seasons cannot shrink the
     replay's four. */
  const fresh = mergeEntries(...maps);
  const zeros = fillZeroTouches(fresh, covered);
  const prev = readEnrichment();
  const enrich = {};
  const rebuilt = new Set(seasons.map(String));
  if (prev && prev.enrich) for (const k in prev.enrich) if (!rebuilt.has(k.split("|")[0])) enrich[k] = prev.enrich[k];
  Object.assign(enrich, fresh);
  const kept = prev && prev.seasons ? prev.seasons.filter((x) => !rebuilt.has(String(x))) : [];
  const out = { generated: new Date().toISOString(), seasons: [...new Set([...kept, ...seasons])].sort(), rows: Object.keys(enrich).length, report, enrich };
  writeFileSync(ENRICH_FILE, JSON.stringify(out));
  for (const line of report) log("  " + line);
  log(`  ${zeros} player-games the stats saw with no red-zone touch set to zero touches`);
  log(`  wrote ${ENRICH_FILE}: ${out.rows} player-games`);
  return out;
}

/** The cache, or null when it has not been built. */
export function readEnrichment(file = ENRICH_FILE) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch (e) { return null; }
}

/** The seasons the history cache holds, so a build asks for files that exist. */
export function historySeasons(file = "nfl-history.json") {
  try { return [...new Set(JSON.parse(readFileSync(file, "utf8")).games.map((g) => g.season))].sort(); } catch (e) { return null; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv.indexOf("--seasons");
  const listed = arg >= 0 && process.argv[arg + 1] ? process.argv[arg + 1].split(",").map(Number).filter(Boolean) : null;
  const seasons = listed && listed.length ? listed : historySeasons();
  if (!seasons || !seasons.length) { console.error("no seasons: pass --seasons 2024,2025 or build nfl-history.json first"); process.exit(1); }
  buildEnrichment(seasons).catch((e) => { console.error(e); process.exit(1); });
}
