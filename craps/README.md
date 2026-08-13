# 🎲 Vegas Craps — Learn & Play

A realistic, single-file craps game that teaches you how to play *and* how to bet smart — styled like a real Las Vegas felt table. Lives as a subfolder of BetHouse.

**▶ Play it:** https://dstray412.github.io/bethouse/craps/

## Features

- **Realistic table** — Pass/Don't Pass, Come/Don't Come, take & lay Odds, Place numbers, Field, Big 6/8, hardways, and the full center proposition box, with animated dice and a live point puck.
- **Plain-English coach** — reacts to every roll and explains what happened, no craps jargon assumed.
- **Strategy Coach** — pick a system (Pass + Odds, 3-Point Molly, Place 6 & 8, Dark Side, or Free Play) and it tells you the exact next bet, highlights the spot on the table, explains why, and can place it for you.
- **Tutorial & Strategy guide** — a step-by-step walkthrough plus a full playbook of house edges and betting systems.
- **Hover payouts + house edge** on every bet (desktop).
- **Live Dice Fairness tracker** — a histogram that proves the dice are fair; 7 is the most common roll by design (6/36 = 16.67%).
- **Fully mobile-friendly** — reflows for phone screens with big tap targets.

## How it works

Everything lives in `index.html` — no build step, no dependencies. Open it locally or let BetHouse's GitHub Pages serve it.

Payouts use common Las Vegas rules (Field pays 2:1 on 2 and 3:1 on 12; 3-4-5× odds). The payout engine was verified against theoretical house edges with a multi-million-roll Monte Carlo simulation.

*Educational simulator — no real money.*
