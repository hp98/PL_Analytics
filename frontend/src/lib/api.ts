// Fetchers for the static JSON bundles. Used with TanStack Query for
// stale-while-revalidate loading and per-panel skeletons (§9).

import type {
  FixtureTicker,
  Manifest,
  OptimalSquad,
  PlayerLive,
  PricePrediction,
  Projections,
  TeamInfo,
} from "./types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/data/${path}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load /data/${path}: ${res.status}`);
  return (await res.json()) as T;
}

export const fetchManifest = () => getJson<Manifest>("manifest.json");
export const fetchTicker = () => getJson<FixtureTicker>("fixture_ticker.json");
export const fetchProjections = () => getJson<Projections>("projections.json");
export const fetchOptimalSquad = () => getJson<OptimalSquad>("optimal_squad.json");
export const fetchPlayersLive = () => getJson<PlayerLive[]>("players_live.json");
export const fetchPricePredictor = () => getJson<PricePrediction[]>("price_predictor.json");
export const fetchTeams = () => getJson<TeamInfo[]>("teams.json");
