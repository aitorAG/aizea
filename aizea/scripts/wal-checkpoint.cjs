// Force a WAL checkpoint on dev.db so all schema + data changes
// are flushed into the main .db file. Without this, the 8MB WAL
// (containing the TopicNode table and other recent schema changes)
// is left behind when we copy dev.db -> standalone/db.sqlite, and
// the installed app crashes with "table main.TopicNode does not exist".
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)")
  .then(() => db.topicNode.count())
  .then((c) => {
    console.log("Checkpoint OK. TopicNode count:", c);
    return db.$disconnect();
  })
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Checkpoint failed:", e.message);
    process.exit(1);
  });
