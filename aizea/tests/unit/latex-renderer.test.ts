import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRenderToString = vi.hoisted(() => vi.fn());

vi.mock("katex", () => ({
  default: { renderToString: mockRenderToString },
  renderToString: mockRenderToString,
}));

const { mockPngCall, mockToBuffer, mockSharp } = vi.hoisted(() => {
  const mockToBuffer = vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  const mockPng = vi.fn(() => ({ toBuffer: mockToBuffer }));
  const mockInstance = { png: mockPng };
  const sharp = vi.fn(() => mockInstance);
  return { mockPngCall: mockPng, mockToBuffer, mockSharp: sharp };
});

vi.mock("sharp", () => ({
  default: mockSharp,
}));

import { renderLatexToPng } from "@/lib/domain/utils/latex-renderer";

describe("latex-renderer: renderLatexToPng", () => {
  beforeEach(() => {
    mockRenderToString.mockReset();
    mockPngCall.mockReset();
    mockToBuffer.mockReset();
    mockPngCall.mockImplementation(() => ({ toBuffer: mockToBuffer }));
    mockToBuffer.mockResolvedValue(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    );
    mockSharp.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a non-empty Buffer for a valid LaTeX expression", async () => {
    mockRenderToString.mockReturnValue("<span>rendered</span>");
    const buf = await renderLatexToPng("E=mc^2");
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    // PNG magic bytes: 89 50 4E 47
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("calls katex.renderToString with throwOnError=false", async () => {
    mockRenderToString.mockReturnValue("ok");
    await renderLatexToPng("x^2");
    expect(mockRenderToString).toHaveBeenCalledWith(
      "x^2",
      expect.objectContaining({ throwOnError: false })
    );
  });

  it("returns an empty Buffer (and warns) for invalid LaTeX — does NOT throw", async () => {
    // katex with throwOnError=false returns "undefined" or error string for invalid input
    mockRenderToString.mockReturnValue("undefined" as unknown as string);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const buf = await renderLatexToPng("\\invalidCommand");
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns an empty Buffer (and warns) when katex throws", async () => {
    mockRenderToString.mockImplementation(() => {
      throw new Error("parse error");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const buf = await renderLatexToPng("$$\\bad$$");
    expect(buf.length).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns a Buffer of the right shape for display-mode LaTeX", async () => {
    mockRenderToString.mockReturnValue("<div>x^2</div>");
    const buf = await renderLatexToPng("\\frac{a}{b}", { displayMode: true });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    expect(mockRenderToString).toHaveBeenCalledWith(
      "\\frac{a}{b}",
      expect.objectContaining({ displayMode: true, throwOnError: false })
    );
  });
});
