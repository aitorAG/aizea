import { defineConfig, devices } from "@playwright/test";

/**
 * Contrato E2E del flujo crítico de AIzea (Fase 0.2 del plan de reescritura
 * selectiva — docs/plans/opcion-3-reescritura-selectiva.md).
 *
 * Este contrato es la RED DE SEGURIDAD que garantiza paridad de comportamiento
 * durante toda la migración (backend saneado → sidecar supervisado → SPA Vite).
 * Se ejecuta en cada Gate de fase.
 *
 * Puerto: la app actual (Next.js) sirve en 3000 por defecto. Se puede
 * sobrescribir con E2E_BASE_URL para apuntar a la futura SPA (Fase 4) sin
 * reescribir la spec.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// Cuando E2E_NO_SERVER=1, no arrancamos el dev server (útil para apuntar a una
// instancia ya levantada o a la SPA empaquetada).
const startServer = process.env.E2E_NO_SERVER !== "1";

export default defineConfig({
  testDir: "./e2e",
  // El flujo crítico incluye pasos dependientes de LLM (generar árbol / contenido)
  // que pueden tardar minutos; timeout generoso por test.
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: startServer
    ? {
        command: "pnpm dev",
        url: BASE_URL,
        timeout: 180_000,
        reuseExistingServer: true,
        stdout: "ignore",
        stderr: "pipe",
      }
    : undefined,
});
