// Cleanup helper: remove the "Nuevo nodo" we created during the first
// test pass, so the second pass starts from a clean baseline.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

(async () => {
  try {
    const COURSE = "eb18c671-5184-4461-b01e-c0cf800cccb6";
    const result = await db.topicNode.deleteMany({
      where: { courseId: COURSE, name: "Nuevo nodo" },
    });
    console.log("Deleted " + result.count + " 'Nuevo nodo' nodes from course " + COURSE);
    const after = await db.topicNode.count({ where: { courseId: COURSE } });
    console.log("TopicNodes for course after cleanup: " + after);
  } catch (e) {
    console.error(e);
  } finally {
    await db.$disconnect();
  }
})();
