/*
 * BetHouse — fetch-odds.mjs
 * Pulls live odds from The Odds API and writes odds-data.js.
 *
 *   node fetch-odds.mjs --check        free: verify key + list what's in season
 *   node fetch-odds.mjs                pull the sports that are in season
 *   node fetch-odds.mjs --sports mlb   pull one sport
 *   node fetch-odds.mjs --force        ignore the freshness cache
 *
 * Key: put it in .env as ODDS_API_KEY=..., or export it, or pass --key=...
 *
 * CREDITS. The free tier is 500/month and the API charges
 * (markets × regions) per request. This script therefore:
 *   - discovers sports via /v4/sports, which is free and uncharged
 *   - refuses to run below a reserve floor
 *   - records every charge in .odds-quota.json so you can see the burn
 * See the budget table in README.md before adding markets or regions.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const API = "https://api.the-odds-api.com/v4";
const QUOTA_FILE = path.join(DIR, ".odds-quota.json");
const OUT_FILE = path.join(DIR, "odds-data.js");

/* ---------------------------------------------------------------- *
 * Config
 * ---------------------------------------------------------------- */

/**
 * Only `us` by default: each extra region multiplies the cost of every
 * request. Adding `eu` would buy you Pinnacle — the sharpest reference
 * there is — at double the credit burn. Worth it on a paid tier.
 */
const REGIONS = "us";

/** Freshness window. Lines move, but not enough to justify re-burning credits. */
const CACHE_MINUTES = 20;

/** Stop pulling with this many credits left, so a bad loop can't drain the month. */
const RESERVE = 25;

/**
 * Which sports we care about, and how to find them.
 *
 * Golf is matched by group rather than by key: the tour's weekly event
 * keys change through the season (each major has its own key), so
 * hardcoding them would silently stop working in April. Discovery via
 * the free endpoint is both cheaper and more durable.
 */
const WANTED = {
  mlb: { match: (s) => s.key === "baseball_mlb", markets: ["h2h", "totals"], label: "MLB" },
  nfl: { match: (s) => s.key === "americanfootball_nfl", markets: ["h2h", "spreads", "totals"], label: "NFL" },
  nba: { match: (s) => s.key === "basketball_nba", markets: ["h2h", "spreads", "totals"], label: "NBA" },
  pga: { match: (s) => s.group === "Golf", markets: ["outrights"], label: "PGA Tour" },
};

/* ---------------------------------------------------------------- *
 * Plumbing
 * ---------------------------------------------------------------- */

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const flagValue = (f) => {
  const hit = args.find((a) => a.startsWith(f + "="));
  return hit ? hit.slice(f.length + 1) : null;
};

function loadKey() {
  const fromFlag = flagValue("--key");
  if (fromFlag) return fromFlag.trim();
  if (process.env.ODDS_API_KEY) return process.env.ODDS_API_KEY.trim();
  const envPath = path.join(DIR, ".env");
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, "utf8").match(/^\s*ODDS_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

function readQuota() {
  try {
    return JSON.parse(fs.readFileSync(QUOTA_FILE, "utf8"));
  } catch {
    return { used: null, remaining: null, history: [] };
  }
}

function writeQuota(q) {
  q.history = (q.history || []).slice(-40);
  fs.writeFileSync(QUOTA_FILE, JSON.stringify(q, null, 2));
}

async function apiGet(url, { free = false } = {}) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const remaining = Number(res.headers.get("x-requests-remaining"));
  const used = Number(res.headers.get("x-requests-used"));
  const cost = Number(res.headers.get("x-requests-last"));

  if (!res.ok) {
    const body = await res.text();
    let msg = body;
    try {
      msg = JSON.parse(body).message || body;
    } catch {}
    const err = new Error(`HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  if (!free && isFinite(remaining)) {
    const q = readQuota();
    q.used = used;
    q.remaining = remaining;
    q.history.push({ at: new Date().toISOString(), cost: cost || 0, remaining });
    writeQuota(q);
  }
  return { data, remaining, used, cost };
}

/** Never print the key, not even partially, in case output gets pasted. */
function redact(url) {
  return url.replace(/apiKey=[^&]+/, "apiKey=***");
}

/* ---------------------------------------------------------------- *
 * Steps
 * ---------------------------------------------------------------- */

/** Free endpoint — does not consume a credit. Confirms the key works too. */
async function discoverSports(key) {
  const { data } = await apiGet(`${API}/sports/?apiKey=${key}`, { free: true });
  const found = {};
  for (const [id, cfg] of Object.entries(WANTED)) {
    const matches = data.filter(cfg.match);
    found[id] = {
      label: cfg.label,
      markets: cfg.markets,
      // `active` means the sport is in season and has events listed.
      events: matches.filter((s) => s.active).map((s) => ({ key: s.key, title: s.title })),
      inactive: matches.filter((s) => !s.active).length,
    };
  }
  return found;
}

async function fetchSportOdds(key, sportKey, markets) {
  const url =
    `${API}/sports/${sportKey}/odds/?apiKey=${key}` +
    `&regions=${REGIONS}&markets=${markets.join(",")}` +
    `&oddsFormat=american&dateFormat=iso`;
  const { data, cost, remaining } = await apiGet(url);
  return { events: data, cost, remaining, url: redact(url) };
}

/**
 * Flatten the API shape into what the app consumes.
 *
 * The app stores raw prices, not computed edges, so you can switch
 * de-vig method in the UI and see the numbers move without re-fetching.
 */
function normalize(events, sportId, sportLabel) {
  const out = [];
  for (const ev of events || []) {
    const markets = new Map(); // marketKey -> books[]
    for (const bm of ev.bookmakers || []) {
      for (const mk of bm.markets || []) {
        if (!markets.has(mk.key)) markets.set(mk.key, []);
        markets.get(mk.key).push({
          book: bm.title,
          updated: bm.last_update,
          outcomes: (mk.outcomes || []).map((o) => ({
            name: o.name,
            price: o.price,
            point: o.point == null ? undefined : o.point,
          })),
        });
      }
    }
    for (const [marketKey, books] of markets) {
      if (books.length < 2) continue; // one book is not a market
      out.push({
        sport: sportId,
        sportLabel,
        eventId: ev.id,
        home: ev.home_team,
        away: ev.away_team,
        commence: ev.commence_time,
        market: marketKey,
        books,
      });
    }
  }
  return out;
}

function isFresh() {
  if (!fs.existsSync(OUT_FILE)) return false;
  const ageMin = (Date.now() - fs.statSync(OUT_FILE).mtimeMs) / 60000;
  return ageMin < CACHE_MINUTES;
}

function writeOut(payload) {
  const banner =
    "/* Generated by fetch-odds.mjs — do not edit by hand. */\n" +
    `/* fetched ${payload.fetchedAt} */\n`;
  fs.writeFileSync(OUT_FILE, banner + "window.BETHOUSE_ODDS = " + JSON.stringify(payload) + ";\n");
}

/* ---------------------------------------------------------------- *
 * Main
 * ---------------------------------------------------------------- */

async function main() {
  const key = loadKey();
  if (!key) {
    console.error(
      [
        "No API key found.",
        "",
        "  1. Get a free one (500 credits/month, no card): https://the-odds-api.com/#get-access",
        "  2. Save it:  echo 'ODDS_API_KEY=your_key_here' > .env",
        "  3. Verify:   node fetch-odds.mjs --check     (free, costs no credits)",
        "",
        "Until then the app runs on sample-odds.js and says so on screen.",
      ].join("\n")
    );
    process.exit(1);
  }

  let sports;
  try {
    sports = await discoverSports(key);
  } catch (e) {
    if (e.status === 401) {
      console.error("Key rejected by the API. Check .env for typos or stray quotes.");
      process.exit(1);
    }
    throw e;
  }

  console.log("In season right now:");
  for (const [id, s] of Object.entries(sports)) {
    const n = s.events.length;
    console.log(
      `  ${s.label.padEnd(9)} ${n ? `${n} board(s): ${s.events.map((e) => e.title).join(", ")}` : "— off-season / nothing listed"}`
    );
  }

  const quota = readQuota();
  if (quota.remaining != null) console.log(`\nCredits remaining (last seen): ${quota.remaining}`);

  if (hasFlag("--check")) {
    console.log("\n--check only: no odds pulled, no credits spent.");
    return;
  }

  const only = flagValue("--sports");
  const targets = Object.entries(sports).filter(
    ([id, s]) => s.events.length && (!only || only.split(",").includes(id))
  );

  if (!targets.length) {
    console.log("\nNothing to pull. Every requested sport is off-season.");
    return;
  }

  const estimate = targets.reduce((sum, [, s]) => sum + s.markets.length * s.events.length, 0);
  console.log(`\nEstimated cost: ${estimate} credits (${REGIONS} region, markets × boards).`);

  if (quota.remaining != null && quota.remaining - estimate < RESERVE) {
    console.error(
      `Refusing to pull: would leave under the ${RESERVE}-credit reserve. ` +
        `Use --force to override, or wait for the monthly reset.`
    );
    if (!hasFlag("--force")) process.exit(1);
  }

  if (isFresh() && !hasFlag("--force")) {
    console.log(`odds-data.js is under ${CACHE_MINUTES} min old. Use --force to refetch.`);
    return;
  }

  const markets = [];
  let spent = 0;
  for (const [id, s] of targets) {
    for (const board of s.events) {
      try {
        const { events, cost, remaining } = await fetchSportOdds(key, board.key, s.markets);
        const rows = normalize(events, id, s.label);
        markets.push(...rows);
        spent += cost || 0;
        console.log(
          `  ${s.label.padEnd(9)} ${board.title.padEnd(28)} ${rows.length} markets  ` +
            `(cost ${cost ?? "?"}, ${remaining ?? "?"} left)`
        );
      } catch (e) {
        // One dead board shouldn't lose the boards that already succeeded.
        console.error(`  ${s.label}: ${board.key} failed — ${e.message}`);
      }
    }
  }

  if (!markets.length) {
    console.error("\nNo markets returned. Leaving the existing odds-data.js in place.");
    process.exit(1);
  }

  const q = readQuota();
  writeOut({
    fetchedAt: new Date().toISOString(),
    regions: REGIONS,
    markets,
    quota: { remaining: q.remaining, used: q.used },
  });

  const bySport = markets.reduce((m, r) => ((m[r.sportLabel] = (m[r.sportLabel] || 0) + 1), m), {});
  console.log(
    `\nWrote odds-data.js — ${markets.length} markets ` +
      `(${Object.entries(bySport).map(([k, v]) => `${k} ${v}`).join(", ")}), ${spent} credits spent.`
  );
}

main().catch((e) => {
  console.error("\nFetch failed:", e.message);
  process.exit(1);
});
