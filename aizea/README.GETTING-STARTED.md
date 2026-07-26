# Primeros pasos

[◄ Volver al índice](./README.md) · Siguiente: [Compilar el escritorio ►](./README.BUILD.md)

Cómo instalar y arrancar AIzea en modo desarrollo.

---

## Requisitos

| Herramienta | Versión | Nota |
|---|---|---|
| **Node.js** | ≥ 18 (recomendado 20+) | Runtime de Next.js |
| **pnpm** | 11+ | Gestor de paquetes del proyecto |
| **Docker Desktop** | cualquiera reciente | Solo para **docling-serve** (parser de PDFs). Opcional pero recomendado |
| **Rust** | ≥ 1.77 (1.97+ recomendado) | Solo si vas a compilar el escritorio — ver [BUILD](./README.BUILD.md) |

> Sin Docker, la app arranca igual pero la **subida de PDFs** usa un fallback de texto plano (sin análisis de layout ni figuras).

---

## Instalación

```powershell
# 1. Instalar dependencias (dispara `prisma generate` vía postinstall)
pnpm install

# 2. Crear el .env a partir de la plantilla
Copy-Item .env.example .env
```

### Variables de entorno (`.env`)

```ini
# API key de OpenRouter (https://openrouter.ai/settings/keys)
# También configurable en la app en /settings. Puede quedar vacía al arrancar.
OPENROUTER_API_KEY=

# Modelo LLM por defecto (opcional)
OPENROUTER_MODEL=deepseek/deepseek-chat

# URL de Docling para parsing avanzado (opcional; sin él usa parsing básico)
DOCLING_BASE_URL=http://127.0.0.1:5001

# Base de datos SQLite (relativa a prisma/)
DATABASE_URL="file:./dev.db"
```

Detalle de cómo se resuelve la config (DB > env > defaults) en [Datos y persistencia](./README.DATA.md).

---

## Arrancar en local

### Opción recomendada — todo el stack de un tirón

```powershell
pnpm local
```

El script [`scripts/start-local.cjs`](./scripts/start-local.cjs) orquesta, en orden:

1. Levanta **docling-serve** en Docker (`:5001`) y espera a que reporte *healthy* (~1 min en frío).
2. `prisma generate` + `prisma db push` contra `dev.db` (idempotente).
3. Arranca **Next.js dev** en http://localhost:3001.

Este camino **no** toca `AIZEA_DATA_DIR`: todos los datos quedan en el repo (`dev.db`, `public/uploads`, `lancedb-data`).

### Opciones granulares

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Solo Next.js dev (sin docling ni sincronización de DB) |
| `pnpm docling:up` / `docling:down` | Arranca/para docling-serve aparte |
| `pnpm docling:logs` | Sigue los logs de docling |
| `pnpm docling:check` | Verifica que docling responde |
| `pnpm db:push` | Sincroniza el schema Prisma con la DB |
| `pnpm db:studio` | Abre Prisma Studio (inspector visual de la DB) |
| `pnpm tauri:dev` | Ventana Tauri contra el dev server |

---

## Verificar que arrancó

- **App:** http://localhost:3001
- **Salud (readiness):** http://localhost:3001/api/health → debe devolver
  ```json
  { "status": "ok", "db": true, "version": "0.2.0", "timestamp": 1234567890 }
  ```

El endpoint `/api/health` también dispara el **bootstrap del worker** (recupera runs interrumpidos y drena la cola). Ver [Pipeline](./README.PIPELINE.md).

---

## Problemas comunes

| Síntoma | Causa / solución |
|---|---|
| Errores `lancedb ... not supported in the browser` | Ya resuelto en el código (era un `instrumentation.ts` mal ubicado). Si reaparece, asegúrate de que no existe `instrumentation.ts` en la raíz |
| La subida de PDF falla | Docker/docling-serve no está arriba → `pnpm docling:up` |
| `@prisma/client did not initialize` | `pnpm db:generate` (o reinstala; el `postinstall` lo hace) |
| Puerto 3001 ocupado | Otro dev server vivo → mátalo o usa `PORT=3002 pnpm dev` |

---

[◄ Volver al índice](./README.md) · Siguiente: [Compilar el escritorio ►](./README.BUILD.md)
