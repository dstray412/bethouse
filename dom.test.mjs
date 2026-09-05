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
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const BOARDS = ["index.html", "golf.html", "nfl.html", "cfb.html", "bets.html"];
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
 * The boards do not share a stylesheet, they share a copy of one.
 * Two separate findings this session were the copies diverging. Pin the
 * design tokens so a change to one board that should apply to all cannot
 * silently apply to one.
 * ------------------------------------------------------------------ */

test("the design tokens are identical across every board", () => {
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

test("every board links to every other board, and nowhere broken", () => {
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

/* ------------------------------------------------------------------ *
 * The parlay may only be built on the prop it was measured on
 *
 * index.html hid the SUGGEST control on total bases and home runs, which
 * looked like the scope rule was enforced. It was not: every row still
 * rendered a live + button, so a total-bases slip was two clicks away and
 * arrived carrying "cross-game slips cashed 1.03-1.08x as often as the
 * product predicts" — a measurement taken on 1+ H/R/RBI and nowhere else.
 *
 * A gate on the control alone cannot catch that, so this checks the thing
 * that was actually wrong: the button itself must sit INSIDE the guard.
 * ------------------------------------------------------------------ */

/* The body of the first `if (<needle>) { ... }` in `js`, brace-matched.
   Braces inside strings, template literals, regex literals and comments
   would break a naive counter; the render code has none inside this block,
   and the assertion below fails loudly rather than silently passing if
   that ever stops being true. */
function guardedRanges(js, needle) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = js.indexOf(needle, from);
    if (at < 0) return out;
    /* The needle ends with its own `{`; scanning from `at` finds that brace
       and not the next one down. Getting this wrong once already cost a
       confusing failure, which is the good outcome — the assertions below
       are written so a broken scan reports "outside the guard" rather than
       quietly passing. */
    const open = js.indexOf("{", at);
    if (open < 0) return out;
    let depth = 0;
    let close = -1;
    for (let i = open; i < js.length; i++) {
      if (js[i] === "{") depth++;
      else if (js[i] === "}" && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close < 0) return out;
    out.push([open, close]);
    from = close;
  }
}

test("every add-to-parlay button is built inside the eligibility guard", () => {
  const js = src("index.html");
  assert.ok(
    js.includes("S.parlayEligible("),
    "index.html must ask score.js which views may build a parlay, not re-derive it",
  );

  const guards = guardedRanges(js, "if(S.parlayEligible(state.view)){");
  assert.ok(guards.length, "no `if(S.parlayEligible(state.view)){` block found in index.html");

  /* There is one row renderer for today and one for a replayed day, and both
     build a + button. Counting call sites would have to be edited every time
     a renderer is added; what actually matters is that NONE of them sits
     outside a guard. */
  const sites = [];
  for (let i = js.indexOf("'addleg'"); i >= 0; i = js.indexOf("'addleg'", i + 1)) sites.push(i);
  assert.ok(sites.length, "index.html no longer builds an addleg button");

  for (const at of sites) {
    const inside = guards.some(([open, close]) => at > open && at < close);
    assert.ok(
      inside,
      `an addleg button at index ${at} is built OUTSIDE the eligibility guard — ` +
        "that is how it became reachable on total bases and home runs",
    );
  }

  /* And the suggestion candidates, which only the live board collects. */
  const push = js.indexOf("state.candidates.push");
  assert.ok(push > 0, "the live board no longer collects suggestion candidates");
  assert.ok(
    guards.some(([open, close]) => push > open && push < close),
    "suggestion candidates are collected outside the eligibility guard",
  );
});

/* ------------------------------------------------------------------ *
 * A price that already carries its sign must not be given a second one
 *
 * fetch-odds-espn.mjs stores American prices as SIGNED STRINGS: "+111",
 * "-103". index.html rendered them as `(mkt.over>0?'+':'')+mkt.over`, and
 * "+111" > 0 coerces to 111 > 0, which is true — so every positively
 * priced row on total bases showed `++111`, in the chip and again in the
 * detail panel's "Market: ++111 over 1.5". Negative prices looked fine,
 * which is why it survived: half the rows were correct.
 *
 * index.html already has amer() for exactly this. Math.round("+111") is
 * 111, so it takes the string or a number and emits one sign either way.
 * ------------------------------------------------------------------ */

/* The prices that break the contract. An empty market set yields none, which
   is the entire point: see the note below. */
const unsignedPrices = (markets) =>
  Object.values(markets)
    .flatMap((m) => [m.over, m.under])
    .filter((p) => !/^[+-]\d+$/.test(String(p)));

/*
 * An empty slate is a legitimate state and must never fail a run.
 *
 * The first version of the test below asserted `prices.length > 0`. That is
 * a claim about the live feed, and this file runs inside all three refresh
 * workflows against data they have just fetched. At 13:51 UTC on 2026-08-20
 * no MLB props were posted yet, refresh-odds.yml printed its own "no
 * scheduled games — nothing priced" and exited 0 as designed, then handed
 * the same empty file to `node --test` and this assertion failed the run.
 * Thirteen consecutive refreshes died on it and the board sat past its
 * six-hour cutoff showing no prices at all.
 *
 * The rule was already written, three lines above the call site: "An empty
 * slate is legitimate (no games scheduled); a malformed file is not. Only
 * the second one should fail the run."
 *
 * So: nothing in this file may assert that live data is non-empty. Check the
 * shape of what is there; say how much that was.
 */

test("an empty slate is not a contract violation", () => {
  assert.deepEqual(unsignedPrices({}), [], "an empty market set must pass");
  assert.deepEqual(
    unsignedPrices({ a: { over: "+108", under: "-144" } }),
    [],
    "signed strings are the contract",
  );
  assert.deepEqual(
    unsignedPrices({ a: { over: 108, under: "-144" } }),
    [108],
    "a bare number is a violation — it is what made index.html print ++108",
  );
});

test("the odds feed stores prices with their sign attached", (t) => {
  const file = resolve(DIR, "odds-data.js");
  assert.ok(existsSync(file), "odds-data.js is missing");

  const win = {};
  new Function("window", readFileSync(file, "utf8"))(win);
  const markets = (win.BetHouseOdds || {}).markets;
  assert.ok(markets && typeof markets === "object", "odds-data.js defines no markets object");

  assert.deepEqual(
    unsignedPrices(markets),
    [],
    "a price is not a signed American string — the render path assumes it is",
  );

  /* Vacuous on an empty slate, by design. Reported so that a file which is
     empty forever is visible in the run output rather than silently green. */
  t.diagnostic(
    `${Object.keys(markets).length} markets, ${Object.values(markets).length * 2} prices checked`,
  );
});

test("no board hand-prefixes a sign onto a market price", () => {
  /* The bug in the form it was written in: a truthiness test on a value
     that is already signed, used to decide whether to add a sign. */
  for (const f of BOARDS) {
    const js = src(f);
    const offenders = js.match(/\.(over|under)\s*>\s*0\s*\?\s*'\+'/g) || [];
    assert.deepEqual(
      offenders,
      [],
      `${f} prefixes '+' onto an already-signed market price — use amer()`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * A fixed-width cell must not let its content decide the row height
 *
 * nfl.html's spread board put "SEA -7.2" inside .prob, a 74px grid column
 * styled for one 21px number. Fifteen of sixteen rows wrapped to two lines
 * and "TB -0.7" did not, so row heights alternated 63px and 32px on
 * nothing but the length of a team abbreviation. The board read as ragged
 * for a reason carrying no information.
 *
 * The file already had the answer in .be: number, then a <small> block
 * label under it ("43.3 / total"). The invariant is that a sublabel inside
 * one of these cells is a block, never inline text that can wrap.
 * ------------------------------------------------------------------ */

test("a sublabel inside a fixed-width row cell is a block, not wrappable text", () => {
  const css = src("nfl.html");
  const rule = css.match(/^([^\n{]*\bsmall\b[^\n{]*)\{([^}]*display:\s*block[^}]*)\}/m);
  assert.ok(rule, "nfl.html has no display:block rule for row sublabels");

  const selectors = rule[1].split(",").map((s) => s.trim());
  for (const cell of [".be", ".prob"]) {
    assert.ok(
      selectors.includes(`${cell} small`),
      `${cell} small is not blocked — content can wrap and set the row height`,
    );
  }
});

/* ------------------------------------------------------------------ *
 * One age computation, not two
 *
 * index.html used to compute the feed's age twice: once inside the ODDS
 * gate to decide whether to show prices, and again into an ODDS_AGE_H
 * that nothing ever read. Two copies of the same arithmetic, one of them
 * dead — which is why the board could withhold prices without being able
 * to say it was withholding them.
 * ------------------------------------------------------------------ */

test("the board asks edge.js how old the odds are, and asks once", () => {
  const js = src("index.html");
  assert.ok(
    js.includes("E.oddsFreshness("),
    "index.html must get odds age from edge.js, not re-derive it",
  );
  const inlined = js.match(/Date\.parse\([^)]*generated[^)]*\)/g) || [];
  assert.deepEqual(
    inlined,
    [],
    "index.html re-derives the feed's age inline; that is the duplication oddsFreshness replaced",
  );
});

/* ------------------------------------------------------------------ *
 * Every test file is actually wired into every gate
 *
 * `node --test` is invoked with an explicit file list, not bare discovery,
 * because discovery would fire the backtest scripts and their live API
 * calls. The cost of that is the list existing in SEVEN places, and adding a
 * seventh test file means remembering all seven. Miss one and the gap is
 * silent: the suite still passes, just without the new file.
 *
 * This is the same duplication that put the parlay scope rule in two places
 * and let them disagree. Here it cannot be deduplicated away — the CI files
 * are YAML and the hook config is its own format — so it gets checked
 * instead.
 * ------------------------------------------------------------------ */

test("every test file runs in every gate that runs tests", () => {
  const GATES = [
    "scripts/local-check.sh",
    ".pre-commit-config.yaml",
    ".github/workflows/ci.yml",
    ".github/workflows/refresh.yml",
    ".github/workflows/refresh-nfl.yml",
    ".github/workflows/refresh-cfb.yml",
    ".github/workflows/refresh-odds.yml",
  ];

  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".test.mjs"))
    .sort();
  assert.ok(files.length >= 6, `expected the suite's test files, found ${files.join(", ")}`);

  for (const gate of GATES) {
    const path = resolve(DIR, gate);
    assert.ok(existsSync(path), `${gate} is missing`);
    const text = readFileSync(path, "utf8");
    assert.ok(/node --test/.test(text), `${gate} no longer runs the suite`);
    for (const f of files) {
      assert.ok(text.includes(f), `${gate} does not run ${f}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * Two copies of the name matcher, and they have to agree
 *
 * The odds feed keys every market by a normalised player name. That
 * normalisation exists twice: `normalizeName` in fetch-odds-espn.mjs, which
 * writes the keys, and `normName` in index.html, which reads them. The
 * board cannot import an .mjs without becoming a module, so the duplication
 * is structural rather than careless.
 *
 * If they ever disagree, no price matches any player: the chips vanish, and
 * closing line value silently reports nothing for every bet rather than
 * failing loudly. So compare them on the names that actually break this
 * sort of function.
 * ------------------------------------------------------------------ */

test("the board and the odds fetcher normalise names identically", async () => {
  const { normalizeName } = await import("./fetch-odds-espn.mjs");

  const js = src("index.html");
  const at = js.indexOf("function normName(s){");
  assert.ok(at > 0, "index.html no longer defines normName");
  const end = js.indexOf("\n}", at) + 2;
  // eslint-disable-next-line no-new-func
  const boardVersion = new Function(js.slice(at, end) + "; return normName;")();

  const NAMES = [
    "Luis García Jr.",          // accent AND a suffix
    "José Ramírez",
    "Ronald Acuña Jr.",
    "Ken Griffey Sr.",
    "Vladimir Guerrero Jr.",
    "J.T. Realmuto",            // periods inside initials
    "A.J. Pollock",
    "Jackson Merrill III",
    "Michael A. Taylor",
    "Shohei Ohtani",
    "O'Neil Cruz",              // apostrophe
    "Jean-Carlos Rodríguez",    // hyphen
    "  Extra   Spaces  ",
    "",
  ];
  for (const n of NAMES) {
    assert.equal(
      boardVersion(n),
      normalizeName(n),
      `"${n}" normalises differently in index.html than in fetch-odds-espn.mjs — ` +
        `every market key for a name like this would fail to match, and CLV would ` +
        `quietly report nothing`,
    );
  }
});
