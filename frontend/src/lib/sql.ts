// Pure SQL helpers (no DuckDB-WASM dependency) so the filter model stays
// unit-testable without loading the wasm bundle.

/** Escape a string literal for safe inlining into SQL. */
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
