// Real-runtime verification: invokes the actual ProcessCourseUseCase
// against the real database. This is what the user would hit when
// clicking "Generar árbol" — minus the broken Next.js page render.

import { describe, it, expect } from 'vitest';
import { createContainer } from '../../lib/composition/container';
import { db } from '../../lib/db';

describe('Final verification: Generar árbol at runtime', () => {
  it('creates TopicNodes when clicking Generar árbol on a course that has material but failed segmentation', async () => {
    // Find the course that has material with 0 SemanticUnits (failed segmentation)
    const course = await db.course.findFirst({
      where: {
        materials: {
          some: {
            semanticUnits: { none: {} }
          }
        }
      },
      include: {
        materials: {
          include: {
            _count: { select: { semanticUnits: true } }
          }
        },
        _count: { select: { topicNodes: true } }
      }
    });

    if (!course) {
      throw new Error('No course with failed-segmentation material found in DB');
    }

    console.log(`[VERIFICATION] Course: ${course.name} (${course.id})`);
    console.log(`[VERIFICATION] Materials: ${course.materials.length}`);
    for (const m of course.materials) {
      console.log(`[VERIFICATION]   - ${m.filename}: content=${m.content.length} chars, units=${m._count.semanticUnits}`);
    }
    console.log(`[VERIFICATION] Existing TopicNodes: ${course._count.topicNodes}`);

    const beforeTopicNodes = course._count.topicNodes;

    // Invoke the use case — exactly what the server action does
    const container = createContainer();
    const outcome = await container.processCourse.execute(course.id);

    console.log(`[VERIFICATION] Outcome:`, JSON.stringify(outcome, null, 2));

    // Check if TopicNodes were created
    const afterTopicNodes = await db.topicNode.count({ where: { courseId: course.id } });
    console.log(`[VERIFICATION] After: TopicNodes = ${afterTopicNodes}`);

    expect(afterTopicNodes).toBeGreaterThan(beforeTopicNodes);
  }, 300000); // 5 min timeout for LLM call
});
