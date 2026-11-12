import { keepPreviousData, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { lazy } from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";

import { App } from "./App";
import { HomeRoute } from "./routes/HomeRoute";
import { NotFoundRoute } from "./routes/NotFoundRoute";
import "./index.css";

// Code-split the heavy routes: DuckDB-WASM, TanStack Table/Virtual and Recharts
// load only when the Explorer/Fixtures routes are visited (§3/§10). Home stays
// lean for a fast first paint.
const ExplorerRoute = lazy(() =>
  import("./routes/ExplorerRoute").then((m) => ({ default: m.ExplorerRoute })),
);
const FixturesRoute = lazy(() =>
  import("./routes/FixturesRoute").then((m) => ({ default: m.FixturesRoute })),
);
const MyTeamRoute = lazy(() =>
  import("./routes/MyTeamRoute").then((m) => ({ default: m.MyTeamRoute })),
);
const PlanRoute = lazy(() => import("./routes/PlanRoute").then((m) => ({ default: m.PlanRoute })));
const DifferentialsRoute = lazy(() =>
  import("./routes/DifferentialsRoute").then((m) => ({ default: m.DifferentialsRoute })),
);
const LeaguesRoute = lazy(() =>
  import("./routes/LeaguesRoute").then((m) => ({ default: m.LeaguesRoute })),
);
const PricesRoute = lazy(() =>
  import("./routes/PricesRoute").then((m) => ({ default: m.PricesRoute })),
);
const AboutRoute = lazy(() =>
  import("./routes/AboutRoute").then((m) => ({ default: m.AboutRoute })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Default posture is for LIVE data proxied through the Worker (squad,
      // scores, prices, leagues): treat it as stale quickly and revalidate when
      // the user returns to the tab. The edge Worker absorbs the load.
      staleTime: 60 * 1000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

// The published JSON bundles are BUILD ARTEFACTS: they change only when the
// pipeline republishes, not continuously. Re-fetching a 400 KB projections file
// every minute was pure waste, and a single failed read blanked the UI.
//
// So: cache them hard, retry transient failures with backoff, and keep the last
// good copy on screen while revalidating. That last part matters on Windows —
// the atomic publish swap can leave a file briefly unopenable, and a momentary
// blip must never render as "data unavailable" when we already have the data.
const STATIC_BUNDLE_KEYS = [
  "manifest",
  "projections",
  "optimal-squad",
  "players-live",
  "price-predictor",
  "ticker",
  "teams",
  "explorer-teams",
];
for (const key of STATIC_BUNDLE_KEYS) {
  queryClient.setQueryDefaults([key], {
    staleTime: 15 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 3,
    retryDelay: (attempt: number) => Math.min(500 * 2 ** attempt, 4000),
    placeholderData: keepPreviousData,
  });
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <HomeRoute /> },
      { path: "explorer", element: <ExplorerRoute /> },
      { path: "fixtures", element: <FixturesRoute /> },
      { path: "my-team", element: <MyTeamRoute /> },
      { path: "planner", element: <PlanRoute /> },
      // Live scoring now lives on My Team; keep the old path working.
      { path: "live", element: <Navigate to="/my-team" replace /> },
      { path: "captaincy", element: <Navigate to="/planner?tab=captaincy" replace /> },
      { path: "differentials", element: <DifferentialsRoute /> },
      { path: "leagues", element: <LeaguesRoute /> },
      { path: "prices", element: <PricesRoute /> },
      { path: "about", element: <AboutRoute /> },
      { path: "*", element: <NotFoundRoute /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
