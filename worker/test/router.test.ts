import { describe, expect, it } from "vitest";

import { resolveRoute, UPSTREAM } from "../src/router";

describe("resolveRoute", () => {
  it("maps public endpoints to upstream with sensible TTLs", () => {
    expect(resolveRoute("/api/bootstrap", "")).toEqual({
      upstream: `${UPSTREAM}/bootstrap-static/`,
      ttl: 180,
    });
    expect(resolveRoute("/api/live/12", "")).toEqual({
      upstream: `${UPSTREAM}/event/12/live/`,
      ttl: 30,
    });
    expect(resolveRoute("/api/entry/123/event/5/picks", "")).toEqual({
      upstream: `${UPSTREAM}/entry/123/event/5/picks/`,
      ttl: 120,
    });
  });

  it("tolerates a trailing slash", () => {
    expect(resolveRoute("/api/entry/999/", "")?.upstream).toBe(`${UPSTREAM}/entry/999/`);
  });

  it("passes a numeric fixtures event through, ignores junk", () => {
    expect(resolveRoute("/api/fixtures", "?event=7")?.upstream).toBe(`${UPSTREAM}/fixtures/?event=7`);
    expect(resolveRoute("/api/fixtures", "?event=abc")?.upstream).toBe(`${UPSTREAM}/fixtures/`);
  });

  it("defaults the league standings page to 1 and validates it", () => {
    expect(resolveRoute("/api/leagues-classic/314/standings", "")?.upstream).toBe(
      `${UPSTREAM}/leagues-classic/314/standings/?page_standings=1`,
    );
    expect(resolveRoute("/api/leagues-classic/314/standings", "?page=3")?.upstream).toBe(
      `${UPSTREAM}/leagues-classic/314/standings/?page_standings=3`,
    );
  });

  it("rejects non-numeric ids (no open proxy / SSRF)", () => {
    expect(resolveRoute("/api/entry/abc", "")).toBeNull();
    expect(resolveRoute("/api/entry/1;drop", "")).toBeNull();
    expect(resolveRoute("/api/evil", "")).toBeNull();
    expect(resolveRoute("/api/element-summary/1/../../secret", "")).toBeNull();
  });
});
