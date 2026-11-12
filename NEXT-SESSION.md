# Next session — open tasks

_Updated 2026-09-05. Everything from the earlier handoffs is **done, validated and published**.
Servers left running (Vite 5173, Worker 8787). **The refresh loop is deliberately OFF** — see the
data-freshness section below. Tests: 75 green (36 pytest, 34 vitest, 5 worker)._

---

## ✅ DONE — expected-points fix (validated + published)

Triggered by: *"Haaland's expected points against Coventry is 7.8 and the model shows 4.1."*
The complaint was correct. **Four** defects were found — two in the model, two more that were
silently preventing the model fixes from reaching the live app.

### 1. Shrinkage reset at every season boundary
Cumulative rates were grouped by `(season, element)`, so at GW3 own form carried only
`180/(180+900)` = **17%** weight and 83% went to the positional prior — Haaland modelled at
**0.323** xG90 against a stable four-season **0.75**.

Fixed with `career_carry_in()` (`dataset.py`) + a **two-stage hierarchical prior**
(`projection.py`): stage A shrinks the player's decayed career rate toward the positional prior,
stage B shrinks season-to-date toward *that*. Using the career rate as the prior **mean** rather
than pooling career minutes into the current-season sample leaves the weight on current form
unchanged, so early-season noise is not over-trusted.

> **TRAP — do not undo.** FPL **reassigns `element` ids every season** and `player_nk` is hashed
> per season. Element 411 has been Matt Phillips → Cresswell → Che Adams → Gillespie → Miley →
> O'Reilly → Haaland. The first attempt keyed the carry on `element` and silently blended
> unrelated careers. It keys on **`name`**; the 4 names that map to >1 element in a season are
> dropped. Covered by `test_career_carry_lifts_an_established_player_off_the_positional_prior`.

### 2. Promoted teams treated as league-average
Coventry/Ipswich/Hull have zero PL history, so `opp_def`/`opp_att` were NaN and fell back to
`league_att`. `calibrate()` now derives `promoted_att`/`promoted_def` from teams' **debut**
seasons (earliest season excluded, since every team looks new there). Measured: promoted sides
attack **−36%** and concede **+17%** vs league average. Covered by
`test_promoted_teams_are_calibrated_weaker_than_the_league`.

### 3 & 4. Both fixes were inert in the live forecast path
`build_forecast_frame` builds rows from an explicit column list. It (3) never included the
`carry_*` columns, so `_carry()` returned zeros and the live model fell straight back to the
positional prior; and (4) defaulted strength lookups to `league_att`, so the promoted fallback
never fired. **The backtest improved while the shipped JSON did not change at all** — if you
touch the model, always confirm the published `projections.json` actually moved.

### Validation (walk-forward 2023-24 → 2025-26, relevant pool n=39,596)

| variant | per-GW rho | MAE | premium bias (≥£9.0m) |
|---|---|---|---|
| original (neither fix) | 0.3488 | 1.891 | — |
| + promoted-team fix | **0.3558** | 1.901 | −1.110 |
| + carry, half-life 0.5 | 0.3553 | 1.898 | −0.798 |
| **+ carry, half-life 1.0 (shipped)** | **0.3540** | **1.894** | **−0.723** |
| + carry, half-life 1.5 | 0.3531 | 1.892 | −0.727 |
| + carry, half-life 2.5 | 0.3524 | 1.889 | −0.743 |

The promoted fix is a clean **+0.0070 rho** win. The carry is an **honest trade, not a free win**:
it costs 0.0018 rho (0.5% relative) and buys back **35% of the systematic under-projection of
premium players**. Bias is minimised at half-life 1.0 and worsens either side, so 1.0 is the
knee of the curve, not a guess. Recorded in `config.yaml` next to the constant.

Shipped model beats every baseline (best is `season_ppg` 0.3019), so the gate passes.

**Result:** Haaland GW3 vs Coventry **4.06 → 5.52** (attack 1.77→2.67, bonus 0.45→1.01,
P(haul) 6%→13%, next-5 22.2→30.4).

> **Still conservative, knowingly.** Premium players remain under-projected by ~0.72 pts on
> average. The user's quoted 7.8 is FPL's own `ep_next`, which is crude — this was deliberately
> **not** tuned to hit it. Closing the rest of that gap is open work, not a solved problem.

---

## ✅ DONE — the three UI requests

### B1. My Team → interactive preview mode
- GW **stepper** (◀ ▶) replacing the static pill row, showing that week's points/projection
- **Preview mode** toggle: a scratch squad that is never saved (`usePreview.ts`, `PreviewPitch.tsx`)
  - tap a player to select, tap another to **swap** — illegal shapes (e.g. two keepers) are rejected
  - **formation** dropdown (all 8 legal shapes), **Auto-pick** best XI, **Reset**
  - provisional **transfers** with a budget-aware, searchable replacement list
  - **Make captain**; live "Preview XI" total vs "Your real XI", plus an *unsaved preview* badge

Verified end-to-end in the browser: 5-4-1 forced 50.5→48.0; Auto-pick found 51.9 (1.4 better than
the real XI); bench swap 46.6→46.9; transfer Maguire→De Cuyper 46.9→49.0 with bank £0.0→£0.3;
two-keeper swap rejected; Reset restored everything.

### B2. Transfer Planner — the "wrong data" was a real bug
`squadHorizonXp` summed **all 15** players while its own docstring claimed the bench was excluded.
So "As you are" was a 15-man total nobody can score, there was **no captain doubling**, and the
planner would happily "upgrade" a **bench** player for a gain that can never be realised.

Now everything routes through `squad.ts` → `pickBestXi()`: best legal XI per gameweek, captain
doubled, bench worth nothing. Swaps are scored by their effect on the **whole squad's XI value**,
so bench cover is valued at what it is actually worth. New: per-gameweek "where the gain lands"
bars, the resulting captain, and a **"Where a transfer helps most"** panel ranking every slot by
its best legal upgrade — which now agrees with the plan instead of contradicting it.

### B3. Transfer Planner + Captaincy merged
One `/planner` route, `PlanRoute.tsx`, tabs *Plan my transfers | Captaincy | Wildcard draft*
(deep-linkable via `?tab=`). `/captaincy` redirects in. Captaincy now defaults to **your own
squad** — you can only captain a player you own — with an "All players" toggle for scouting and
an *owned* badge.

**Tests at that point: 72 green.** ruff + mypy strict + tsc strict clean.

---

## ✅ DONE — "data unavailable" root cause + data-freshness policy (2026-09-05)

**Symptom:** the header intermittently showed *"data unavailable"* while the
5-minute refresh loop was running.

**Root cause — non-atomic publish.** `write_json` used `path.write_text()`, which
truncates the file and then writes. Anything reading a bundle mid-write (dev
server, browser, CDN origin pull) got unparseable JSON. Measured against the
416 KB `projections.json`: **~8% of concurrent reads failed**.

**Fix:** `write_json` now writes to a temp file in the same directory and
`os.replace`s it, so a reader sees either the complete old bundle or the complete
new one — never a torn one. Verified: corruption went **8% → 0**.

> **Windows gotcha:** `os.replace` raises `PermissionError` while any process
> still holds the destination open (the dev server and browser both do). The swap
> is retried against a **15-second deadline** with capped backoff. An earlier
> attempt-based retry (10 tries) expired in milliseconds under CPU load and
> failed a whole publish — don't go back to a fixed attempt count.

Covered by `tests/test_publish_io.py` (round-trip, no leftover temp files, and a
concurrent reader that must never observe partial JSON).

**Caching policy (replaces the 5-minute loop).** The published bundles are build
artefacts — they change only when the pipeline runs — but the app re-fetched them
every 60s and on every window focus, and a single failed read blanked the UI.
`main.tsx` now applies a shared policy via `setQueryDefaults` to the static keys
(`manifest`, `projections`, `optimal-squad`, `players-live`, `price-predictor`,
`ticker`, `teams`, `explorer-teams`): 15-minute `staleTime`, 24h `gcTime`, no
refetch-on-focus, 3 retries with backoff, and `keepPreviousData` so a transient
blip keeps the last good copy on screen. `DataFreshness` only renders
"data unavailable" when there is genuinely nothing cached.

Four `refetchInterval`s that polled *static* bundles were removed. The two that
remain are genuinely live and must stay: `useLive` (30s, only while a match is in
play) and `LeaguesRoute` (120s). Verified: revisiting a route now triggers
**0 new network fetches**.

**The refresh loop is intentionally OFF.** `scripts_refresh_loop.sh` still exists
for on-demand use, but it is not meant to run continuously — the user does not
want it on a 5-minute timer. Run a publish when it actually matters (after a
gameweek completes), not on a clock.

## ✅ DONE — refresh to GW9 + Explorer ownership/transfers + sortable ticker (2026-11-06)

Data refreshed GW3 → **GW9** (projections cover GW10–17).

**Explorer "Selected" showed "—" and T-in was silently understated.** The FPL API
top-up (used for gameweeks the community archive hasn't published yet) reads
`event/{gw}/live/`, which has match stats only — no `selected`, no transfer counts,
and it stamped *today's* price on past fixtures. With GW7–9 topped up, the latest
row had no ownership ("—" for everyone) and season T-in summed GW1–6 only:
De Cuyper showed 3.17M against a true 4.63M. Fixed by overlaying each player's
`element-summary/{id}/` history (per-fixture `value`, `selected`, transfers) —
`_history_fields` / `_apply_history` in `pipeline/ingest/fpl_gameweeks.py`,
covered by `tests/test_fpl_topup.py`.

> **Cost:** ~670 requests held to ~1 req/s (`sources.fpl_api.history_request_gap_seconds`),
> so a cold ingest takes ~15 minutes. Same-day re-runs reuse today's raw dumps
> and are near-instant. It only runs for gameweeks the archive is missing.

Large counts now render compactly (`fmtCompact`: "4.63M", exact on hover) and
Explorer cells clip instead of bleeding into the next column.

**Fixture ticker is sortable by every column** — Team, each GW, Avg — click to
toggle direction (`sortTeams` in `features/ticker/fdr.ts`). Blank gameweeks sink
to the bottom in both directions; ties break by team name.

**Known semantic, not fixed:** Explorer "Price" is the price at the last finished
gameweek, so a rise during the current week isn't shown (De Cuyper £5.3 there vs
£5.4 live). Prices/My Team use the live bootstrap and are current.

## Still open (older backlog, unchanged)
- **Team News screen (§8.9)** — the one named screen never built
- Supplementary sources (Understat, FBref) — why shots/key-passes/big-chances are absent
- Optimiser modes 2 & 4 — multi-transfer MIP (client-side greedy today), season-long chip timing
- Deeper Mini-Leagues (§8.7) — projected final table, rival squad diffs, captain split
- dbt models `fct_fixture_team`, `fct_manager_gameweek`, `mart_fixture_ticker`, `mart_ownership`
- **git init + first commit** — repo still has zero commits (header shows `build unknown`)
- Cloudflare deployment — needs the user's account
- **Selling price** is approximated by `now_cost` everywhere; the public API doesn't expose
  per-pick purchase price, so a risen player overstates available budget

## Environment reminders
- `uv` on OneDrive needs `UV_LINK_MODE=copy`; Python logs need `PYTHONUTF8=1`
- Worker needs `npm rebuild workerd` after install (npm 11 skips postinstall)
- `wrangler dev`'s `workerd` **survives killing the parent** — kill the PID on :8787 directly
