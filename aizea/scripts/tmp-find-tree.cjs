const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const rows = await p.course.findMany({
    include: { _count: { select: { topicNodes: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  console.log(
    JSON.stringify(
      rows.map((r) => ({ id: r.id, name: r.name, count: r._count.topicNodes })),
      null,
      2
    )
  );
  await p.$disconnect();
})();
