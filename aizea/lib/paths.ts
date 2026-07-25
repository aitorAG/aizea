/**
 * Centralised data-directory resolver.
 *
 * In desktop mode (Tauri .exe / .msi) the Rust launcher sets
 * AIZEA_DATA_DIR to the OS app-data directory before spawning the
 * Node.js server, so every piece of mutable data ends up in a
 * writable location even when the installer put the app somewhere
 * that requires elevation to write (e.g. Program Files).
 *
 * In dev / web mode the variable is unset and we fall back to
 * process.cwd(), which is the repo root — the same location that
 * was always used.
 *
 * Windows desktop example:
 *   AIZEA_DATA_DIR = C:\Users\<user>\AppData\Roaming\AIzea
 *
 * Directory layout (both modes):
 *   <dataDir>/
 *     db.sqlite          ← Prisma database
 *     uploads/           ← uploaded PDF files
 *     lancedb-data/      ← LanceDB vector store
 */

import { join } from "path";

/** Root data directory — writable in all deployment modes. */
export function getDataDir(): string {
  return process.env.AIZEA_DATA_DIR ?? process.cwd();
}

/**
 * Directory for uploaded PDF files.
 * In desktop mode: <appData>/uploads
 * In web/dev mode: <cwd>/public/uploads  (served as static assets)
 */
export function getUploadsDir(): string {
  if (process.env.AIZEA_DATA_DIR) {
    return join(process.env.AIZEA_DATA_DIR, "uploads");
  }
  return join(process.cwd(), "public", "uploads");
}

/** Directory for the LanceDB vector store. */
export function getLanceDbDir(): string {
  return join(getDataDir(), "lancedb-data");
}

/**
 * Path to the SQLite database file.
 * In desktop mode: <appData>/db.sqlite
 * In web/dev mode: uses DATABASE_URL env var (Prisma default).
 */
export function getDbPath(): string {
  return join(getDataDir(), "db.sqlite");
}
