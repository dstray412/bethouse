---
# gstack: design-md-format=spec
name: BetHouse
description: An industrial ledger on warm black, still and dense, coloured only where there is edge.
colors:
  primary: "#EDEAE0"
  on-primary: "#0E0F0C"
  surface: "#15170F"
  surface-2: "#1B1E16"
  background: "#0E0F0C"
  line: "rgba(255,255,255,0.09)"
  rule: "rgba(255,255,255,0.22)"
  text: "#EDEAE0"
  text-muted: "#8F9284"
  accent: "#D9A441"
  on-accent: "#0E0F0C"
  success: "#6FD39A"
  warning: "#E4B04A"
  error: "#E2513F"
typography:
  display:
    fontFamily: Bricolage Grotesque
    fontWeight: 700
    fontSize: clamp(1.375rem, 1rem + 1vw, 1.625rem)
    letterSpacing: 0.06em
  body:
    fontFamily: Source Sans 3
    fontSize: 0.9375rem
    lineHeight: 1.5
  label:
    fontFamily: Archivo
    fontSize: 0.625rem
    letterSpacing: 0.14em
  mono:
    fontFamily: Martian Mono
    fontFeature: tnum
rounded:
  sm: 2px
  md: 3px
  lg: 4px
  full: 4px
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

**Creative North Star:** an industrial ledger, warm and dark, a working instrument rather than a product page, because the one thing to remember is that it tells you the truth about the price.
**Product context:** a personal, zero-dependency sports-props board: five static pages (baseball, NFL, college football, golf, a bet log) where every number is a measured probability with a fair price beside it. Used daily, on a laptop and a phone, before kickoff, by the owner and the friends he sends links to. Peers: nhlpropking.com and the props sites it resembles.
**Mode per surface:** the boards and the drawer Operate; the notes, footers and README prose Read; nothing Persuades and nothing is an Experience.
**Reference sites:** nhlpropking.com/projections (the user's reference for density, the headed table, the stat tile and the drawer).
**Key characteristics:**
- Warm black, not navy: the page is a ledger under a lamp, not a dashboard under neon.
- Every figure on the site is set in one monospace face, larger than the words around it: numbers are machine output.
- Colour is a semantic spent only on edge: green, amber and red mean money; gold means BetHouse; nothing else is coloured.
- Hairline rules instead of rounded cards; the largest radius anywhere is 4px.
- A real stat tile in the header: players priced, build time, predictions graded. Never a decorative number.

## Colors

**Strategy:** Restrained. One accent (gold) for the brand, pressed states and stars; three semantic colours for edge; everything else is paper on warm black.
**Light or dark:** dark, fixed by the use scene: evenings, a phone, a slate to check before kickoff. The light theme exists only in the preview toggle and is not shipped.
The neutrals derive from the ground: surfaces lift by a few points of warmth (#15170F, #1B1E16) rather than by lightness alone, and hierarchy on dark surfaces comes from the two rule weights (a hairline at 9% white, a rule at 22%) and from type weight, never from glow or shadow. `accent` is the brand and the pressed state; it is not an edge colour, so the star and the wordmark are gold and a number never is. `success`, `warning`, `error` are the edge colours the baseball board already taught: over 2% good, at or above zero a warning, below zero bad. They appear on the edge cell, the slip's edge, the tray's edge line and the bet log's won/lost, and nowhere else.

## Typography

Four faces, all Open Font License, self-hosted as latin woff2 in `fonts/` (no build step, no third-party request at runtime).
- **Bricolage Grotesque**, display: the wordmark (opsz 96, weight 800, tracked 0.06em, gold), panel titles and player names (opsz 14, weight 600). A grotesque with a burr on it, chosen so the site does not read as a startup.
- **Archivo**, label: column heads, the dateline, control labels, the stat-tile captions. 10px, weight 600, condensed (wdth 85), caps, tracked 0.14em, muted.
- **Martian Mono**, every figure: chance, projection, fair price, typed price, edge, rungs, win rates, dates in the log. Tabular numerals always. Chance in a row at 19px weight 600; fair and price at 13px; the stat tile at 30px.
- **Source Sans 3**, body: verdicts, notes, control text, the drawer's prose. 15px, line height 1.5.
Space Grotesk retires; its file leaves `fonts/`. Newsreader for the author's prose was offered as a risk and declined. Scale: labels 10px, body 15px, row figures 19px, panel titles 18 to 22px, the wordmark 26px, the tile 30px; levels differ by face and weight, not by a step of size.

## Layout

One column, max width 1180px, 20px side padding on desktop and 12px on a phone; nothing narrower than 390px ever scrolls sideways. The header is a baseline: wordmark and dateline left, the stat tile flush right on the same rule, a 2px rule with a hairline 3px below it (the ledger's thick-thin signature). Controls sit in wrapping rows of labelled groups; on a phone each strip scrolls inside itself. The table is a grid of 36px rows on desktop and 44px on touch, hairline separators, 10px caps heads over the thick-thin double rule, rank dimmed in the left margin, figures right-aligned; on a phone the matchup and fair columns drop and the price cell stays. Density is deliberate in the table and relaxed everywhere else: 4px base, 8px vertical rhythm, 16px between groups, 40px between sections.

## Elevation & Depth

Flat. The drawer is the one raised surface: it sits on the ground colour with a 1px `line` border and a scrim behind it; on a phone it is a bottom sheet. The compare tray sits on a 1px `rule`. No shadows with zero offset, no glows, no blurred backdrops. A hover is a surface tint (`surface`), never a lift.

## Shapes

Radius 3px on buttons, inputs, rungs and cards; 2px on tags; 4px on the drawer and the tray corners. Nothing rounder. A nested element takes the outer radius minus the gap, which at these sizes means 2px or square.

## Components

- **Row** (`.row`): grid, hairline top border, hover tints to `surface`, focus-visible a 2px `accent` outline, `aria-haspopup="dialog"`. The star beside it is its own button, gold when pressed, muted when not.
- **Segmented control** (`.seg button`): muted text on `surface` with a hairline; pressed inverts to paper on black, weight 600; hover lifts the text to paper. No gold on controls.
- **Price input** (`.pxin`): mono, 16px, on `surface` with a hairline; focus border `accent`.
- **Edge** (`.edge`): mono, coloured good, warn or bad; the only coloured text in a row, the slip and the tray.
- **Drawer** (`.drawer`): title in display 22px, dateline muted, a 2px rule under the head, tabs as a segmented control, body in body face; the ladder as square rungs with the pressed one outlined in `accent`; recent games as square bars, the ones that clear the threshold in `success`, the threshold a dashed `warning` line.
- **Tray card** (`.tcard`): surface, hairline, name in display 600, the figure in mono 20px, the edge line coloured.
- **Bet log row**: date in mono muted, the bet in body, said and price in mono, won and lost as 10px caps labels in `success` and `error`.
- **States**: disabled at 50% opacity with the cursor default; empty states in body text on the ground, no illustration; loading is the same empty panel with the one sentence it has today.

## Do's and Don'ts

- Do set every number in Martian Mono with tabular figures, including inside prose.
- Do keep colour for edge, won/lost and the brand; a pressed control is inverted, not coloured.
- Do use the thick-thin double rule under the header and above a table's column heads.
- Do keep the table denser than the rest of the page; 36px rows on desktop, 44px on touch.
- Do show only measured numbers in the stat tile: players priced, build time, predictions graded.
- Don't add a card inside a card, a glow, a gradient, or a radius above 4px.
- Don't colour a number gold, or a control green.
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
| 2026-09-29 | Initial design system created | Created by /design-consultation from the product context and the user's reference (nhlpropking.com), with one outside voice (a Claude subagent; Codex unavailable). Adopted from it: mono figures everywhere, ledger rules, colour as a semantic. Departed: gold accent (the user's ask) over lime; no receipt metaphor in the drawer. Risk 3 (serif prose) declined. |
