#!/usr/bin/env node
/*
 * BetHouse — fetch-stadiums.mjs
 * Where each NFL game is played, as a point a weather forecast can be
 * asked for → `stadiums.json`.
 *
 * ESPN's team list names each franchise's venue (name, city, state,
 * country, and whether it is indoors) and the scoreboard names the venue
 * of every scheduled game, neutral sites included. Neither carries
 * coordinates, so the city is geocoded once through Open-Meteo's keyless
 * geocoding API, and the point is written beside the venue. A dome needs
 * no forecast and is marked so the fetcher asks for none.
 *
 * Keyless, like every fetcher here. Run by hand when a venue changes
 * (a new stadium, a London or Munich week); the file is committed.
 *
 *   node fetch-stadiums.mjs                # new venues only; a point on file is kept
 *   node fetch-stadiums.mjs --regeocode    # every venue again, when a point was wrong
 *
 * TODO(simplify): the point is the city's centroid, not the stadium's;
 * fine while the forecast grid is coarser than the gap (Soldier Field
 * is 3 km from Chicago's, the two London grounds share one point), and
 * the upgrade is a hand-kept lat/lon per venue if a reading is ever
 * compared against a measurement at the ground.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const OUT = "stadiums.json";

/* ESPN gives two-letter states; Open-Meteo names them. */
const STATES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia" };

/* ESPN names a venue's country in words; the geocoder answers in ISO
   codes. A city whose country is not matched is not taken: the first run
   put Stade de France on Réunion (Saint-Denis, RE). */
const COUNTRIES = { USA: "US", "United States": "US", England: "GB", "United Kingdom": "GB", Scotland: "GB", Wales: "GB", Ireland: "IE", France: "FR", Germany: "DE", Spain: "ES", Brazil: "BR", Mexico: "MX", Canada: "CA", Australia: "AU", Japan: "JP" };

const have = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { venues: {} };
const venues = have.venues || {};

async function json(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }

/* Every venue ESPN knows for the league: the 32 home grounds, then the
   venues on this season's schedule (neutral sites arrive here). */
const found = new Map();
const teams = await json(`${ESPN}/teams?limit=40`);
for (const row of teams.sports[0].leagues[0].teams) {
  const v = row.team.franchise && row.team.franchise.venue;
  if (v && v.fullName) found.set(v.fullName, { city: v.address && v.address.city, state: v.address && v.address.state, country: v.address && v.address.country, indoor: !!v.indoor });
}
const year = new Date().getUTCFullYear();
for (let week = 1; week <= 18; week++) {
  try {
    const sb = await json(`${ESPN}/scoreboard?seasontype=2&week=${week}&dates=${year}`);
    for (const e of sb.events || []) {
      const v = e.competitions && e.competitions[0] && e.competitions[0].venue;
      if (v && v.fullName && !found.has(v.fullName)) found.set(v.fullName, { city: v.address && v.address.city, state: v.address && v.address.state, country: v.address && v.address.country, indoor: !!v.indoor });
    }
  } catch (e) { console.log(`  week ${week}: ${e.message}`); }
}
console.log(`${found.size} venues named by ESPN`);

/* Geocode the city once; a venue already on file keeps its point. The
   cache is sticky on purpose (one request a venue, ever), so a wrong
   point is repaired with --regeocode, not by running again. */
const REGEOCODE = process.argv.includes("--regeocode");
let geocoded = 0, kept = 0, failed = 0;
for (const [name, v] of found) {
  const prev = venues[name];
  if (!REGEOCODE && prev && prev.lat != null) { venues[name] = { ...prev, indoor: v.indoor }; kept++; continue; }
  if (!v.city) { failed++; console.log(`  ${name}: no city`); continue; }
  try {
    const q = await json(`${GEO}?name=${encodeURIComponent(v.city)}&count=5&language=en&format=json`);
    const cc = COUNTRIES[v.country] || null;
    if (v.country && !cc) { failed++; console.log(`  ${name}: country "${v.country}" not in the table`); continue; }
    const hits = (q.results || []).filter((h) => h.country_code === (cc || "US"));
    const hit = (v.state ? hits.find((h) => h.admin1 && v.state && (h.admin1 === STATES[v.state] || h.admin1 === v.state)) : null) || hits[0];
    if (!hit) { failed++; console.log(`  ${name}: ${v.city} not geocoded`); continue; }
    venues[name] = { city: v.city, state: v.state || null, country: v.country || null, indoor: v.indoor, lat: Number(hit.latitude.toFixed(4)), lon: Number(hit.longitude.toFixed(4)), geocoded: hit.name + (hit.admin1 ? ", " + hit.admin1 : "") + ", " + hit.country_code };
    geocoded++;
  } catch (e) { failed++; console.log(`  ${name}: ${e.message}`); }
}
console.log(`${geocoded} geocoded, ${kept} kept, ${failed} without a point`);
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), source: "ESPN venues, Open-Meteo geocoding (city)", venues }, null, 1) + "\n");
console.log(`wrote ${OUT}: ${Object.keys(venues).length} venues`);
