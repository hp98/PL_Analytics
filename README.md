# One-Stop FPL

A single Fantasy Premier League analytics app that merges the squad/live views of
the official site, the projections/optimiser of Fantasy Football Hub, and the deep
stats/fixtures of Fantasy Football Scout. Enter your FPL entry ID once and get a
team rating, projected points, transfer suggestions, live scoring, and full
statistical drill-down.

## Honest data limits (read `docs/about` / §2 of the brief)

The official FPL API does **not** expose 15 seasons of player-level gameweek data.
This project trains on **2020-21 → present** (clean, schema-consistent window with
position + xP), uses **2016-17 → present** for long-run positional priors, and uses
pre-2016 results data only for team-strength initialisation. Nothing here implies
granular history that does not exist.

## Architecture

Two planes (see the brief, §3):

- **Cold plane** — GitHub Actions runs ingest (Python) → dbt-duckdb star schema →
  model (LightGBM + Bayesian minutes) → optimiser (PuLP) → publishes static JSON +
  parquet bundles. Heavy compute happens in CI, never while a user waits.
- **Hot plane** — a Cloudflare Worker proxies the CORS-less FPL API during live
  gameweeks, with a shared edge cache and a circuit breaker.
- **Frontend** — Vite + React + TypeScript on Cloudflare Pages; DuckDB-WASM powers
  the in-browser stats explorer.

## Repo layout

```
config.yaml            # single source of truth for constants + assumptions
pipeline/              # Python: ingest, (later) model, optimise
  ingest/              # source adapters (vaastav archive, FPL API, ...)
  run_ingest.py        # ingest CLI entrypoint
transform/             # dbt-duckdb project (staging -> dims -> facts -> marts)
data/
  raw/                 # dated verbatim source dumps (gitignored)
  interim/             # normalised typed parquet the dbt layer reads (gitignored)
  warehouse/           # duckdb database file (gitignored)
  public/              # published static bundles for the frontend
tests/                 # pytest
```

## Quick start

Pipeline (cold plane) — ingest, build the star schema, publish static bundles:

```bash
UV_LINK_MODE=copy uv sync --extra transform
UV_LINK_MODE=copy uv run python -m pipeline.run_ingest        # fetch + normalise 2020-21..present
UV_LINK_MODE=copy DBT_PROFILES_DIR=transform uv run dbt build --project-dir transform
UV_LINK_MODE=copy uv run python -m pipeline.run_backtest      # -> reports/backtest.md (the §6 gate)
UV_LINK_MODE=copy uv run python -m pipeline.run_publish       # -> frontend/public/data/* (incl. projections)
```

The projection model is decomposed (minutes → attacking → clean sheets → bonus →
peripherals) and validated by a walk-forward backtest that must beat every
baseline on rank correlation before projections ship — see
[reports/backtest.md](reports/backtest.md). Note: FPL's own `ep_next` isn't in the
historical archive, so it can't be a historical baseline; and `mart_projections`
is realised as the published `projections.json` rather than a dbt model, since it
is model output rather than a warehouse transform.

Edge Worker (hot plane — proxies the CORS-less FPL API for My Team / Live):

```bash
cd worker && npm install && npm run dev       # http://localhost:8787
```

Frontend (Explorer, Fixture Ticker, My Team):

```bash
cd frontend && npm install && npm run dev     # http://localhost:5173
```

The frontend calls the Worker at `http://localhost:8787` in dev (override with
`VITE_WORKER_URL`); in production they share an origin under `/api`.

Notes:
- `UV_LINK_MODE=copy` is required because the repo lives on a OneDrive-synced path
  (hardlinks fail there).
- If `npm run dev` in `worker/` can't find the runtime, run `npm rebuild workerd`
  (npm 11 skips its post-install script by default).

## Club crests

Team badges are referenced from the Premier League's own CDN
(`resources.premierleague.com/premierleague/badges/...`), keyed by the `team_code`
the FPL API already provides — the same source the official game uses. The crests
are **not** copied into this repo. If the CDN is unreachable (offline, blocked),
every badge degrades silently to the team's short code, so nothing breaks.

## Build status

| Milestone | Deliverable | State |
|-----------|-------------|-------|
| M1 | Ingest + dbt star schema (2020-21→present) | ✅ done — 164,004 player-GWs, 52/52 dbt nodes green |
| M2 | Player Explorer + Fixture Ticker (static) | ✅ done — DuckDB-WASM, 152 ms filtering; ticker + drill-down charts |
| M3 | Cloudflare Worker proxy + My Team | ✅ done — CORS/SWR/circuit-breaker Worker; any entry ID renders its live squad |
| M4 | Projection model + backtest report | ✅ done — beats all baselines (Spearman 0.356 > 0.302); projections live in My Team |
| M5 | Live Gameweek (provisional bonus) | ✅ done — provisional bonus verified 0/610 vs official; live total matches exactly |
| M6 | Optimiser + Transfer Planner | ✅ done — PuLP MIP optimal squad (constraints proven); team rating + suggested transfers |
| M7 | Captaincy, Differentials, Mini-Leagues, Price Predictor | ✅ done — haul-distribution captaincy, diff index, live league table, heuristic price flags |
| M8 | Polish, About page, error states | ✅ done — About/data-limitations page, error boundary, 404, favicon |

Ship M1–M3 before touching the model: a trustworthy stats explorer with no
projections is more useful than projections that cannot be validated.
