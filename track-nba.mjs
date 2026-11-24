/*
 * BetHouse — track-nba.mjs
 * What the NBA board predicted, and whether it was any good.
 *
 *   node track-nba.mjs snapshot     record tonight's PREGAME predictions
 *   node track-nba.mjs grade        grade any recorded night whose games are final
 *   node track-nba.mjs report       print the running record
 *   node track-nba.mjs report --write-record   also emit nba-record.js
 *
 * The work is in track-football.mjs (the name is older than this file:
 * it records any board whose model has a stat table) and the rules that
 * keep a record honest are in track-core.mjs, shared with baseball.
 * This file only says which league.
 */
import { NBA } from "./fetch-nba.mjs";
import { run } from "./track-football.mjs";

run(NBA);
