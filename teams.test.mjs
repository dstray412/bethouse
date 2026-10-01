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
    pit: { p: "000000", s: "ffb612" }, nite: { p: "000000", s: "0a0a0a" }, dark: { p: "000000" } },
  "College football": { "2000": { p: "592d82", s: "b1b3b3" } },
  MLB: { phi: { p: "e81828", s: "002d72" } },
};

test("colour: a team's primary and secondary as #hex, by league and the key faces.js uses; nothing for an unknown team or a bad hex", () => {
  T.use(DATA);
  assert.deepEqual(T.colour("NFL", "CLE"), { primary: "#311d00", secondary: "#ff3c00" }, "the key is case-insensitive like faces.js's");
  assert.deepEqual(T.colour("College football", "2000"), { primary: "#592d82", secondary: "#b1b3b3" });
  assert.deepEqual(T.colour("MLB", "phi"), { primary: "#e81828", secondary: "#002d72" });
  assert.equal(T.colour("NFL", "xxx"), null);
  assert.equal(T.colour("NFL", "bad"), null, "a colour that is not six hex digits is not a colour");
  assert.deepEqual(T.colour("NFL", "one"), { primary: "#123456", secondary: null }, "a team with no secondary keeps its primary");
  assert.equal(T.colour("PGA", "x"), null);
  assert.equal(T.colour("NFL", null), null);
  assert.equal(T.colour("NFL", "<b>"), null, "a key that is not letters and digits is not a key");
  T.use(null);
});

test("stripe: two solid halves for the two teams; a known side beside a transparent one so a miss reads as a miss; nothing when neither is known", () => {
  T.use(DATA);
  // The fixture's seal brown (#311d00, luminance 0.015) is under DARK, so Cleveland paints with its orange.
  assert.equal(T.stripe("NFL", "kc", "cle"), "linear-gradient(90deg,#e31837 0 50%,#ff3c00 50% 100%)");
  assert.equal(T.stripe("NFL", "kc", "xxx"), "linear-gradient(90deg,#e31837 0 50%,transparent 50% 100%)");
  assert.equal(T.stripe("NFL", "xxx", "cle"), "linear-gradient(90deg,transparent 0 50%,#ff3c00 50% 100%)");
  assert.equal(T.stripe("NFL", "xxx", "yyy"), "");
  T.use(null);
});

test("paint: a primary too dark for the site's black surfaces gives way to the secondary; with no usable secondary the team paints nothing, never black", () => {
  T.use(DATA);
  assert.equal(T.paint("NFL", "pit"), "#ffb612", "the Steelers paint gold, not black");
  assert.equal(T.paint("NFL", "kc"), "#e31837");
  assert.equal(T.paint("NFL", "nite"), null, "a near-black secondary is no better than a black primary");
  assert.equal(T.paint("NFL", "dark"), null);
  assert.equal(T.tint("NFL", "dark"), "", "a black team gets no tint rather than an invisible one");
  assert.equal(T.stripe("NFL", "dark", "kc"), "linear-gradient(90deg,transparent 0 50%,#e31837 50% 100%)", "a black team's half is transparent, not black");
  assert.equal(T.paint("NFL", "xxx"), null);
  assert.equal(T.stripe("NFL", "pit", "kc"), "linear-gradient(90deg,#ffb612 0 50%,#e31837 50% 100%)");
  assert.equal(T.tint("NFL", "pit"), "rgba(255,182,18,0.16)");
  assert.ok(T.DARK > 0 && T.DARK < 0.03, "the dark threshold must sit below a navy (0.04) and above the surface (0.006)");
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
