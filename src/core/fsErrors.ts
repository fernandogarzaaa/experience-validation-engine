/**
 * Shared helper for the JSON-file-backed stores (`memory/longTerm.ts`,
 * `twins/store.ts`): distinguishing "the file doesn't exist yet" — a normal,
 * silent-reset-to-empty first run — from every other failure (corrupted
 * JSON, permission denial, disk failure), which must be surfaced rather than
 * quietly treated as "no data yet" and losing whatever was actually there.
 */
export function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
