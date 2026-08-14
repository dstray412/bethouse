#!/usr/bin/env node
/*
 * BetHouse — fetch-nfl.mjs
 * ESPN's NFL API → `nfl-history.json` (every completed game, every box score,
 * every closing line) and `nfl-data.js` (this week's board).
 *
 * Keyless, like statsapi and the golf side. No account, no rate tier.
 *
 * Three endpoints:
 *   1. scoreboard?dates=<yr>&seasontype=2&week=<n>  the week's schedule
 *   2. summary?event=<id>                           per-player box score
 *   3. core .../competitions/<id>/odds              the closing line
 *
 * TWO TRAPS, BOTH OF WHICH WOULD CORRUPT A BACKTEST SILENTLY
 * ----------------------------------------------------------
 * 1. THE ODDS ENDPOINT SERVES LIVE LINES ALONGSIDE PREGAME ONES. A finished
 *    game returns both "ESPN BET" (the closing number) and "ESPN Bet - Live
 *    Odds", which is the line as it stood DURING play. On Eagles-Cowboys the
 *    pregame line was PHI -7.5 with a total of 47.5; the live entry says
 *    -4.5 and 44.5, because by then the game had told it what was happening.
 *    Grading a model against that is grading it against the answer. Anything
 *    whose provider name matches /live/i is dropped, here, once.
 *
 * 2. `spread` IS ALWAYS HOME-RELATIVE, even though `details` names whichever
 *    team is favoured. "KC -3.5" on the road comes back as spread +3.5,
 *    meaning the HOME team is getting 3.5. Reading the sign off `details`
 *    instead would flip every road favourite in the dataset — about half the
 *    games — and the resulting backtest would look like noise rather than
 *    like a bug. Verified against four week-1 games with known results:
 *
 *        home covers  <=>  (homeScore - awayScore) + spread > 0
 *
 * WHY THE CACHE IS NOT COMMITTED
 * ------------------------------
 * Two seasons of box scores is a few megabytes, and the repo's own
 * pre-commit hook rejects anything over 1 MB. `pga-history.json` is small
 * enough to ship; this is not. It is a rebuildable cache, so it lives in
 * .gitignore and `node fetch-nfl.mjs --history` rebuilds it from scratch.
 * The board itself does not need it: fetch writes the ratings it derives
 * into nfl-data.js.
 *
 *   node fetch-nfl.mjs                  # refresh cache, then build the board
 *   node fetch-nfl.mjs --history        # cache only
 *   node fetch-nfl.mjs --seasons 2024,2025
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import nfl from "./nfl.js";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const HISTORY_FILE = "nfl-history.json";
const DATA_FILE = "nfl-data.js";
const REGULAR_SEASON = 2;
const WEEKS = 18;

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

/** A stat block's `keys` and an athlete's `stats` zip into a named record. */
export function zipStats(keys, stats) {
  const out = {};
  (keys || []).forEach((k, i) => {
    const raw = (stats || [])[i];
    if (raw == null) return;
    // "18/25" style compound keys: completions/passingAttempts.
    if (k.includes("/") && String(raw).includes("/")) {
      const names = k.split("/");
      const vals = String(raw).split("/");
      names.forEach((n, j) => (out[n] = num(vals[j])));
      return;
    }
    out[k] = num(raw);
  });
  return out;
}

/**
 * One summary payload → a compact game record.
 *
 * Only players who actually did something are kept: a 53-man roster mostly
 * consists of people who cannot score a touchdown, and carrying them would
 * quadruple the cache for no signal.
 */
export function parseGame(summary) {
  const header = summary?.header;
  const comp = header?.competitions?.[0];
  if (!comp) return null;
  const home = (comp.competitors || []).find((c) => c.homeAway === "home");
  const away = (comp.competitors || []).find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const players = new Map();
  const touch = (team, ath) => {
    const id = String(ath?.athlete?.id ?? "");
    if (!id) return null;
    if (!players.has(id)) {
      players.set(id, {
        id,
        name: ath.athlete.displayName || ath.athlete.shortName || "",
        team,
      });
    }
    return players.get(id);
  };

  for (const side of summary.boxscore?.players || []) {
    const team = side.team?.abbreviation || "";
    for (const block of side.statistics || []) {
      for (const ath of block.athletes || []) {
        const p = touch(team, ath);
        if (!p) continue;
        const s = zipStats(block.keys, ath.stats);
        if (block.name === "passing") {
          p.pass = {
            att: s.passingAttempts || 0, cmp: s.completions || 0,
            yds: s.passingYards || 0, td: s.passingTouchdowns || 0,
            int: s.interceptions || 0,
          };
        } else if (block.name === "rushing") {
          p.rush = {
            att: s.rushingAttempts || 0, yds: s.rushingYards || 0,
            td: s.rushingTouchdowns || 0,
          };
        } else if (block.name === "receiving") {
          p.rec = {
            rec: s.receptions || 0, tgt: s.receivingTargets || 0,
            yds: s.receivingYards || 0, td: s.receivingTouchdowns || 0,
          };
        }
      }
    }
  }

  const kept = [...players.values()].filter(
    (p) => p.pass?.att || p.rush?.att || p.rec?.tgt,
  );

  return {
    id: String(header.id ?? comp.id),
    season: header.season?.year ?? null,
    week: header.week ?? null,
    date: comp.date || "",
    home: { team: home.team?.abbreviation || "", score: num(home.score) },
    away: { team: away.team?.abbreviation || "", score: num(away.score) },
    players: kept,
  };
}

/**
 * The closing line, home-relative.
 *
 * Live in-play lines are dropped here and nowhere else, so no downstream
 * caller has to remember. See the header.
 */
export function parseOdds(payload) {
  const items = (payload?.items || []).filter(
    (it) => !/live/i.test(String(it?.provider?.name || "")),
  );
  for (const it of items) {
    const spread = Number(it.spread);
    if (!isFinite(spread)) continue;
    return {
      spread, // negative = home favoured
      total: isFinite(Number(it.overUnder)) ? Number(it.overUnder) : null,
      homeML: Number(it.homeTeamOdds?.moneyLine) || null,
      awayML: Number(it.awayTeamOdds?.moneyLine) || null,
      book: it.provider?.name || "",
    };
  }
  return null;
}

/** Did the home side cover? `null` when there is no line or it pushed. */
export function homeCovered(game) {
  if (!game || game.spread == null) return null;
  const margin = game.home.score - game.away.score;
  const edge = margin + game.spread;
  if (edge === 0) return null; // push
  return edge > 0;
}

/** Did the game go over? `null` when there is no total or it pushed. */
export function wentOver(game) {
  if (!game || game.total == null) return null;
  const points = game.home.score + game.away.score;
  if (points === game.total) return null;
  return points > game.total;
}

/* -------------------------------------------------------------------- *
 * Collection
 * -------------------------------------------------------------------- */

/**
 * One scoreboard event → a schedule row, INCLUDING both team codes.
 *
 * The codes matter. The board used to recover them by searching each
 * abbreviation inside the full team name, which is wrong in both directions:
 * "San Francisco 49ers" does not contain "SF" so the game vanished, and
 * "Arizona Cardinals" does contain "CAR" so it was projected as Carolina.
 * Six of sixteen week-1 games were dropped and two were attributed to the
 * wrong franchise. The scoreboard has carried `team.abbreviation` all along.
 */
export function parseScheduleEvent(e, season, week) {
  const comp = e?.competitions?.[0];
  const cs = comp?.competitors || [];
  const home = cs.find((c) => c.homeAway === "home");
  const away = cs.find((c) => c.homeAway === "away");
  return {
    id: String(e?.id ?? ""),
    week,
    season,
    date: e?.date || "",
    completed: !!e?.status?.type?.completed,
    name: e?.name || "",
    home: home?.team?.abbreviation || null,
    away: away?.team?.abbreviation || null,
  };
}

async function weekSchedule(season, week) {
  const d = await getJSON(
    `${SITE}/scoreboard?dates=${season}&seasontype=${REGULAR_SEASON}&week=${week}`,
  );
  return (d.events || []).map((e) => parseScheduleEvent(e, season, week));
}

async function fetchGame(id) {
  const [summary, odds] = await Promise.all([
    getJSON(`${SITE}/summary?event=${id}`),
    getJSON(`${CORE}/events/${id}/competitions/${id}/odds`).catch(() => null),
  ]);
  const game = parseGame(summary);
  if (!game) return null;
  const line = parseOdds(odds);
  game.spread = line ? line.spread : null;
  game.total = line ? line.total : null;
  game.homeML = line ? line.homeML : null;
  game.awayML = line ? line.awayML : null;
  return game;
}

function loadHistory() {
  if (!existsSync(HISTORY_FILE)) return { games: [] };
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, "utf8"));
  } catch {
    return { games: [] };
  }
}

async function refreshHistory(seasons) {
  const history = loadHistory();
  const have = new Set((history.games || []).map((g) => g.id));
  const todo = [];

  for (const season of seasons) {
    for (let w = 1; w <= WEEKS; w++) {
      const sched = await weekSchedule(season, w);
      for (const g of sched) if (g.completed && !have.has(g.id)) todo.push(g);
    }
    console.log(`  ${season}: schedule scanned`);
  }
  console.log(`cached ${have.size} games, ${todo.length} to fetch`);

  const BATCH = 6;
  let done = 0, failed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const got = await Promise.all(
      chunk.map((g) => fetchGame(g.id).catch(() => null)),
    );
    got.forEach((g, j) => {
      if (g && g.players.length) history.games.push(g);
      else failed++;
    });
    done += chunk.length;
    process.stdout.write(`\r  games: ${done}/${todo.length}   `);
  }
  if (todo.length) process.stdout.write("\n");
  if (failed) console.log(`  WARNING: ${failed} games failed to fetch`);

  history.games.sort(
    (a, b) => a.season - b.season || a.week - b.week || String(a.date).localeCompare(String(b.date)),
  );
  history.seasons = seasons;
  writeFileSync(HISTORY_FILE, JSON.stringify(history) + "\n");

  const withLine = history.games.filter((g) => g.spread != null).length;
  console.log(
    `wrote ${HISTORY_FILE}: ${history.games.length} games, ${withLine} with a closing line, ` +
      `${history.games.reduce((n, g) => n + g.players.length, 0)} player-games`,
  );
  return history;
}

/* -------------------------------------------------------------------- *
 * Main
 * -------------------------------------------------------------------- */

async function main() {
  const args = process.argv.slice(2);
  const sArg = args.indexOf("--seasons");
  const year = new Date().getUTCFullYear();
  const seasons =
    sArg >= 0
      ? String(args[sArg + 1]).split(",").map(Number).filter(Boolean)
      : [year - 2, year - 1];

  console.log(`seasons: ${seasons.join(", ")}`);
  const history = await refreshHistory(seasons);
  if (args.includes("--history")) return;
  await buildBoard(history);
}

/* -------------------------------------------------------------------- *
 * The board
 *
 * Everything the page needs, derived here so nfl.html can run the same
 * model the backtest ran without shipping three megabytes of box scores.
 * -------------------------------------------------------------------- */

/** The next week with games still to play, else the most recent one. */
async function nextWeek(season) {
  const now = new Date().toISOString();
  for (let w = 1; w <= WEEKS; w++) {
    const sched = await weekSchedule(season, w);
    if (!sched.length) continue;
    const unplayed = sched.filter((g) => !g.completed || g.date > now);
    if (unplayed.length) return { week: w, games: sched };
  }
  return null;
}

async function buildBoard(history) {
  const season = new Date().getUTCFullYear();
  const up = await nextWeek(season);
  if (!up) {
    console.log("no upcoming regular-season week found");
    return;
  }
  console.log(`\nbuilding board: ${season} week ${up.week} (${up.games.length} games)`);

  const games = history.games;
  const ratings = nfl.buildTeamRatings(games);

  /* Player season lines. The current season if it has started, otherwise
     last season -- which is what anyone handicapping week 1 has too. */
  const latest = Math.max(...games.map((g) => g.season));
  const current = games.filter((g) => g.season === latest);
  const players = new Map();
  const usageByPlayer = new Map();
  const teamTD = new Map(), teamTDAgainst = new Map(), teamGames = new Map();
  for (const g of current) {
    const tdBy = { [g.home.team]: 0, [g.away.team]: 0 };
    for (const p of g.players) {
      const r = players.get(p.id) || {
        id: p.id, name: p.name, team: p.team,
        games: 0, tds: 0, carries: 0, targets: 0, recYds: 0, rushYds: 0, recs: 0,
      };
      r.team = p.team; r.games++;
      const td = (p.rush?.td || 0) + (p.rec?.td || 0);
      r.tds += td;
      r.carries += p.rush?.att || 0;
      r.targets += p.rec?.tgt || 0;
      r.recYds += p.rec?.yds || 0;
      r.rushYds += p.rush?.yds || 0;
      r.recs += p.rec?.rec || 0;
      players.set(p.id, r);
      if (tdBy[p.team] != null) tdBy[p.team] += td;
      const u = nfl.usageTDs(p.rush?.att || 0, p.rec?.tgt || 0);
      if (u > 0) {
        if (!usageByPlayer.has(p.id)) usageByPlayer.set(p.id, []);
        usageByPlayer.get(p.id).push(u);
      }
    }
    for (const [t, opp] of [[g.home.team, g.away.team], [g.away.team, g.home.team]]) {
      teamTD.set(t, (teamTD.get(t) || 0) + tdBy[t]);
      teamTDAgainst.set(opp, (teamTDAgainst.get(opp) || 0) + tdBy[t]);
      teamGames.set(t, (teamGames.get(t) || 0) + 1);
    }
  }

  const leagueTD =
    [...teamTD.values()].reduce((a, b) => a + b, 0) /
    Math.max(1, [...teamGames.values()].reduce((a, b) => a + b, 0));
  const factorOf = (map, t) => {
    const n = teamGames.get(t) || 0;
    if (!n || !leagueTD) return 1;
    const K = 6;
    return ((map.get(t) || 0) + leagueTD * K) / ((n + K) * leagueTD);
  };
  const teamFactors = {};
  for (const t of teamGames.keys()) {
    teamFactors[t] = {
      off: Number(factorOf(teamTD, t).toFixed(4)),
      def: Number(factorOf(teamTDAgainst, t).toFixed(4)),
    };
  }

  /* Who plays whom this week. Built from the schedule's own team codes. */
  const opponentOf = {};
  for (const g of up.games) {
    if (!g.home || !g.away) continue;
    opponentOf[g.home] = g.away;
    opponentOf[g.away] = g.home;
  }
  const matched = Object.keys(opponentOf).length;
  console.log(`  matchups resolved for ${matched} teams across ${up.games.length} games`);

  const usagePool = nfl.usagePoolFrom([...usageByPlayer.values()], 6);
  const yardPool = [];
  for (const g of current) {
    for (const p of g.players) {
      if (!(p.rec?.tgt >= 1)) continue;
      const r = players.get(p.id);
      if (!r || r.games < 3) continue;
      const exp = nfl.expectedVolume(r.recYds, r.games, 25);
      if (exp >= 5) yardPool.push((p.rec?.yds || 0) / exp);
    }
  }

  const round = (a, n) => Array.from(a, (x) => Number(x.toFixed(n)));
  const payload = {
    generated: new Date().toISOString(),
    season, week: up.week,
    statsSeason: latest,
    games: up.games.map((g) => ({
      id: g.id, date: g.date, name: g.name, completed: g.completed,
      home: g.home, away: g.away,
    })),
    ratings,
    teamFactors,
    players: [...players.values()]
      .filter((p) => p.games >= 3 && (p.carries + p.targets) >= 10)
      .map((p) => ({
        id: p.id, name: p.name, team: p.team, games: p.games, tds: p.tds,
        carries: p.carries, targets: p.targets, recYds: p.recYds, rushYds: p.rushYds, recs: p.recs,
        // Who he faces this week, so the board can apply the opponent's
        // defence the same way the backtest does. null = on bye or the
        // schedule has not placed his team yet.
        opp: opponentOf[p.team] || null,
      })),
    usagePool: round(usagePool.slice(0, 4000), 3),
    yardPool: round(yardPool.slice(-4000), 3),
    seasonsCached: history.seasons,
    gamesCached: history.games.length,
  };

  writeFileSync(
    DATA_FILE,
    `/* generated by fetch-nfl.mjs — do not edit */\nwindow.BetHouseNFLData = ${JSON.stringify(payload)};\n`,
  );
  console.log(
    `wrote ${DATA_FILE}: ${payload.players.length} players, ${payload.games.length} games, ` +
      `pools ${payload.usagePool.length}/${payload.yardPool.length}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
