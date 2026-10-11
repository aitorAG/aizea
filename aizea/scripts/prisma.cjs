const { spawnSync } = require("node:child_process");

const DEFAULT_DATABASE_URL = "file:./dev.db";

function resolveDatabaseUrl(env = process.env, override) {
  return override || env.DATABASE_URL || DEFAULT_DATABASE_URL;
}

if (require.main === module) {
  const hasDatabaseUrlFlag = process.argv[2] === "--database-url";
  const databaseUrl = hasDatabaseUrlFlag ? process.argv[3] : undefined;
  if (hasDatabaseUrlFlag && !databaseUrl) {
    console.error("--database-url requires a URL value.");
    process.exit(1);
  }
  const prismaArgs = hasDatabaseUrlFlag ? process.argv.slice(4) : process.argv.slice(2);
  const result = spawnSync(
    process.execPath,
    [require.resolve("prisma/build/index.js"), ...prismaArgs],
    {
      env: {
        ...process.env,
        DATABASE_URL: resolveDatabaseUrl(process.env, databaseUrl),
      },
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
