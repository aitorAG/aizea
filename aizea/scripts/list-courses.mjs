// One-shot script that lists a few courses + their slide counts so
// the Playwright evidence run can target a real courseId without
// hard-coding it.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const courses = await db.course.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { slides: true } } },
  });
  for (const c of courses) {
    console.log(`${c.id}\t${c._count.slides}\t${c.name}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
