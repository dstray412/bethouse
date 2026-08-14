#!/usr/bin/env node
/*
 * BetHouse — fetch-pga.mjs
 * ESPN's golf API → `pga-history.json` (every round score of the season) and
 * `pga-data.js` (this week's field, for the board).
 *
 * Keyless, like statsapi on the baseball side. `site.api.espn.com` needs no
 * account and no rate tier.
 *
 * Two endpoints:
 *   1. scoreboard?dates=YYYYMMDD-YYYYMMDD  → the season's schedule
 *   2. leaderboard?league=pga&event=<id>   → one event, full field, per-round
 *                                            scores and explicit cut status
 *
 * A WORD ON WHICH ENDPOINT
 * ------------------------
 * The date-range scoreboard also carries `linescores`, and it is WRONG: it
 * pads every player to four rounds, so The American Express comes back with
 * 156 players and zero missed cuts. Only the per-event leaderboard has real
 * round counts and the `STATUS_CUT` flag. Never rate players off the bulk
 * feed — it will teach the model that nobody ever misses a cut.
 *
 * The history file is a cache: completed events never change, so a rebuild
 * only fetches events it has not already stored.
 *
 *   node fetch-pga.mjs                # refresh history, then build the board
 *   node fetch-pga.mjs --history-only # just the cache
 *   node fetch-pga.mjs --season 2025  # a different year
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import golf from "./golf.js";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/golf";
const HISTORY_FILE = "pga-history.json";
const DATA_FILE = "pga-data.js";

/*
 * Cut rules live in golf.js, not here.
 *
 * They were duplicated at first and the two copies immediately disagreed:
 * this file had the signature events down as no-cut, which the 2026 results
 * disprove (Genesis, Bay Hill and Memorial each cut about twenty players).
 * A fetcher that labels an event no-cut and a model that cuts it at 50 is
 * worse than either being wrong on its own, so there is one table now.
 */
const { cutRuleFor } = golf;

/* -------------------------------------------------------------------- *
 * Parsing
 * -------------------------------------------------------------------- */

/**
 * One competitor → a flat record.
 *
 * `madeCut` is taken from ESPN's own STATUS_CUT flag rather than inferred
 * from round count, because a player who makes the cut and then withdraws
 * has three rounds and still made it.  `null` means we cannot tell (the
 * event has not been played), which the backtest drops rather than guesses.
 */
export function parseCompetitor(p) {
  const statusName = p?.status?.type?.name || "";
  const rounds = (p?.linescores || [])
    .filter((l) => l && l.value != null)
    .sort((a, b) => (a.period || 0) - (b.period || 0))
    .map((l) => Number(l.value));

  let madeCut = null;
  if (statusName === "STATUS_CUT") madeCut = false;
  else if (statusName === "STATUS_FINISH") madeCut = true;

  return {
    id: String(p?.id ?? ""),
    name: p?.athlete?.displayName || p?.athlete?.fullName || "",
    amateur: !!p?.amateur,
    status: statusName,
    teeTime: p?.status?.teeTime || null,
    rounds,
    madeCut,
  };
}

/** One leaderboard payload → an event record. */
export function parseEvent(json) {
  const e = json?.events?.[0];
  if (!e) return null;
  const c = e.competitions?.[0] || {};
  const course = e.courses?.[0] || {};
  const players = (c.competitors || []).map(parseCompetitor).filter((p) => p.id);

  return {
    id: String(e.id),
    name: e.name || "",
    date: e.date || "",
    state: c.status?.type?.state || "", // pre | in | post
    par: Number(course.shotsToPar) || null,
    course: course.name || "",
    cut: cutRuleFor(e.name).cut,
    excluded: cutRuleFor(e.name).excluded === true,
    players,
  };
}

/** A scoreboard payload → the season schedule (ids and names only). */
export function parseSchedule(json) {
  return (json?.events || [])
    .map((e) => ({
      id: String(e.id),
      name: e.name || "",
      date: e.date || "",
      state: e.competitions?.[0]?.status?.type?.state || "",
      description: e.status?.type?.description || "",
    }))
    .filter((e) => e.id);
}

/* -------------------------------------------------------------------- *
 * Network
 * -------------------------------------------------------------------- */

async function getJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": "BetHouse/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSchedule(year) {
  const json = await getJSON(
    `${ESPN}/pga/scoreboard?dates=${year}0101-${year}1231`,
  );
  return parseSchedule(json);
}

async function fetchEvent(id) {
  return parseEvent(await getJSON(`${ESPN}/leaderboard?league=pga&event=${id}`));
}

/* -------------------------------------------------------------------- *
 * History cache
 * -------------------------------------------------------------------- */

function loadHistory() {
  if (!existsSync(HISTORY_FILE)) return { season: null, events: [] };
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, "utf8"));
  } catch {
    return { season: null, events: [] };
  }
}

/**
 * Refresh the cache of completed events.
 *
 * Only events that are finished AND not already stored get fetched, so a
 * daily run costs one schedule request plus however many tournaments have
 * ended since last time — usually zero or one.
 */
async function refreshHistory(year) {
  const history = loadHistory();
  if (history.season !== year) history.events = [];
  history.season = year;

  const schedule = await fetchSchedule(year);
  const have = new Set(history.events.map((e) => e.id));
  const todo = schedule.filter((e) => e.state === "post" && !have.has(e.id));

  console.log(
    `schedule: ${schedule.length} events, ${have.size} cached, ${todo.length} to fetch`,
  );

  for (const [i, ev] of todo.entries()) {
    try {
      const full = await fetchEvent(ev.id);
      if (!full || !full.players.length) {
        console.log(`  skip ${ev.name} (no field)`);
        continue;
      }
      // Drop events where nobody has a round — cancelled tournaments.
      if (!full.players.some((p) => p.rounds.length)) {
        console.log(`  skip ${ev.name} (no rounds — cancelled?)`);
        continue;
      }
      history.events.push(full);
      const made = full.players.filter((p) => p.madeCut === true).length;
      const cut = full.players.filter((p) => p.madeCut === false).length;
      console.log(
        `  [${i + 1}/${todo.length}] ${full.name} — ${full.players.length} players, ${made} made, ${cut} cut, par ${full.par}`,
      );
      await sleep(250); // be polite; ESPN has no published rate limit
    } catch (err) {
      console.log(`  FAILED ${ev.name}: ${err.message}`);
    }
  }

  history.events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  // Trailing newline: the end-of-file-fixer pre-commit hook adds one
  // otherwise, so every regeneration would show up as a diff against
  // itself and fight whoever commits next.
  writeFileSync(HISTORY_FILE, JSON.stringify(history) + "\n");
  console.log(
    `wrote ${HISTORY_FILE}: ${history.events.length} events, ${history.events.reduce((n, e) => n + e.players.length, 0)} player-events`,
  );
  return { history, schedule };
}

/**
 * The event to put on the board: the one in progress, else the next one up.
 */
export function pickCurrentEvent(schedule, nowISO) {
  const now = nowISO || new Date().toISOString();
  const live = schedule.find((e) => e.state === "in");
  if (live) return live;
  const upcoming = schedule
    .filter((e) => e.state === "pre" && String(e.date) >= now)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (upcoming.length) return upcoming[0];
  return schedule.filter((e) => e.state === "pre").pop() || null;
}

/* -------------------------------------------------------------------- *
 * Main
 * -------------------------------------------------------------------- */

async function main() {
  const args = process.argv.slice(2);
  const yearArg = args.indexOf("--season");
  const year =
    yearArg >= 0 ? Number(args[yearArg + 1]) : new Date().getUTCFullYear();

  const { history, schedule } = await refreshHistory(year);
  if (args.includes("--history-only")) return;

  /*
   * `--event <id>` builds the board for a specific tournament instead of
   * this week's. Useful for looking at a past week, and necessary for
   * checking the make-the-cut board at all during the stretches when the
   * tour is running no-cut events.
   */
  const eventArg = args.indexOf("--event");
  const current =
    eventArg >= 0
      ? schedule.find((e) => e.id === String(args[eventArg + 1])) || {
          id: String(args[eventArg + 1]), name: "", date: "",
        }
      : pickCurrentEvent(schedule);
  if (!current) {
    console.log("no current or upcoming event on the schedule");
    return;
  }
  console.log(`\ncurrent event: ${current.name} (${current.date})`);
  const field = await fetchEvent(current.id);
  if (!field) {
    console.log("could not load the field");
    return;
  }
  console.log(
    `  field ${field.players.length}, par ${field.par}, cut rule ${field.cut === null ? "NONE" : "low " + field.cut + " and ties"}`,
  );

  /*
   * Rate the field here, in Node, from the whole season. The board then
   * runs the same simulation the backtest runs — golf.js is loaded by the
   * page, the tests and backtest-pga.mjs alike, so nobody is looking at
   * numbers that came from a different model than the one that was
   * measured.
   *
   * The scoring-shape pool ships with it, rounded to three decimals
   * because four would double the file to buy nothing.
   */
  /*
   * Only tournaments that finished BEFORE the one on the board. For this
   * week that is everything in the cache anyway, but when `--event` points
   * at a completed tournament it matters: rating a player partly on the
   * week you are about to predict is lookahead, and it would quietly make
   * the preview look sharper than the model really is. Same rule the
   * backtest runs under.
   */
  const priorEvents = history.events.filter(
    (e) => e.id !== field.id && String(e.date) < String(field.date || "9999"),
  );
  const { players: ratings } = golf.buildRatings(priorEvents);
  const residuals = golf.standardizedResiduals(priorEvents);

  const rated = field.players.map((p) => {
    const r = ratings[p.id];
    return {
      id: p.id,
      name: p.name,
      amateur: p.amateur,
      teeTime: p.teeTime,
      skill: r ? Number(r.skill.toFixed(4)) : null,
      rounds: r ? r.rounds : 0,
    };
  });
  const withRating = rated.filter((p) => p.rounds > 0).length;
  console.log(
    `  rated ${withRating}/${rated.length} of the field from ${history.events.length} events`,
  );

  /*
   * The next few tournaments that actually cut.
   *
   * Worth surfacing because for long stretches the answer to "who makes
   * the cut this week" is "nobody misses it". The playoffs and the
   * signature events run limited fields with no cut at all, so a board
   * that only knows about today would sit there looking broken.
   */
  const upcoming = schedule
    .filter((e) => String(e.date) > String(current.date))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((e) => ({ name: e.name, date: e.date, ...cutRuleFor(e.name) }))
    .filter((e) => e.cut != null && !e.excluded)
    .slice(0, 4)
    .map((e) => ({ name: e.name, date: e.date, cut: e.cut }));

  const payload = {
    generated: new Date().toISOString(),
    upcoming,
    event: {
      id: field.id, name: field.name, date: field.date, state: field.state,
      par: field.par, course: field.course, cut: field.cut, excluded: field.excluded,
    },
    field: rated,
    residuals: residuals ? Array.from(residuals, (x) => Number(x.toFixed(3))) : null,
    seasonEvents: history.events.length,
  };

  /*
   * An empty field is a NORMAL state, not an error. Entry lists post a few
   * days before a tournament, so between events ESPN returns the next event
   * with zero competitors -- the BMW Championship six days out has a name, a
   * course and nobody in it.
   *
   * Writing that out would replace a usable board with an empty one, so the
   * previous board is kept instead. This is what happened on 2026-08-14: the
   * FedEx St. Jude finished, the fetcher advanced to a field that did not
   * exist yet, and the refresh workflow's sanity check then failed the whole
   * run -- taking the BASEBALL board down with it for the rest of the day.
   */
  if (!rated.length) {
    console.log(
      `  field for ${field.name} is not posted yet — keeping the previous board`,
    );
    return;
  }

  // A plain global assignment so the page can <script src> it with no build
  // step, exactly like mlb-data.js.
  writeFileSync(
    DATA_FILE,
    `/* generated by fetch-pga.mjs — do not edit */\nwindow.BetHousePGAData = ${JSON.stringify(payload)};\n`,
  );
  console.log(`wrote ${DATA_FILE}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
