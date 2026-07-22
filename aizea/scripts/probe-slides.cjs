// Quick DB probe — find slides with generated HTML so we can verify export.
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  const slides = await db.slide.findMany({
    where: { htmlDesign: { not: null } },
    select: {
      id: true,
      title: true,
      courseId: true,
      htmlDesign: true,
      course: { select: { name: true } },
    },
    take: 3,
  });
  console.log(
    JSON.stringify(
      slides.map((s) => ({
        id: s.id,
        title: s.title,
        courseId: s.courseId,
        courseName: s.course.name,
        hasHtml: !!s.htmlDesign,
        htmlLen: s.htmlDesign ? s.htmlDesign.length : 0,
        htmlStart: s.htmlDesign ? s.htmlDesign.slice(0, 120) : null,
      })),
      null,
      2
    )
  );
  await db.$disconnect();
})();
