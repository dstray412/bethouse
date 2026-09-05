/*
 * BetHouse — track-nfl.mjs
 * What the NFL board predicted, and whether it was any good.
 *
 *   node track-nfl.mjs snapshot     record this week's PREGAME predictions
 *   node track-nfl.mjs grade        grade any recorded week whose games are final
 *   node track-nfl.mjs report       print the running record
 *   node track-nfl.mjs report --write-record   also emit nfl-record.js
 *
 * The work is in track-football.mjs, shared with the college board; the
 * rules that keep the record honest are in track-core.mjs, shared with
 * baseball. This file only says which league.
 */
import { NFL } from "./football-leagues.mjs";
import { run } from "./track-football.mjs";

run(NFL);
