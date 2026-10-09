/**
 * SlideImageRenderService — renderiza slides HTML a imágenes PNG mediante
 * Playwright. Reutiliza el patrón del PdfRenderService (import dinámico,
 * manejo de PlaywrightUnavailableError, espera del auto-fit) pero captura
 * screenshots en vez de PDFs.
 *
 * Las imágenes resultantes son idénticas píxel-a-píxel a los slides visibles
 * en la app (misma resolución 1123×794, mismo KaTeX inline, mismo auto-fit),
 * lo que garantiza fidelidad visual total en la exportación a PPT.
 */

import { PlaywrightUnavailableError } from "@/lib/infrastructure/pdf/pdf-render.service";
import { SLIDE_W, SLIDE_H } from "@/lib/actions/slide-export-helpers";

// Tipo estructural mínimo de la API Page de Playwright para screenshots.
interface PwPage {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  setContent(html: string, opts?: { waitUntil?: string }): Promise<void>;
  evaluate<T>(fn: (arg: number) => Promise<T> | T, arg: number): Promise<T>;
  screenshot(opts: {
    type: "png";
    fullPage?: boolean;
    clip?: { x: number; y: number; width: number; height: number };
  }): Promise<Buffer | Uint8Array>;
}
interface PwChromium {
  launch(opts: Record<string, unknown>): Promise<{
    newContext(): Promise<{ newPage(): Promise<PwPage> }>;
    close(): Promise<void>;
  }>;
}

async function loadChromium(): Promise<PwChromium> {
  try {
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
 * Espera a que el script de auto-fit compartido (`SLIDE_FIT_SCRIPT`) termine:
 * renderiza KaTeX, espera fuentes, mide y aplica `transform: scale()`, y marca
 * `window.__slideFitDone = true`. Idéntico al usado en PdfRenderService.
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

export class SlideImageRenderService {
  /**
   * Renderiza un documento HTML completo a imagen PNG. Lanza
   * `PlaywrightUnavailableError` cuando Playwright no está disponible.
   *
   * @param html documento HTML completo del slide (generado con `buildSlideDocument`)
   * @param fitTimeoutMs ventana máxima de espera del auto-fit (default 6000ms)
   * @returns Buffer con la imagen PNG a resolución nativa 1123×794
   */
  async renderToImage(
    html: string,
    fitTimeoutMs: number = 6000
  ): Promise<Buffer> {
    const chromium = await loadChromium();
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      // Viewport exacto del tamaño del slide para captura 1:1
      await page.setViewportSize({ width: SLIDE_W, height: SLIDE_H });
      // KaTeX inlineado, no necesita red
      await page.setContent(html, { waitUntil: "load" });
      // Espera a que el auto-fit termine (KaTeX + fuentes + scale)
      await waitForSlideFit(page, fitTimeoutMs);
      // Captura el contenido visible exacto (1123×794)
      const screenshotBuffer = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: SLIDE_W, height: SLIDE_H },
      });
      return Buffer.from(screenshotBuffer);
    } finally {
      await browser.close();
    }
  }

  /**
   * Renderiza múltiples slides en batch (reutiliza el mismo browser para
   * eficiencia). Útil para exportar un curso completo a PPT sin lanzar N
   * instancias de Chromium.
   */
  async renderMultipleToImages(
    htmlDocs: string[],
    fitTimeoutMs: number = 6000
  ): Promise<Buffer[]> {
    const chromium = await loadChromium();
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.setViewportSize({ width: SLIDE_W, height: SLIDE_H });

      const images: Buffer[] = [];
      for (const html of htmlDocs) {
        await page.setContent(html, { waitUntil: "load" });
        await waitForSlideFit(page, fitTimeoutMs);
        const screenshotBuffer = await page.screenshot({
          type: "png",
          clip: { x: 0, y: 0, width: SLIDE_W, height: SLIDE_H },
        });
        images.push(Buffer.from(screenshotBuffer));
      }
      return images;
    } finally {
      await browser.close();
    }
  }
}
