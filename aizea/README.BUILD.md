# Compilar el escritorio (MSI)

[◄ Índice](./README.md) · Anterior: [Primeros pasos](./README.GETTING-STARTED.md) · Siguiente: [Arquitectura ►](./README.ARCHITECTURE.md)

Cómo generar el instalador de escritorio autocontenido de Windows.

---

## Qué produce

Un instalador **sin dependencias** en la máquina destino: no requiere Node.js, ni Python, ni Docker. AIzea es un shell de Tauri que arranca el servidor Next.js standalone con un runtime de Node **empaquetado como sidecar**.

- `.msi` (Windows Installer)
- `.exe` (NSIS, instala **por usuario**, sin admin)

El parsing de PDF en el build de escritorio usa el fallback `pdf-parse` (docling-serve no se empaqueta; el lanzador Rust fija `AIZEA_SKIP_DOCLING=1`). La API key la introduce el usuario en `/settings`.

---

## Requisitos adicionales (sobre los de [Primeros pasos](./README.GETTING-STARTED.md))

- **Rust** ≥ 1.77 (1.97+ recomendado)
- **Microsoft Visual C++ Build Tools** (toolchain MSVC)
- **Tauri CLI** (ya viene como dependencia de dev)

---

## Build en un comando

```powershell
pnpm build:msi
```

El script [`scripts/build-msi.cjs`](./scripts/build-msi.cjs) ejecuta cada paso de preparación que el bundler de Tauri necesita, en orden:

1. **`prisma generate`** — regenera el cliente Prisma.
2. **`next build`** — compila el servidor Next.js standalone (`output: "standalone"`).
3. **Copia de assets estáticos** — `output: "standalone"` omite `.next/static` y `public`; se copian junto a `server.js`.
4. **Limpieza del `.env` de dev** — se elimina del standalone para que el lanzador Rust provea las env vars correctas (si no, la app instalada abriría `./dev.db` en vez de `%APPDATA%`).
5. **Semilla de la DB** — hace *WAL checkpoint* ([`wal-checkpoint.cjs`](./scripts/wal-checkpoint.cjs)) y copia `prisma/dev.db` → `standalone/db.sqlite` (el lanzador la copia a `%APPDATA%\AIzea\db.sqlite` en el primer arranque).
6. **Poda de binarios de otras plataformas** — elimina las variantes no-win32-x64 de `@lancedb`, `@esbuild`, `@img` (sharp). Reduce el standalone de ~1.8GB a ~200MB.
7. **Sidecar de Node** — copia el runtime de Node a `src-tauri/binaries/node-x86_64-pc-windows-msvc.exe`.
8. **`tauri build`** — compila el Rust y empaqueta MSI/NSIS.

---

## Salida

```
src-tauri/target/release/bundle/
├── msi/   → AIzea_0.2.0_x64_es-ES.msi
└── nsis/  → AIzea_0.2.0_x64-setup.exe   (per-user, sin admin)
```

---

## Cómo arranca la app instalada

El lanzador Rust ([`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs)) en modo release:

1. Resuelve `%APPDATA%\AIzea`, crea `uploads/`, `lancedb-data/`, `logs/`.
2. Copia la `db.sqlite` semilla si es el primer arranque.
3. **Supervisa** el sidecar Node (`server.js`): lo lanza, captura stdout/stderr a `logs/server.log`, y lo **reinicia** con backoff si muere (hasta 5 veces).
4. **Sondea `/api/health`** hasta que el servidor responde 200 (en vez de un `sleep` ciego) y abre la ventana apuntando a `http://localhost:1422`.

Detalle de la supervisión y el modelo de proceso en [Arquitectura](./README.ARCHITECTURE.md) y [Seguridad](./README.SECURITY.md).

---

## Verificar antes de compilar

```powershell
pnpm typecheck              # tsc --noEmit
pnpm test                   # suite completa
cargo check --release       # (en src-tauri/) valida el Rust del build release
```

> Nota: los helpers de supervisión en `lib.rs` están gated a `not(debug_assertions)`, así que se validan con `cargo check --release` (no en debug).

---

## Firma y auto-updater

El instalador **no se firma** y **no hay auto-updater** (decisión deliberada para uso no comercial). Al instalar, Windows SmartScreen avisa de "editor desconocido"; se acepta manualmente. Ver [Seguridad y distribución](./README.SECURITY.md#firma-del-instalador-y-auto-updater).

---

[◄ Índice](./README.md) · Anterior: [Primeros pasos](./README.GETTING-STARTED.md) · Siguiente: [Arquitectura ►](./README.ARCHITECTURE.md)
