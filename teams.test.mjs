/*
 * BetHouse — teams.test.mjs
 * Team colours for the home's game cards, the drawer's hero and the tray
 * cards (B2). Oracle: DESIGN.md's rule that a team colour is a stripe or
 * a tint behind white text and never a text colour, and ESPN's team feed,
 * which gives each team a six-hex `color` and `alternateColor`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import T from "./teams.js";

const DATA = {
  NFL: { cle: { p: "311d00", s: "ff3c00" }, kc: { p: "e31837", s: "ffb81c" }, bad: { p: "zzz", s: "ffffff" }, one: { p: "123456" },
    pit: { p: "000000", s: "ffb612" }, lite: { p: "ffffff", s: "1a3a6b" }, glare: { p: "ffffff", s: "f4f4f4" }, pale: { p: "f7f7f7" } },
  MLB: { phi: { p: "e81828", s: "002d72" } },
};

test("colour: a team's primary and secondary as #hex, by league and the key faces.js uses; nothing for an unknown team or a bad hex", () => {
  T.use(DATA);
  assert.deepEqual(T.colour("NFL", "CLE"), { primary: "#311d00", secondary: "#ff3c00" }, "the key is case-insensitive like faces.js's");
  assert.deepEqual(T.colour("MLB", "phi"), { primary: "#e81828", secondary: "#002d72" });
  assert.equal(T.colour("NFL", "xxx"), null);
  assert.equal(T.colour("NFL", "bad"), null, "a colour that is not six hex digits is not a colour");
  assert.deepEqual(T.colour("NFL", "one"), { primary: "#123456", secondary: null }, "a team with no secondary keeps its primary");
  assert.equal(T.colour("Curling", "x"), null, "a league the table does not carry");
  assert.equal(T.colour("NFL", null), null);
  assert.equal(T.colour("NFL", "<b>"), null, "a key that is not letters and digits is not a key");
  T.use(null);
});

test("stripe: two solid halves for the two teams; a known side beside a transparent one so a miss reads as a miss; nothing when neither is known", () => {
  T.use(DATA);
  // The fixture's seal brown (#311d00) is dark, which on paper is visible: Cleveland paints with it, not the orange.
  assert.equal(T.stripe("NFL", "kc", "cle"), "linear-gradient(90deg,#e31837 0 50%,#311d00 50% 100%)");
  assert.equal(T.stripe("NFL", "kc", "xxx"), "linear-gradient(90deg,#e31837 0 50%,transparent 50% 100%)");
  assert.equal(T.stripe("NFL", "xxx", "cle"), "linear-gradient(90deg,transparent 0 50%,#311d00 50% 100%)");
  assert.equal(T.stripe("NFL", "xxx", "yyy"), "");
  T.use(null);
});

test("paint: a primary too light for the site's paper surfaces gives way to the secondary; with no usable secondary the team paints nothing, never white; black is the most visible colour on paper and paints as itself", () => {
  T.use(DATA);
  assert.equal(T.paint("NFL", "pit"), "#000000", "the Steelers paint black on paper (they painted gold on the black board, until 2026-10-16)");
  assert.equal(T.paint("NFL", "kc"), "#e31837");
  assert.equal(T.paint("NFL", "lite"), "#1a3a6b", "a white primary gives way to the secondary");
  assert.equal(T.paint("NFL", "glare"), null, "a near-white secondary is no better than a white primary");
  assert.equal(T.paint("NFL", "pale"), null);
  assert.equal(T.tint("NFL", "pale"), "", "a white team gets no tint rather than an invisible one");
  assert.equal(T.stripe("NFL", "pale", "kc"), "linear-gradient(90deg,transparent 0 50%,#e31837 50% 100%)", "a white team's half is transparent, not white");
  assert.equal(T.paint("NFL", "xxx"), null);
  assert.equal(T.stripe("NFL", "pit", "kc"), "linear-gradient(90deg,#000000 0 50%,#e31837 50% 100%)");
  assert.equal(T.tint("NFL", "pit"), "rgba(0,0,0,0.16)");
  assert.ok(T.LIGHT > 0.6 && T.LIGHT < 0.93, "the light threshold must sit above a silver like #c4ced4 (0.6) and below the ground (0.93)");
  T.use(null);
});

test("tint: the primary at a stated alpha, as rgba; nothing for an unknown team", () => {
  T.use(DATA);
  assert.equal(T.tint("NFL", "kc", 0.18), "rgba(227,24,55,0.18)");
  assert.equal(T.tint("NFL", "xxx", 0.18), "");
  assert.equal(T.tint("NFL", "kc"), "rgba(227,24,55,0.16)", "the default alpha is the faint one DESIGN.md names");
  // The alpha is the one input that does not pass through the hex gate: anything but a number in [0,1] falls back.
  assert.equal(T.tint("NFL", "kc", "0.5);background:url(x)"), "rgba(227,24,55,0.16)");
  assert.equal(T.tint("NFL", "kc", 5), "rgba(227,24,55,0.16)");
  assert.equal(T.tint("NFL", "kc", -1), "rgba(227,24,55,0.16)");
  assert.equal(T.tint("NFL", "kc", NaN), "rgba(227,24,55,0.16)");
  T.use(null);
});

test("without a data table every call is empty, so a page that lost teams-data.js keeps its shape", () => {
  T.use(null);
  assert.equal(T.colour("NFL", "kc"), null);
  assert.equal(T.stripe("NFL", "kc", "cle"), "");
  assert.equal(T.tint("NFL", "kc"), "");
});

test("every value is a CSS colour value and nothing else: no markup, no quotes, no semicolons", () => {
  T.use({ NFL: { x: { p: "aabbcc", s: "ddeeff" } } });
  for (const v of [T.stripe("NFL", "x", "x"), T.stripe("NFL", "x", "nope"), T.tint("NFL", "x"), T.colour("NFL", "x").primary]) {
    assert.match(v, /^[#a-z0-9(),.% -]+$/i, "not a bare colour value: " + v);
  }
  T.use(null);
});
