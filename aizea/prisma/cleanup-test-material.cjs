const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  // Find any materials created during the test run
  const mats = await db.material.findMany({
    where: {
      filename: { contains: "upload-fixture" },
    },
    orderBy: { createdAt: "desc" },
  });
  console.log("Materials to clean:", mats.length);
  for (const m of mats) {
    console.log(`  - id=${m.id} filename=${m.filename} createdAt=${m.createdAt}`);
  }
  if (mats.length > 0) {
    const ids = mats.map((m) => m.id);
    // Delete text chunks first (FK)
    await db.textChunk.deleteMany({ where: { materialId: { in: ids } } });
    const res = await db.material.deleteMany({ where: { id: { in: ids } } });
    console.log("Deleted:", res.count);
  }
  await db.$disconnect();
})();
