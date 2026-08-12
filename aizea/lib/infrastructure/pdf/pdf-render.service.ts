/**
 * PdfRenderService — responsabilidad ÚNICA: renderizar un documento HTML a PDF
 * mediante un Chromium controlado por Playwright.
 *
 * Extraído de `lib/actions/slide-export.ts` (fichero-dios de 524 líneas que
 * duplicaba este bloque de automatización de navegador en dos actions) como
 * parte de la Fase 1 del plan de reescritura selectiva (CA-7 + CA-8: sin
 * ficheros-dios, sin duplicación). Es infraestructura pura: automatización de
 * navegador, sin acceso a BD ni lógica de dominio.
 *
 * Playwright (+ su binario Chromium) NO se empaqueta en el build de escritorio
 * (demasiado grande, ~300MB, e innecesario porque el WebView de Tauri imprime a
 * PDF de forma nativa). Se resuelve de forma perezosa con un import no
 * analizable para que el build nunca falle por la dependencia opcional; si está
 * ausente en runtime, se lanza `PlaywrightUnavailableError`.
 */

// Error tipado para que los llamantes distingan "Playwright ausente" (y hagan
// su fallback) de un fallo real de render.
export class PlaywrightUnavailableError extends Error {
  constructor() {
    super(
      "La exportación a PDF requiere Playwright, que no está disponible " +
        "en esta instalación. Usa la opción 'Exportar HTML' e imprime a " +
        "PDF desde el navegador (Ctrl+P)."
    );
    this.name = "PlaywrightUnavailableError";
  }
}

// Tipo estructural mínimo de la porción de la API Page de Playwright que
// usamos. NO dependemos de los @types del paquete playwright (es una
// dependencia opcional de runtime, ausente en el build de escritorio).
interface PwPage {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  setContent(html: string, opts?: { waitUntil?: string }): Promise<void>;
  evaluate<T>(fn: (arg: number) => Promise<T> | T, arg: number): Promise<T>;
  pdf(opts: Record<string, unknown>): Promise<Buffer | Uint8Array>;
}
interface PwChromium {
  launch(opts: Record<string, unknown>): Promise<{
    newContext(): Promise<{ newPage(): Promise<PwPage> }>;
    close(): Promise<void>;
  }>;
}

async function loadChromium(): Promise<PwChromium> {
  try {
    // Construimos el especificador en runtime para que ni TypeScript ni webpack
    // resuelvan 'playwright' estáticamente (dependencia opcional, ausente en el
    // build de escritorio). La indirección con `Function` mantiene el import
    // dinámico fuera del grafo de módulos.
    const pkg = ["play", "wright"].join("");
    const dynamicImport = new Function("m", "return import(m)") as (
      m: string
    ) => Promise<{ chromium: PwChromium }>;
    const mod = await dynamicImport(pkg);
    return mod.chromium;
  } catch {
    throw new PlaywrightUnavailableError();
  }
}

/**
 * v2.0 — espera a que el script de auto-fit compartido (`SLIDE_FIT_SCRIPT`)
 * termine: renderiza KaTeX (inline, offline), espera `document.fonts.ready`,
 * mide y aplica el `transform: scale()`, y marca `window.__slideFitDone = true`.
 *
 * Capturar el PDF antes de esa señal produciría (a) LaTeX en crudo y/o (b) una
 * diapositiva sin escalar (recortada). Sondeamos el flag hasta `maxMs`; si el
 * documento no incluye el script (p. ej. la página de contenido en retrato),
 * el flag nunca aparece y devolvemos `false` sin bloquear el render — por eso
 * el llamante usa un timeout corto y sigue.
 */
async function waitForSlideFit(
  page: PwPage,
  maxMs: number = 6000
): Promise<boolean> {
  return page.evaluate((maxMsArg: number) => {
    return new Promise<boolean>((resolve) => {
      const start = Date.now();
      const w = window as unknown as { __slideFitDone?: boolean };
      const tick = () => {
        if (w.__slideFitDone === true) {
          resolve(true);
          return;
        }
        if (Date.now() - start >= maxMsArg) {
          resolve(false);
          return;
        }
        setTimeout(tick, 40);
      };
      tick();
    });
  }, maxMs);
}

export class PdfRenderService {
  /**
   * Renderiza un documento HTML completo a PDF. Lanza `PlaywrightUnavailableError`
   * cuando Playwright no está disponible (el llamante decide el fallback).
   *
   * @param html documento HTML completo (con CSS @page, KaTeX inline, etc.)
   * @param pdfOptions opciones pasadas a `page.pdf()` (formato, márgenes...)
   * @param opts.fitTimeoutMs ventana máxima de espera del auto-fit. El trabajo
   *   de fit es O(N diapositivas) (KaTeX + imágenes + medición por slide), así
   *   que el llamante lo escala con el nº de diapositivas para que un export
   *   grande no se capture antes de tiempo.
   */
  async renderToPdf(
    html: string,
    pdfOptions: Record<string, unknown>,
    opts: { fitTimeoutMs?: number } = {}
  ): Promise<Buffer> {
    const chromium = await loadChromium();
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      // Viewport ancho suficiente para ambas orientaciones A4 a ~96dpi
      // (retrato 794px y apaisado 1123px). Con preferCSSPageSize la regla CSS
      // @page (landscape/portrait por sección) manda en la paginación real;
      // el viewport solo evita que el layout apaisado se constriña antes de
      // paginar (v1.0: 2 páginas/diapositiva, mezcla de orientaciones).
      await page.setViewportSize({ width: 1123, height: 1123 });
      // KaTeX is inlined (no network), so `load` is sufficient and avoids
      // `networkidle` hanging on data-URI fonts.
      await page.setContent(html, { waitUntil: "load" });
      // Wait for the shared auto-fit script to finish (KaTeX rendered + images
      // decoded + fonts ready + transform applied). The timeout scales with the
      // slide count (caller-provided) so large exports aren't captured early;
      // a document WITHOUT the script (or a hang) still resolves at the cap.
      await waitForSlideFit(page, opts.fitTimeoutMs ?? 6000);
      const pdfBuffer = await page.pdf(pdfOptions);
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }
}
