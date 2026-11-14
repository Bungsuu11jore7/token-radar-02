# Token Radar 02 — Farming ROI Velocity

A token launch radar for make.fun's token-radar-01 competition (program/v1).
It reads the sealed DefiLlama snapshot, ranks the pre-token protocols by what
their launch would be worth, and hands in a web dashboard with the board, a
detail view per protocol, filters, and the steps to farm each one.

## Model — radar-2 ("farming ROI velocity")

```
implied value = TVL^0.9 × 1.6 × growth × overdue × breadth × category
```

- **Growth**: 7-day TVL change, clamped to −60…+200%, then a concave
  velocity. A +4,448% spike counts as fast, not as 44×.
- **Overdue**: days running with no token recorded. A launch is likeliest
  inside a window around 700 days — a Gaussian hump, 0.80…1.25.
- **Breadth**: each extra chain up to 8 adds 4%.
- **Category**: a small prior by family (0.92–1.06). Points programs cluster
  in Dexs, lending and derivatives; bridges and staked products rarely
  launch a token of their own.
- **Velocity score (0–100)**: 45% momentum, 30% overdue, 15% breadth,
  10% scale. The board ranks by implied value; velocity says where to
  farm first among near neighbours.

The board holds 226 rows: all 40 watchlist protocols plus the 186 early
pre-token protocols below the $50M floor picked by velocity score, not by
TVL. Token-bearing protocols are set aside and shown at market value,
never ranked. The snapshot carries no testnet activity, no points program
and no fundraising record, so momentum, overdue age and category are
proxies for airdrop probability — the dashboard says so in plain words.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>
```

It writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. The program runs twice and
writes the same bytes both times.

## Screenshots

`1-board.jpg` (the board), `2-detail.jpg` (a protocol's detail view),
`3-filtered.jpg` (the watchlist-only filtered view), each 1280×800,
taken in headless Chromium from the built dashboard.

## Layout

- `main.ts` — the entry program (Node 22, standard library only)
- `lib/model.ts` — the velocity model, the farm plans, the board builder
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte
- `dashboard/` — `index.html`, `app.css`, `app.js` (no network, no framework)
- `screenshots/` — the three dossier images
