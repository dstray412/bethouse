/*
 * BetHouse — football-leagues.mjs
 * The one table of what is league-shaped about the football board.
 *
 * The fetcher, the tracker and the backtest (fetch-football.mjs,
 * track-football.mjs, backtest-nfl.mjs) take one of these objects and ask
 * it for everything that is league-shaped: which ESPN endpoints, which
 * files, which model, how many weeks. Nothing else in those files knows
 * which league it is running.
 *
 * The table held college football too until 2026-10-16, when that board
 * was removed. Adding a league back is adding an entry here and two
 * three-line entry-point scripts. It is not copying anything.
 */
import nfl from "./nfl.js";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/football";
const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues";

export const NFL = {
  id: "nfl",
  label: "NFL",
  /* The forecast at kickoff (fetch-weather.mjs) needs a point per venue;
     stadiums.json has the NFL's 38. */
  weather: true,
  site: `${SITE}/nfl`,
  core: `${CORE}/nfl`,
  weeks: 18,
  /* Games of history before the backtest starts grading: about four weeks. */
  warmupGames: 64,
  /* The league's injury report: every player, Active or not, with a dated
     status. Read once per board build. */
  injuriesUrl: `${SITE}/nfl/injuries`,
  /* Who plays for whom today. The box score names last season's team
     until a player plays a game for the new one; the roster does not. */
  teamsUrl: `${SITE}/nfl/teams?limit=40`,
  rosterUrl: (teamId) => `${SITE}/nfl/teams/${teamId}/roster`,
  model: nfl,
  fetcher: "fetch-nfl.mjs",
  tracker: "track-nfl.mjs",
  historyFile: "nfl-history.json",
  dataFile: "nfl-data.js",
  recentGames: 10,
  dataGlobal: "BetHouseNFLData",
  recordDir: "nfl-record",
  recordFile: "nfl-record.js",
  recordGlobal: "BETHOUSE_NFL_RECORD",
  /* nflverse carries what the box score cannot see (snap share, target
     share, air yards, red-zone touches); enrich-nfl.mjs joins it to
     ESPN's ids for the board and the replay. */
  enrich: true,
};

export const LEAGUES = { nfl: NFL };

/** `--league nfl` on a command line, defaulting to the NFL. */
export function leagueFromArgs(args) {
  const i = args.indexOf("--league");
  const id = i >= 0 ? String(args[i + 1] || "").toLowerCase() : "nfl";
  const league = LEAGUES[id];
  if (!league) throw new Error(`unknown league "${id}" — one of ${Object.keys(LEAGUES).join(", ")}`);
  return league;
}
