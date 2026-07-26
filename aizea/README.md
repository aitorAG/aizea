# AIzea

> Plataforma de escritorio (Tauri + Next.js) que transforma PDFs de material didáctico en **árboles conceptuales** y **diapositivas** generadas con IA, con búsqueda semántica (RAG) local.

**Versión:** 0.2.0 · **Stack:** Next.js 15 · React 19 · TypeScript · Prisma/SQLite · LanceDB · Tauri 2 (Rust) · Zustand · Tailwind

---

## Wiki — índice navegable

Esta wiki está partida en varias páginas. Empieza por donde necesites:

| Página | Para qué |
|---|---|
| [Primeros pasos](./README.GETTING-STARTED.md) | Requisitos, instalación y arrancar en local (`pnpm local`) |
| [Compilar el escritorio (MSI)](./README.BUILD.md) | Generar el instalador `.msi`/`.exe` con `pnpm build:msi` |
| [Arquitectura](./README.ARCHITECTURE.md) | Diseño hexagonal, capas, flujo de datos, diagrama |
| [Módulos y carpetas](./README.MODULES.md) | Referencia de cada directorio y sus responsabilidades |
| [Pipeline de generación](./README.PIPELINE.md) | Cola persistente, worker, fases (segmentación→árbol) |
| [API y acciones](./README.API.md) | Endpoints REST, server actions, contratos |
| [Datos y persistencia](./README.DATA.md) | Modelos Prisma, SQLite, LanceDB, migraciones |
| [Testing](./README.TESTING.md) | Cómo correr la suite (889 tests), tipos de test |
| [Seguridad y distribución](./README.SECURITY.md) | Cifrado de API key, CSP, firma del instalador |

---

## Qué hace AIzea

1. **Subes un PDF** de material de estudio a un curso.
2. El **pipeline** lo procesa en fondo: segmenta el texto, extrae unidades semánticas, las integra y construye un **árbol conceptual** navegable.
3. A partir del árbol, genera **diapositivas** con contenido estructurado (guion, relevancia, narrativa, ejercicios).
4. Un motor **RAG** (LanceDB) indexa el contenido para búsqueda semántica.

Todo corre **en local**: la base de datos (SQLite), los vectores (LanceDB) y el servidor (Next.js) viven en la máquina del usuario. La única llamada externa es al LLM (OpenRouter), con la API key que aporta el usuario.

---

## Arranque rápido (TL;DR)

```powershell
# 1. Instalar dependencias
pnpm install

# 2. Configurar entorno (copia la plantilla y rellena tu API key opcional)
Copy-Item .env.example .env

# 3. Arrancar todo el stack local (docling + DB + Next dev en :3001)
pnpm local
```

Abre http://localhost:3001 · Salud del servicio: http://localhost:3001/api/health

Detalle completo en **[Primeros pasos](./README.GETTING-STARTED.md)**.

---

## Mapa del repositorio (nivel 1)

```
aizea/
├── app/            → Next.js App Router: páginas (UI) + rutas API REST
├── components/     → Componentes React (curso, slides, árbol, banner, ui)
├── lib/            → Núcleo (arquitectura hexagonal) — ver README.MODULES.md
│   ├── domain/          lógica de negocio pura
│   ├── application/     casos de uso + puertos (interfaces)
│   ├── infrastructure/  implementaciones (Prisma, LanceDB, OpenRouter…)
│   ├── composition/     inyección de dependencias (container)
│   ├── actions/         server actions de Next
│   ├── client/          data-layer tipado (ApiClient)
│   ├── stores/          estado cliente (Zustand)
│   └── types/           tipos compartidos
├── prisma/         → schema + migraciones + dev.db
├── src-tauri/      → shell de escritorio (Rust): supervisión, sidecar Node
├── scripts/        → arranque local, build MSI, utilidades/QA
├── tests/          → suite (unit + integration)
└── docs/           → documentación histórica de versiones + consultoría
```

---

## Convenciones del proyecto

- **Idioma:** UI, mensajes y documentación en **español**; código y comentarios en inglés.
- **Gestor de paquetes:** `pnpm` (con `node-linker=hoisted`, requerido para el build standalone en Windows).
- **Type-safety estricta:** prohibido `as any`, `@ts-ignore`. Todo cambio pasa `tsc --noEmit` + la suite verde.
- **Arquitectura hexagonal:** el dominio no conoce la infraestructura; se conectan por puertos en `lib/application/ports/`.

Ver los detalles en **[Arquitectura](./README.ARCHITECTURE.md)**.
