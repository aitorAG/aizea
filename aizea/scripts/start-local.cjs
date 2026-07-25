#!/usr/bin/env node
// start-local.cjs — One-command local launch for AIzea (development mode).
//
// Orchestrates the FULL local stack so a single `npm run local` brings
// everything up in the right order:
//
//   1. Start docling-serve (Docker) — the PDF layout parser on :5001.
//   2. Wait until docling-serve reports healthy (models load lazily).
//   3. Sync the Prisma schema to dev.db (idempotent).
//   4. Start the Next.js dev server on :3001.
//
// This is the LOCAL DEV path. It does NOT touch AIZEA_DATA_DIR, so all
// data stays in the repo (dev.db, public/uploads, lancedb-data) exactly
// as before. The desktop/MSI path is separate and sets AIZEA_DATA_DIR.
//
// Requirements on this machine:
//   - Docker Desktop running (for docling-serve)
//   - Node.js + npm (already present)
//
// Usage:  npm run local

const { spawn, spawnSync } = require("child_process");
const http = require("http");

const DOCLING_HEALTH = "http://127.0.0.1:5001/health";
const DEV_PORT = process.env.PORT || "3001";
const DOCLING_MAX_WAIT_MS = 120_000; // models can take ~1 min on cold start

function log(msg) {
  console.log(`\x1b[36m[local]\x1b[0m ${msg}`);
}
function warn(msg) {
  console.log(`\x1b[33m[local]\x1b[0m ${msg}`);
}
function err(msg) {
  console.log(`\x1b[31m[local]\x1b[0m ${msg}`);
}

function pingDocling() {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: "127.0.0.1", port: 5001, path: "/health", timeout: 4000 },
      (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 300);
        res.resume();
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureDocling() {
  // Already up?
  if (await pingDocling()) {
    log("docling-serve ya está healthy en :5001");
    return true;
  }

  log("Levantando docling-serve (Docker)…");
  const up = spawnSync(
    "docker",
    ["compose", "up", "-d", "docling-serve"],
    { stdio: "inherit", shell: true }
  );
  if (up.status !== 0) {
    err(
      "No se pudo iniciar docling-serve. ¿Está Docker Desktop corriendo?\n" +
        "        Sin docling-serve, la SUBIDA de PDFs fallará (el resto de la app funciona)."
    );
    return false;
  }

  log("Esperando a que docling-serve esté healthy (puede tardar ~1 min la primera vez)…");
  const start = Date.now();
  while (Date.now() - start < DOCLING_MAX_WAIT_MS) {
    if (await pingDocling()) {
      log("docling-serve HEALTHY ✔");
      return true;
    }
    await sleep(3000);
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  warn(
    "docling-serve no respondió a tiempo. Continúo igualmente; " +
      "la subida de PDFs puede fallar hasta que esté listo."
  );
  return false;
}

function syncDb() {
  // Regenerate the Prisma client FIRST. Without this, a fresh checkout
  // (or a schema change) starts the dev server against a stale/absent
  // client and every page 500s with:
  //   "@prisma/client did not initialize yet. Please run prisma generate"
  log("Generando cliente Prisma…");
  const gen = spawnSync("npx", ["prisma", "generate"], {
    stdio: "inherit",
    shell: true,
  });
  if (gen.status !== 0) {
    warn("prisma generate devolvió un código no-cero.");
  }

  log("Sincronizando esquema Prisma con dev.db…");
  const r = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], {
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) {
    warn("prisma db push devolvió un código no-cero (puede ser inofensivo).");
  }
}

function startDevServer() {
  log(`Arrancando Next.js dev server en http://localhost:${DEV_PORT} …`);
  const child = spawn("npx", ["next", "dev", "--port", DEV_PORT], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env },
  });
  child.on("exit", (code) => process.exit(code ?? 0));

  // Forward Ctrl+C so the dev server shuts down cleanly.
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
}

(async () => {
  log("Iniciando stack local de AIzea…");
  await ensureDocling();
  syncDb();
  startDevServer();
})();
