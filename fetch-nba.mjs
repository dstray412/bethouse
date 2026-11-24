#!/usr/bin/env node
/*
 * BetHouse — fetch-nba.mjs
 * ESPN's NBA API → `nba-history.json` (the box-score cache) and
 * `nba-data.js` (tonight's board).
 *
 *   node fetch-nba.mjs                  # refresh the cache, then build the board
 *   node fetch-nba.mjs --history        # cache only
 *   node fetch-nba.mjs --seasons 2026,2027
 *
 * No key, no account. A season is named the way ESPN names it, by the
 * year it ends in: 2026-27 is 2027.
 *
 * WHY THIS IS NOT fetch-football.mjs
 * ----------------------------------
 * The football fetcher is built around a week: eighteen of them, one
 * scoreboard request each, a board that changes on Tuesday. Basketball
 * has a slate a night, a box score with one block instead of three, and
 * minutes where football has touches. What is NOT league-shaped is
 * shared rather than copied: the injury report parser and the roster
 * walk are fetch-football.mjs's, the pools are nfl.js's through nba.js.
 *
 * WHAT A WARM RUN COSTS
 * ---------------------
 * The scoreboard's calendar lists every date of a season with a game on
 * it, so the cache knows which dates it has not finished: one request for
 * the calendar, one per unfinished date (usually yesterday and today),
 * one per game that went final since. A cold start is about 230 dates and
 * 1,300 games a season.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import nba from "./nba.js";
import { parseInjuries, notActive, fetchRosters } from "./fetch-football.mjs";

export const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

/* What is league-shaped, in the shape football-leagues.mjs gives the NFL, so the shared roster walk and the shared tracker read either. */
export const NBA = {
  id: "nba",
  label: "NBA",
  site: SITE,
  injuriesUrl: `${SITE}/injuries`,
  teamsUrl: `${SITE}/teams?limit=40`,
  rosterUrl: (teamId) => `${SITE}/teams/${teamId}/roster`,
  model: nba,
  fetcher: "fetch-nba.mjs",
  tracker: "track-nba.mjs",
  historyFile: "nba-history.json",
  dataFile: "nba-data.js",
  dataGlobal: "BetHouseNBAData",
  recordDir: "nba-record",
  recordFile: "nba-record.js",
  recordGlobal: "BETHOUSE_NBA_RECORD",
  recentGames: 10,
  /* For the shared tracker (track-football.mjs): a final game's lines by athlete id, and what a graded row keeps of one. */
  boxScoreLines: (summary) => new Map(((parseGame(summary) || {}).players || []).map((p) => [p.id, { ...p, played: true }])),
  resultOf: (line) => ({ min: line.min, pts: line.pts, reb: line.reb, ast: line.ast, tpm: line.tpm }),
};

/* -------------------------------------------------------------------- *
 * Network
 * -------------------------------------------------------------------- */

async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
}

const num = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return isFinite(n) ? n : 0;
};

/* -------------------------------------------------------------------- *
 * Parsing
 * -------------------------------------------------------------------- */

/** "4-9" → [4, 9]: ESPN writes made and attempted as one string. */
const pair = (v) => {
  const [m, a] = String(v ?? "").split("-");
  return [num(m), num(a)];
};

/**
 * One summary payload → a compact game record.
 *
 * A line per player who logged a minute. The bench that did not play is
 * not carried: a did-not-play is the absence of a line, and every count
 * the model makes (games, minutes) is of games he was on the floor for.
 * Stats are read by ESPN's key, never by column.
 */
export function parseGame(summary) {
  const header = summary?.header;
  const comp = header?.competitions?.[0];
  if (!comp) return null;
  const home = (comp.competitors || []).find((c) => c.homeAway === "home");
  const away = (comp.competitors || []).find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const players = [];
  for (const side of summary.boxscore?.players || []) {
    const team = side.team?.abbreviation || "";
    for (const block of side.statistics || []) {
      const keys = block.keys || [];
      for (const a of block.athletes || []) {
        const id = String(a?.athlete?.id ?? "");
        if (!id || a.didNotPlay || !(a.stats || []).length) continue;
        const s = {};
        keys.forEach((k, i) => { s[k] = a.stats[i]; });
        const min = num(s.minutes);
        if (!(min > 0)) continue;
        const [tpm, tpa] = pair(s["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]);
        const [, fga] = pair(s["fieldGoalsMade-fieldGoalsAttempted"]);
        const [, fta] = pair(s["freeThrowsMade-freeThrowsAttempted"]);
        const pos = a.athlete.position?.abbreviation;
        players.push({
          id, name: a.athlete.displayName || a.athlete.shortName || "", team,
          ...(pos ? { pos } : {}),
          st: a.starter ? 1 : 0,
          min, pts: num(s.points), reb: num(s.rebounds), ast: num(s.assists),
          tpm, tpa, fga, fta, stl: num(s.steals), blk: num(s.blocks), to: num(s.turnovers),
        });
      }
    }
  }

  const game = {
    id: String(header.id ?? comp.id),
    season: header.season?.year ?? null,
    type: header.season?.type ?? null,
    date: comp.date || "",
    home: { team: home.team?.abbreviation || "", score: num(home.score) },
    away: { team: away.team?.abbreviation || "", score: num(away.score) },
    players,
  };
  if (comp.neutralSite) game.neutral = true;
  return game;
}

/** One scoreboard event → the row the schedule and the board read. Team codes are the feed's own abbreviations. */
export function parseScheduleEvent(e) {
  const comp = e?.competitions?.[0];
  const cs = comp?.competitors || [];
  const home = cs.find((c) => c.homeAway === "home");
  const away = cs.find((c) => c.homeAway === "away");
  const row = {
    id: String(e?.id ?? ""),
    date: e?.date || "",
    season: e?.season?.year ?? null,
    type: e?.season?.type ?? null,
    kind: comp?.type?.abbreviation || "",
    completed: !!e?.status?.type?.completed,
    state: e?.status?.type?.state || "",
    name: e?.name || "",
    home: home?.team?.abbreviation || null,
    away: away?.team?.abbreviation || null,
  };
  if (comp?.neutralSite) row.neutral = true;
  if (home?.team?.id != null) row.homeId = String(home.team.id);
  if (away?.team?.id != null) row.awayId = String(away.team.id);
  if (comp?.venue?.fullName) row.venue = String(comp.venue.fullName);
  return row;
}

/* ESPN's season types: 1 preseason, 2 regular season, 3 playoffs, 5 play-in. */
const REAL = new Set([2, 3, 5]);

/**
 * A game the cache and the board want: the regular season, the play-in
 * and the playoffs, between two teams. The All-Star games sit inside the
 * regular season with a type of their own and rosters that are nobody's
 * team; the preseason is not basketball anyone prices.
 */
export function wanted(row) {
  /* An event id goes into a request url, so it is digits or the game is not one (the security review, 2026-11-23). */
  return !!(row && /^\d+$/.test(String(row.id)) && row.home && row.away && REAL.has(Number(row.type)) && row.kind !== "ALLSTAR");
}

/** Every date with a game on it, YYYYMMDD in order, off a scoreboard payload's calendar (a whitelist of days stamped at the league's midnight). */
export function calendarDates(payload) {
  const out = new Set();
  for (const d of payload?.leagues?.[0]?.calendar || []) {
    const m = /^(\d{4})-(\d\d)-(\d\d)T/.exec(String(d));
    if (m) out.add(m[1] + m[2] + m[3]);
  }
  return [...out].sort();
}

/**
 * The league's day, YYYYMMDD: the Eastern date, turning over at 6am so a
 * tip at 10:30pm Pacific belongs to the night it started and the small
 * hours still show the slate that is finishing. ESPN's scoreboard dates
 * are this day, not UTC's.
 */
export function slateDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(now.getTime() - 6 * 3600 * 1000));
  const get = (t) => parts.find((p) => p.type === t).value;
  return get("year") + get("month") + get("day");
}

/* -------------------------------------------------------------------- *
 * Collection
 * -------------------------------------------------------------------- */

export const HISTORY_FILE = NBA.historyFile;

function loadHistory() {
  if (!existsSync(HISTORY_FILE)) return { games: [], done: {} };
  try {
    const h = JSON.parse(readFileSync(HISTORY_FILE, "utf8"));
    if (!Array.isArray(h.games)) h.games = [];
    if (!h.done || typeof h.done !== "object") h.done = {};
    return h;
  } catch {
    return { games: [], done: {} };
  }
}

/**
 * A final game whose summary still has no box score three days on: ESPN
 * does not have one (eight 2026 playoff games, found 2026-11-23), and
 * asking again every run would keep its date open for ever. Yesterday's
 * may only be late.
 */
export function gaveUp(game, now = new Date()) {
  const t = Date.parse(game && game.date);
  return isFinite(t) && now.getTime() - t > 3 * 24 * 3600 * 1000;
}

/** The day's wanted games, off the scoreboard. */
export async function daySchedule(day) {
  const d = await getJSON(`${SITE}/scoreboard?dates=${day}`);
  return (d.events || []).map(parseScheduleEvent).filter(wanted);
}

/** A date inside each season, to ask the scoreboard for that season's calendar. */
const seasonProbe = (season) => `${season - 1}1115`;

/**
 * Bring the cache up to date for these seasons. `history.done[season]`
 * lists the dates whose games are all cached, so a warm run asks only
 * about the dates still open and never past today's.
 */
export async function refreshHistory(seasons, now = new Date()) {
  const history = loadHistory();
  /* `missing` are the finals ESPN has no box score for (gaveUp): settled, with nothing to cache. */
  const have = new Set([...history.games.map((g) => g.id), ...(history.missing || [])]);
  const today = slateDay(now);
  const todo = [];
  const pending = []; // [season, day, ids]: a day is done once every final game on it is cached

  for (const season of seasons) {
    const dates = calendarDates(await getJSON(`${SITE}/scoreboard?dates=${seasonProbe(season)}`)).filter((d) => d <= today);
    const done = new Set(history.done[season] || []);
    const open = dates.filter((d) => !done.has(d));
    const BATCH = 8;
    for (let i = 0; i < open.length; i += BATCH) {
      const chunk = open.slice(i, i + BATCH);
      const got = await Promise.all(chunk.map((d) => daySchedule(d).catch(() => null)));
      got.forEach((sched, j) => {
        if (!sched) return; // a failed day stays open for the next run
        for (const g of sched) if (g.completed && !have.has(g.id)) todo.push(g);
        /* Closed only when the day is over and nothing on it is still to play. */
        if (chunk[j] < today && sched.every((g) => g.completed)) pending.push([season, chunk[j], sched.map((g) => g.id)]);
      });
      process.stdout.write(`\r  ${season}: ${Math.min(i + BATCH, open.length)}/${open.length} open dates scanned   `);
    }
    if (open.length) process.stdout.write("\n");
  }
  console.log(`cached ${have.size} games, ${todo.length} to fetch`);

  const BATCH = 6;
  let done = 0, failed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    /* A request that failed is not a game without a box score: `answered` is whether ESPN replied at all, and only a reply with no lines in it can be given up on (the code review, 2026-11-23: a timeout on a cold start would have dropped the game for good). */
    const got = await Promise.all(chunk.map((g) => getJSON(`${SITE}/summary?event=${g.id}`).then((s) => ({ answered: true, game: parseGame(s) })).catch(() => ({ answered: false, game: null }))));
    got.forEach(({ answered, game: g }, j) => {
      if (g && g.players.length) {
        /* The scoreboard's word on what kind of game it was: the summary's header carries the season type but not always the play-in's. */
        g.type = chunk[j].type ?? g.type; g.season = chunk[j].season ?? g.season;
        history.games.push(g); have.add(g.id);
      } else if (answered && gaveUp(chunk[j], now)) {
        (history.missing = history.missing || []).push(chunk[j].id); have.add(chunk[j].id);
        console.log(`\n  ${chunk[j].id} (${chunk[j].name}, ${String(chunk[j].date).slice(0, 10)}): no box score at ESPN; not asked for again`);
      } else failed++;
    });
    done += chunk.length;
    process.stdout.write(`\r  games: ${done}/${todo.length}   `);
    /* A cold start is thousands of requests: keep what has landed, so a dropped connection costs the tail and not the run. */
    if (done % 600 === 0) writeFileSync(HISTORY_FILE, JSON.stringify(history) + "\n");
  }
  if (todo.length) process.stdout.write("\n");
  if (failed) console.log(`  WARNING: ${failed} games failed to fetch; their dates stay open`);

  for (const [season, day, ids] of pending) {
    if (!ids.every((id) => have.has(id))) continue;
    (history.done[season] = history.done[season] || []).push(day);
  }
  for (const s of Object.keys(history.done)) history.done[s] = [...new Set(history.done[s])].sort();
  history.games.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  history.seasons = [...new Set([...(history.seasons || []), ...seasons])].sort();
  writeFileSync(HISTORY_FILE, JSON.stringify(history) + "\n");
  console.log(`wrote ${HISTORY_FILE}: ${history.games.length} games, ${history.games.reduce((n, g) => n + g.players.length, 0)} player-games`);
  return history;
}

/* -------------------------------------------------------------------- *
 * Season lines, the walk, the pools
 *
 * What the board and the replay share by being here: neither can count a
 * rebound, weigh a defence or fill a pool differently from the other.
 * -------------------------------------------------------------------- */

/* A team's allowance is regressed toward the league's by this many games of league average, as the football factors are. */
const TEAM_K = 6;

/**
 * Season-to-date player records and what each defence allows, from a
 * set of games. A record is his totals, the team of his latest game,
 * the date of it (`last`) and `slog`, the per-game log oldest first
 * (nba.js logRow), whatever order the games arrive in.
 */
export function seasonLines(games, model) {
  const STAT_IDS = Object.keys(model.STATS);
  const players = new Map();
  const allowedBy = Object.fromEntries(STAT_IDS.map((s) => [s, new Map()]));
  const leagueStat = Object.fromEntries(STAT_IDS.map((s) => [s, 0]));
  const teamGames = new Map();
  const ordered = [...games].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const g of ordered) {
    for (const p of g.players) {
      const opp = model.opponentIn(g, p);
      if (opp) {
        for (const stat of STAT_IDS) {
          const v = model.gameValue(stat, p);
          allowedBy[stat].set(opp, (allowedBy[stat].get(opp) || 0) + v);
          leagueStat[stat] += v;
        }
      }
      let r = players.get(p.id);
      if (!r) { r = { id: p.id, name: p.name, team: p.team, games: 0, min: 0, pts: 0, reb: 0, ast: 0, tpm: 0, slog: [] }; players.set(p.id, r); }
      r.team = p.team; r.name = p.name || r.name; r.last = g.date;
      if (p.pos) r.pos = p.pos;
      const row = model.logRow(p);
      r.games++; r.min += row[0]; r.pts += row[1]; r.reb += row[2]; r.ast += row[3]; r.tpm += row[4];
      r.slog.push(row);
    }
    for (const t of [g.home.team, g.away.team]) teamGames.set(t, (teamGames.get(t) || 0) + 1);
  }
  const teamGameCount = Math.max(1, [...teamGames.values()].reduce((a, b) => a + b, 0));
  const factorOf = (map, t, league) => {
    const n = teamGames.get(t) || 0;
    if (!n || !league) return 1;
    return ((map.get(t) || 0) + league * TEAM_K) / ((n + TEAM_K) * league);
  };
  const teamFactors = {};
  for (const t of teamGames.keys()) {
    teamFactors[t] = { allow: Object.fromEntries(STAT_IDS.map((s) => [s, Number(factorOf(allowedBy[s], t, leagueStat[s] / teamGameCount).toFixed(4))])) };
  }
  return { players, teamFactors };
}

/** What a projection is told about the game: the opponent's allowance of the stat, and whether he is at home (null on a neutral floor). */
export function contextFor(model, teamFactors, game, p, stat) {
  const opp = model.opponentIn(game, p);
  return { oppFactor: opp ? model.allowOf(teamFactors, opp, stat) : null, home: game.neutral ? null : p.team === game.home.team };
}

/**
 * The slates in order, each with the lines as they stood before it:
 * every earlier game from that season and the one before, which is the
 * board's own window. `from` (YYYYMMDD) skips the days before it without
 * changing what a later day sees. Yields {day, season, games, lines}.
 */
export function* walk(games, model, opts = {}) {
  const ordered = [...games].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const days = [];
  for (const g of ordered) {
    const day = slateDay(new Date(g.date));
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, games: [] });
    days[days.length - 1].games.push(g);
  }
  const prior = [];
  for (const d of days) {
    if (!opts.from || d.day >= opts.from) {
      const season = Math.max(...d.games.map((g) => Number(g.season) || 0));
      yield { day: d.day, season, games: d.games, lines: seasonLines(prior.filter((g) => g.season >= season - 1), model) };
    }
    for (const g of d.games) prior.push(g);
  }
}

/**
 * One game's entries for a stat's pool: actual over the projection made
 * before it, for every player with three games on file whose own line
 * is at the pool's floor. Membership is his level; the ratio is against
 * the whole projection, opponent included, so the pool is the shape of
 * what the projection does not explain. Against the line as it stood
 * BEFORE the game: a ratio taken against a season line that already
 * holds the game is narrower than anything the board will ever face.
 */
export function poolEntries(stat, game, lines, model) {
  const floor = model.DEFAULTS[model.STATS[stat].poolFloorKey];
  const out = [];
  for (const p of game.players) {
    const rec = lines.players.get(p.id);
    if (!rec || rec.games < 3) continue;
    const y = model.projectedStat(stat, rec, null, contextFor(model, lines.teamFactors, game, p, stat));
    if (y && y.base >= floor && y.exp > 0) out.push({ exp: y.exp, ratio: model.gameValue(stat, p) / y.exp });
  }
  return out;
}

/* -------------------------------------------------------------------- *
 * The board
 * -------------------------------------------------------------------- */

/** The first day with a game still to tip, from [day, games] pairs in order; with none, the last day that had games at all (the night that just finished), else null. */
export function pickSlate(days) {
  let last = null;
  for (const [day, games] of days || []) {
    if (!games || !games.length) continue;
    if (games.some((g) => !g.completed && g.state === "pre")) return { day, games };
    last = { day, games };
  }
  return last;
}

/* A player absent from more than this many of his team's games running is not in its rotation today, whatever his season line says. */
const ABSENT = 5;
/* The pools are the most recent poolKeep games of each prop, about fourteen a game for the thinnest (assists), so the walk that fills them starts this many games back: across the summer if it has to, as the replay's pools do. */
const POOL_GAMES = 450;

/**
 * Everything the page needs for one slate, from the cache and what the
 * network said (the slate, and when there are any the rosters and the
 * injury report). Pure: the fetching is buildBoard's.
 *
 * WHO IS ON IT. A player whose team plays tonight, where the roster
 * says he is today, with five games on file and a rotation's minutes;
 * the model's gate decides which props he gets. Left off: a player on
 * no roster, and one absent from more than five of his team's games
 * running (hurt all year, out of the rotation): his season line is
 * about someone he is not at the moment, and he comes back onto the
 * board the day after he comes back onto the floor.
 *
 * THE POOLS are filled by the same walk the replay prices off
 * (poolEntries: actual over the projection made BEFORE each game), so
 * what the board reads an over off is what backtest-nba.mjs measured.
 */
export function boardPayload({ history, slate, day, model, now = new Date(), roster = null, injuries = null }) {
  const games = history.games || [];
  const season = seasonOf(now);
  const current = games.filter((g) => g.season >= season - 1);
  const { players, teamFactors } = seasonLines(current, model);
  const STAT_IDS = Object.keys(model.STATS);

  const pools = {};
  {
    const entries = Object.fromEntries(STAT_IDS.map((s) => [s, []]));
    const ordered = [...games].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const from = ordered.length ? slateDay(new Date(ordered[Math.max(0, ordered.length - POOL_GAMES)].date)) : day;
    for (const d of walk(ordered, model, { from })) {
      for (const stat of STAT_IDS) for (const g of d.games) for (const e of poolEntries(stat, g, d.lines, model)) entries[stat].push(e);
    }
    const keep = model.DEFAULTS.poolKeep;
    const round = (a, n) => a.map((x) => Number(x.toFixed(n)));
    for (const stat of STAT_IDS) {
      const e = entries[stat].slice(-keep);
      const pool = model.sortedPool(e.map((x) => x.exp), e.map((x) => x.ratio), stat);
      pools[stat] = { stat, exp: round(pool.exp, 1), ratio: round(pool.ratio, 3) };
    }
  }

  const open = (slate || []).filter((g) => g.home && g.away);
  const gameOf = {};
  for (const g of open) { gameOf[g.home] = g; gameOf[g.away] = g; }

  /* Each team's game dates, newest first, to count the games a player has missed since his last. */
  const teamDates = new Map();
  for (const g of current) for (const t of [g.home.team, g.away.team]) { if (!teamDates.has(t)) teamDates.set(t, []); teamDates.get(t).push(g.date); }
  for (const list of teamDates.values()) list.sort().reverse();
  const missed = (p) => (teamDates.get(p.team) || []).filter((d) => d > (p.last || "")).length;

  /* The last few lines per player, newest first, for the drawer. */
  const recent = new Map();
  for (const g of [...current].sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
    for (const p of g.players) {
      const list = recent.get(p.id) || [];
      if (list.length >= NBA.recentGames) continue;
      const opp = model.opponentIn(g, p);
      if (!opp) continue;
      /* The league's day, not UTC's: a 10pm Eastern tip is tomorrow in UTC and was printed a day late. */
      list.push(model.recentRow(slateDay(new Date(g.date)), p, opp));
      recent.set(p.id, list);
    }
  }

  const placed = model.applyRosters([...players.values()], roster);
  const lastPlayed = new Map([...players.values()].map((p) => [p.id, p.last]));
  const listed = notActive(injuries || {}, roster, lastPlayed);
  const rows = [];
  for (const p of placed.players) {
    const g = gameOf[p.team];
    if (!g) continue;
    if (!(p.games >= model.DEFAULTS.minGames) || !(p.min / p.games >= 10)) continue;
    /* A moved player's last game was for another team: his new team's games since are not ones he missed. */
    if (!p.movedFrom && missed(p) > ABSENT) continue;
    const on = roster && roster.get(String(p.id));
    const inj = listed[p.id];
    const w = model.weightedStatTotals(p);
    const rec = recent.get(p.id);
    rows.push({
      id: p.id, name: p.name, team: p.team,
      ...((on && on.pos) || p.pos ? { pos: (on && on.pos) || p.pos } : {}),
      games: p.games, min: p.min, pts: p.pts, reb: p.reb, ast: p.ast, tpm: p.tpm,
      opp: p.team === g.home ? g.away : g.home,
      home: g.neutral ? null : p.team === g.home,
      ...(p.movedFrom ? { movedFrom: p.movedFrom } : {}),
      ...(inj ? { status: inj.status, ...(inj.detail ? { injury: inj.detail } : {}) } : {}),
      ...(rec && rec.length ? { recent: rec } : {}),
      ...(w ? { w } : {}),
    });
  }

  return {
    generated: now.toISOString(),
    /* The terms this build ran with (nba.js terms): the record stamps them on every row, and the page drops the weighted totals if its model script disagrees. */
    model: { terms: model.terms() },
    season,
    date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`,
    statsSeasons: [...new Set(current.map((g) => Number(g.season)))].sort(),
    games: open.map((g) => ({
      id: g.id, date: g.date, name: g.name, completed: !!g.completed, home: g.home, away: g.away,
      ...(g.neutral ? { neutral: true } : {}),
      ...(g.homeId ? { homeId: g.homeId } : {}), ...(g.awayId ? { awayId: g.awayId } : {}),
      ...(g.venue ? { venue: g.venue } : {}),
    })),
    teamFactors,
    players: rows,
    injuriesAt: injuries ? now.toISOString() : null,
    pools,
    seasonsCached: history.seasons || [],
    gamesCached: games.length,
  };
}

export async function buildBoard(history, now = new Date()) {
  const model = NBA.model;
  const today = slateDay(now);
  /* Today, or the next day with a game still to tip: the calendar says which days have games at all. */
  const first = await getJSON(`${SITE}/scoreboard?dates=${today}`);
  const ahead = calendarDates(first).filter((d) => d > today).slice(0, 10);
  const days = [[today, (first.events || []).map(parseScheduleEvent).filter(wanted)]];
  let picked = pickSlate(days);
  for (const d of ahead) {
    if (picked && picked.games.some((g) => !g.completed && g.state === "pre")) break;
    days.push([d, await daySchedule(d)]);
    picked = pickSlate(days);
  }
  const day = picked ? picked.day : today, slate = picked ? picked.games : [];
  console.log(`\nbuilding board: ${day} (${slate.length} games)`);

  let roster = null, injuries = null;
  if (slate.length) {
    roster = await fetchRosters(NBA);
    try {
      injuries = parseInjuries(await getJSON(NBA.injuriesUrl));
      console.log(`  injury report: ${Object.keys(injuries).length} players not active`);
    } catch (e) {
      console.log(`  WARNING: no injury report (${e.message})`);
    }
  }
  const payload = boardPayload({ history, slate, day, model, now, roster, injuries });
  const count = (f) => payload.players.filter(f).length;
  console.log(`  availability: ${count((p) => p.status)} of ${payload.players.length} board players carry a status, ${count((p) => model.availability(p.status) === "out")} ruled out`);
  /* The pre-commit hook refuses a file over 1 MB, and bots bypass hooks: the fetcher fails first, loudly. */
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  if (bytes > 1000 * 1024) throw new Error(`${NBA.dataFile} would be ${(bytes / 1024).toFixed(0)} KB, over the 1 MB ceiling: lower NBA.recentGames or poolKeep`);
  writeFileSync(NBA.dataFile, `/* generated by ${NBA.fetcher} — do not edit */\nwindow.${NBA.dataGlobal} = ${JSON.stringify(payload)};\n`);
  console.log(`wrote ${NBA.dataFile}: ${payload.players.length} players, ${payload.games.length} games, pools ${Object.entries(payload.pools).map(([k, v]) => `${k} ${v.ratio.length}`).join(", ")} (${(bytes / 1024).toFixed(0)} KB)`);
  return payload;
}

/* -------------------------------------------------------------------- *
 * Main
 * -------------------------------------------------------------------- */

/** The season under way, ESPN's way: the year it ends in. October starts the next one. */
export function seasonOf(now = new Date()) {
  const day = slateDay(now);
  const y = Number(day.slice(0, 4)), m = Number(day.slice(4, 6));
  return m >= 10 ? y + 1 : y;
}

export async function main(argv) {
  const args = argv || process.argv.slice(2);
  const sArg = args.indexOf("--seasons");
  const season = seasonOf();
  /* Last season and this one are the board's window; the one before is
     what gives last season's replay a window of the same depth. */
  const seasons = sArg >= 0
    ? String(args[sArg + 1]).split(",").map(Number).filter((s) => Number.isInteger(s) && s >= 2003 && s <= 2100)
    : [season - 2, season - 1, season];
  console.log(`NBA, seasons: ${seasons.join(", ")}`);
  const history = await refreshHistory(seasons);
  if (args.includes("--history")) return;
  await buildBoard(history);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
