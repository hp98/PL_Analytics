// DuckDB-WASM singleton. Self-contained: the wasm + worker are imported via
// Vite `?url` so they are served from our own origin (works offline; no CDN),
// satisfying the "instant and offline" requirement for the Explorer (§8.3).

import * as duckdb from "@duckdb/duckdb-wasm";
import eh_wasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import eh_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import mvp_wasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvp_worker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvp_wasm, mainWorker: mvp_worker },
  eh: { mainModule: eh_wasm, mainWorker: eh_worker },
};

// Parquet bundles registered as virtual files for range-read querying.
const PARQUET_FILES = [
  "mart_player_form",
  "fct_player_gameweek",
  "dim_team",
  "dim_fixture",
  "dim_gameweek",
] as const;

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;
let filesRegistered = false;

async function initDb(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
  const worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  return db;
}

export function getDb(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) dbPromise = initDb();
  return dbPromise;
}

/** Register the published parquet files (idempotent). */
async function ensureFiles(db: duckdb.AsyncDuckDB): Promise<void> {
  if (filesRegistered) return;
  const base = `${window.location.origin}/data`;
  await Promise.all(
    PARQUET_FILES.map((name) =>
      db.registerFileURL(
        `${name}.parquet`,
        `${base}/${name}.parquet`,
        duckdb.DuckDBDataProtocol.HTTP,
        false,
      ),
    ),
  );
  filesRegistered = true;
}

// Coerce Arrow/DuckDB values into plain JS numbers for the UI.
//
// int64 arrives as BigInt. DuckDB's HUGEINT (what sum() over an integer column
// returns) arrives as an Arrow Decimal, whose JS representation is a raw
// byte-backed value that silently reads wrong if used as a number — a 9 can
// surface as 9000. Prefer casting such aggregates in SQL (`sum(x)::INT`); this
// is the backstop so a stray one degrades visibly rather than quietly.
function coerce(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (
    value !== null &&
    typeof value === "object" &&
    ArrayBuffer.isView(value as ArrayBufferView)
  ) {
    // An unconverted Decimal/BigNum: surface it as null instead of a wrong number.
    return null;
  }
  return value;
}

/** Run a read-only SQL query, returning plain typed row objects. */
export async function query<T>(sql: string): Promise<T[]> {
  const db = await getDb();
  await ensureFiles(db);
  const conn = await db.connect();
  try {
    const result = await conn.query(sql);
    return result.toArray().map((row) => {
      const obj = row.toJSON() as Record<string, unknown>;
      for (const key of Object.keys(obj)) obj[key] = coerce(obj[key]);
      return obj as T;
    });
  } finally {
    await conn.close();
  }
}

export { sqlString } from "./sql";
