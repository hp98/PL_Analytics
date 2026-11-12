// Pure route resolution for the FPL proxy. A strict whitelist: every route is
// an explicit pattern with numeric-only id/gw params, and the upstream URL is
// always built from a fixed base — so the Worker can never be turned into an
// open proxy or coaxed into SSRF via a crafted path.

export const UPSTREAM = "https://fantasy.premierleague.com/api";
/** Club kit images live outside /api on the same host. */
export const KIT_BASE = "https://fantasy.premierleague.com/dist/img/shirts/standard";

export interface ProxyTarget {
  /** Absolute upstream URL to fetch. */
  upstream: string;
  /** Freshness TTL in seconds (drives cache-first + stale-while-revalidate). */
  ttl: number;
}

const t = (path: string, ttl: number): ProxyTarget => ({ upstream: `${UPSTREAM}${path}`, ttl });
/** Same, for an already-absolute upstream URL (kit images). */
const t2 = (upstream: string, ttl: number): ProxyTarget => ({ upstream, ttl });

/**
 * Map a proxy request (pathname under `/api`, plus query string) to an upstream
 * target, or `null` if the path is not on the whitelist.
 */
export function resolveRoute(pathname: string, search: string): ProxyTarget | null {
  const p = pathname.replace(/\/+$/, ""); // tolerate a trailing slash
  const params = new URLSearchParams(search);

  // Club kits. Proxied (not hotlinked) so they inherit our CORS + edge cache and
  // work anywhere the app does. Kits change at most once a season -> cache a day.
  let k: RegExpExecArray | null;
  if ((k = /^\/api\/kit\/(\d+)$/.exec(p))) return t2(`${KIT_BASE}/shirt_${k[1]}-66.png`, 86400);
  if ((k = /^\/api\/kit\/(\d+)\/gk$/.exec(p)))
    return t2(`${KIT_BASE}/shirt_${k[1]}_1-66.png`, 86400);

  if (p === "/api/bootstrap") return t("/bootstrap-static/", 180); // prices/ownership move fast
  if (p === "/api/event-status") return t("/event-status/", 60);

  if (p === "/api/fixtures") {
    const ev = params.get("event");
    return ev && /^\d+$/.test(ev)
      ? t(`/fixtures/?event=${ev}`, 60) // single live GW: 60s
      : t("/fixtures/", 120);
  }

  let m: RegExpExecArray | null;
  if ((m = /^\/api\/live\/(\d+)$/.exec(p))) return t(`/event/${m[1]}/live/`, 30); // live: 30s
  if ((m = /^\/api\/entry\/(\d+)$/.exec(p))) return t(`/entry/${m[1]}/`, 120);
  if ((m = /^\/api\/entry\/(\d+)\/history$/.exec(p))) return t(`/entry/${m[1]}/history/`, 300);
  if ((m = /^\/api\/entry\/(\d+)\/transfers$/.exec(p))) return t(`/entry/${m[1]}/transfers/`, 300);
  if ((m = /^\/api\/entry\/(\d+)\/event\/(\d+)\/picks$/.exec(p)))
    return t(`/entry/${m[1]}/event/${m[2]}/picks/`, 120);
  if ((m = /^\/api\/element-summary\/(\d+)$/.exec(p)))
    return t(`/element-summary/${m[1]}/`, 3600);
  if ((m = /^\/api\/dream-team\/(\d+)$/.exec(p))) return t(`/dream-team/${m[1]}/`, 3600);
  if ((m = /^\/api\/leagues-classic\/(\d+)\/standings$/.exec(p))) {
    const page = params.get("page");
    const pg = page && /^\d+$/.test(page) ? page : "1";
    return t(`/leagues-classic/${m[1]}/standings/?page_standings=${pg}`, 60);
  }

  return null;
}
