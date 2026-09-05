#!/usr/bin/env node
/*
 * BetHouse — fetch-nfl.mjs
 * ESPN's NFL API → `nfl-history.json` and `nfl-data.js`.
 *
 * All of the work is in fetch-football.mjs, which is shared with the
 * college board; this file only says which league. The parsers are
 * re-exported so the tests keep importing them from here.
 *
 *   node fetch-nfl.mjs                  # refresh cache, then build the board
 *   node fetch-nfl.mjs --history        # cache only
 *   node fetch-nfl.mjs --seasons 2024,2025
 */
import { NFL } from "./football-leagues.mjs";
import { main } from "./fetch-football.mjs";

export { zipStats, parseGame, parseOdds, homeCovered, wentOver, parseScheduleEvent } from "./fetch-football.mjs";

if (import.meta.url === `file://${process.argv[1]}`) {
  main(NFL).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
