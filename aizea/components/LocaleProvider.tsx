"use client";

import { createContext, useContext, type ReactNode } from "react";
import { type Locale, type TranslationArgs, type TranslationKey, translate } from "@/lib/i18n";

const LocaleContext = createContext<Locale | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  const locale = useContext(LocaleContext);
  if (locale === null) throw new Error("useLocale must be used within LocaleProvider");
  return locale;
}

export function useTranslations() {
  const locale = useLocale();
  return <K extends TranslationKey>(key: K, ...args: TranslationArgs<K>) =>
    translate(locale, key, ...args);
}
