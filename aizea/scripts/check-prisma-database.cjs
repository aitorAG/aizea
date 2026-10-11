const { spawnSync } = require("node:child_process");
const { DEFAULT_DATABASE_URL, resolveDatabaseUrl } = require("./prisma.cjs");

if (resolveDatabaseUrl({}) !== DEFAULT_DATABASE_URL) {
  throw new Error("Prisma default database URL is not the local dev database");
}

const override = "file:./prisma-check-override.db";
if (resolveDatabaseUrl({ DATABASE_URL: override }) !== override) {
  throw new Error("DATABASE_URL override was not preserved");
}

const defaultEnv = { ...process.env };
delete defaultEnv.DATABASE_URL;
const defaultResult = spawnSync(process.execPath, ["scripts/prisma.cjs", "validate"], {
  env: defaultEnv,
  stdio: "pipe",
  encoding: "utf8",
});

if (defaultResult.status !== 0) {
  throw new Error(`Prisma validate failed with the local default:\n${defaultResult.stdout || ""}${defaultResult.stderr || ""}`);
}

const overrideResult = spawnSync(
  process.execPath,
  ["scripts/prisma.cjs", "validate"],
  {
    env: { ...process.env, DATABASE_URL: "not-a-valid-sqlite-url" },
    stdio: "pipe",
    encoding: "utf8",
  }
);

if (overrideResult.status === 0) {
  throw new Error("Prisma validate unexpectedly accepted an invalid DATABASE_URL override");
}

console.log("Prisma default and DATABASE_URL override precedence verified.");
