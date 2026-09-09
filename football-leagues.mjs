/*
 * BetHouse — football-leagues.mjs
 * The one table of what makes the NFL and college football different.
 *
 * The fetcher, the tracker and the backtest are shared between the two
 * leagues (fetch-football.mjs, track-football.mjs, backtest-nfl.mjs). Each
 * of them takes one of these objects and asks it for everything that is
 * league-shaped: which ESPN endpoints, which files, which model, how many
 * weeks, and what to call a team that is not in the league. Nothing else
 * in those files knows which league it is running.
 *
 * Adding a third league is adding an entry here and two three-line
 * entry-point scripts. It is not copying anything.
 */
import nfl from "./nfl.js";
import cfb from "./cfb.js";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/football";
const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues";

export const NFL = {
  id: "nfl",
  label: "NFL",
  site: `${SITE}/nfl`,
  core: `${CORE}/nfl`,
  weeks: 18,
  /* Games of history before the backtest starts grading: about four weeks. */
  warmupGames: 64,
  scoreboardQuery: "",
  /* Every team on the NFL scoreboard is in the NFL. */
  membersUrl: null,
  outsiderCode: null,
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
  dataGlobal: "BetHouseNFLData",
  recordDir: "nfl-record",
  recordFile: "nfl-record.js",
  recordGlobal: "BETHOUSE_NFL_RECORD",
};

export const CFB = {
  id: "cfb",
  label: "College football",
  site: `${SITE}/college-football`,
  core: `${CORE}/college-football`,
  /* 2025 ran sixteen regular-season weeks, 2026 fifteen. A week past the
     end comes back empty, so the longer count is safe for both. */
  weeks: 16,
  warmupGames: 250,
  /* groups=80 is FBS. Without it the scoreboard is the top-25 slate;
     without the limit it is the first fifty games of a hundred. */
  scoreboardQuery: "&groups=80&limit=400",
  /* ESPN's own FBS membership for the season, as team ids. Every side not
     on it is recorded as `FCS` and rated as one team. See fetch-football.mjs
     trap 4. */
  membersUrl: (season) => `${CORE}/college-football/seasons/${season}/types/2/groups/80/teams?limit=200`,
  outsiderCode: "FCS",
  /* ESPN's college injuries endpoint returns three entries dated 2020-22.
     There is no report; every college player reads as available. */
  injuriesUrl: null,
  /* Team ids come from the membership list; one roster request each. */
  teamsUrl: null,
  rosterUrl: (teamId) => `${SITE}/college-football/teams/${teamId}/roster`,
  model: cfb,
  fetcher: "fetch-cfb.mjs",
  tracker: "track-cfb.mjs",
  historyFile: "cfb-history.json",
  dataFile: "cfb-data.js",
  dataGlobal: "BetHouseCFBData",
  recordDir: "cfb-record",
  recordFile: "cfb-record.js",
  recordGlobal: "BETHOUSE_CFB_RECORD",
};

export const LEAGUES = { nfl: NFL, cfb: CFB };

/** `--league cfb` on a command line, defaulting to the NFL. */
export function leagueFromArgs(args) {
  const i = args.indexOf("--league");
  const id = i >= 0 ? String(args[i + 1] || "").toLowerCase() : "nfl";
  const league = LEAGUES[id];
  if (!league) throw new Error(`unknown league "${id}" — one of ${Object.keys(LEAGUES).join(", ")}`);
  return league;
}
