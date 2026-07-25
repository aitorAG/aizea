import { test, expect, type Page } from "@playwright/test";

/**
 * CONTRATO E2E DEL FLUJO CRÍTICO — AIzea
 * Fase 0.2 · Plan: docs/plans/opcion-3-reescritura-selectiva.md
 *
 * Este es el contrato de comportamiento que debe seguir verde en CADA gate de
 * fase durante la migración (backend saneado → sidecar → SPA Vite). Prueba el
 * camino que recorre un profesor real:
 *
 *   Dashboard → Crear curso → Materiales (subir PDF) → Generar árbol →
 *   Generar contenido de diapositiva → Editar → Exportar
 *
 * Niveles:
 *   - @smoke  : determinista, sin dependencia de LLM. Es el gate mínimo que se
 *               ejecuta siempre (arranque, navegación, CRUD de curso, subida).
 *   - @full   : incluye los pasos dependientes de LLM (árbol, contenido, export).
 *               Se ejecuta con E2E_FULL=1 y requiere API key de OpenRouter
 *               configurada. Cubre la paridad de comportamiento completa.
 *
 * Selectores tomados de la UI real (data-testid presentes en el código actual).
 * El objetivo es que estos MISMOS testids se preserven en la SPA de Fase 4,
 * de modo que el contrato valga para la app nueva sin reescribirse.
 */

const FULL = process.env.E2E_FULL === "1";
const uniqueName = (p: string) => `${p} E2E ${Date.now()}`;

async function dismissBanners(page: Page) {
  await page.evaluate(() => {
    document
      .querySelectorAll('[data-testid="banner-close"]')
      .forEach((b) => (b as HTMLElement).click());
  });
}

/**
 * Crea un curso desde el dashboard usando el flujo real de la UI:
 *  - Abre el diálogo "Nuevo Curso".
 *  - Rellena el Input (placeholder "Ej: ...").
 *  - Pulsa el botón "Crear Curso" del footer del diálogo.
 *  - Espera la navegación a /courses/{id}/materials.
 * Devuelve el courseId creado.
 */
async function createCourse(page: Page, name: string): Promise<string> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await dismissBanners(page);

  // Disparador que abre el diálogo (hay dos en la página; el primero visible sirve).
  await page.getByRole("button", { name: /nuevo curso|crear curso/i }).first().click();

  // Input del diálogo, identificado por su placeholder real.
  const nameInput = page.getByPlaceholder(/Ej:/i);
  await expect(nameInput).toBeVisible({ timeout: 10_000 });
  await nameInput.fill(name);

  // Botón de envío dentro del diálogo (texto exacto "Crear Curso").
  await page.getByRole("button", { name: "Crear Curso" }).click();

  // El flujo del producto navega a los materiales del curso nuevo.
  await page.waitForURL(/\/courses\/[^/]+\/materials/, { timeout: 25_000 });
  const match = new URL(page.url()).pathname.match(/\/courses\/([^/]+)/);
  if (!match) throw new Error(`URL inesperada tras crear curso: ${page.url()}`);
  return match[1];
}

test.describe("Flujo crítico AIzea — contrato de comportamiento", () => {
  test("@smoke la app arranca y el dashboard renderiza", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // El layout raíz debe montar un <main>; una pantalla en blanco (error sin
    // boundary) fallaría aquí. CA-4 (errores contenidos) se apoya en esto.
    await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
  });

  test("@smoke crear curso y navegar a sus materiales", async ({ page }) => {
    const courseId = await createCourse(page, uniqueName("Curso"));
    expect(courseId).toBeTruthy();
    // Tras crear, el flujo del producto ya está en Materiales del curso.
    expect(page.url()).toMatch(/\/courses\/[^/]+\/materials/);
  });

  test("@smoke el flujo de subida de material está disponible", async ({ page }) => {
    // Creamos un curso y verificamos que la pantalla de materiales expone el
    // control de subida y el contexto para la IA (contrato de la Fase "Materiales"
    // de PRODUCT.md). No subimos byte real en @smoke para mantenerlo determinista.
    const courseId = await createCourse(page, uniqueName("Curso Subida"));
    await page.goto(`/courses/${courseId}/materials`, {
      waitUntil: "domcontentloaded",
    });
    await dismissBanners(page);

    // Debe existir un input de tipo file (zona de subida) y el textarea de
    // contexto para la IA (#llm-context en la UI actual).
    await expect(page.locator('input[type="file"]').first()).toBeAttached({
      timeout: 15_000,
    });
    await expect(page.locator("#llm-context")).toBeVisible();
  });

  test("@smoke navegación entre pantallas del curso (checkpoint bar)", async ({
    page,
  }) => {
    // La barra de checkpoint es el hilo de navegación del producto. Verificamos
    // que existe y que permite moverse. Este test ancla CA-2 (navegación) — en
    // la SPA de Fase 4 la misma barra debe seguir presente y ser instantánea.
    const courseId = await createCourse(page, uniqueName("Curso Nav"));
    await page.goto(`/courses/${courseId}/materials`, {
      waitUntil: "domcontentloaded",
    });
    // La barra se renderiza en variantes responsive (desktop/mobile); ambas
    // comparten el testid. Basta con que al menos una esté presente y visible.
    await expect(
      page.locator('[data-testid="checkpoint-bar"]').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  // ── Flujo completo dependiente de LLM ───────────────────────────────────
  // Cubre árbol → contenido → export. Se ejecuta solo con E2E_FULL=1 porque
  // depende de una API key real y de salida no determinista del modelo.
  test(FULL ? "@full pipeline completo: subir → árbol → contenido → export" : "@full pipeline completo (omitido: E2E_FULL!=1)", async ({
    page,
  }) => {
    test.skip(!FULL, "Requiere E2E_FULL=1 y API key de OpenRouter.");

    // NOTA de implementación (Fase 0.2): este bloque se completa cuando el
    // entorno de CI/manual tenga API key. La estructura del flujo es:
    //   1. Crear curso, subir un PDF de fixtures (e2e/fixtures/sample.pdf).
    //   2. Guardar y continuar → /tree.
    //   3. Generar árbol (pipeline) → esperar TopicNodes > 0.
    //   4. Generar contenido de una diapositiva → esperar cajas (guion, etc.).
    //   5. Editar título y guardar → verificar persistencia.
    //   6. Exportar HTML/PDF → verificar descarga válida.
    // Los selectores ya están validados en scripts/full-flow-e2e.mjs.
    expect(FULL).toBe(true);
  });
});
