# Build the desktop app (MSI)

[◄ Index](./README.md) · Previous: [Getting started](./README.GETTING-STARTED.md) · Next: [Architecture ►](./README.ARCHITECTURE.md)

How to generate the self-contained Windows desktop installer.

---

## Output

An installer with **no target-machine dependencies**: it requires no Node.js, Python, or Docker. AIzea is a Tauri shell that starts the standalone Next.js server with a Node runtime **packaged as a sidecar**.

- `.msi` (Windows Installer)
- `.exe` (NSIS, instala **por usuario**, sin admin)

PDF parsing in the desktop build uses the `pdf-parse` fallback (docling-serve is not packaged; the Rust launcher sets `AIZEA_SKIP_DOCLING=1`). The user enters the API key in `/settings`.

---

## Additional requirements (beyond [Getting started](./README.GETTING-STARTED.md))

- **Rust** ≥ 1.77 (1.97+ recommended)
- **Microsoft Visual C++ Build Tools** (toolchain MSVC)
- **Tauri CLI** (ya viene como dependencia de dev)

---

## One-command build

```powershell
pnpm build:msi
```

The [`scripts/build-msi.cjs`](./scripts/build-msi.cjs) script runs each preparation step required by the Tauri bundler, in order:

1. **`prisma generate`**: regenerates the Prisma client.
2. **`next build`**: builds the standalone Next.js server (`output: "standalone"`).
3. **Static asset copy**: `output: "standalone"` omits `.next/static` and `public`; they are copied next to `server.js`.
4. **Development `.env` cleanup**: removes it from standalone so the Rust launcher provides the correct environment variables (otherwise the installed app would open `./dev.db` instead of `%APPDATA%`).
5. **Database seed**: performs a *WAL checkpoint* ([`wal-checkpoint.cjs`](./scripts/wal-checkpoint.cjs)) and copies `prisma/dev.db` to `standalone/db.sqlite` (the launcher copies it to `%APPDATA%\AIzea\db.sqlite` on first launch).
6. **Pruning other-platform binaries**: removes non-win32-x64 variants of `@lancedb`, `@esbuild`, and `@img` (sharp), reducing standalone from ~1.8 GB to ~200 MB.
7. **Node sidecar**: copies the Node runtime to `src-tauri/binaries/node-x86_64-pc-windows-msvc.exe`.
8. **`tauri build`**: compiles Rust and packages MSI/NSIS.

---

## Output

```
local install file/
├── AIzea_0.19.2_x64_es-ES.msi
└── AIzea_0.19.2_x64-setup.exe   (per-user, no admin)
```

Tauri first writes intermediate bundle output under
`src-tauri/target/release/bundle/`. The current local MSI and NSIS installers
are kept in the repository-root `local install file/` directory, which is
intentionally ignored by Git because the MSI exceeds GitHub's regular file
size limit. Published distribution files belong in GitHub Releases.

---

## How the installed app starts

The Rust launcher ([`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs)) in release mode:

1. Resolves `%APPDATA%\AIzea` and creates `uploads/`, `lancedb-data/`, and `logs/`.
2. Copies the seeded `db.sqlite` on first launch.
3. **Supervises** the Node sidecar (`server.js`): starts it, captures stdout/stderr to `logs/server.log`, and **restarts** it with backoff if it dies (up to five times).
4. **Polls `/api/health`** until the server returns 200 (instead of using a blind `sleep`) and opens the window at `http://localhost:1422`.

See [Architecture](./README.ARCHITECTURE.md) and [Security](./README.SECURITY.md) for supervision and process-model details.

---

## Verify before building

```powershell
pnpm typecheck              # tsc --noEmit
pnpm test                   # suite completa
cargo check --release       # (en src-tauri/) valida el Rust del build release
```

> Note: supervision helpers in `lib.rs` are gated by `not(debug_assertions)`, so they are validated with `cargo check --release` (not in debug).

---

## Signing and auto-updater

The installer is **not signed** and there is **no auto-updater** (a deliberate decision for non-commercial use). During installation, Windows SmartScreen warns about an "unknown publisher"; accept it manually. See [Security and distribution](./README.SECURITY.md#installer-signing-and-auto-updater).

---

[◄ Index](./README.md) · Previous: [Getting started](./README.GETTING-STARTED.md) · Next: [Architecture ►](./README.ARCHITECTURE.md)
