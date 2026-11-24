#!/usr/bin/env node
/*
 * BetHouse — fetch-props.mjs
 * A book's player-prop lines for the NFL board → `nfl-props.js`.
 *
 *   PROPLINE_API_KEY=… node fetch-props.mjs     # PropLine, one request
 *   ODDS_API_KEY=…     node fetch-props.mjs     # The Odds API, the backup
 *   node fetch-props.mjs                        # no key: says so, writes nothing
 *
 * WHERE THE KEY LIVES. In the environment, from a repository secret in
 * props.yml, and nowhere else: never in a file, never in a URL (PropLine
 * takes it as a header), never on the page. A key in client JavaScript
 * is public the moment the site loads, which is why the page reads a
 * file this script wrote and never calls a provider.
 *
 * WHAT IS WRITTEN, AND WHAT IS NOT. `nfl-props.js` holds the offers the
 * board shows today: one main line a player, prop and book, for games
 * that have not kicked off. No raw response and no archive of snapshots
 * is kept. PropLine's terms (§2, read 2026-11-24) allow surfacing
 * individual values in a product and prohibit publishing "aggregated
 * odds dumps" or "historical line-movement snapshots", and this
 * repository is public. The record keeps a price only for a pick it
 * logged (track-props.mjs).
 *
 * BUDGET. PropLine's free tier is 1,000 requests a day and this is one
 * request; the run still stops when the last response said fewer than
 * 100 were left. The Odds API's free 500 credits a month are spent one
 * game at a time (markets returned x regions), so its run takes three
 * markets only and stops under 40 credits.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import P from "./props.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = "nfl-props.js", GLOBAL = "BetHouseNFLProps";
export const PROPLINE = "https://api.prop-line.com", ODDS_API = "https://api.the-odds-api.com";
const PROPLINE_FLOOR = 100, ODDS_API_FLOOR = 40;
/* The backup's three markets: two-sided, the most players, and the one the record says runs hot. */
const ODDS_API_MARKETS = ["player_reception_yds", "player_rush_yds", "player_receptions"];
const BOOK_KEYS = Object.keys(P.BOOKS);

/** The page's file: today's offers by player, prop and book, for games not yet started. Pure. */
export function buildPayload({ events, D, source, fetched, remaining, overrides, now }) {
  const t = now == null ? Date.now() : now;
  /* The bulk feed carries live games, and an in-play price beside a pregame chance is a wrong number. */
  const pregame = (Array.isArray(events) ? events : []).filter((e) => e && !e.live && Date.parse(e.commence_time) > t);
  const { matched, unmatched } = P.matchOffers(P.parseEvents(pregame), D, overrides);
  const offers = {};
  let n = 0;
  for (const o of matched) {
    if (!(Date.parse(o.kickoff) > t)) continue;
    const byStat = (offers[o.playerId] = offers[o.playerId] || {});
    const byBook = (byStat[o.stat] = byStat[o.stat] || {});
    byBook[o.book] = { line: o.line, over: o.over, under: o.under, at: o.at, g: o.gameId };
    n++;
  }
  return {
    payload: { fetched, source, season: D && D.season, week: D && D.week, remaining: remaining == null ? null : remaining, books: P.BOOKS, count: n, offers },
    unmatched,
  };
}

async function getJson(url, headers, fetchImpl) {
  /* No redirects: fetch strips only Authorization on a cross-origin hop, and the key rides in X-API-Key or the query string. */
  const res = await fetchImpl(url, { redirect: "error", headers: Object.assign({ Accept: "application/json" }, headers || {}) });
  /* The status and nothing else: an error body can echo the request, and the request carries the key. */
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let body;
  /* A parse error quotes the start of the body, so it is not passed on. */
  try { body = await res.json(); } catch { throw new Error(`HTTP ${res.status}: not JSON`); }
  return { body, headers: res.headers };
}

/** PropLine: the whole slate in one request, the key in a header. */
export async function fetchPropLine(key, fetchImpl = fetch) {
  const url = `${PROPLINE}/v1/sports/football_nfl/odds?markets=${Object.keys(P.MARKETS).join(",")}&bookmakers=${BOOK_KEYS.join(",")}`;
  const { body, headers } = await getJson(url, { "X-API-Key": key }, fetchImpl);
  const left = Number(headers.get("x-daily-remaining"));
  return { events: Array.isArray(body) ? body : [], remaining: Number.isFinite(left) ? left : null, missing: headers.get("x-propline-missing-markets") || "" };
}

/** The Odds API: props come one game at a time and each costs credits, so three markets and a floor. */
export async function fetchOddsApi(key, fetchImpl = fetch, now = Date.now()) {
  const k = encodeURIComponent(key);
  const list = await getJson(`${ODDS_API}/v4/sports/americanfootball_nfl/events?apiKey=${k}`, null, fetchImpl);
  let remaining = Number(list.headers.get("x-requests-remaining"));
  const events = [];
  for (const ev of Array.isArray(list.body) ? list.body : []) {
    if (!(Date.parse(ev.commence_time) > now)) continue;
    if (Number.isFinite(remaining) && remaining < ODDS_API_FLOOR) { console.log(`  stopping: ${remaining} credits left, under the floor of ${ODDS_API_FLOOR}`); break; }
    const one = await getJson(`${ODDS_API}/v4/sports/americanfootball_nfl/events/${encodeURIComponent(ev.id)}/odds?apiKey=${k}&regions=us&oddsFormat=american&markets=${ODDS_API_MARKETS.join(",")}&bookmakers=${BOOK_KEYS.join(",")}`, null, fetchImpl);
    const left = Number(one.headers.get("x-requests-remaining"));
    if (Number.isFinite(left)) remaining = left;
    if (one.body && one.body.id) events.push(one.body);
  }
  return { events, remaining: Number.isFinite(remaining) ? remaining : null, missing: "" };
}

/** Whether the last run left too little of today's allowance to spend more. Pure. */
export function underFloor(last, source, now = Date.now()) {
  if (!last || last.source !== source || last.remaining == null) return false;
  if (source === "propline") {
    /* The quota is a hard reset at 00:00 UTC, so yesterday's balance says nothing about today's. */
    return String(last.fetched).slice(0, 10) === new Date(now).toISOString().slice(0, 10) && last.remaining < PROPLINE_FLOOR;
  }
  return String(last.fetched).slice(0, 7) === new Date(now).toISOString().slice(0, 7) && last.remaining < ODDS_API_FLOOR;
}

function readGlobal(file, name) {
  const f = path.join(DIR, file);
  if (!fs.existsSync(f)) return null;
  const w = {};
  new Function("window", fs.readFileSync(f, "utf8"))(w);
  return w[name] || null;
}

export async function main() {
  const propline = process.env.PROPLINE_API_KEY, oddsApi = process.env.ODDS_API_KEY;
  if (!propline && !oddsApi) {
    console.log("no PROPLINE_API_KEY or ODDS_API_KEY in the environment: nothing fetched, nothing written.");
    return;
  }
  const D = readGlobal("nfl-data.js", "BetHouseNFLData");
  if (!D || !Array.isArray(D.players)) throw new Error("no nfl-data.js: run node fetch-nfl.mjs first");
  const source = propline ? "propline" : "the-odds-api";
  const last = readGlobal(OUT, GLOBAL);
  if (underFloor(last, source)) {
    console.log(`${source}: ${last.remaining} left after the last run, under the floor. Not spending more; the board keeps the last file.`);
    return;
  }
  const overridesFile = path.join(DIR, "props-overrides.json");
  const overrides = fs.existsSync(overridesFile) ? JSON.parse(fs.readFileSync(overridesFile, "utf8")) : {};
  let got;
  try {
    got = propline ? await fetchPropLine(propline) : await fetchOddsApi(oddsApi);
  } catch (e) {
    /* A failed fetch leaves the last file: an hour-old line is better than a board with none, and the page prints its age. */
    console.log(`${source}: ${e.message}. The board keeps the last file.`);
    return;
  }
  const { payload, unmatched } = buildPayload({ events: got.events, D, source, fetched: new Date().toISOString(), remaining: got.remaining, overrides });
  console.log(`${source}: ${got.events.length} events, ${payload.count} offers for ${Object.keys(payload.offers).length} players; ${got.remaining == null ? "balance not reported" : got.remaining + " left"}`);
  if (got.missing) console.log(`  markets the provider did not return: ${got.missing}`);
  if (unmatched.length) {
    const who = new Map();
    /* A feed's name goes to a workflow log: one line, so it cannot start a "::command::". */
    const clean = (s) => String(s).replace(/[\r\n]+/g, " ").replace(/^:+/, "").slice(0, 80);
    for (const u of unmatched) { const k = `${clean(u.player)} (${u.why})`; who.set(k, (who.get(k) || 0) + 1); }
    console.log(`  ${unmatched.length} offers matched nobody on the board, ${who.size} names:`);
    for (const [name, n] of [...who].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`    ${name} x${n}`);
  }
  fs.writeFileSync(path.join(DIR, OUT),
    `/* Written by fetch-props.mjs: the book lines the NFL board shows today. Not an archive. */\nwindow.${GLOBAL} = ${JSON.stringify(payload)};\n`);
  console.log(`wrote ${OUT}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
