const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  const count = await db.slide.count({
    where: { courseId: "3d416e2a-e498-42d8-a539-0d49c08d3e0b" },
  });
  console.log("slide count:", count);
  const withHtml = await db.slide.count({
    where: {
      courseId: "3d416e2a-e498-42d8-a539-0d49c08d3e0b",
      htmlDesign: { not: null },
    },
  });
  console.log("with html:", withHtml);
  await db.$disconnect();
})();
