import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const course = await db.course.findFirst({
    where: { name: "fisica test 3 pags" },
  });
  if (!course) {
    console.log("No course found");
    return;
  }
  const nodes = await db.topicNode.findMany({
    where: { courseId: course.id },
    orderBy: { name: "asc" },
  });
  console.log("NODES:");
  for (const n of nodes) {
    console.log(`  depth=${n.depth} parent=${n.parentId ?? "ROOT"} name=${JSON.stringify(n.name)}`);
  }
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
