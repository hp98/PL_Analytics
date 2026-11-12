import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// DuckDB-WASM ships worker + wasm assets that must not be pre-bundled; exclude
// it from dep optimisation so Vite serves the worker/wasm URLs directly.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@duckdb/duckdb-wasm"],
  },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          // Keep DuckDB-WASM and charts out of the main bundle (lazy routes).
          recharts: ["recharts"],
        },
      },
    },
  },
  worker: {
    format: "es",
  },
});
