"use client";

import { useState, type ChangeEvent } from "react";
import { setLocaleAction } from "@/lib/actions/locale";
import { LOCALES, type Locale } from "@/lib/i18n";
import { useLocale, useTranslations } from "@/components/LocaleProvider";

export function LanguageSelector() {
  const locale = useLocale();
  const t = useTranslations();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function onChange(event: ChangeEvent<HTMLSelectElement>) {
    const selected = event.target.value;
    if (selected === locale) return;
    setPending(true);
    setError(false);
    try {
      const result = await setLocaleAction(selected);
      if (result.ok) {
        window.location.reload();
        return;
      }
    } catch {
      // Keep the current locale when cookie persistence fails.
    }
    setPending(false);
    setError(true);
  }

  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor="language-selector" className="sr-only">{t("language")}</label>
      <select
        id="language-selector"
        data-testid="language-selector"
        aria-label={t("language")}
        aria-invalid={error || undefined}
        aria-describedby={error ? "language-selector-error" : undefined}
        className="max-w-20 rounded border border-input bg-background px-1 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={locale}
        disabled={pending}
        onChange={onChange}
      >
        {LOCALES.map((code: Locale) => (
          <option key={code} value={code}>{code === "es" ? "Español" : "English"}</option>
        ))}
      </select>
      {error && <span id="language-selector-error" role="alert" className="sr-only">{t("languageChangeFailed")}</span>}
    </div>
  );
}
