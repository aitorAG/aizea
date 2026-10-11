const { spawnSync } = require("node:child_process");

const DEFAULT_DATABASE_URL = "file:./dev.db";

function resolveDatabaseUrl(env = process.env) {
  return env.DATABASE_URL || DEFAULT_DATABASE_URL;
}

if (require.main === module) {
  const result = spawnSync(
    process.execPath,
    [require.resolve("prisma/build/index.js"), ...process.argv.slice(2)],
    {
      env: { ...process.env, DATABASE_URL: resolveDatabaseUrl() },
      stdio: "inherit",
    }
  );

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

module.exports = { DEFAULT_DATABASE_URL, resolveDatabaseUrl };
