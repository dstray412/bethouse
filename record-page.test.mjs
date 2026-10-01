/*
 * BetHouse — record-page.test.mjs
 * The record page: every league's forward record and its parlays, from
 * the record files the trackers write, rendered once for the whole site.
 *
 * Oracle: the record files' shape (track-core.mjs writes {days, total,
 * props:{k:{label,n,predicted,actual,bias,brier}}, picks, parlays}) and
 * the words the football footer used to print under every table.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import page from "./record-page.js";

const R = {
  days: ["2026-09-10", "2026-09-18", "2026-09-25"], total: 2360,
  props: {
    td: { label: "Anytime touchdown", n: 816, predicted: 21.9, actual: 20.7, bias: 1.2, brier: 0.1507 },
    recyds: { label: "Receiving yards, over", n: 457, predicted: 41, actual: 42.9, bias: -1.9, brier: 0.2438 },
  },
  picks: { spread: { n: 47, rate: 44.7, lo: 30.4, hi: 59, clvPts: 0.28, movedToward: 42.6 }, ml: { n: 48, rate: 66.7, lo: 52.5, hi: 80.8 } },
  parlays: { "slate|3|td": { scope: "slate", legs: 3, tag: "td", n: 1, adjusted: 0.188, cashed: 0 }, "game|3": { scope: "game", legs: 3, n: 28, adjusted: 0.155, cashed: 9 } },
};

test("the live record: one row per prop with n, predicted, actual, bias and Brier; the picks with their interval and CLV", () => {
  const h = page.liveRecord(R);
  assert.match(h, /<b>2,360<\/b> graded predictions over 3 weeks/);
  assert.match(h, /<td>Anytime touchdown<\/td><td>n <b>816<\/b> · predicted <b>21\.9%<\/b>, actual <b>20\.7%<\/b> · off by <b>\+1\.2pp<\/b> · Brier <b>0\.1507<\/b>/);
  assert.match(h, /off by <b>\u22121\.9pp<\/b>/, "a negative bias must carry a real minus sign, as the boards do");
  assert.match(h, /spread picks<\/td><td>n <b>47<\/b> · won <b>44\.7%<\/b> \(30\.4–59%\), needs 52\.4% · closing line moved toward the pick <b>42\.6%<\/b> of the time, <b>\+0\.28<\/b> pts on average/);
  assert.match(h, /moneyline picks<\/td><td>n <b>48<\/b> · won <b>66\.7%<\/b> \(52\.5–80\.8%\), needs 52\.4%<\/td>/, "a pick family without CLV must not print one");
  assert.doesNotMatch(h, /Far too few/, "2,360 is not too few");
  assert.match(page.liveRecord(Object.assign({}, R, { total: 120 })), /Far too few to mean anything yet/);
});

test("no record, or an empty one, says so instead of printing a table", () => {
  assert.match(page.liveRecord(null), /nothing graded yet/);
  assert.match(page.liveRecord({ total: 0, days: [], props: {} }), /nothing graded yet/);
  assert.doesNotMatch(page.liveRecord(null), /<table>/);
});

test("the parlays: each kind with its count, what it said and what cashed", () => {
  const h = page.parlayRecord(R);
  assert.match(h, /slate, 3 legs \(touchdowns\)<\/td><td>1 slip · said <b>18\.8%<\/b> · cashed <b>0\.0%<\/b>/);
  assert.match(h, /one game, 3 legs<\/td><td>28 slips · said <b>15\.5%<\/b> · cashed <b>32\.1%<\/b>/);
  assert.equal(page.parlayRecord({ total: 5, props: {} }), "", "a record with no parlays prints no parlay table");
  assert.equal(page.parlayRecord(null), "");
});

test("render fills each league's slot from its global, and leaves a league with no record file saying so", () => {
  const slots = {};
  const doc = { getElementById: (id) => (slots[id] = slots[id] || { innerHTML: "" }) };
  page.render(doc, { nfl: R, cfb: null });
  assert.match(slots["nfl-live"].innerHTML, /<b>2,360<\/b> graded/);
  assert.match(slots["nfl-live"].innerHTML, /Suggested parlays/);
  assert.match(slots["cfb-live"].innerHTML, /nothing graded yet/);
});

test("every label the record carries is escaped before it is printed", () => {
  const h = page.liveRecord({ total: 9, days: ["d"], props: { x: { label: "<img src=x onerror=alert(1)>", n: 9, predicted: 1, actual: 1, bias: 0, brier: 0.1 } } });
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img/);
});
