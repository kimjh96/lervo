import type { MessageFormatElement } from "react-intl";

import en from "./generated/en.json";

/** English is the only shipped catalog; other locales fall back to it (ADE convention). */
export const defaultLocale = "en";

const catalogs: Readonly<Record<string, Record<string, MessageFormatElement[]>>> = {
  en: en as Record<string, MessageFormatElement[]>,
};

/** The OS locale when a catalog exists for it, otherwise English. */
export function chooseLocale(preferred: readonly string[]): string {
  for (const locale of preferred) {
    const language = locale.split("-")[0];
    if (language !== undefined && language in catalogs) return language;
  }
  return defaultLocale;
}

export function messagesFor(locale: string): Record<string, MessageFormatElement[]> {
  return catalogs[locale] ?? (en as Record<string, MessageFormatElement[]>);
}
