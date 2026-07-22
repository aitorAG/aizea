import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const courses = await db.course.findMany({
    select: {
      id: true,
      name: true,
      _count: { select: { slides: true, topicNodes: true, materials: true } },
    },
  });
  console.log("=== COURSES ===");
  console.log(JSON.stringify(courses, null, 2));

  for (const course of courses) {
    if (course._count.topicNodes > 0 && course._count.slides > 0) {
      console.log(`\n=== SLIDES + NODES for ${course.name} ===`);
      const nodes = await db.topicNode.findMany({
        where: { courseId: course.id },
        select: { id: true, name: true, depth: true, parentId: true },
        orderBy: [{ depth: "asc" }, { name: "asc" }],
      });
      const slides = await db.slide.findMany({
        where: { courseId: course.id },
        select: { id: true, title: true, order: true },
        orderBy: { order: "asc" },
      });
      console.log("NODES:");
      console.log(JSON.stringify(nodes, null, 2));
      console.log("SLIDES:");
      console.log(JSON.stringify(slides, null, 2));
    }
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
