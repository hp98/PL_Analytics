import { useQuery } from "@tanstack/react-query";

import { fetchTeams } from "../../lib/api";
import type { TeamInfo } from "../../lib/types";

export interface TeamLookup {
  /** Official PL badge code for a team referenced by short name, full name or id. */
  codeOf: (key: string | number | null | undefined) => number | null;
  byKey: Map<string, TeamInfo>;
}

const norm = (v: string | number) => String(v).trim().toLowerCase();

/** Team identity lookup keyed by short name, full name and id, so any screen can
 * resolve a crest regardless of which field it happens to carry. */
export function useTeams(): TeamLookup {
  const { data } = useQuery({
    queryKey: ["teams"],
    queryFn: fetchTeams,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const byKey = new Map<string, TeamInfo>();
  for (const t of data ?? []) {
    if (t.short_name) byKey.set(norm(t.short_name), t);
    if (t.name) byKey.set(norm(t.name), t);
    if (t.id !== null && t.id !== undefined) byKey.set(`#${t.id}`, t);
  }

  const codeOf = (key: string | number | null | undefined): number | null => {
    if (key === null || key === undefined || key === "") return null;
    const direct = typeof key === "number" ? byKey.get(`#${key}`) : byKey.get(norm(key));
    return direct?.code ?? null;
  };

  return { codeOf, byKey };
}
