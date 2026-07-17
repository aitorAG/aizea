# AIzea — Documento de Producto

## Misión
Empoderar a profesores universitarios para crear materiales docentes de alta calidad a partir de sus fuentes bibliográficas, reduciendo drásticamente el tiempo de preparación de clases mediante inteligencia artificial.

## Visión
Ser la herramienta estándar para la generación semiautomática de contenidos formativos en educación superior, donde el profesor mantiene el control creativo y la IA actúa como asistente de producción.

## Constitución del Producto

### Principios Fundamentales
1. **El profesor tiene la última palabra** — La IA sugiere, el profesor decide, edita y aprueba.
2. **Origen único de verdad** — Todo el contenido generado debe estar fundamentado en los materiales de referencia subidos por el profesor.
3. **Flujo lineal con libertad** — La app guía al profesor por un proceso estructurado (Materiales → Diapositivas → Contenido → Exportar), pero permite navegar libremente.
4. **Local-first** — La aplicación se ejecuta en local (o en servidor propio vía Docker), sin dependencia de servicios cloud excepto la API de IA.
5. **Modularidad de servicios** — El backend se compone de servicios aislados (extracción de texto, generación IA, exportación) que pueden evolucionar independientemente.

### Lo que NO es AIzea
- No es un generador automático de cursos sin supervisión
- No es un LMS (Learning Management System)
- No es una herramienta de presentación en vivo
- No reemplaza el criterio pedagógico del profesor

---

## Glosario

| Término | Definición |
|---|---|
| **Curso** | Unidad organizativa principal. Representa una asignatura o parte de ella (ej: "Diseño en Ingeniería Mecánica — Tema 10"). |
| **Material** | Documento de referencia subido por el profesor (PDF, Word, imagen). Es la fuente de verdad para la generación de contenido. |
| **Diapositiva (Slide)** | Unidad atómica de contenido formativo. Representa un concepto, fórmula, tabla o gráfica que merece exposición individual. |
| **Guion** | Lista de contenidos a presentar en una diapositiva, generado por la IA a partir del material. Define qué se explica y en qué orden. |
| **Diseño HTML** | Representación visual de la diapositiva en HTML. Incluye el guion formateado, fórmulas LaTeX renderizadas, y referencias a figuras. Se usa como miniatura y como diapositiva final. |
| **Relevancia** | Texto que explica por qué el concepto de la diapositiva es importante en ingeniería, conectándolo con aplicaciones industriales reales. |
| **Narrativa** | Texto completo que la profesora puede usar para impartir la clase. Incluye introducción, desarrollo con ejemplos, y cierre. Tono natural de exposición oral. |
| **Ejercicio** | Enunciado de problema que evalúa la comprensión del concepto de la diapositiva. Incluye datos numéricos y requiere aplicar lo aprendido. |
| **Contexto LLM** | Texto libre que el profesor proporciona para guiar a la IA en la generación. Puede incluir instrucciones específicas, enfoque deseado, o restricciones. |
| **RAG (Retrieval-Augmented Generation)** | Sistema que indexa el material original para recuperar fragmentos relevantes durante la generación, mejorando la precisión y fidelidad al texto fuente. |
| **Exportación** | Generación de un documento final (PDF/Markdown) con todas las diapositivas formateadas para uso en clase. |
| **Figura** | Imagen, gráfica o tabla extraída del material de referencia, identificada por su numeración (ej: "Figura 10.5"). |

---

## Flujo de Usuario

```
[Dashboard] → [Crear Curso] → [Materiales] → [Gestión de Diapositivas] → [Exportar]
                   │                                  │
                   └──────────────────────────────────┤
                                                      ▼
                                            [Vista de Diapositiva]
                                            (editar diseño HTML,
                                             guion, relevancia,
                                             narrativa)
```

### 1. Dashboard (Landing Page)
- Ver lista de cursos existentes con nombre, nº de diapositivas, fecha
- Seleccionar curso → navega a Materiales
- Editar nombre del curso (inline o modal)
- Eliminar curso (con confirmación)
- Crear nuevo curso → navega a Materiales

### 2. Materiales (Por Curso)
- Ver archivos subidos con icono por tipo (PDF, Word, imagen), nombre y tamaño
- Click en archivo → previsualizar en navegador
- Subir archivos desde local (drag & drop + botón)
- Eliminar archivos subidos
- Caja de texto libre "Contexto para la IA": instrucciones adicionales para el LLM
- Botón "Guardar" → persiste todo y navega a Gestión de Diapositivas

### 3. Gestión de Diapositivas (Central Control)
- Si no hay diapositivas: botón único "Generar Esquema con IA"
- Si hay diapositivas: lista vertical de bloques
- Cada bloque muestra:
  - Thumbnail del diseño HTML a la izquierda
  - Título, descripción, nº/total (ej: "3/12")
  - Iconos de acción: editar, regenerar (individual), eliminar
- Botón "Generar Todo" al final:
  - Itera sobre cada diapositiva
  - Genera: guion, diseño HTML, relevancia, narrativa
  - Muestra borde de color en diapositivas procesadas
- Cada diapositiva tiene icono de "generar individual"
- El profesor puede: reordenar (drag & drop), eliminar, editar título, crear nueva manualmente
- Botón "Exportar" → genera PDF/Markdown

### 4. Vista de Diapositiva (Detalle)
- Layout de dos columnas:
  - Izquierda: renderizado HTML de la diapositiva (preview en tiempo real)
  - Derecha: guion, relevancia, narrativa (campos editables)
- Debajo del HTML: caja de texto libre "Instrucciones de diseño" para regenerar el HTML
- Botón "Regenerar HTML" → envía todos los campos al LLM y actualiza el diseño
- Botón "Guardar" → persiste todos los cambios
- Botón "Volver" → regresa a Gestión de Diapositivas

### 5. Exportación
- Botón en Gestión de Diapositivas
- Genera PDF o Markdown
- Una página por diapositiva:
  - Título
  - Render HTML (mitad superior de A4)
  - Guion + Relevancia + Narrativa (mitad inferior)
- Descarga automática en el equipo local

---

## Comportamientos UX

### Reglas de Interacción

- **Tarjeta de diapositiva (slide block)**: toda la superficie de la tarjeta es clickable. Al hacer click, navega a la vista de detalle de la diapositiva.
- **Botones de acción (Editar, Eliminar, Generar)**: cada botón detiene la propagación del evento (`stopPropagation`). El click en un botón ejecuta su acción sin disparar la navegación a detalle.
- **Vista previa HTML**: el renderizado se ajusta al contenedor de la tarjeta. Al hacer click sobre la vista previa, se abre un modal overlay a pantalla completa para inspeccionar el diseño sin salir de la lista.
- **Handle de arrastre**: implementado con `@dnd-kit/core` y `@dnd-kit/sortable`. El handle incluye `suppressHydrationWarning` para evitar errores de hidratación en entornos SSR.
- **Estado de generación**: durante la generación de contenido se muestran mensajes animados por paso (esquema, guion, diseño HTML, relevancia, narrativa). Las diapositivas en proceso muestran un borde de color. Al completarse, aparece un checkmark verde.

---

## Arquitectura del Sistema

### Servicios (MVP)
```
┌─────────────────────────────────────────────┐
│              Next.js Frontend                │
│  (App Router, Server Components, Actions)    │
├─────────────────────────────────────────────┤
│  Servicio de Extracción (pdf-parse)          │
│  Servicio de IA (OpenRouter/DeepSeek)        │
│  Servicio de Exportación (HTML→PDF)          │
│  Capa de Datos (Prisma + SQLite)             │
└─────────────────────────────────────────────┘
```

### Futuro (visión a largo plazo)
- Servicio RAG independiente (vector store + embeddings)
- API REST separada del frontend
- Cola de trabajos para generación asíncrona
- Soporte multi-usuario con autenticación

---

## Stack Tecnológico
| Capa | Tecnología |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS |
| UI Components | Custom (button, card, dialog, input, textarea, badge, spinner) |
| Drag & Drop | @dnd-kit/core + @dnd-kit/sortable |
| Base de Datos | SQLite (Prisma ORM) |
| IA | OpenRouter API (DeepSeek V3) |
| Renderizado LaTeX | KaTeX (CDN + react-markdown + remark-math + rehype-katex) |
| Exportación | HTML autocontenido con KaTeX CDN, imprimible a PDF |
| Despliegue | Docker + docker-compose |

---

## Historial de Decisiones

1. **SQLite vs PostgreSQL**: Se eligió SQLite por simplicidad (app local, single-user). Para despliegue cloud se migraría a Turso (libSQL) o PostgreSQL.
2. **Server Actions vs API Routes**: Se usan Server Actions para mutaciones (mejor DX en Next.js 15) y API Routes para exportación (necesita streaming/descarga).
3. **KaTeX vs MathJax**: KaTeX es más rápido y ligero. Se carga desde CDN en exportaciones.
4. **HTML vs PPTX para slides**: HTML permite renderizado LaTeX nativo y es más portable. PPTX se puede añadir después con pptxgenjs.
5. **RAG MVP**: Para el MVP se implementa extracción de referencias de figuras del texto. RAG completo (embeddings + vector store) queda para fase 2.
6. **Docker**: Se añade para garantizar despliegue consistente en cualquier máquina, incluyendo la BD SQLite y los directorios de uploads.

---

## Notas de la Entrevista con Bea (Profesora)

- Material educativo → guía docente con lista de temas y bibliografía
- Libro principal: Diseño en Ingeniería Mecánica — Shigley
- Foco: Temas 10, 12, 16, 17 (lubricación, rodamientos, engranajes, etc.)
- Proceso actual de Bea: lee el libro → prepara diapositivas con esquemas narrativos + diagramas → enseña fórmulas → diseña ejercicios
- Las diapositivas combinan texto narrativo con gráficas y tablas del libro
- Las gráficas/tablas son "sagradas": se usan tal cual aparecen en el libro
- Sistema de 5 carriles: diapositiva, narrativa, ejercicio, relevancia, guion
- El sistema debe generar una librería interna de figuras etiquetadas
- Las fórmulas deben codificarse en LaTeX/Markdown
