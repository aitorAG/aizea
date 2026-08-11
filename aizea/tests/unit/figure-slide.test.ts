import { describe, it, expect } from "vitest";
import {
  buildFigureSlideHtml,
  imageMimeFromMagic,
} from "@/lib/domain/slides/figure-slide";

describe("imageMimeFromMagic", () => {
  it("detects PNG", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(imageMimeFromMagic(png)).toBe("image/png");
  });

  it("detects JPEG", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(imageMimeFromMagic(jpeg)).toBe("image/jpeg");
  });

  it("detects WebP (RIFF....WEBP)", () => {
    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("WEBP", "ascii"),
    ]);
    expect(imageMimeFromMagic(webp)).toBe("image/webp");
  });

  it("defaults to png for unknown bytes", () => {
    expect(imageMimeFromMagic(Buffer.from([1, 2, 3]))).toBe("image/png");
  });
});

describe("buildFigureSlideHtml", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it("embeds the image as a base64 data URI with the detected mime", () => {
    const html = buildFigureSlideHtml({ imageData: png, caption: "Fig 1" });
    expect(html).toContain(`data:image/png;base64,${png.toString("base64")}`);
    expect(html).toContain("<img");
  });

  it("uses A4-landscape (1123×794) dimensions to match the slide contract", () => {
    const html = buildFigureSlideHtml({ imageData: png, caption: null });
    expect(html).toContain("width:1123px");
    expect(html).toContain("height:794px");
  });

  it("renders the caption when present and escapes HTML", () => {
    const html = buildFigureSlideHtml({
      imageData: png,
      caption: 'A <b>bold</b> & "quoted"',
    });
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });

  it("omits the caption block when caption is null/empty", () => {
    const html = buildFigureSlideHtml({ imageData: png, caption: null });
    // With no caption the image is allowed to use the full height.
    expect(html).toContain("max-height:100%");
  });

  it("is a self-contained root div (no <html>/<body>), matching htmlDesign", () => {
    const html = buildFigureSlideHtml({ imageData: png, caption: "x" });
    expect(html.trimStart().startsWith("<div")).toBe(true);
    expect(html).not.toContain("<html");
    expect(html).not.toContain("<body");
  });
});
