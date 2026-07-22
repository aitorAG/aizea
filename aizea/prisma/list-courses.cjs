const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  const courses = await db.course.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  console.log(JSON.stringify(courses, null, 2));
  await db.$disconnect();
})();
