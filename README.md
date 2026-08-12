<div align="center">

# 🎓 AIzea

### De tus PDFs a diapositivas y árboles conceptuales, con IA — 100% en tu ordenador.

Aplicación de escritorio que transforma material didáctico en PDF en **árboles conceptuales navegables** y **diapositivas listas para proyectar**, con **búsqueda semántica (RAG)** local. Sin nube: tus datos nunca salen de tu máquina.

<br />

[![Release](https://img.shields.io/github/v/release/aitorAG/aizea?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/aitorAG/aizea/releases)
[![Windows](https://img.shields.io/badge/Windows-MSI%20%2F%20EXE-0078D6?labelColor=black&logo=windows&logoColor=white&style=flat-square)](https://github.com/aitorAG/aizea/releases)
[![Stars](https://img.shields.io/github/stars/aitorAG/aizea?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/aitorAG/aizea/stargazers)
[![Issues](https://img.shields.io/github/issues/aitorAG/aizea?color=ff80eb&labelColor=black&style=flat-square)](https://github.com/aitorAG/aizea/issues)
[![Last commit](https://img.shields.io/github/last-commit/aitorAG/aizea?color=8ae8ff&labelColor=black&style=flat-square)](https://github.com/aitorAG/aizea/commits)

<br />

![Next.js](https://img.shields.io/badge/Next.js%2015-black?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React%2019-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri%202-24C8DB?style=flat-square&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat-square&logo=prisma&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)

</div>

---

## ✨ Qué es AIzea

AIzea es una herramienta para **docentes y estudiantes** que convierte apuntes y libros en PDF en material didáctico estructurado, sin trabajo manual.

Le das un PDF de una asignatura y AIzea:

1. **Lo entiende** — segmenta el texto, extrae las ideas clave (unidades semánticas) y construye un **árbol conceptual** navegable del tema.
2. **Lo enseña** — genera **diapositivas** con guion, relevancia, narrativa para el profesor y ejercicios, más un diseño HTML listo para proyectar en el aula.
3. **Lo recuerda** — indexa todo en un motor de **búsqueda semántica (RAG)** para que encuentres cualquier concepto al instante.

Todo corre **en local**: la base de datos (SQLite), los vectores (LanceDB) y el servidor viven en tu ordenador. La única llamada externa es al modelo de lenguaje (vía [OpenRouter](https://openrouter.ai)), con **tu propia clave de API**.

---

## 🚀 Características

| | Característica | Qué hace |
|:---:|:---|:---|
| 📄 | **Ingesta de PDF** | Analiza el layout con [Docling](https://github.com/DS4SD/docling) (o un fallback de texto plano) y extrae texto, estructura y figuras. |
| 🌳 | **Árbol conceptual** | Segmentación → unidades semánticas → integración → árbol de temas navegable, con granularidad ajustable. |
| 🖼️ | **Extracción de figuras** | Recupera imágenes reales del PDF. Para diagramas vectoriales sin imagen embebida, **rasteriza y recorta** la figura desde el propio PDF (in-process, sin dependencias externas). |
| 🎬 | **Generación de diapositivas** | Contenido estructurado (guion, relevancia, narrativa, ejercicios) + diseño HTML por IA. Generación por lotes en paralelo. |
| 📐 | **Ajuste automático** | Las diapositivas se **auto-escalan** para caber siempre en A4 apaisado (1123×794): sin recortes ni scroll, en pantalla y en el PDF. |
| ∑ | **Fórmulas en HTML** | Renderiza LaTeX con **KaTeX embebido (100% offline)** — funciona sin internet dentro del `.exe`. |
| 🔍 | **Búsqueda semántica (RAG)** | Indexa el contenido en [LanceDB](https://lancedb.com) para búsqueda por significado, no solo por palabras. |
| 📤 | **Exportación** | Exporta a **PDF** (A4, una diapositiva por página) o **HTML** autocontenido. |
| 🔒 | **Privacidad primero** | Todo el procesamiento y almacenamiento es local. Tu clave de API se cifra en reposo. |
| 🖥️ | **App de escritorio** | Instalador nativo de Windows (MSI/EXE) con [Tauri 2](https://tauri.app); no requiere navegador ni servidor externo. |

---

## 📦 Instalación (usuarios)

AIzea se distribuye como aplicación de escritorio para **Windows (x64)**.

1. Descarga el instalador desde la [**página de Releases**](https://github.com/aitorAG/aizea/releases):
   - **`AIzea_x.y.z_x64-setup.exe`** — instalador NSIS, **por usuario, sin permisos de administrador** (recomendado).
   - **`AIzea_x.y.z_x64_es-ES.msi`** — instalador MSI (despliegue corporativo).
2. Ejecuta el instalador y abre AIzea.
3. La primera vez, ve a **Ajustes** e introduce tu clave de API de [OpenRouter](https://openrouter.ai/settings/keys) (necesaria para la generación con IA).

> 💡 AIzea funciona sin conexión salvo por las llamadas al modelo de lenguaje. Los PDFs, la base de datos y los índices nunca salen de tu equipo.

---

## 🧭 Cómo funciona

```
        Subes un PDF a un curso
                 │
                 ▼
   ┌──────────────────────────────┐
   │  Pipeline (en segundo plano)  │   cola persistente + worker
   ├──────────────────────────────┤
   │  1. Segmentación del texto    │
   │  2. Unidades semánticas       │
   │  3. Integración               │
   │  4. Árbol conceptual          │
   └──────────────┬───────────────┘
                  │
        ┌─────────┴──────────┐
        ▼                    ▼
   Árbol navegable      RAG (LanceDB)
        │                    │
        ▼                    ▼
   Diapositivas         Búsqueda
   (contenido + HTML     semántica
    + figuras)
        │
        ▼
   Exportar a PDF / HTML
```

El pipeline es **resumible**: si se interrumpe, retoma donde iba al reiniciar. La generación de diapositivas corre bajo demanda o por lotes en paralelo.

---

## 🏗️ Stack y arquitectura

**AIzea** es una app **[Tauri 2](https://tauri.app)** (shell nativo en **Rust**) que embebe un servidor **[Next.js 15](https://nextjs.org)** (App Router, React 19, TypeScript) como sidecar Node. La persistencia es **[Prisma](https://www.prisma.io) + SQLite** y los vectores **[LanceDB](https://lancedb.com)**; la IA vía **[OpenRouter](https://openrouter.ai)**.

El código sigue una **arquitectura hexagonal** (puertos y adaptadores): el dominio es puro y no conoce la infraestructura; ambos se conectan por interfaces.

```
UI (app/ + components/ + stores)
        │  server actions / ApiClient
Application (casos de uso + PUERTOS)
        │  depende solo de interfaces
Domain (lógica de negocio PURA)
        ▲  implementan los puertos
Infrastructure (Prisma · LanceDB · OpenRouter · pdfium · cola)
        ▲  cablea todo
Composition Root (inyección de dependencias)
```

📚 **Documentación técnica completa** en [`aizea/README.md`](./aizea/README.md): [arquitectura](./aizea/README.ARCHITECTURE.md), [módulos](./aizea/README.MODULES.md), [pipeline](./aizea/README.PIPELINE.md), [datos](./aizea/README.DATA.md), [API](./aizea/README.API.md), [seguridad](./aizea/README.SECURITY.md) y [testing](./aizea/README.TESTING.md).

---

## 🛠️ Desarrollo

Requisitos: **Node.js 20+**, **pnpm 11+**, **Docker** (opcional, para el parser Docling) y **Rust 1.77+** (solo para compilar el escritorio).

```bash
# 1. Instalar dependencias (dispara prisma generate)
pnpm install

# 2. Crear el .env a partir de la plantilla
cp .env.example .env   # o Copy-Item en PowerShell

# 3. Arrancar todo el stack local (Docling + DB + Next dev en :3001)
pnpm local
```

Abre **http://localhost:3001**. Guía detallada en [Primeros pasos](./aizea/README.GETTING-STARTED.md).

### Comandos útiles

| Comando | Qué hace |
|:---|:---|
| `pnpm local` | Levanta Docling + sincroniza DB + arranca Next dev |
| `pnpm dev` | Solo Next.js dev |
| `pnpm test` | Suite de tests (Vitest) |
| `pnpm typecheck` | `tsc --noEmit` (type-safety estricta) |
| `pnpm build` | Build de producción de Next.js |
| `pnpm build:msi` | Genera el instalador de escritorio (MSI + EXE) — ver [Compilar](./aizea/README.BUILD.md) |
| `pnpm tauri:dev` | Ventana Tauri contra el dev server |

> El proyecto es **type-safe estricto** (prohibido `as any` / `@ts-ignore`) y todo cambio pasa `tsc --noEmit` + la suite verde.

---

## 🤝 Contribuir

Las contribuciones son bienvenidas. Antes de abrir un PR:

1. Asegúrate de que `pnpm typecheck` y `pnpm test` pasan en verde.
2. Sigue las convenciones del proyecto: UI y documentación en **español**, código y comentarios en **inglés**; arquitectura hexagonal (el dominio no importa infraestructura).
3. Describe el cambio y cómo lo verificaste.

---

<div align="center">

**AIzea** — Convierte tus apuntes en conocimiento estructurado.

Hecho con Next.js, Tauri y Rust.

</div>
