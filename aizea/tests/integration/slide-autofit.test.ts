import { describe, it, expect, afterAll } from "vitest";
import { buildSlideDocument } from "@/lib/actions/slide-export-helpers";

// Real-browser verification of the shared slide document: deterministic
// auto-fit (no scroll / no clip) + offline KaTeX rendering. Uses Playwright
// (present in dev/export path). Skips gracefully if the browser binary is
// unavailable so the unit suite never hard-fails on a missing Chromium.

const SLIDE_W = 1123;
const SLIDE_H = 794;

// A design that DELIBERATELY overflows the 794px height (a tall stack of big
// paragraphs) AND contains a LaTeX formula — the exact conditions the user
// reported (scroll in preview/PDF + formulas not rendering).
const OVERFLOWING_DESIGN = `<div style="width:1123px;height:794px;overflow:hidden;box-sizing:border-box;font-family:system-ui,sans-serif;background:#fff;padding:60px 80px;">
  <h1 style="font-size:40px;">Ecuación de Navier-Stokes</h1>
  ${Array.from({ length: 30 })
    .map(
      (_, i) =>
        `<p style="font-size:26px;line-height:1.5;">Párrafo ${i + 1}: la viscosidad dinámica y el gradiente de presión gobiernan el flujo. La fórmula clave es \\( \\rho \\frac{Dv}{Dt} = -\\nabla p + \\mu \\nabla^2 v \\).</p>`
    )
    .join("\n")}
</div>`;

type Browser = Awaited<ReturnType<typeof import("playwright")["chromium"]["launch"]>>;
let browser: Browser | null = null;
let available = true;

async function getBrowser(): Promise<Browser | null> {
  if (!available) return null;
  if (browser) return browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    return browser;
  } catch {
    available = false;
    return null;
  }
}

afterAll(async () => {
  if (browser) await browser.close();
});

describe("slide document — real browser auto-fit + offline KaTeX", () => {
  it("fits overflowing content into 1123×794 with NO scroll and renders KaTeX", async () => {
    const b = await getBrowser();
    if (!b) {
      // Chromium unavailable in this environment — skip without failing.
      expect(available).toBe(false);
      return;
    }
    const html = buildSlideDocument({ htmlDesign: OVERFLOWING_DESIGN });

    const ctx = await b.newContext({ viewport: { width: SLIDE_W, height: SLIDE_H } });
    const page = await ctx.newPage();
    // No network: everything (KaTeX + fonts) is inlined. `load` suffices.
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForFunction("window.__slideFitDone === true", null, {
      timeout: 8000,
    });

    const result = await page.evaluate(() => {
      const frame = document.querySelector(".slide-frame") as HTMLElement;
      const fit = document.querySelector(".slide-fit") as HTMLElement;
      const katexCount = document.querySelectorAll(".katex").length;
      // Raw LaTeX must be gone from the VISIBLE text. KaTeX keeps the source in
      // a hidden `.katex-mathml` annotation, so we clone the content, strip
      // every `.katex-mathml`, and check the remaining (rendered) text.
      const clone = document.querySelector(".slide-content")?.cloneNode(true) as HTMLElement;
      clone?.querySelectorAll(".katex-mathml").forEach((n) => n.remove());
      const rawLatexLeft = (clone?.textContent ?? "").includes("\\rho");
      return {
        docScrollH: document.documentElement.scrollHeight,
        docClientH: document.documentElement.clientHeight,
        bodyScrollH: document.body.scrollHeight,
        frameH: frame?.getBoundingClientRect().height ?? 0,
        transform: fit?.style.transform ?? "",
        katexCount,
        rawLatexLeft,
      };
    });

    // 1. The frame is exactly the slide box.
    expect(Math.round(result.frameH)).toBeLessThanOrEqual(SLIDE_H + 1);

    // 2. NO document-level scroll: content fits the viewport (the bug was a
    //    scrollbar in preview and a "printed" scrollbar in the PDF).
    expect(result.docScrollH).toBeLessThanOrEqual(result.docClientH + 1);

    // 3. The auto-fit actually scaled DOWN (content overflowed, so scale < 1).
    expect(result.transform).toMatch(/scale\(/);
    const scaleMatch = result.transform.match(/scale\(([\d.]+)\)/);
    const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThan(0);

    // 4. KaTeX rendered the formula (offline, inline) — many instances (one per
    //    paragraph) and NO raw LaTeX left.
    expect(result.katexCount).toBeGreaterThan(0);
    expect(result.rawLatexLeft).toBe(false);

    await ctx.close();
  }, 30000);

  it("waits for embedded images: a figure slide is measured AFTER the image decodes", async () => {
    const b = await getBrowser();
    if (!b) {
      expect(available).toBe(false);
      return;
    }
    // A 2×2 red PNG as a base64 data URI, blown up to fill the frame — exactly
    // how a figure slide embeds its visual. If the fit measured BEFORE decode,
    // the image would be height 0 and the scale would be wrong (≈1, no fit).
    const redPng2x2 =
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAxMwMFTbNjbQAAAABJRU5ErkJggg==";
    const figureDesign = `<div style="width:1123px;height:794px;overflow:hidden;box-sizing:border-box;background:#fff;padding:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
      <img src="data:image/png;base64,${redPng2x2}" style="width:900px;height:1400px;object-fit:contain;" />
      <div style="margin-top:20px;font-size:20px;">Figura 1: prueba</div>
    </div>`;
    const html = buildSlideDocument({ htmlDesign: figureDesign });
    const ctx = await b.newContext({ viewport: { width: SLIDE_W, height: SLIDE_H } });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForFunction("window.__slideFitDone === true", null, {
      timeout: 8000,
    });
    const result = await page.evaluate(() => {
      const fit = document.querySelector(".slide-fit") as HTMLElement;
      const img = document.querySelector(".slide-content img") as HTMLImageElement;
      return {
        transform: fit?.style.transform ?? "",
        imgComplete: img?.complete ?? false,
        imgNaturalW: img?.naturalWidth ?? 0,
        docScrollH: document.documentElement.scrollHeight,
        docClientH: document.documentElement.clientHeight,
      };
    });
    // Image decoded before measuring.
    expect(result.imgComplete).toBe(true);
    expect(result.imgNaturalW).toBeGreaterThan(0);
    // The tall image (1400px) forced a scale-down so the slide fits (no clip).
    const scale = parseFloat(result.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? "1");
    expect(scale).toBeLessThan(1);
    // No document scroll → nothing clipped/scrolled.
    expect(result.docScrollH).toBeLessThanOrEqual(result.docClientH + 1);
    await ctx.close();
  }, 30000);

  it("produces a PDF with no clipping (single A4 landscape page)", async () => {
    const b = await getBrowser();
    if (!b) {
      expect(available).toBe(false);
      return;
    }
    const html = buildSlideDocument({ htmlDesign: OVERFLOWING_DESIGN });
    const ctx = await b.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: SLIDE_W, height: SLIDE_H });
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForFunction("window.__slideFitDone === true", null, {
      timeout: 8000,
    });
    const pdf = await page.pdf({
      width: "297mm",
      height: "210mm",
      printBackground: true,
      pageRanges: "1-999",
    });
    // Valid PDF header + non-trivial size.
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
    await ctx.close();
  }, 30000);
});
