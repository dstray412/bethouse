/*
 * BetHouse — dom.test.mjs
 * The gate that would have caught this session's design bugs.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The suite had 202 tests and not one of them looked at a page. score.js,
 * edge.js, golf.js and nfl.js were covered to the decimal place while the
 * three HTML boards -- the entire thing a user actually sees -- had no
 * coverage at all. A design review then found five defects on a fully green
 * suite, including two controls that rendered on every view and did nothing.
 * The gate and the failures did not overlap anywhere.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not render anything. There is no jsdom, no headless browser, no
 * package.json, because "no build step, no server, no API key" is a real
 * property of this project and a test dependency would be the first crack
 * in it. Nor does it skip when a browser is missing: a gate that reports
 * success while quietly running nothing is worse than no gate.
 *
 * So it asserts SOURCE INVARIANTS instead -- the things that were actually
 * broken, in the form they were actually broken in. Every assertion below
 * is a regression test for a real defect, and each was checked against the
 * pre-fix source to confirm it fails there.
 *
 * Runtime behaviour (horizontal scroll, console errors, computed contrast)
 * stays in `/design-review`, which drives a real browser on demand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const BOARDS = ["index.html", "golf.html", "nfl.html"];
const src = (f) => readFileSync(resolve(DIR, f), "utf8");

/*
 * Markup only, with <script> bodies removed.
 *
 * The first version of the duplicate-id check scanned raw source and
 * reported nfl.html as defining the id `why'+i+'` three times. That is a
 * JavaScript string concatenation appearing once per view renderer, not a
 * duplicated DOM id -- the regex was reading JS as if it were HTML. Style
 * blocks are deliberately KEPT, because the CSS assertions above need them.
 */
const markup = (f) => src(f).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

/* ------------------------------------------------------------------ *
 * FINDING-001 — the hidden attribute must actually hide
 *
 * .ctl and .controls declare display:flex. An author style beats the UA
 * stylesheet's [hidden]{display:none} regardless of specificity, so
 * `el.hidden = true` silently did nothing: the Bases control sat on every
 * bet type and the NFL yardage control on two views of three, both inert.
 * ------------------------------------------------------------------ */

test("every board neutralises the hidden-attribute override", () => {
  for (const f of BOARDS) {
    const css = src(f);
    assert.match(
      css,
      /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*\}/,
      `${f} is missing [hidden]{display:none!important} — any class that sets ` +
        `display will beat the attribute and leave dead controls on screen`,
    );
  }
});

test("nothing re-introduces a display rule that could outrank it", () => {
  // The !important above wins, but only while nothing else is !important.
  for (const f of BOARDS) {
    const bad = src(f).match(/\.(ctl|controls)[^{]*\{[^}]*display\s*:[^;}]*!important/g);
    assert.equal(
      bad, null,
      `${f} declares display !important on .ctl/.controls, which would tie with ` +
        `the [hidden] rule and reopen FINDING-001`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * FINDING-002 — prose needs a measure
 *
 * The paragraph carrying the calibration caveats ran 166 characters per
 * line against a 45-75 target. Long measure is the readability defect that
 * matters: past ~75 the eye loses the next line on the return sweep.
 * ------------------------------------------------------------------ */

test("the explanatory paragraph has a capped measure", () => {
  for (const f of BOARDS) {
    const rule = src(f).match(/\.note\{[^}]*\}/);
    assert.ok(rule, `${f} has no .note rule`);
    assert.match(
      rule[0], /max-width\s*:\s*\d+ch/,
      `${f}: .note has no ch-based max-width, so it will run the full column ` +
        `width — this is how it reached 166 characters per line`,
    );
  }
});

test("the measure cap is set in ch, and low enough to mean it", () => {
  /*
   * 1ch is the advance width of "0", which is wider than average prose:
   * max-width:72ch measured 93 real characters here. Anything above ~60ch
   * is over the 75-character limit in practice regardless of what the
   * number looks like.
   */
  for (const f of BOARDS) {
    const m = src(f).match(/\.note\{[^}]*max-width\s*:\s*(\d+)ch/);
    assert.ok(m, `${f}: .note max-width is not in ch`);
    const ch = Number(m[1]);
    assert.ok(
      ch <= 60,
      `${f}: .note is capped at ${ch}ch. 1ch is the width of "0" and wider than ` +
        `average prose, so ${ch}ch renders roughly ${Math.round(ch * 1.3)} characters ` +
        `— over the 75-character limit. 56ch is the measured value for 72 characters.`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * Copy-paste drift — the root cause behind FINDING-001 and FINDING-004
 *
 * The three boards do not share a stylesheet, they share a copy of one.
 * Two separate findings this session were the copies diverging. Pin the
 * design tokens so a change to one board that should apply to all cannot
 * silently apply to one.
 * ------------------------------------------------------------------ */

test("the design tokens are identical across all three boards", () => {
  const blocks = BOARDS.map((f) => {
    const m = src(f).match(/:root\{[^}]*\}/);
    assert.ok(m, `${f} has no :root token block`);
    return [f, m[0]];
  });
  const [, first] = blocks[0];
  for (const [f, block] of blocks.slice(1)) {
    assert.equal(
      block, first,
      `${f}'s :root tokens have drifted from ${blocks[0][0]}'s. These boards share ` +
        `a stylesheet by copy, and divergence is what produced both the dead-control ` +
        `bug and the inconsistent navigation names.`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * FINDING-004 — wayfinding
 *
 * The same destination had two names depending on where you stood, and the
 * baseball board never said which board it was: the only signal of location
 * was which nav link happened to be absent.
 * ------------------------------------------------------------------ */

test("every board links to the other two, and nowhere broken", () => {
  for (const f of BOARDS) {
    const hrefs = [...src(f).matchAll(/class="navlink"\s+href="([^"]+)"/g)].map((m) => m[1]);
    const others = BOARDS.filter((b) => b !== f);
    assert.equal(
      hrefs.length, others.length,
      `${f} has ${hrefs.length} nav links, expected ${others.length} (one per sibling board)`,
    );
    for (const o of others) {
      assert.ok(hrefs.includes(o), `${f} does not link to ${o}`);
    }
    for (const h of hrefs) {
      assert.ok(existsSync(resolve(DIR, h)), `${f} links to ${h}, which does not exist`);
    }
  }
});

test("a destination has ONE name everywhere it is linked", () => {
  const names = new Map(); // href -> Set of link texts
  for (const f of BOARDS) {
    for (const m of src(f).matchAll(/class="navlink"\s+href="([^"]+)">([^<]+)</g)) {
      const href = m[1];
      const label = m[2].replace(/[→\s]+$/u, "").trim();
      if (!names.has(href)) names.set(href, new Set());
      names.get(href).add(label);
    }
  }
  for (const [href, set] of names) {
    assert.equal(
      set.size, 1,
      `${href} is called ${[...set].map((s) => `"${s}"`).join(" and ")} depending on which ` +
        `board you are standing on. A section that renames itself stops users building a ` +
        `map of the site.`,
    );
  }
});

test("every board states which board it is", () => {
  for (const f of BOARDS) {
    const s = src(f);
    const hasStatic = /class="tagline"[^>]*>[^<]*\S[^<]*</.test(s);
    const hasDynamic = /tagline'\)\.textContent\s*=\s*'[A-Z]/.test(s);
    assert.ok(
      hasStatic || hasDynamic,
      `${f} has an empty tagline — the page never names itself, so the only clue to ` +
        `where you are is which nav link is missing (the trunk test failing)`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * Assets — a board that cannot load its own model is a blank page
 * ------------------------------------------------------------------ */

test("every script and stylesheet a board loads actually exists", () => {
  for (const f of BOARDS) {
    const s = src(f);
    const refs = [
      ...[...s.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]),
      ...[...s.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]),
    ].filter((r) => !/^https?:/.test(r));
    assert.ok(refs.length, `${f} loads no local assets, which cannot be right`);
    for (const r of refs) {
      assert.ok(existsSync(resolve(DIR, r)), `${f} loads ${r}, which does not exist in the repo`);
    }
  }
});

test("no board defines the same id twice", () => {
  for (const f of BOARDS) {
    const ids = [...markup(f).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(
      [...new Set(dupes)], [],
      `${f} defines duplicate ids, so getElementById silently returns whichever came first`,
    );
  }
});
