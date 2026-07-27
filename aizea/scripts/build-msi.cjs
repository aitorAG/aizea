#!/usr/bin/env node
// build-msi.cjs — One-command build of the self-contained AIzea desktop
// installer (.msi + .exe/NSIS).
//
// The desktop build is a Tauri shell that spawns the bundled Next.js
// standalone server with a bundled Node.js runtime. This script does
// every preparation step the Tauri bundler needs, in order:
//
//   1. Regenerate the Prisma client (safe / idempotent).
//   2. Build the Next.js standalone server (`next build`).
//   3. Copy the static assets the standalone server does NOT include
//      by itself:
//        - .next/static  -> .next/standalone/.next/static
//        - public        -> .next/standalone/public
//      (Next.js documents this as a required manual step for
//       `output: "standalone"`.)
//   4. Seed a pre-migrated SQLite DB into the standalone folder so the
//      first launch has a ready schema (copied to %APPDATA% on first
//      run by the Rust launcher).
//   5. Copy the Node.js runtime next to the app as a Tauri sidecar
//      (binaries/node-x86_64-pc-windows-msvc.exe) so the target machine
//      does NOT need Node.js installed.
//   6. Run `tauri build` to produce the .msi and NSIS .exe installers.
//
// The result is a fully self-contained installer: no Node.js, no Python,
// no docling-serve required on the target machine. PDF parsing uses the
// in-process pdf-parse fallback (AIZEA_SKIP_DOCLING is set by the Rust
// launcher), and the user supplies their own OpenRouter API key in
// /settings on first run.
//
// Usage:  npm run build:msi

const { spawnSync } = require("child_process");
const { existsSync, mkdirSync, copyFileSync, cpSync, rmSync } = require("fs");
const { join } = require("path");

const ROOT = join(__dirname, "..");
const STANDALONE = join(ROOT, ".next", "standalone");

function log(msg) {
  console.log(`\x1b[36m[build:msi]\x1b[0m ${msg}`);
}
function fail(msg) {
  console.error(`\x1b[31m[build:msi]\x1b[0m ${msg}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: true,
    cwd: ROOT,
    ...opts,
  });
  if (r.status !== 0) {
    fail(`Command failed (exit ${r.status}): ${cmd} ${args.join(" ")}`);
  }
}

// --- 1. Prisma client -------------------------------------------------
run("npx", ["prisma", "generate"]);

// --- 2. Next.js standalone build --------------------------------------
log("Building Next.js standalone (this can take a few minutes)…");
run("npx", ["next", "build"]);

if (!existsSync(join(STANDALONE, "server.js"))) {
  fail(
    "Next.js standalone build did not produce server.js. " +
      "Check the build output above."
  );
}

// --- 3. Copy static assets into the standalone folder -----------------
// `output: "standalone"` intentionally omits .next/static and public;
// they must be copied next to server.js for the server to serve CSS/JS
// and public files. https://nextjs.org/docs/app/api-reference/config/next-config-js/output
log("Copying .next/static and public into standalone…");
const staticSrc = join(ROOT, ".next", "static");
const staticDest = join(STANDALONE, ".next", "static");
if (existsSync(staticSrc)) {
  rmSync(staticDest, { recursive: true, force: true });
  cpSync(staticSrc, staticDest, { recursive: true });
} else {
  fail(".next/static not found — did the build succeed?");
}

const publicSrc = join(ROOT, "public");
const publicDest = join(STANDALONE, "public");
if (existsSync(publicSrc)) {
  rmSync(publicDest, { recursive: true, force: true });
  cpSync(publicSrc, publicDest, { recursive: true });
}

// --- 3b. Remove the dev .env from the standalone folder ---------------
// The .env file is a DEV artifact: it contains DATABASE_URL="file:./dev.db"
// which, when loaded by Next.js/Prisma at runtime, OVERRIDES the
// DATABASE_URL that the Rust launcher sets via Command::env(). This
// causes the installed app to connect to ./dev.db (relative to CWD)
// instead of %APPDATA%/com.aizea.app/db.sqlite, crashing with
// "table main.TopicNode does not exist".
//
// In production the Rust launcher provides every env var the server
// needs (DATABASE_URL, AIZEA_DATA_DIR, AIZEA_SKIP_DOCLING, PORT,
// HOSTNAME, NODE_ENV). The OpenRouter API key is NOT bundled — the
// user enters it in /settings, which persists it to the Settings DB
// row inside db.sqlite (survives reinstalls because app_data_dir is
// not removed by the NSIS uninstaller).
log("Removing dev .env from standalone (Rust launcher provides env vars)…");
const envFile = join(STANDALONE, ".env");
if (existsSync(envFile)) rmSync(envFile, { force: true });

// --- 3c. Remove the stale dev.db from the generated Prisma client -----
// `prisma generate` creates a placeholder dev.db inside
// node_modules/.prisma/client/. Historically the schema used a
// hardcoded `url = "file:./dev.db"`, so Prisma resolved that path
// RELATIVE TO THE SCHEMA FILE and silently opened this 4KB stub —
// which lacks the TopicNode/Slide tables — instead of the real
// database, crashing every dynamic route with P2021.
//
// The root fix is in prisma/schema.prisma (now `url = env("DATABASE_URL")`,
// so there is no hardcoded fallback path). This cleanup is defense in
// depth: with no stub present, any misconfiguration fails loudly at
// connect time instead of silently reading an empty database.
log("Removing stale dev.db stubs from generated Prisma client…");
const prismaClientDir = join(
  STANDALONE,
  "node_modules",
  ".prisma",
  "client"
);
for (const ext of ["", "-wal", "-shm", "-journal"]) {
  const stub = join(prismaClientDir, `dev.db${ext}`);
  if (existsSync(stub)) rmSync(stub, { force: true });
}
// The Rust launcher copies this to %APPDATA%/AIzea/db.sqlite on first
// run so the schema is ready without running prisma migrate offline.
//
// CRITICAL: SQLite uses WAL mode by default. Recent schema changes
// (new tables, columns) live in the 8MB+ -wal file alongside dev.db.
// If we copy only dev.db, those changes are lost and the installed app
// crashes with "table main.X does not exist". We force a WAL checkpoint
// FIRST so everything is flushed into the main .db file, THEN copy.
log("Flushing WAL into dev.db (checkpoint)…");
run("node", ["scripts/wal-checkpoint.cjs"]);

log("Seeding pre-migrated db.sqlite into standalone…");
const devDb = join(ROOT, "prisma", "dev.db");
if (existsSync(devDb)) {
  copyFileSync(devDb, join(STANDALONE, "db.sqlite"));
  // Remove any stale WAL/SHM sidecars from previous builds.
  for (const ext of ["-wal", "-shm"]) {
    const f = join(STANDALONE, `db.sqlite${ext}`);
    if (existsSync(f)) rmSync(f, { force: true });
  }
  // CRITICAL: dev.db carries the developer's test data (courses, materials…).
  // Wipe every row from the COPY so a fresh install starts EMPTY. This keeps
  // the schema (tables/columns) but removes all data. Never touches dev.db.
  log("Emptying installer db.sqlite (ship schema, zero data)…");
  run("node", ["scripts/seed-installer-db.cjs"]);
} else {
  log(
    "WARN: prisma/dev.db not found — the installer will start with an " +
      "empty DB. Run `npm run db:push` first if you want a seeded schema."
  );
}

// --- 4b. Prune non-Windows-x64 platform binaries ---------------------
// pnpm's `node-linker=hoisted` layout (required so Next.js standalone can
// COPY node_modules instead of creating symlinks — Windows blocks symlink
// creation without Developer Mode) materialises the platform-specific
// optional dependencies for EVERY OS: @lancedb, @esbuild and @img (sharp)
// each ship prebuilt binaries for win32/linux/darwin × x64/arm64. In the
// isolated layout pnpm only linked the current platform; hoisted copies
// them all, inflating the standalone from ~200MB to ~1.8GB (installer
// 89MB -> 456MB).
//
// The desktop target is win32-x64 ONLY, so we delete every platform
// package that is not win32-x64. This is safe: the app never loads a
// darwin/linux/arm binary on a Windows machine. Keeps the win32-x64
// variants and any platform-agnostic JS wrapper packages (size ~0).
log("Pruning non-Windows-x64 platform binaries from standalone…");
function pruneForeignPlatforms(scopeDir, keepSubstrings) {
  const dir = join(STANDALONE, "node_modules", scopeDir);
  if (!existsSync(dir)) return;
  const { readdirSync, statSync } = require("fs");
  let freedMb = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    // Keep JS wrapper packages (the ones without a platform suffix) and
    // anything matching a keep-substring (our target platform).
    const keep = keepSubstrings.some((s) => name.includes(s));
    const isPlatformPkg = /(win32|linux|linuxmusl|darwin|android|freebsd|openbsd|netbsd|sunos|aix|wasm|openharmony)/.test(
      name
    );
    if (isPlatformPkg && !keep) {
      try {
        const sz =
          (require("fs")
            .readdirSync(full)
            .reduce((acc, f) => {
              try {
                return acc + statSync(join(full, f)).size;
              } catch {
                return acc;
              }
            }, 0)) / 1024 / 1024;
        freedMb += sz;
      } catch {
        /* size best-effort */
      }
      rmSync(full, { recursive: true, force: true });
    }
  }
  log(`  ${scopeDir}: pruned foreign platforms`);
}
// @lancedb: keep only lancedb-win32-x64-msvc (+ the JS 'lancedb' wrapper).
pruneForeignPlatforms("@lancedb", ["win32-x64"]);
// @esbuild: keep only win32-x64.
pruneForeignPlatforms("@esbuild", ["win32-x64"]);
// @img (sharp): keep win32-x64 variants (sharp-win32-x64). libvips is
// bundled INSIDE sharp-win32-x64 on Windows, so the separate
// sharp-libvips-* packages (linux/darwin only) are safe to drop.
pruneForeignPlatforms("@img", ["win32-x64"]);

// --- 5. Bundle the Node.js runtime as a Tauri sidecar -----------------
// The sidecar must be named with the target triple so Tauri picks it up
// and strips the suffix, placing `node.exe` next to the main exe.
log("Bundling Node.js runtime as Tauri sidecar…");
const binariesDir = join(ROOT, "src-tauri", "binaries");
if (!existsSync(binariesDir)) mkdirSync(binariesDir, { recursive: true });

const nodeExe = process.execPath; // the node running THIS script
const sidecarDest = join(binariesDir, "node-x86_64-pc-windows-msvc.exe");
copyFileSync(nodeExe, sidecarDest);
log(`  node runtime: ${nodeExe} -> ${sidecarDest}`);

// --- 6. Tauri build ---------------------------------------------------
log("Running tauri build (compiles Rust + bundles MSI/NSIS)…");
run("npx", ["tauri", "build"]);

log("DONE. Installers are in src-tauri/target/release/bundle/");
log("  MSI  : src-tauri/target/release/bundle/msi/AIzea_*_x64_*.msi");
log("  NSIS : src-tauri/target/release/bundle/nsis/AIzea_*_x64-setup.exe");
log("The NSIS .exe installs per-user (no admin required).");
