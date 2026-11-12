// Persisted UI state: theme + saved Explorer filter presets (localStorage only,
// no accounts / PII per §9). Zustand with the persist middleware.

import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ExplorerFilters } from "../features/explorer/filterModel";

export type Theme = "dark" | "light" | "system" | "football";
type Resolved = "dark" | "light" | "football";

interface UiState {
  theme: Theme;
  entryId: string | null; // persisted for My Team
  presets: Record<string, ExplorerFilters>;
  setTheme: (t: Theme) => void;
  setEntryId: (id: string | null) => void;
  savePreset: (name: string, filters: ExplorerFilters) => void;
  deletePreset: (name: string) => void;
}

/** Resolve "system" to the OS preference; other themes map to themselves. */
export function resolveTheme(theme: Theme): Resolved {
  if (theme === "system") {
    const light =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: light)").matches;
    return light ? "light" : "dark";
  }
  return theme;
}

/** Stamp the resolved theme onto <html> so the CSS variables switch. */
export function applyTheme(theme: Theme): void {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved === "light" ? "light" : "dark";
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "dark",
      entryId: null,
      presets: {},
      // Apply synchronously so getComputedStyle-based consumers (charts) read
      // the new palette on the same render.
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      setEntryId: (entryId) => set({ entryId }),
      savePreset: (name, filters) =>
        set((s) => ({ presets: { ...s.presets, [name]: filters } })),
      deletePreset: (name) =>
        set((s) => {
          const next = { ...s.presets };
          delete next[name];
          return { presets: next };
        }),
    }),
    { name: "one-stop-fpl-ui" },
  ),
);
