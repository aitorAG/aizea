// Seed: create slides for the existing "fisica test 3 pags" course
// with titles matching the existing topic nodes, so the v1.5
// Issue 3.1 hierarchy (depth lookup by title) has data to render.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const course = await db.course.findFirst({
    where: { name: "fisica test 3 pags" },
  });
  if (!course) {
    console.log("No course 'fisica test 3 pags' found");
    return;
  }

  // Wipe any existing slides for a clean demo
  await db.slide.deleteMany({ where: { courseId: course.id } });
  console.log(`Cleared existing slides for course ${course.id}`);

  const nodes = await db.topicNode.findMany({
    where: { courseId: course.id },
    orderBy: { name: "asc" },
  });

  // Create one slide per node, in name order. The slide title
  // matches the node name, so the page-level depth lookup
  // (slide.title -> TopicNode.depth) succeeds for every slide.
  let i = 0;
  for (const n of nodes) {
    await db.slide.create({
      data: {
        courseId: course.id,
        title: n.name,
        description: n.summary ?? "",
        order: i++,
      },
    });
  }

  console.log(`Created ${nodes.length} slides for course ${course.id}`);
  console.log(`Course URL: http://localhost:3000/courses/${course.id}/slides`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
