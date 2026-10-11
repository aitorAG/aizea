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

const LOCAL_DATABASE_URL = "file:./dev.db";

export type DatabaseEnvironment = Record<string, string | undefined>;

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
 * Resolve the SQLite URL used by the application and its configuration.
 * Desktop data is authoritative: the launcher may also inherit a
 * DATABASE_URL, but it must never redirect desktop data outside app-data.
 * DATABASE_URL remains an explicit override for local tests and CI.
 */
export function getDatabaseUrl(
  env: DatabaseEnvironment = process.env
): string {
  if (env.AIZEA_DATA_DIR) {
    return `file:${join(env.AIZEA_DATA_DIR, "db.sqlite").replace(/\\/g, "/")}`;
  }
  return env.DATABASE_URL ?? LOCAL_DATABASE_URL;
}

/**
 * Path to the SQLite database file.
 * In desktop mode: <appData>/db.sqlite
 * In web/dev mode: the default is prisma/dev.db; explicit SQLite URLs are
 * retained for tests and CI.
 */
export function getDbPath(): string {
  const databaseUrl = getDatabaseUrl();
  if (databaseUrl.startsWith("file:")) {
    const filePath = databaseUrl.slice("file:".length);
    return filePath.startsWith("/")
      ? filePath
      : join(process.cwd(), "prisma", filePath);
  }
  return join(getDataDir(), "db.sqlite");
}
