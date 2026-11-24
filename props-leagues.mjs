/*
 * BetHouse — props-leagues.mjs
 * What is league-shaped about a book's prop lines, in one table.
 *
 * fetch-props.mjs and track-props.mjs take one of these and ask it for
 * everything that differs between the boards: the provider's sport key,
 * which of its markets is which of the board's props, the model, the
 * files, and where a final game's box score comes from. props.js itself
 * knows no league.
 */
import P from "./props.js";
import nfl from "./nfl.js";
import nba from "./nba.js";
import { NFL } from "./football-leagues.mjs";
import { NBA } from "./fetch-nba.mjs";
import { boxScoreLines } from "./track-football.mjs";

const pad = (n) => String(n).padStart(2, "0");

export const PROPS_LEAGUES = {
  nfl: {
    id: "nfl", label: "NFL", model: nfl,
    sport: "football_nfl", oddsApiSport: "americanfootball_nfl",
    markets: P.MARKETS,
    /* The backup's three: two-sided, the most players, and the one the record says runs hot. */
    oddsApiMarkets: ["player_reception_yds", "player_rush_yds", "player_receptions"],
    dataFile: NFL.dataFile, dataGlobal: NFL.dataGlobal, fetcher: NFL.fetcher,
    out: "nfl-props.js", global: "BetHouseNFLProps",
    recDir: "nfl-props-record", recFile: "nfl-props-record.js", recGlobal: "BetHouseNFLPropsRecord",
    /* One record file a week. */
    recName: (D) => `${D.season}-w${pad(D.week)}.json`,
    site: NFL.site, boxScoreLines,
    /* A player's role: his share of the offence's snaps, the season's against his last three games (enrich-nfl.mjs). */
    roleOf: (p) => (p && p.usage && p.usage3 && p.usage3.n >= 2 && Number.isFinite(p.usage.snap) && Number.isFinite(p.usage3.snap) ? { season: p.usage.snap, recent: p.usage3.snap } : null),
  },
  nba: {
    id: "nba", label: "NBA", model: nba,
    sport: "basketball_nba", oddsApiSport: "basketball_nba",
    markets: { player_points: "pts", player_rebounds: "reb", player_assists: "ast", player_threes: "tpm", player_points_rebounds_assists: "pra" },
    oddsApiMarkets: ["player_points", "player_rebounds", "player_assists"],
    dataFile: NBA.dataFile, dataGlobal: NBA.dataGlobal, fetcher: NBA.fetcher,
    out: "nba-props.js", global: "BetHouseNBAProps",
    recDir: "nba-props-record", recFile: "nba-props-record.js", recGlobal: "BetHouseNBAPropsRecord",
    /* One record file a night, named for the slate's day as the board's own record is. */
    recName: (D) => `${D.date}.json`,
    site: NBA.site, boxScoreLines: NBA.boxScoreLines,
    /* A player's role: his minutes a game, the window's against the recent-weighted figure the projection runs on (fetch-nba.mjs `w.min`). */
    roleOf: (p) => (p && p.games > 0 && p.min > 0 && p.w && p.w.min && Number.isFinite(p.w.min.pts) ? { season: Math.round((100 * p.min) / p.games) / 100, recent: p.w.min.pts } : null),
  },
};

/** `--league nba` on a command line, defaulting to the NFL. */
export function propsLeague(args) {
  const i = (args || []).indexOf("--league");
  const id = i >= 0 ? String(args[i + 1] || "").toLowerCase() : "nfl";
  if (!Object.prototype.hasOwnProperty.call(PROPS_LEAGUES, id)) throw new Error(`unknown league "${id}": one of ${Object.keys(PROPS_LEAGUES).join(", ")}`);
  return PROPS_LEAGUES[id];
}
