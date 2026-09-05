#!/usr/bin/env node
/*
 * BetHouse — fetch-cfb.mjs
 * ESPN's college football API → `cfb-history.json` and `cfb-data.js`.
 *
 * All of the work is in fetch-football.mjs, shared with the NFL board;
 * this file only says which league. What is particular to college -- FBS
 * membership, neutral sites, receptions instead of targets -- is in
 * football-leagues.mjs and cfb.js respectively.
 *
 *   node fetch-cfb.mjs                  # refresh cache, then build the board
 *   node fetch-cfb.mjs --history        # cache only (~1,700 games, ~3,400 requests cold)
 *   node fetch-cfb.mjs --seasons 2024,2025
 */
import { CFB } from "./football-leagues.mjs";
import { main } from "./fetch-football.mjs";

if (import.meta.url === `file://${process.argv[1]}`) {
  main(CFB).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
