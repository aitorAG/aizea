// Seed: create a brand-new course with a multi-level TopicNode tree
// AND matching slides (with parentSlideId set) so the new hierarchy
// UI can be demoed/screenshot'ed. Idempotent: re-runs clean up
// previous demo data first.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const DEMO_NAME = 'v1.5 #4.1 Slide Hierarchy Demo';
const TREE = [
  {
    name: 'Mecánica de fluidos',
    summary: 'Estudio de fluidos en reposo y movimiento.',
    children: [
      {
        name: 'Propiedades de los fluidos',
        summary: 'Densidad, viscosidad, presión.',
        children: [
          { name: 'Densidad', summary: 'Masa por unidad de volumen.' },
          {
            name: 'Viscosidad',
            summary: 'Resistencia interna al flujo.',
            children: [
              { name: 'Viscosidad dinámica', summary: 'Poise, Pa·s.' },
              { name: 'Viscosidad cinemática', summary: 'Stoke, m²/s.' },
              { name: 'Saybolt', summary: 'Viscosímetro Saybolt.' },
            ],
          },
        ],
      },
      {
        name: 'Estática de fluidos',
        summary: 'Fluidos en reposo.',
        children: [
          { name: 'Presión hidrostática', summary: 'Variación con la profundidad.' },
          { name: 'Principio de Pascal', summary: 'Transmisión de presión.' },
        ],
      },
    ],
  },
  {
    name: 'Lubricación y fricción',
    summary: 'Contacto entre superficies y su lubricación.',
    children: [
      {
        name: 'Teoría de la fricción',
        summary: 'Leyes y modelos clásicos.',
        children: [
          { name: 'Coeficiente de fricción', summary: 'Relación entre fuerzas.' },
          { name: 'Ecuación de Petroff', summary: 'Modelo de fricción viscosa.' },
        ],
      },
      {
        name: 'Componentes mecánicos',
        summary: 'Chumaceras y cojinetes.',
        children: [
          { name: 'Chumacera de camisa', summary: 'Soporte de eje deslizante.' },
          { name: 'Cojinete antifricción', summary: 'Rodamientos de bolas/rodillos.' },
        ],
      },
      {
        name: 'Tipos de lubricación',
        summary: 'Hidrodimámica, limítrofe, mixta.',
        children: [
          { name: 'Lubricación hidrodinámica', summary: 'Película fluida completa.' },
          { name: 'Lubricación limítrofe', summary: 'Contacto parcial asperidad.' },
        ],
      },
    ],
  },
];

async function deleteCourseByName(name) {
  const c = await db.course.findFirst({ where: { name } });
  if (c) {
    // Children cascade via FK
    await db.course.delete({ where: { id: c.id } });
    console.log(`Deleted previous demo course "${name}" (${c.id})`);
  }
}

function flattenTree(nodes, parentId = null, depth = 0, out = []) {
  for (const n of nodes) {
    out.push({ name: n.name, summary: n.summary ?? '', parentId, depth });
    if (n.children) flattenTree(n.children, '__PARENT__', depth + 1, out);
  }
  return out;
}

(async () => {
  await deleteCourseByName(DEMO_NAME);

  // Create the course
  const course = await db.course.create({ data: { name: DEMO_NAME } });
  console.log(`Created course "${course.name}" (${course.id})`);

  // Create the tree recursively, then resolve parent IDs
  const flat = [];
  flattenTree(TREE, null, 0, flat);
  const idByName = new Map();
  for (const n of flat) {
    const parentId = n.parentId === '__PARENT__' ? null : n.parentId; // placeholder; will be updated below
    const created = await db.topicNode.create({
      data: {
        courseId: course.id,
        name: n.name,
        summary: n.summary,
        parentId: null, // we'll update later
        depth: n.depth,
      },
    });
    idByName.set(n.name, created.id);
  }
  // Resolve parent IDs by walking TREE in the same order
  function resolveIds(nodes, parentId = null) {
    for (const n of nodes) {
      const id = idByName.get(n.name);
      n._id = id;
      if (n.children) resolveIds(n.children, id);
    }
  }
  resolveIds(TREE);
  for (const n of flat) {
    const realParentId = n.parentId === '__PARENT__'
      ? findParentIdInTREE(TREE, n.name)
      : null;
    if (realParentId) {
      await db.topicNode.update({
        where: { id: idByName.get(n.name) },
        data: { parentId: realParentId },
      });
    }
  }
  function findParentIdInTREE(nodes, name) {
    for (const n of nodes) {
      if (n.children) {
        for (const c of n.children) {
          if (c.name === name) return n._id;
        }
        const r = findParentIdInTREE(n.children, name);
        if (r) return r;
      }
    }
    return null;
  }

  // Create slides for every node (1 slide per node) with parentSlideId
  // set according to the tree
  const order = [];
  function collect(nodes) {
    for (const n of nodes) {
      order.push(n);
      if (n.children) collect(n.children);
    }
  }
  collect(TREE);

  const nodeIdByName = new Map();
  for (const n of order) nodeIdByName.set(n.name, n._id);

  // First pass: create slides without parent links
  const created = [];
  for (let i = 0; i < order.length; i++) {
    const n = order[i];
    const s = await db.slide.create({
      data: {
        courseId: course.id,
        title: n.name,
        description: n.summary,
        order: i,
        sourceNodeId: n._id,
        status: 'COMPLETED',
      },
    });
    created.push({ slideId: s.id, nodeId: n._id, nodeName: n.name });
  }

  // Second pass: link parentSlideId
  for (const entry of created) {
    const node = order.find((n) => n._id === entry.nodeId);
    // find the slide id of this node's parent (if any)
    const parentName = findParentNameInTREE(TREE, entry.nodeName);
    if (parentName) {
      const parentSlide = created.find((c) => c.nodeName === parentName);
      if (parentSlide) {
        await db.slide.update({
          where: { id: entry.slideId },
          data: { parentSlideId: parentSlide.slideId },
        });
      }
    }
  }

  function findParentNameInTREE(nodes, name, parent = null) {
    for (const n of nodes) {
      if (n.name === name) return parent ? parent.name : null;
      if (n.children) {
        const r = findParentNameInTREE(n.children, name, n);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  }

  // Add a sample box for "Viscosidad" so it shows as "Listo"
  const visc = created.find((c) => c.nodeName === 'Viscosidad');
  if (visc) {
    await db.slideBox.createMany({
      data: [
        { slideId: visc.slideId, type: 'script', content: '...' },
        { slideId: visc.slideId, type: 'relevance', content: '...' },
      ],
    });
  }

  console.log(`\nCreated ${created.length} slides with parent links.`);
  console.log(`Course id: ${course.id}`);
  console.log(`Course name: ${course.name}`);
  await db.$disconnect();
})();
