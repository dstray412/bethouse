/*
 * BetHouse — fetch-weather.test.mjs
 * The forecast at kickoff for the board's open outdoor games. Oracle:
 * Open-Meteo's hourly shape ({hourly:{time:[iso…], wind_speed_10m:[…],
 * temperature_2m:[…]}}, UTC when asked), stadiums.json's venue rows,
 * and the rule that a missing reading is a missing field, never a wrong
 * one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { windAt, forecastUrl, weatherFor, loadStadiums } from "./fetch-weather.mjs";

const hourly = { time: ["2026-10-04T16:00", "2026-10-04T17:00", "2026-10-04T18:00"], wind_speed_10m: [12.2, 18.6, 21], temperature_2m: [60.4, 61.5, 63] };

test("windAt: the hour nearest the kickoff, rounded; nothing when the forecast does not reach it", () => {
  assert.deepEqual(windAt(hourly, "2026-10-04T17:00Z"), { wind: 19, temp: 62 });
  assert.deepEqual(windAt(hourly, "2026-10-04T17:25Z"), { wind: 19, temp: 62 }, "25 past the hour is still that hour");
  assert.deepEqual(windAt(hourly, "2026-10-04T17:40Z"), { wind: 21, temp: 63 }, "40 past is nearer the next hour");
  assert.equal(windAt(hourly, "2026-10-05T01:00Z"), null, "a kickoff hours past the last reading is not forecast");
  assert.equal(windAt(null, "2026-10-04T17:00Z"), null);
  assert.equal(windAt({ time: [] }, "2026-10-04T17:00Z"), null);
  assert.equal(windAt(hourly, "not a date"), null);
  assert.deepEqual(windAt({ time: ["2026-10-04T17:00"], wind_speed_10m: [null], temperature_2m: [55] }, "2026-10-04T17:00Z"), { wind: null, temp: 55 }, "a null wind is null, not zero");
});

test("forecastUrl: Open-Meteo, mph and Fahrenheit, UTC, the kickoff's day only", () => {
  const u = forecastUrl({ lat: 39.05, lon: -94.48 }, "2026-10-04T17:00Z");
  assert.match(u, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=39\.05&longitude=-94\.48&/);
  assert.match(u, /wind_speed_unit=mph/); assert.match(u, /temperature_unit=fahrenheit/); assert.match(u, /timezone=UTC/);
  assert.match(u, /start_date=2026-10-04&end_date=2026-10-04$/);
  assert.equal(forecastUrl({ lat: 39.05, lon: -94.48 }, "soon"), null, "a kickoff that is not a date asks for nothing");
  assert.equal(forecastUrl({ lat: "x", lon: -94.48 }, "2026-10-04T17:00Z"), null, "a point that is not numbers asks for nothing");
});

test("weatherFor: an open outdoor game at a known point gets its reading; a dome is marked and not fetched; an unknown venue, a played game, a failed fetch and an unreached hour get nothing", async () => {
  const stadiums = {
    "Arrowhead Stadium": { lat: 39.05, lon: -94.48, indoor: false },
    "Caesars Superdome": { lat: 29.95, lon: -90.08, indoor: true },
    "Nowhere Field": { indoor: false },
  };
  const games = [
    { id: "g1", venue: "Arrowhead Stadium", date: "2026-10-04T17:00Z" },
    { id: "g2", venue: "Caesars Superdome", date: "2026-10-04T17:00Z" },
    { id: "g3", venue: "Unknown Park", date: "2026-10-04T17:00Z" },
    { id: "g4", venue: "Arrowhead Stadium", date: "2026-10-01T17:00Z", completed: true },
    { id: "g5", venue: "Nowhere Field", date: "2026-10-04T17:00Z" },
    { id: "g6", venue: "Arrowhead Stadium", date: "2026-10-04T23:00Z" },
    { id: "g7", venue: "Arrowhead Stadium", date: "2026-10-04T18:00Z", fail: true },
  ];
  const calls = [];
  const getJson = async (url) => { calls.push(url); if (calls.length === 3) throw new Error("503"); return { hourly }; };
  const got = await weatherFor(games, stadiums, getJson, { now: Date.parse("2026-10-02T00:00Z") });
  assert.deepEqual(got.g1, { wind: 19, temp: 62, indoor: false });
  assert.deepEqual(got.g2, { indoor: true }, "a dome is marked without a forecast");
  assert.equal(got.g3, undefined, "an unknown venue is left alone");
  assert.equal(got.g4, undefined, "a played game is not forecast");
  assert.equal(got.g5, undefined, "a venue with no point is left alone");
  assert.equal(got.g6, undefined, "a kickoff past the forecast's last hour gets no reading");
  assert.equal(got.g7, undefined, "a failed fetch leaves the game without a reading, never with one");
  assert.equal(calls.length, 3, "one request per open outdoor game with a point, none for a dome");
  assert.doesNotMatch(calls.join(" "), /Superdome|29\.95/);
});

/* Where each country is, as a box: an oracle independent of the script
   that wrote the file, since the first run put Stade de France on
   Réunion and "lat is a number" let it through. */
const BOX = { USA: [24, 50, -125, -66], England: [49.5, 56, -6, 2], France: [42, 51.5, -5, 8.5], Germany: [47, 55.5, 5.5, 15.5], Spain: [36, 44, -9.5, 4.5], Brazil: [-34, 6, -74, -34], Mexico: [14, 33, -118, -86], Australia: [-44, -10, 112, 154] };

test("loadStadiums: the committed file's venues, each point inside its own country; nothing without the file", () => {
  const v = loadStadiums();
  assert.ok(Object.keys(v).length >= 30, "stadiums.json should name every home ground");
  for (const [name, s] of Object.entries(v)) {
    assert.equal(typeof s.indoor, "boolean", name + " has no indoor flag");
    assert.ok(isFinite(s.lat) && isFinite(s.lon), name + " has no point");
    const b = BOX[s.country];
    assert.ok(b, name + ": country " + s.country + " has no box in this test; add one");
    assert.ok(s.lat >= b[0] && s.lat <= b[1] && s.lon >= b[2] && s.lon <= b[3], name + " is not in " + s.country + ": " + s.lat + ", " + s.lon);
  }
  assert.deepEqual(loadStadiums("/nonexistent/stadiums.json"), {});
});
