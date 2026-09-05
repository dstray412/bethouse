#!/usr/bin/env node
/*
 * BetHouse — fetch-football.mjs
 * ESPN's football API → `<league>-history.json` (every completed game, every
 * box score, every closing line) and `<league>-data.js` (this week's board).
 *
 * One fetcher, two leagues. The NFL and college football share ESPN's
 * payload shape to the key name, and the day this was two files was the day
 * they started to disagree about the rules (see tasks/lessons.md, "two
 * copies of the same rule will disagree"). Everything league-shaped -- the
 * URLs, the file names, the model, how many weeks a season has, what to do
 * with a team that is not in the league -- lives in football-leagues.mjs.
 * `fetch-nfl.mjs` and `fetch-cfb.mjs` are each three lines that pick one.
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
 *    whose provider name matches /live/i is dropped, here, once. College
 *    football does exactly the same thing (Iowa State-Kansas State: KSU -2.5
 *    pregame, ISU -3.5 "live").
 *
 * 2. `spread` IS ALWAYS HOME-RELATIVE, even though `details` names whichever
 *    team is favoured. "KC -3.5" on the road comes back as spread +3.5,
 *    meaning the HOME team is getting 3.5. Reading the sign off `details`
 *    instead would flip every road favourite in the dataset -- about half the
 *    games -- and the resulting backtest would look like noise rather than
 *    like a bug. Verified against four week-1 games with known results:
 *
 *        home covers  <=>  (homeScore - awayScore) + spread > 0
 *
 * TWO MORE, PARTICULAR TO COLLEGE FOOTBALL
 * ----------------------------------------
 * 3. NEUTRAL SITES. Kickoff classics, conference championships and every bowl
 *    are played where neither team is at home, and ESPN still designates one
 *    side "home" for the box score. `neutralSite` is carried through so the
 *    model gives home field to nobody. Five of the 96 games in 2025's first
 *    week were neutral; the NFL's London and Germany games are the same flag.
 *
 * 4. TEAMS THAT ARE NOT IN THE LEAGUE. The FBS scoreboard lists every game an
 *    FBS team plays, including ninety-odd a season against FCS opponents who
 *    appear once and lose by forty. Rated individually on one game, the ridge
 *    shrinks each of them to roughly average, which credits the FBS team that
 *    beat one with a forty-point performance against an average side. So
 *    every side that is not in ESPN's own membership list for the season
 *    (core API group 80) is recorded under one code, `FCS`, and rated as one
 *    team on ninety games rather than ninety teams on one. That is where the
 *    membership list comes from: the data, per season, not a table typed
 *    from memory. A school that moves up mid-decade is FCS in the seasons it
 *    was FCS and itself afterwards.
 *
 * WHY THE CACHE IS NOT COMMITTED
 * ------------------------------
 * Two seasons of box scores is a few megabytes, and the repo's own
 * pre-commit hook rejects anything over 1 MB. `pga-history.json` is small
 * enough to ship; this is not. It is a rebuildable cache, so it lives in
 * .gitignore and `--history` rebuilds it from scratch. The board itself does
 * not need it: fetch writes the ratings it derives into the data file.
 *
 *   node fetch-nfl.mjs                  # refresh cache, then build the board
 *   node fetch-cfb.mjs --history        # cache only
 *   node fetch-cfb.mjs --seasons 2024,2025
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const REGULAR_SEASON = 2;

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
 * The code a team is recorded under. Its own abbreviation, unless the
 * league keeps a membership list and this team is not on it -- then the
 * league's code for outsiders (trap 4 above). `members` is a Set of ESPN
 * team ids; null means every team is a member, which is the NFL.
 */
export function teamCode(team, members, outsiderCode) {
  const abbr = team?.abbreviation || "";
  if (!members || !abbr) return abbr;
  return members.has(String(team?.id ?? "")) ? abbr : outsiderCode;
}

/**
 * One summary payload → a compact game record.
 *
 * Only players who actually did something are kept: a 53-man roster mostly
 * consists of people who cannot score a touchdown, and carrying them would
 * quadruple the cache for no signal.
 *
 * `opts.members` / `opts.outsiderCode`: see teamCode.
 */
export function parseGame(summary, opts) {
  const o = opts || {};
  const header = summary?.header;
  const comp = header?.competitions?.[0];
  if (!comp) return null;
  const home = (comp.competitors || []).find((c) => c.homeAway === "home");
  const away = (comp.competitors || []).find((c) => c.homeAway === "away");
  if (!home || !away) return null;
  const code = (c) => teamCode(c.team, o.members, o.outsiderCode);
  const homeCode = code(home), awayCode = code(away);

  /* The box score names sides by abbreviation, which for an outsider is
     the school's own code rather than the one it is recorded under. */
  const codeOf = { [home.team?.abbreviation || ""]: homeCode, [away.team?.abbreviation || ""]: awayCode };

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
    const abbr = side.team?.abbreviation || "";
    const team = codeOf[abbr] ?? abbr;
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
          /* College box scores carry no targets. The key is simply absent,
             so `tgt` is 0 there and the college model reads receptions
             instead -- see cfb.js. */
          p.rec = {
            rec: s.receptions || 0, tgt: s.receivingTargets || 0,
            yds: s.receivingYards || 0, td: s.receivingTouchdowns || 0,
          };
        }
      }
    }
  }

  const kept = [...players.values()].filter(
    (p) => p.pass?.att || p.rush?.att || p.rec?.tgt || p.rec?.rec,
  );

  const game = {
    id: String(header.id ?? comp.id),
    season: header.season?.year ?? null,
    week: header.week ?? null,
    date: comp.date || "",
    home: { team: homeCode, score: num(home.score) },
    away: { team: awayCode, score: num(away.score) },
    players: kept,
  };
  if (comp.neutralSite) game.neutral = true;
  return game;
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
export function parseScheduleEvent(e, season, week, opts) {
  const o = opts || {};
  const comp = e?.competitions?.[0];
  const cs = comp?.competitors || [];
  const home = cs.find((c) => c.homeAway === "home");
  const away = cs.find((c) => c.homeAway === "away");
  const row = {
    id: String(e?.id ?? ""),
    week,
    season,
    date: e?.date || "",
    completed: !!e?.status?.type?.completed,
    name: e?.name || "",
    home: home ? teamCode(home.team, o.members, o.outsiderCode) || null : null,
    away: away ? teamCode(away.team, o.members, o.outsiderCode) || null : null,
  };
  if (comp?.neutralSite) row.neutral = true;
  return row;
}

/** The team ids on a league's membership payload (core API groups/<n>/teams). */
export function parseMembers(payload) {
  const ids = new Set();
  for (const it of payload?.items || []) {
    const m = /\/teams\/(\d+)/.exec(String(it?.$ref || ""));
    if (m) ids.add(m[1]);
  }
  return ids;
}

/* -------------------------------------------------------------------- *
 * Collection
 * -------------------------------------------------------------------- */

function loadHistory(league) {
  if (!existsSync(league.historyFile)) return { games: [] };
  try {
    return JSON.parse(readFileSync(league.historyFile, "utf8"));
  } catch {
    return { games: [] };
  }
}

/**
 * The league's membership for a season, as a Set of team ids, or null for
 * a league that has no outsiders. Cached in the history file so a warm
 * refresh costs nothing; a season whose list cannot be fetched falls back
 * to the most recent one on disk, which is right for all but the handful
 * of schools that move up in any given year.
 */
async function membersFor(league, history, season) {
  if (!league.membersUrl) return null;
  history.members = history.members || {};
  if (!history.members[season]) {
    try {
      const ids = parseMembers(await getJSON(league.membersUrl(season)));
      if (ids.size) history.members[season] = [...ids];
    } catch (e) {
      console.log(`  WARNING: no membership list for ${season} (${e.message})`);
    }
  }
  const seasons = Object.keys(history.members).map(Number).filter((s) => s <= season).sort((a, b) => b - a);
  const use = history.members[season] ? season : seasons[0];
  if (!use) return null;
  if (use !== season) console.log(`  using the ${use} membership list for ${season}`);
  return new Set(history.members[use]);
}

async function weekSchedule(league, season, week, members) {
  const d = await getJSON(
    `${league.site}/scoreboard?dates=${season}&seasontype=${REGULAR_SEASON}&week=${week}${league.scoreboardQuery || ""}`,
  );
  const opts = { members, outsiderCode: league.outsiderCode };
  return (d.events || []).map((e) => parseScheduleEvent(e, season, week, opts));
}

async function fetchGame(league, id, members) {
  const [summary, odds] = await Promise.all([
    getJSON(`${league.site}/summary?event=${id}`),
    getJSON(`${league.core}/events/${id}/competitions/${id}/odds`).catch(() => null),
  ]);
  const game = parseGame(summary, { members, outsiderCode: league.outsiderCode });
  if (!game) return null;
  const line = parseOdds(odds);
  game.spread = line ? line.spread : null;
  game.total = line ? line.total : null;
  game.homeML = line ? line.homeML : null;
  game.awayML = line ? line.awayML : null;
  return game;
}

export async function refreshHistory(league, seasons) {
  const history = loadHistory(league);
  const have = new Set((history.games || []).map((g) => g.id));
  const todo = [];

  for (const season of seasons) {
    const members = await membersFor(league, history, season);
    for (let w = 1; w <= league.weeks; w++) {
      const sched = await weekSchedule(league, season, w, members);
      for (const g of sched) if (g.completed && !have.has(g.id)) todo.push({ ...g, members });
    }
    console.log(`  ${season}: schedule scanned`);
  }
  console.log(`cached ${have.size} games, ${todo.length} to fetch`);

  const BATCH = 6;
  let done = 0, failed = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const got = await Promise.all(
      chunk.map((g) => fetchGame(league, g.id, g.members).catch(() => null)),
    );
    got.forEach((g) => {
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
  writeFileSync(league.historyFile, JSON.stringify(history) + "\n");

  const withLine = history.games.filter((g) => g.spread != null).length;
  console.log(
    `wrote ${league.historyFile}: ${history.games.length} games, ${withLine} with a closing line, ` +
      `${history.games.reduce((n, g) => n + g.players.length, 0)} player-games`,
  );
  return history;
}

/* -------------------------------------------------------------------- *
 * The board
 *
 * Everything the page needs, derived here so the page can run the same
 * model the backtest ran without shipping three megabytes of box scores.
 * -------------------------------------------------------------------- */

/** The next week with games still to play, else the most recent one. */
async function nextWeek(league, season, members) {
  const now = new Date().toISOString();
  for (let w = 1; w <= league.weeks; w++) {
    const sched = await weekSchedule(league, season, w, members);
    if (!sched.length) continue;
    const unplayed = sched.filter((g) => !g.completed || g.date > now);
    if (unplayed.length) return { week: w, games: sched };
  }
  return null;
}

/**
 * Season-to-date player lines and team touchdown factors from a set of
 * games. Shared with the backtest by being here rather than there, so the
 * board and the replay cannot count a touchdown differently.
 */
/** A box-score line in the shape of a season record, so the model can read
    it with the same accessor it uses on season totals. */
const gameLine = (p) => ({ targets: p.rec?.tgt || 0, recs: p.rec?.rec || 0 });

export function seasonLines(games, model) {
  const players = new Map();
  const usageByPlayer = new Map();
  const teamTD = new Map(), teamTDAgainst = new Map(), teamGames = new Map();
  for (const g of games) {
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
      // One game's workload, in the model's own terms: targets in the
      // NFL, receptions in college, where targets are not recorded.
      const u = model.usageTDs(p.rush?.att || 0, model.receivingOpportunity(gameLine(p)));
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
  return { players, usageByPlayer, teamFactors };
}

export async function buildBoard(league, history) {
  const model = league.model;
  const season = new Date().getUTCFullYear();
  const members = await membersFor(league, history, season);
  const up = await nextWeek(league, season, members);
  if (!up) {
    console.log("no upcoming regular-season week found");
    return;
  }
  console.log(`\nbuilding board: ${season} week ${up.week} (${up.games.length} games)`);

  const games = history.games;
  const ratings = model.buildTeamRatings(games);

  /* Player lines: this season and last, together. In week 1 that is last
     season, which is what anyone handicapping week 1 has too; by week 2 it
     is last season plus one game, and the current year takes over as it
     accumulates. Restricting to the current season alone would empty the
     board until week 4 (the three-game gate), and restricting to last
     season alone would never let it move. The backtest's rule is the same
     one: every prior game on file. */
  const current = games.filter((g) => g.season >= season - 1);
  const statsSeasons = [...new Set(current.map((g) => g.season))].sort();
  const { players, usageByPlayer, teamFactors } = seasonLines(current, model);

  /* Who plays whom this week. Built from the schedule's own team codes. */
  const opponentOf = {};
  for (const g of up.games) {
    if (!g.home || !g.away) continue;
    opponentOf[g.home] = g.away;
    opponentOf[g.away] = g.home;
  }
  const matched = Object.keys(opponentOf).length;
  console.log(`  matchups resolved for ${matched} teams across ${up.games.length} games`);

  const usagePool = model.usagePoolFrom([...usageByPlayer.values()], 6);
  /*
   * The yardage pool: actual/expected for every game by a player with
   * three games behind him and a real expectation.
   *
   * WHICH POPULATION GOES IN THE POOL IS A CHOICE, AND IT MOVES THE ANSWER.
   * Replaying two NFL seasons with three definitions (2026-09-05):
   *
   *     this one (games >= 3, expectation >= 5)          -1.2pp
   *     games >= 3 and 8+ targets, expectation >= 5      +1.0pp
   *     exactly the rows the board shows (yardsEligible) +4.2pp
   *
   * The strictest is the one that sounds right -- "players like him" --
   * and calibrates worst, because early-season expectations are shrunk
   * toward the prior and a good receiver's early ratios all come out high.
   * The loosest carries the zero-inflated tail that pulls them back. None
   * of the three is fitted to anything; this is what the board ships, so
   * it is what the backtest replays, and the forward record decides.
   */
  const yardPool = [];
  for (const g of current) {
    for (const p of g.players) {
      if (!(model.receivingOpportunity(gameLine(p)) >= 1)) continue;
      const r = players.get(p.id);
      if (!r || r.games < 3) continue;
      const exp = model.expectedVolume(r.recYds, r.games);
      if (exp >= 5) yardPool.push((p.rec?.yds || 0) / exp);
    }
  }

  const round = (a, n) => Array.from(a, (x) => Number(x.toFixed(n)));
  const payload = {
    generated: new Date().toISOString(),
    season, week: up.week,
    statsSeasons,
    games: up.games.map((g) => ({
      id: g.id, date: g.date, name: g.name, completed: g.completed,
      home: g.home, away: g.away,
      ...(g.neutral ? { neutral: true } : {}),
    })),
    ratings,
    teamFactors,
    players: [...players.values()]
      .filter((p) => p.games >= 3 && (p.carries + model.receivingOpportunity(p)) >= 10)
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
    league.dataFile,
    `/* generated by ${league.fetcher} — do not edit */\nwindow.${league.dataGlobal} = ${JSON.stringify(payload)};\n`,
  );
  console.log(
    `wrote ${league.dataFile}: ${payload.players.length} players, ${payload.games.length} games, ` +
      `pools ${payload.usagePool.length}/${payload.yardPool.length}`,
  );
}

/* -------------------------------------------------------------------- *
 * Main
 * -------------------------------------------------------------------- */

export async function main(league, argv) {
  const args = argv || process.argv.slice(2);
  const sArg = args.indexOf("--seasons");
  const year = new Date().getUTCFullYear();
  /* Two completed seasons and the one under way. The current season is
     what makes the board move during the year: without it (and until
     2026-09-05 it was absent) the cache froze at last season's final week
     and every in-season board would have been built from stale lines. Its
     schedule scan costs one request a week and finds nothing until games
     are played. */
  const seasons =
    sArg >= 0
      ? String(args[sArg + 1]).split(",").map(Number).filter(Boolean)
      : [year - 2, year - 1, year];

  console.log(`${league.label}, seasons: ${seasons.join(", ")}`);
  const history = await refreshHistory(league, seasons);
  if (args.includes("--history")) return;
  await buildBoard(league, history);
}
