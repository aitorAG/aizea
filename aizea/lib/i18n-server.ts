import "server-only";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n";

export async function getRequestLocale() {
  return normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}
