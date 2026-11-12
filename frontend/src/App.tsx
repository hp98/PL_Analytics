import { Suspense, useEffect } from "react";
import { Link, Outlet } from "react-router-dom";

import { DataFreshness } from "./components/DataFreshness";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { NavBar } from "./components/NavBar";
import { ThemeMenu } from "./components/ThemeMenu";
import { applyTheme, useUiStore } from "./store/useUiStore";

export function App() {
  const theme = useUiStore((s) => s.theme);

  // Apply the persisted theme on mount, and keep "system" live to OS changes.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return (
    <div className="min-h-full flex flex-col">
      <header className="app-header">
        <div className="app-container">
          <div className="flex items-center justify-between h-14 gap-3">
            <Link to="/" className="flex items-center gap-2 shrink-0">
              <span
                className="grid place-items-center h-8 w-8 rounded-lg text-surface-0 text-lg shadow-[0_2px_10px_-2px_rgb(var(--brand)/0.6)]"
                style={{ background: "rgb(var(--brand))" }}
              >
                ⚽
              </span>
              <span className="brand-title">One-Stop FPL</span>
            </Link>
            <div className="flex items-center gap-2 sm:gap-3">
              <DataFreshness />
              <ThemeMenu />
            </div>
          </div>
          <NavBar />
        </div>
      </header>

      <main className="app-container flex-1 w-full py-5">
        <ErrorBoundary>
          <Suspense fallback={<div className="skeleton h-64 w-full" />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>

      <footer className="border-t border-surface-2 py-4 text-center text-xs text-ink-faint">
        No login · no accounts · data in your browser only. Historical data 2020-21 → present ·{" "}
        <Link to="/about" className="text-ink-muted hover:text-brand transition-colors">
          About &amp; data limitations
        </Link>
      </footer>
    </div>
  );
}
