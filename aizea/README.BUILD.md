# Build the desktop app (MSI)

[◄ Index](./README.md) · Previous: [Getting Started](./README.GETTING-STARTED.md) · Next: [Architecture ►](./README.ARCHITECTURE.md)

How to generate the self-contained Windows desktop installer.

---

## What it produces

A **dependency-free** installer on the target machine: it requires neither Node.js, Python, nor Docker. AIzea is a Tauri shell that starts the standalone Next.js server with a Node runtime **packaged as a sidecar**.

- `.msi` (Windows Installer)
- `.exe` (NSIS, installs **per user**, without admin privileges)

PDF parsing in the desktop build uses the `pdf-parse` fallback (docling-serve is not packaged; the Rust launcher sets `AIZEA_SKIP_DOCLING=1`). The user enters the API key in `/settings`.

---

## Additional requirements (beyond [Getting Started](./README.GETTING-STARTED.md))

- **Rust** ≥ 1.77 (1.97+ recommended)
- **Microsoft Visual C++ Build Tools** (toolchain MSVC)
- **Tauri CLI** (ya viene como dependencia de dev)

---

## Build with one command

```powershell
pnpm build:msi
```

The [`scripts/build-msi.cjs`](./scripts/build-msi.cjs) script runs each preparation step required by the Tauri bundler, in order:

1. **`prisma generate`** — regenerates the Prisma client.
2. **`next build`** — builds the standalone Next.js server (`output: "standalone"`).
3. **Static asset copy** — `output: "standalone"` omits `.next/static` and `public`; they are copied next to `server.js`.
4. **Dev `.env` cleanup** — removes it from the standalone output so the Rust launcher can provide the correct environment variables (otherwise the installed app would open `./dev.db` instead of `%APPDATA%`).
5. **Database seed** — performs a *WAL checkpoint* ([`wal-checkpoint.cjs`](./scripts/wal-checkpoint.cjs)) and copies `prisma/dev.db` → `standalone/db.sqlite` (the launcher copies it to `%APPDATA%\AIzea\db.sqlite` on first startup).
6. **Prune binaries for other platforms** — removes non-win32-x64 variants of `@lancedb`, `@esbuild`, and `@img` (sharp). Reduces the standalone output from ~1.8GB to ~200MB.
7. **Node sidecar** — copies the Node runtime to `src-tauri/binaries/node-x86_64-pc-windows-msvc.exe`.
8. **`tauri build`** — compiles the Rust code and packages MSI/NSIS.

---

## Output

```
src-tauri/target/release/bundle/
├── msi/   → AIzea_0.2.0_x64_es-ES.msi
└── nsis/  → AIzea_0.2.0_x64-setup.exe   (per-user, no admin)
```

---

## How the installed app starts

The Rust launcher ([`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs)) in release mode:

1. Resolves `%APPDATA%\AIzea` and creates `uploads/`, `lancedb-data/`, and `logs/`.
2. Copies the seed `db.sqlite` on first startup.
3. **Supervises** the Node sidecar (`server.js`): launches it, captures stdout/stderr to `logs/server.log`, and **restarts** it with backoff if it dies (up to 5 times).
4. **Polls `/api/health`** until the server responds with 200 (instead of using a blind `sleep`) and opens the window at `http://localhost:1422`.

For details on supervision and the process model, see [Architecture](./README.ARCHITECTURE.md) and [Security](./README.SECURITY.md).

---

## Verify before building

```powershell
pnpm typecheck              # tsc --noEmit
pnpm test                   # complete test suite
cargo check --release       # (in src-tauri/) validates the Rust release build
```

> Note: the supervision helpers in `lib.rs` are gated by `not(debug_assertions)`, so they are validated with `cargo check --release` (not in debug mode).

---

## Signing and auto-updater

The installer is **not signed** and there is **no auto-updater** (a deliberate decision for non-commercial use). During installation, Windows SmartScreen warns about an "unknown publisher"; accept it manually. See [Security and distribution](./README.SECURITY.md#installer-signing-and-auto-updater).

---

[◄ Index](./README.md) · Previous: [Getting Started](./README.GETTING-STARTED.md) · Next: [Architecture ►](./README.ARCHITECTURE.md)
