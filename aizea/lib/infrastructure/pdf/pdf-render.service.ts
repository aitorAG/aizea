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
 * v1.9 / Issue 6 — espera a que KaTeX termine de renderizar dentro de la página
 * Chromium antes de capturar el PDF. KaTeX se carga con `defer` y la extensión
 * auto-render corre en `DOMContentLoaded`. Si llamamos a `page.pdf()` antes de
 * que termine, la página impresa muestra el LaTeX en crudo (`$E = mc^2$`).
 *
 * Estrategia: sondear hasta `maxMs` buscando elementos `.katex`. Si la página
 * no tiene LaTeX, resolvemos rápido con `rendered: -1` ("nada que renderizar").
 */
async function waitForKatexRender(
  page: PwPage,
  maxMs: number = 5000
): Promise<{ rendered: number; hadLatex: boolean }> {
  return page.evaluate((maxMsArg: number) => {
    return new Promise<{ rendered: number; hadLatex: boolean }>((resolve) => {
      const start = Date.now();
      const body = document.body?.innerHTML ?? "";
      const hadLatex = /\$[^$]+\$|\\\(|\\\[/.test(body);
      if (!hadLatex) {
        setTimeout(
          () => resolve({ rendered: -1, hadLatex: false }),
          Math.min(200, maxMsArg)
        );
        return;
      }
      const tick = () => {
        const rendered = document.querySelectorAll(".katex").length;
        if (rendered > 0) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve({ rendered, hadLatex: true }));
          });
          return;
        }
        if (Date.now() - start >= maxMsArg) {
          resolve({ rendered: 0, hadLatex: true });
          return;
        }
        setTimeout(tick, 50);
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
   * @param html documento HTML completo (con CSS @page, KaTeX CDN, etc.)
   * @param pdfOptions opciones pasadas a `page.pdf()` (formato, márgenes...)
   */
  async renderToPdf(
    html: string,
    pdfOptions: Record<string, unknown>
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
      await page.setContent(html, { waitUntil: "networkidle" });
      const katex = await waitForKatexRender(page);
      if (katex.hadLatex && katex.rendered === 0) {
        // Había fórmulas pero no se renderizaron: fallar en vez de producir un
        // PDF con `$x^2$` en crudo.
        throw new Error(
          "KaTeX no terminó de renderizar las fórmulas (timeout). " +
            "El PDF se generaría con el LaTeX en crudo."
        );
      }
      const pdfBuffer = await page.pdf(pdfOptions);
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }
}
