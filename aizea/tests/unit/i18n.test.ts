import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOCALE, dictionaries, LOCALE_COOKIE, normalizeLocale, translate } from "@/lib/i18n";

const cookieJar = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => cookieJar,
}));
vi.mock("server-only", () => ({}));

import { getRequestLocale } from "@/lib/i18n-server";
import { setLocaleAction } from "@/lib/actions/locale";

beforeEach(() => {
  cookieJar.get.mockReset();
  cookieJar.set.mockReset();
});

describe("locale", () => {
  it("defaults invalid and missing cookie values to Spanish", async () => {
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("EN")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("en-US")).toBe(DEFAULT_LOCALE);
    cookieJar.get.mockReturnValue({ value: "en-US" });
    expect(await getRequestLocale()).toBe("es");
  });

  it("reads an English cookie", async () => {
    cookieJar.get.mockReturnValue({ value: "en" });
    expect(await getRequestLocale()).toBe("en");
    expect(cookieJar.get).toHaveBeenCalledWith(LOCALE_COOKIE);
  });

  it("interpolates parameters and returns the selected language", () => {
    expect(translate("es", "itemCount", { count: 2 })).toBe("2 elementos");
    expect(translate("en", "itemCount", { count: 2 })).toBe("2 items");
    expect(translate("en", "home")).toBe("Home");
  });

  it("has an English translation for every Spanish UI value", () => {
    const legitimatelyIdentical = new Set([
      "apiKey",
      "chatModel",
      "embedModel",
      "doclingBaseUrl",
      "export.ppt",
      "materials.acceptedTypes",
      "common.error",
      "course.checkpoints.slides",
    ]);

    for (const key of Object.keys(dictionaries.es) as Array<keyof typeof dictionaries.es>) {
      if (legitimatelyIdentical.has(key)) continue;
      expect(dictionaries.en[key], `${key} should not fall back to Spanish`).not.toBe(dictionaries.es[key]);
    }
  });

  it("keeps the expanded user-facing contract present in both locales", () => {
    const requiredKeys = [
      "dashboard.search",
      "materials.uploadProgressLabel",
      "figures.galleryTitle",
      "slides.batchProgressLabel",
      "tree.actionsLabel",
      "settingsAdvanced",
      "errors.unexpected",
    ] as const;
    for (const key of requiredKeys) {
      expect(dictionaries.es[key]).toBeTruthy();
      expect(dictionaries.en[key]).toBeTruthy();
    }
  });
});

describe("setLocaleAction", () => {
  it("rejects invalid inputs without writing a cookie", async () => {
    expect(await setLocaleAction("EN")).toEqual({ ok: false });
    expect(await setLocaleAction(null)).toEqual({ ok: false });
    expect(cookieJar.set).not.toHaveBeenCalled();
  });

  it("persists a validated locale with safe cookie options", async () => {
    expect(await setLocaleAction("en")).toEqual({ ok: true });
    expect(cookieJar.set).toHaveBeenCalledWith(LOCALE_COOKIE, "en", expect.objectContaining({
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      maxAge: 31_536_000,
    }));
  });
});
