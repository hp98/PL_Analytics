# One-Stop FPL — edge Worker (hot plane)

A thin Cloudflare Worker that proxies the **public, read-only** FPL API. It exists
solely because the FPL API sends no CORS headers, so the browser cannot call it
directly (brief §2/§3). It also centralises caching so live-gameweek polling never
fans out per browser tab.

## Behaviour

- **CORS** added to every response (`Access-Control-Allow-Origin: *`).
- **Cache-first + stale-while-revalidate**: fresh within the per-route TTL; stale
  entries are served immediately and revalidated in the background.
- **Circuit breaker**: if the upstream errors, the last good (stale) payload is
  served rather than failing.
- **Best-effort per-IP throttle** (per isolate; robust limiting would use a
  Durable Object / KV — a deployment note, not a dev blocker).
- **Whitelisted routes only**, with numeric-only id/gw params — the upstream URL
  is always built from a fixed base, so this can never become an open proxy.

Only public endpoints are proxied (bootstrap, fixtures, live, entry, picks,
history, transfers, leagues, event-status, element-summary, dream-team). No
authenticated endpoint and no login are ever touched (§2).

## Routes (under `/api`)

| Worker route | Upstream | TTL |
|---|---|---|
| `/api/bootstrap` | `/bootstrap-static/` | 15 min |
| `/api/fixtures[?event=N]` | `/fixtures/[?event=N]` | 5 min / 60 s |
| `/api/live/:gw` | `/event/:gw/live/` | 30 s |
| `/api/entry/:id` | `/entry/:id/` | 5 min |
| `/api/entry/:id/history` | `/entry/:id/history/` | 5 min |
| `/api/entry/:id/event/:gw/picks` | `/entry/:id/event/:gw/picks/` | 5 min |
| `/api/entry/:id/transfers` | `/entry/:id/transfers/` | 5 min |
| `/api/leagues-classic/:id/standings[?page=N]` | `/leagues-classic/:id/standings/?page_standings=N` | 2 min |
| `/api/event-status` | `/event-status/` | 60 s |
| `/api/element-summary/:id` | `/element-summary/:id/` | 60 min |
| `/api/dream-team/:gw` | `/dream-team/:gw/` | 60 min |

## Develop

```bash
npm install
npm run dev        # http://localhost:8787 (miniflare; real outbound FPL calls)
npm test           # router unit tests
npm run typecheck
```

If `npm run dev` fails to start the runtime, run `npm rebuild workerd` — npm 11
skips its post-install script by default.

## Deploy (needs your Cloudflare account)

```bash
npx wrangler login
npm run deploy
```

Then bind it to the Pages app so the frontend reaches it same-origin at `/api/*`
(see `wrangler.toml`).
