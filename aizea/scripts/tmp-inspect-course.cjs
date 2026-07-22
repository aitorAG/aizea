// @ts-check
// Inspect a course to understand its pipeline state.
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const COURSE_ID = process.argv[2];
if (!COURSE_ID) {
  console.error("Usage: node tmp-inspect-course.cjs <courseId>");
  process.exit(1);
}

(async () => {
  const course = await db.course.findUnique({
    where: { id: COURSE_ID },
    include: { _count: { select: { topicNodes: true } } },
  });
  if (!course) {
    console.log("Course not found");
    return;
  }
  const recentJobs = await db.processingJob.findMany({
    where: { courseId: COURSE_ID },
    orderBy: { updatedAt: "desc" },
    take: 6,
  });
  console.log(
    JSON.stringify(
      {
        id: course.id,
        name: course.name,
        nodeCount: course._count.topicNodes,
        recentJobs: recentJobs.map((j) => ({
          id: j.id,
          type: j.type,
          status: j.status,
          progress: j.progress,
          updatedAt: j.updatedAt.toISOString(),
        })),
      },
      null,
      2
    )
  );
  await db.$disconnect();
})();
