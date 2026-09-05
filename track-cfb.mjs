/*
 * BetHouse — track-cfb.mjs
 * What the college football board predicted, and whether it was any good.
 *
 *   node track-cfb.mjs snapshot     record this week's PREGAME predictions
 *   node track-cfb.mjs grade        grade any recorded week whose games are final
 *   node track-cfb.mjs report       print the running record
 *   node track-cfb.mjs report --write-record   also emit cfb-record.js
 *
 * The work is in track-football.mjs, shared with the NFL board; the rules
 * that keep the record honest are in track-core.mjs, shared with baseball.
 * This file only says which league.
 */
import { CFB } from "./football-leagues.mjs";
import { run } from "./track-football.mjs";

run(CFB);
