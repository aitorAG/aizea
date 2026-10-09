/**
 * SlideImageRenderService
 *
 * Renders individual slides as PNG images using Playwright.
 * Used by PptExportService to capture slide visuals for PowerPoint export.
 */

import type { Browser, Page } from "playwright";
import { chromium } from "playwright";

export interface SlideImageRenderOptions {
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
}

export class SlideImageRenderService {
  private browser: Browser | null = null;

  /**
   * Initialize the Playwright browser instance.
   */
  async init(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({
      headless: true,
      args: ["--disable-web-security"],
    });
  }

  /**
   * Render a single slide HTML to a PNG buffer.
   *
   * @param slideHtml - Complete HTML document for the slide
   * @param options - Image rendering options (width, height, scale)
   * @returns PNG buffer
   */
  async renderSlideToPng(
    slideHtml: string,
    options: SlideImageRenderOptions = {}
  ): Promise<Buffer> {
    if (!this.browser) {
      throw new Error("SlideImageRenderService not initialized. Call init() first.");
    }

    const { width = 1920, height = 1080, deviceScaleFactor = 2 } = options;

    const page: Page = await this.browser.newPage({
      viewport: { width, height },
      deviceScaleFactor,
    });

    try {
      await page.setContent(slideHtml, {
        waitUntil: "networkidle",
      });

      // Wait for KaTeX to render formulas
      await page.waitForTimeout(500);

      const screenshot = await page.screenshot({
        type: "png",
        fullPage: false,
      });

      return Buffer.from(screenshot);
    } finally {
      await page.close();
    }
  }

  /**
   * Close the browser instance.
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
