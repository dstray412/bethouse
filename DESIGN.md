---
# gstack: design-md-format=spec
name: BetHouse
description: A pitch-black board with soft rounded panels, neon-green figures, and solid green or red pills where the model found something.
colors:
  primary: "#FFFFFF"
  on-primary: "#000000"
  surface: "#111111"
  surface-2: "#1A1A1A"
  background: "#000000"
  line: "rgba(255,255,255,0.16)"
  rule: "rgba(255,255,255,0.32)"
  text: "#FFFFFF"
  text-muted: "#C9C9C9"
  accent: "#3DFF5C"
  on-accent: "#000000"
  success: "#3DFF5C"
  warning: "#FFD23F"
  error: "#FF3366"
typography:
  display:
    fontFamily: Bricolage Grotesque
    fontWeight: 700
    fontSize: clamp(1.375rem, 1rem + 1vw, 1.625rem)
    letterSpacing: 0.06em
  body:
    fontFamily: Source Sans 3
    fontSize: 1rem
    lineHeight: 1.5
  label:
    fontFamily: Archivo
    fontSize: 0.75rem
    letterSpacing: 0.1em
  mono:
    fontFamily: Martian Mono
    fontFeature: tnum
rounded:
  sm: 999px
  md: 10px
  lg: 14px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
  button-primary-hover:
    backgroundColor: "#FFFFFF"
  input:
    borderColor: "{colors.line}"
    rounded: "{rounded.md}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  nav-link:
    textColor: "{colors.text-muted}"
---

# BetHouse

## Overview

**Creative North Star:** a warm, soft board that reads like the reference the user likes: rounded panels and pills, figures in gold, colour where the model found something, because the one thing to remember is that it tells you the truth about the price, and the truth should be easy to spot.
**Product context:** a personal, zero-dependency sports-props board: five static pages (baseball, NFL, college football, golf, a bet log) where every number is a measured probability with a fair price beside it. Used daily, on a laptop and a phone, before kickoff, by the owner and the friends he sends links to. Peers: nhlpropking.com and the props sites it resembles.
**Mode per surface:** the boards and the drawer Operate; the notes, footers and README prose Read; nothing Persuades and nothing is an Experience.
**Reference sites:** nhlpropking.com/projections (the user's reference for density, the headed table, the stat tile and the drawer).
**Key characteristics:**
- Pitch black, not grey and not navy: the page is a board in a dark room, and the neon green is the light on it.
- Every figure on the site is set in one monospace face, larger than the words around it: numbers are machine output.
- Colour marks what matters: the chance or projection figure is neon green, a pressed control is neon green, and a solid green, amber or red pill with ink text says an edge or a projection well above or below his own rate. Prose, labels and chrome stay white and muted.
- Soft shapes: panels at 14px, buttons and inputs at 10px, pills fully round; hairlines inside panels, no glow.
- A real stat tile in the header: players priced, build time, predictions graded. Never a decorative number.

## Colors

**Strategy:** Loud where it counts. Neon green (`accent`, and it is also `success`) for the brand, pressed controls, stars, a tracked bet, the headline figure in a row (chance or projection), the stat tile, and a good edge; amber and hot red for a warning and a bad edge. Pills are solid fills with ink text, never tints. Everything else is white on pitch black.
**Light or dark:** dark, fixed by the use scene: evenings, a phone, a slate to check before kickoff. The light theme exists only in the preview toggle and is not shipped.
The ground is true black (#000000); surfaces lift by lightness alone (#111111, #1A1A1A), and hierarchy on them comes from the two rule weights (a hairline at 12% white, a rule at 28%) and from type weight, never from glow or shadow. `accent` is the brand and the pressed state; it is not an edge colour, so the star and the wordmark are gold and a number never is. `success`, `warning`, `error` are the edge colours the baseball board already taught: over 2% good, at or above zero a warning, below zero bad. They appear on the edge cell, the slip's edge, the tray's edge line and the bet log's won/lost, and nowhere else.

## Typography

Four faces, all Open Font License, self-hosted as latin woff2 in `fonts/` (no build step, no third-party request at runtime).
- **Bricolage Grotesque**, display: the wordmark (opsz 96, weight 800, tracked 0.06em, gold), panel titles and player names (opsz 14, weight 600). A grotesque with a burr on it, chosen so the site does not read as a startup.
- **Archivo**, label: column heads, the dateline, control labels, the stat-tile captions. 12px, weight 600, normal width, caps, tracked 0.1em, muted.
- **Martian Mono**, every figure: chance, projection, fair price, typed price, edge, rungs, win rates, dates in the log. Tabular numerals always. Chance in a row at 19px weight 600; fair and price at 13px; the stat tile at 30px.
- **Source Sans 3**, body: verdicts, notes, control text, the drawer's prose. 16px, line height 1.5.
Space Grotesk retires; its file leaves `fonts/`. Newsreader for the author's prose was offered as a risk and declined. Scale: labels 12px, small text 13 to 14px, body 16px, row figures 24px, panel titles 18 to 22px, the wordmark 26px, the tile 28px; levels differ by face and weight, not by a step of size. Nothing on the site is set under 12px.

## Layout

One column, max width 1180px, 20px side padding on desktop and 12px on a phone; nothing narrower than 390px ever scrolls sideways. The header is a baseline: wordmark and dateline left, the stat tile flush right on the same rule, a 2px rule with a hairline 3px below it (the ledger's thick-thin signature). Controls sit in wrapping rows of labelled groups; on a phone each strip scrolls inside itself. The table is a grid of 36px rows on desktop and 44px on touch, hairline separators, 10px caps heads over the thick-thin double rule, rank dimmed in the left margin, figures right-aligned; on a phone the matchup and fair columns drop and the price cell stays. Density is deliberate in the table and relaxed everywhere else: 4px base, 8px vertical rhythm, 16px between groups, 40px between sections.

## Elevation & Depth

Flat. The drawer is the one raised surface: it sits on the ground colour with a 1px `line` border and a scrim behind it; on a phone it is a bottom sheet. The compare tray sits on a 1px `rule`. No shadows with zero offset, no glows, no blurred backdrops. A hover is a surface tint (`surface`), never a lift.

## Shapes

Panels (the table, the slip, the tile, the record, a day in the log) at 14px; buttons, inputs, rungs and cards at 10px; tags, chips and pills fully round. The drawer's top corners on a phone at 14px. Bars in the recent-games chart round at the top by 3px.

## Components

- **Row** (`.row`): grid, hairline top border, hover tints to `surface`, focus-visible a 2px `accent` outline, `aria-haspopup="dialog"`. The star beside it is its own button, gold when pressed, muted when not.
- **Segmented control** (`.seg button`): muted text on `surface` with a hairline, 10px radius; pressed is gold with ink text, weight 600; hover lifts the text to paper.
- **Pill** (`.pill`): 10px caps in a fully round capsule, solid: `up` a green fill with ink text and `down` a red fill with white text for a projection ten percent above or below his rate, an outlined grey "steady" between; an edge in the price cell wears the same solid capsule in good, warn or bad.
- **Price input** (`.pxin`): mono, 16px, on `surface` with a hairline; focus border `accent`.
- **Edge** (`.edge`): mono, coloured good, warn or bad; the only coloured text in a row, the slip and the tray.
- **Drawer** (`.drawer`): title in display 22px, dateline muted, a 2px rule under the head, tabs as a segmented control, body in body face; the ladder as square rungs with the pressed one outlined in `accent`; recent games as square bars, the ones that clear the threshold in `success`, the threshold a dashed `warning` line.
- **Tray card** (`.tcard`): surface, hairline, name in display 600, the figure in mono 20px, the edge line coloured.
- **Bet log row**: date in mono muted, the bet in body, said and price in mono, won and lost as 10px caps labels in `success` and `error`.
- **States**: disabled at 50% opacity with the cursor default; empty states in body text on the ground, no illustration; loading is the same empty panel with the one sentence it has today.

## Do's and Don'ts

- Do set every number in Martian Mono with tabular figures, including inside prose.
- Do keep colour to neon green on the headline figure, pressed controls and stars, and a solid green, amber or red pill that reports a measurement.
- Do put tables, the slip and the record in rounded panels; hairlines only inside them.
- Do keep rows at 60px on desktop and 56px on a phone with names at 16px and the headline figure at 24px.
- Do show only measured numbers in the stat tile: players priced, build time, predictions graded.
- Don't add a card inside a card, a glow, or a gradient.
- Don't colour a number that is not the row's headline figure, and never a control green.
- Don't put a kicker above a heading or an icon in a circle beside one.
- Don't add a photo, a mascot or a drawn illustration; the site ships none.
- Don't let a page carry its own `:root` or redefine the shared classes; everything lives in `board.css`.

## Motion

- **Approach:** minimal-functional
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) short(150-250ms) medium(250-400ms) long(400-700ms)
- **The one authored moment:** the drawer sliding in from the right (or up, on a phone) over 250ms ease-out; everything else changes in 150ms or not at all.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-09-29 | Type one step larger, labels uncondensed, greys lighter | The user asked for text that is easier to read. Every size under 18px went up one step (10 to 12, 11 and 12 to 13, 13 to 14, 14 to 15, 15 to 16, 16 to 17), body to 16px, the labels dropped the 87.5% condensing and loosened from 0.14em to 0.1em, and muted text went to #C9C9C9 (14:1 on black). Rows still 60px; nothing scrolls sideways at 390px. |
| 2026-09-29 | Neon green, solid pills, white text | The user saw the gold on black and asked for colour that pops; of three mocks on the real board (amber, lime, cyan + gold) they chose the lime and asked for a truer green. Accent and success are one neon green (#3DFF5C), warning #FFD23F, error #FF3366, text pure white, and the pills went from faint tints to solid fills with ink text. |
| 2026-09-29 | Pitch black and a brighter gold | The user saw the warm black on the live site and read it as faded. The ground went to #000000, the surfaces to neutral greys, the hairlines up a few points so panels still read, and the accent from #D9A441 to #FFC53D. Ink on the accent stays black; every figure on black now clears 12:1. |
| 2026-09-29 | Softer: rounded panels and pills, gold figures, a vs-rate pill | The user saw the ledger and asked for the reference's feel: bubblier, softer, bigger text, colour that marks good picks. Shapes went to 14 / 10 / round; the chance and projection figures and pressed controls took gold; a pill under each matchup reports the projection against his own rate (the boost ratio the sort computes), green past +10%, red past −10%. Still nothing narrative. |
| 2026-09-29 | Gold on a tracked bet (baseball `.trk[aria-pressed]`) | The tracked and add-to-slip buttons sit side by side on one row and must not look alike; gold already means "yours" on a starred player, so a tracked bet takes it too. Still never on a number. |
| 2026-09-29 | Initial design system created | Created by /design-consultation from the product context and the user's reference (nhlpropking.com), with one outside voice (a Claude subagent; Codex unavailable). Adopted from it: mono figures everywhere, ledger rules, colour as a semantic. Departed: gold accent (the user's ask) over lime; no receipt metaphor in the drawer. Risk 3 (serif prose) declined. |
