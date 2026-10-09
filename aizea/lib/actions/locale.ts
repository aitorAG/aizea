"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n";

export async function setLocaleAction(value: unknown): Promise<{ ok: boolean }> {
  if (!isLocale(value)) return { ok: false };

  (await cookies()).set(LOCALE_COOKIE, value, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  return { ok: true };
}
