/*
 * BetHouse — fetch-weather.mjs
 * The forecast at kickoff for every open outdoor game on the board, from
 * Open-Meteo (keyless), through the points in stadiums.json.
 *
 * What it writes on a game: `wind` (mph at 10 m, the hour of kickoff),
 * `temp` (°F), and `indoor` (true under a roof, from ESPN's venue flag;
 * a dome gets no forecast). The model's wind term (nfl.js windK) reads
 * `wind`; at 0 the number is a fact on the game's panel and nothing else.
 *
 * Everything here is guarded: a venue not on file, a point not geocoded,
 * a forecast that fails or does not reach the kickoff hour leaves the
 * game without a reading, never with a wrong one, and the board builds
 * either way. The pure parts (`windAt`, `weatherFor`) take the fetch as
 * an argument so the tests hand them canned answers.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const METEO = "https://api.open-meteo.com/v1/forecast";

/** stadiums.json's venues, or {} when the file is not there. */
export function loadStadiums(file = path.join(DIR, "stadiums.json")) {
  if (!existsSync(file)) return {};
  /* A missing file is a league without a table; a file that will not parse is a broken commit and says so. */
  try { return JSON.parse(readFileSync(file, "utf8")).venues || {}; } catch (e) { console.warn(`  stadiums: ${file} did not parse (${e.message}); no forecasts this build`); return {}; }
}

/** The hourly reading nearest the kickoff, or null when the forecast does not reach it. */
export function windAt(hourly, kickoffIso) {
  if (!hourly || !Array.isArray(hourly.time) || !hourly.time.length) return null;
  const t = Date.parse(kickoffIso);
  if (!isFinite(t)) return null;
  /* Open-Meteo's hours carry no offset; forecastUrl asks for timezone=UTC,
     so a bare hour is a UTC hour and the kickoff (ISO, with its Z) compares
     to it directly. The two must change together. */
  let best = -1, gap = Infinity;
  hourly.time.forEach((h, i) => { const d = Math.abs(Date.parse(h + (/[Z+]/.test(h) ? "" : "Z")) - t); if (d < gap) { gap = d; best = i; } });
  if (best < 0 || gap > 90 * 60 * 1000) return null; // more than an hour and a half off is not this kickoff
  const w = hourly.wind_speed_10m && hourly.wind_speed_10m[best], tp = hourly.temperature_2m && hourly.temperature_2m[best];
  return { wind: w != null && isFinite(w) ? Math.round(Number(w)) : null, temp: tp != null && isFinite(tp) ? Math.round(Number(tp)) : null };
}

/** The forecast url for a point on the kickoff's day, or null when the kickoff is not a date. */
export function forecastUrl(v, kickoffIso) {
  const m = /^\d{4}-\d{2}-\d{2}/.exec(String(kickoffIso));
  if (!m || !isFinite(v && v.lat) || !isFinite(v && v.lon)) return null;
  const day = m[0];
  return `${METEO}?latitude=${v.lat}&longitude=${v.lon}&hourly=wind_speed_10m,temperature_2m&wind_speed_unit=mph&temperature_unit=fahrenheit&timezone=UTC&start_date=${day}&end_date=${day}`;
}

/**
 * Weather for every game not yet played: {gameId: {wind, temp, indoor}}.
 * `getJson(url)` fetches; a game whose venue is unknown gets nothing, a
 * dome gets {indoor:true} and no forecast, a failed fetch gets nothing.
 */
export async function weatherFor(games, stadiums, getJson, opts = {}) {
  const now = opts.now || Date.now();
  const out = {};
  for (const g of games || []) {
    if (!g || !g.venue || g.completed || !(Date.parse(g.date) > now)) continue;
    const v = stadiums[g.venue];
    if (!v) continue;
    if (v.indoor) { out[g.id] = { indoor: true }; continue; }
    if (v.lat == null || v.lon == null) continue;
    try {
      const url = forecastUrl(v, g.date);
      if (!url) continue;
      const j = await getJson(url);
      const r = windAt(j && j.hourly, g.date);
      if (r && (r.wind != null || r.temp != null)) out[g.id] = { ...r, indoor: false };
    } catch (e) { if (opts.log) opts.log(`  weather ${g.venue}: ${e.message}`); }
  }
  return out;
}

export async function fetchJson(url) {
  /* A stalled connection is a missing reading, not a hung build. */
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}
