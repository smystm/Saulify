import { en, type Dictionary } from "./en";
import { fa } from "./fa";

export type Locale = "en" | "fa";
export type Direction = "ltr" | "rtl";

export const locales: Locale[] = ["en", "fa"];
export const defaultLocale: Locale = "en";
export const localeCookieName = "saulify_locale";
export const localeStorageKey = "saulify:locale";

const dictionaries: Record<Locale, Dictionary> = { en, fa };

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "fa";
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale;
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export function directionFor(locale: Locale): Direction {
  return locale === "fa" ? "rtl" : "ltr";
}

export type { Dictionary };
