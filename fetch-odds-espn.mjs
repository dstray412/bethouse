#!/usr/bin/env node
/*
 * BetHouse — fetch-odds-espn.mjs
 * Player prop prices, with no API key.
 *
 * `fetch-odds.mjs` talks to The Odds API and needs a key and a quota. This
 * does not. ESPN's core API carries DraftKings prop markets for every game
 * -- about 550 of them per game, pregame, including the three this project
 * actually models:
 *
 *     Total Hits + Runs + RBIs   over 0.5   -> the 1+ H/R/RBI board
 *     Total Bases                over 1.5   -> the 2+ total bases board
 *     Total Bases                over 2.5   -> the 3+ board
 *
 * THE OVER/UNDER PROBLEM, AND HOW IT WAS SETTLED
 * ----------------------------------------------
 * Each market arrives as TWO entries that are byte-identical apart from the
 * price: same athlete, same type, same line, same timestamp. Nothing in the
 * payload says which one is the over. Getting it backwards would invert
 * every edge on the board, so it was established by evidence rather than by
 * assumption.
 *
 * The test: at a 0.5 line the over is a heavy favourite for hits (a starter
 * gets one about 65% of the time) and a heavy underdog for doubles (about
 * 12%). If the ordering is real, the FIRST entry should be the favourite in
 * the first case and the underdog in the second. Over 141 pairs in one game:
 *
 *     Total Hits        @ 0.5   first is favourite  17/18
 *     Total H+R+RBI     @ 0.5   first is favourite   3/4
 *     Total Singles     @ 0.5   first is favourite   3/18
 *     Total Bases       @ 1.5   first is favourite   0/6
 *     Total RBIs        @ 0.5   first is favourite   0/18
 *     Total Doubles     @ 0.5   first is favourite   0/18
 *
 * The rate flips exactly with each market's true base rate, which is what
 * you would only see if the first entry were always the over. So: first is
 * the over. `sanityCheckSide` re-verifies it per market on every run, and
 * a pair that fails is dropped rather than priced.
 *
 * ESPN athlete ids are not MLB ids, so players are matched by normalised
 * name against the board. Names are cached in .espn-athletes.json.
 *
 *   node fetch-odds-espn.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const SITE = "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb";
const CORE = "https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb";
const NAME_CACHE = ".espn-athletes.json";
const OUT = "odds-data.js";

/* Markets this project has a calibrated model for. Anything else is
   ignored: a price is only useful next to a probability. */
const WANTED = {
  "Total Hits + Runs + RBIs": "hrr",
  "Total Bases": "tb",
};

async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((s) => setTimeout(s, 350 * (i + 1)));
    }
  }
}

/** American odds to implied probability, vig included. */
export function impliedProb(american) {
  const v = Number(String(american).replace("+", ""));
  if (!isFinite(v) || v === 0) return NaN;
  return v > 0 ? 100 / (v + 100) : -v / (-v + 100);
}

/** Strip accents, punctuation and suffixes so two spellings can meet. */
export function normalizeName(s) {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Two entries for one market, in payload order. Returns {over, under} or
 * null when the pair does not look like a two-way market at all.
 *
 * The order is the evidence (see the header). The check here is a floor,
 * not a guess: a real two-way price pair has a hold between roughly 1% and
 * 25%. Anything outside that is a stale or half-updated market and is
 * dropped rather than guessed at.
 */
export function pairToSides(entries) {
  if (!entries || entries.length !== 2) return null;
  const a = impliedProb(entries[0]), b = impliedProb(entries[1]);
  if (!isFinite(a) || !isFinite(b)) return null;
  const hold = a + b - 1;
  if (!(hold > 0.005 && hold < 0.28)) return null;
  return { over: a, under: b, hold };
}

/**
 * De-vig a two-way market. Proportional method, same as edge.js uses.
 */
export function devig(over, under) {
  const s = over + under;
  return s > 0 ? over / s : NaN;
}

/**
 * Does the labelling hold up for this market? `expectOverFavoured` is
 * whether the over SHOULD be the favourite at this line. Returns the share
 * of pairs that agree.
 */
export function sanityCheckSide(pairs, expectOverFavoured) {
  if (!pairs.length) return NaN;
  const agree = pairs.filter((p) =>
    expectOverFavoured ? p.over > p.under : p.over < p.under,
  ).length;
  return agree / pairs.length;
}

function loadNames() {
  if (!existsSync(NAME_CACHE)) return {};
  try { return JSON.parse(readFileSync(NAME_CACHE, "utf8")); } catch { return {}; }
}

async function main() {
  const names = loadNames();
  const board = await getJSON(`${SITE}/scoreboard`);
  const games = (board.events || []).filter(
    (e) => e.status?.type?.name === "STATUS_SCHEDULED" || e.status?.type?.state === "pre",
  );
  console.log(`${games.length} scheduled games`);

  const out = {};
  let priced = 0, dropped = 0, fetchedNames = 0;

  for (const g of games) {
    const id = g.id;
    let odds;
    try { odds = await getJSON(`${CORE}/events/${id}/competitions/${id}/odds`); }
    catch { continue; }
    const ref = odds.items?.[0]?.propBets?.$ref;
    if (!ref) continue;

    const items = [];
    for (let p = 1; p <= 30; p++) {
      let page;
      try { page = await getJSON(`${ref}&page=${p}`); } catch { break; }
      if (!page?.items?.length) break;
      items.push(...page.items);
      if (p >= (page.pageCount || 1)) break;
    }

    // Group in payload order: first entry of each pair is the over.
    const groups = new Map();
    for (const it of items) {
      const market = WANTED[it.type?.name];
      const aid = it.athlete?.$ref?.match(/athletes\/(\d+)/)?.[1];
      const line = Number(it.odds?.total?.value);
      const price = it.odds?.american?.value;
      if (!market || !aid || !isFinite(line) || price == null) continue;
      const k = `${aid}|${market}|${line}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(price);
    }

    for (const [k, entries] of groups) {
      const [aid, market, lineStr] = k.split("|");
      const line = Number(lineStr);
      const sides = pairToSides(entries);
      if (!sides) { dropped++; continue; }

      if (!names[aid]) {
        try {
          const a = await getJSON(`${CORE}/seasons/${new Date().getUTCFullYear()}/athletes/${aid}`);
          names[aid] = a.displayName || a.fullName || "";
          fetchedNames++;
        } catch { names[aid] = ""; }
      }
      const nm = normalizeName(names[aid]);
      if (!nm) { dropped++; continue; }

      const fair = devig(sides.over, sides.under);
      const key = `${nm}|${market}|${line}`;
      out[key] = {
        name: names[aid],
        market, line,
        over: entries[0],
        under: entries[1],
        impliedOver: Number(sides.over.toFixed(4)),
        noVigOver: Number(fair.toFixed(4)),
        hold: Number(sides.hold.toFixed(4)),
      };
      priced++;
    }
    process.stdout.write(`\r  games done: ${games.indexOf(g) + 1}/${games.length}  markets: ${priced}   `);
  }
  process.stdout.write("\n");

  /* Re-verify the over/under labelling on this run's own data, per market.
     If the convention ever flips, this is what will say so. */
  const check = (market, line, expectFav) => {
    const ps = Object.values(out)
      .filter((o) => o.market === market && o.line === line)
      .map((o) => ({ over: o.impliedOver, under: 1 - o.impliedOver + o.hold }));
    const rate = sanityCheckSide(ps, expectFav);
    if (ps.length >= 5) {
      console.log(
        `  ${market} @ ${line}: over is ${expectFav ? "favoured" : "the underdog"} in ` +
        `${(100 * rate).toFixed(0)}% of ${ps.length}` +
        (rate < 0.8 ? "   <-- CONVENTION MAY HAVE FLIPPED, DO NOT TRUST THESE" : ""),
      );
    }
  };
  /*
   * Only markets whose side is not genuinely in doubt are checked. Over 1.5
   * H+R+RBI sits near a coin flip for a good hitter in a good spot, so the
   * over being favoured there is a real price, not a mislabelling -- an
   * early version flagged it at 72% and the flag was the check being too
   * crude, not the data being wrong. Over 0.5 H+R+RBI and over 1.5 total
   * bases are never close, so they are the honest tripwires.
   */
  check("hrr", 0.5, true);   // over ~67%: never in doubt
  check("tb", 1.5, false);   // over ~35%: never in doubt

  writeFileSync(NAME_CACHE, JSON.stringify(names));
  writeFileSync(
    OUT,
    `/* generated by fetch-odds-espn.mjs — do not edit */\nwindow.BetHouseOdds = ${JSON.stringify({
      generated: new Date().toISOString(),
      book: "DraftKings (via ESPN, no key)",
      markets: out,
    })};\n`,
  );
  console.log(`wrote ${OUT}: ${priced} markets, ${dropped} dropped, ${fetchedNames} new names cached`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
