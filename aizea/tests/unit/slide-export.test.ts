// Tests for the slide export helpers (HTML wrapper + PDF HTML builder).
// We only test the pure functions — the database-bound server actions
// and the Playwright-driven PDF generation are exercised manually via
// the verification scripts under .test-artifacts/evidence/export-slides/.

import { describe, it, expect } from "vitest";
import {
  buildIframeSlideHtml,
  buildStandaloneSlideHtml,
  KATEX_CDN_TAGS,
  stripBom,
} from "@/lib/actions/slide-export-helpers";

describe("buildStandaloneSlideHtml", () => {
  it("produces a complete HTML document with DOCTYPE and <html>/<head>/<body>", () => {
    const html = buildStandaloneSlideHtml({
      title: "Mi slide",
      htmlDesign: "<div>Hola</div>",
    });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toMatch(/<html\b/);
    expect(html).toMatch(/<head>/);
    expect(html).toMatch(/<body>/);
  });

  it("embeds the slide's htmlDesign verbatim inside the body", () => {
    const design = '<div data-test="slide">contenido único</div>';
    const html = buildStandaloneSlideHtml({
      title: "X",
      htmlDesign: design,
    });
    expect(html).toContain(design);
  });

  it("uses the slide title as the <title> tag (escaped)", () => {
    const html = buildStandaloneSlideHtml({
      title: "Tema importante",
      htmlDesign: "<p>x</p>",
    });
    expect(html).toContain("<title>Tema importante</title>");
  });

  it("escapes HTML in the title to prevent injection", () => {
    const html = buildStandaloneSlideHtml({
      title: "<script>alert(1)</script>",
      htmlDesign: "<p>x</p>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("includes a fixed A4-landscape (1123x794) frame for the slide content", () => {
    const html = buildStandaloneSlideHtml({
      title: "X",
      htmlDesign: "<p>x</p>",
    });
    // The CSS sets the slide frame to 1123x794 — this is the contract
    // the visual preview in slide-detail-client.tsx relies on, so it
    // must be preserved here for visual fidelity.
    expect(html).toMatch(/width:\s*1123px/);
    expect(html).toMatch(/height:\s*794px/);
  });

  it("sets the charset so accented characters render correctly", () => {
    const html = buildStandaloneSlideHtml({
      title: "ñ",
      htmlDesign: "<p>áéíóú</p>",
    });
    expect(html).toMatch(/charset="?utf-8"?/i);
  });

  // F1.5: the meta charset declaration must be the FIRST child of
  // <head> so the HTML5 parser can detect the encoding from the
  // first 1024 bytes. If the meta tag appears later (e.g. after
  // <title> or a CSS <style>), some viewers will re-parse the
  // document and break accented characters.
  it("places <meta charset='utf-8'> as the first child of <head>", () => {
    const html = buildStandaloneSlideHtml({
      title: "X",
      htmlDesign: "<p>x</p>",
    });
    const headOpen = html.indexOf("<head>");
    expect(headOpen).toBeGreaterThan(-1);
    // The first non-whitespace content after <head> must be the
    // meta charset tag — anything else (title, viewport, katex, etc.)
    // would mean the browser could re-parse with the wrong encoding.
    const afterHead = html.slice(headOpen + "<head>".length);
    expect(afterHead.replace(/^\s+/, "")).toMatch(/^<meta\s+charset="?utf-8"?/i);
  });

  // F1.5: the meta charset must appear within the first 1024 bytes
  // of the document, which is the HTML5 spec's hard limit for
  // auto-detecting the encoding. We assert generously (<256) to
  // make this resilient to template refactors.
  it("places <meta charset='utf-8'> within the first 256 bytes", () => {
    const html = buildStandaloneSlideHtml({
      title: "X",
      htmlDesign: "<p>x</p>",
    });
    const charsetIdx = html.indexOf('charset="utf-8"');
    expect(charsetIdx).toBeGreaterThan(-1);
    expect(charsetIdx).toBeLessThan(256);
  });

  // F1.5: a leading UTF-8 BOM in the htmlDesign (LLMs occasionally
  // emit one) must NOT make it into the final document, because the
  // BOM would shift the document's byte stream and some viewers
  // would skip the meta charset detection.
  it("strips a leading BOM from the htmlDesign", () => {
    const bom = "\uFEFF";
    const html = buildStandaloneSlideHtml({
      title: "X",
      htmlDesign: `${bom}<div>Hola</div>`,
    });
    expect(html.charCodeAt(0)).not.toBe(0xfeff);
    // The actual content must be preserved (BOM removed, not the
    // whole string).
    expect(html).toContain("<div>Hola</div>");
  });

  it("strips a leading BOM from the title", () => {
    const bom = "\uFEFF";
    const html = buildStandaloneSlideHtml({
      title: `${bom}Mi tema`,
      htmlDesign: "<p>x</p>",
    });
    expect(html).toContain("<title>Mi tema</title>");
    // The BOM must not appear inside the title tag.
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
    expect(titleMatch?.[1]).not.toMatch(/\uFEFF/);
  });

  // F1.5: the exact char set the user complained about — accents,
  // ñ, em-dash, euro, at-sign, German eszett — must round-trip
  // through the wrapper byte-for-byte (we're not escaping inside
  // the body, only the title).
  it("preserves accented characters and special symbols in the body verbatim", () => {
    const payload = '<div>Año ñáéíóú — € @ ß</div>';
    const html = buildStandaloneSlideHtml({
      title: "X",
      htmlDesign: payload,
    });
    expect(html).toContain(payload);
  });

  it("includes KaTeX so LaTeX formulas in the slide render in the browser", () => {
    // F1.4 (v1.5 plan): the standalone export must include KaTeX so
    // when the user opens the downloaded file, `$x^2$` and
    // `$$\\int_0^1 x^2 dx$$` render properly instead of showing
    // as raw text.
    const html = buildStandaloneSlideHtml({
      title: "Tema con fórmulas",
      htmlDesign: "<p>$x^2$</p>",
    });
    expect(html).toContain(KATEX_CDN_TAGS);
    expect(html).toContain("katex@0.16.9/dist/katex.min.css");
    expect(html).toContain("katex@0.16.9/dist/katex.min.js");
    expect(html).toContain("katex@0.16.9/dist/contrib/auto-render.min.js");
    // The auto-render script must be told to walk the body once the
    // DOM is ready — that's what actually replaces the LaTeX with
    // rendered math.
    expect(html).toMatch(/renderMathInElement\s*\(\s*document\.body/);
    expect(html).toMatch(/addEventListener\(\s*['"]DOMContentLoaded['"]/);
  });
});

describe("buildIframeSlideHtml", () => {
  it("returns a complete HTML document with charset and KaTeX", () => {
    // The iframe preview is what the user sees while editing the
    // slide; it must be byte-equivalent to the standalone export
    // modulo the @media scaling rule, so formulas render in BOTH
    // places identically.
    const html = buildIframeSlideHtml({ htmlDesign: "<p>hi</p>" });
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toMatch(/charset="?utf-8"?/i);
    expect(html).toContain(KATEX_CDN_TAGS);
    expect(html).toContain("katex@0.16.9/dist/katex.min.css");
  });

  it("embeds the htmlDesign inside the body", () => {
    const design = '<div data-test="formula">$E = mc^2$</div>';
    const html = buildIframeSlideHtml({ htmlDesign: design });
    expect(html).toContain(design);
  });

  // F1.5: the iframe preview is the most important place to get
  // the encoding right — it's what the user sees while editing.
  // Same charset-first + BOM-strip rules as the standalone export.
  it("places <meta charset='utf-8'> as the first child of <head>", () => {
    const html = buildIframeSlideHtml({ htmlDesign: "<p>x</p>" });
    const headOpen = html.indexOf("<head>");
    expect(headOpen).toBeGreaterThan(-1);
    const afterHead = html.slice(headOpen + "<head>".length);
    expect(afterHead.replace(/^\s+/, "")).toMatch(/^<meta\s+charset="?utf-8"?/i);
  });

  it("strips a leading BOM from the htmlDesign", () => {
    const bom = "\uFEFF";
    const html = buildIframeSlideHtml({
      htmlDesign: `${bom}<div>Año</div>`,
    });
    expect(html.charCodeAt(0)).not.toBe(0xfeff);
    expect(html).toContain("<div>Año</div>");
  });

  it("preserves accented characters and special symbols in the body verbatim", () => {
    const payload = '<span>Año ñáéíóú — € @ ß</span>';
    const html = buildIframeSlideHtml({ htmlDesign: payload });
    expect(html).toContain(payload);
  });
});

describe("stripBom", () => {
  it("removes a leading U+FEFF", () => {
    expect(stripBom("\uFEFFhola")).toBe("hola");
  });

  it("removes a leading zero-width space", () => {
    expect(stripBom("\u200Bhola")).toBe("hola");
  });

  it("removes multiple leading invisible chars", () => {
    expect(stripBom("\uFEFF\u200B\u200Chola")).toBe("hola");
  });

  it("preserves invisible chars in the middle of the string", () => {
    // We only strip the LEADING noise — middle-of-string zero-width
    // chars are intentional (e.g. for word-break hints) and must
    // be preserved.
    expect(stripBom("ho\u200Bla")).toBe("ho\u200Bla");
  });

  it("is a no-op on clean text", () => {
    expect(stripBom("hola mundo")).toBe("hola mundo");
  });

  it("handles empty string", () => {
    expect(stripBom("")).toBe("");
  });

  it("handles strings that are only invisible chars", () => {
    expect(stripBom("\uFEFF\u200B")).toBe("");
  });
});
