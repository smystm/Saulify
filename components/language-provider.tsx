"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  defaultLocale,
  directionFor,
  getDictionary,
  isLocale,
  localeCookieName,
  localeStorageKey,
  normalizeLocale,
  type Dictionary,
  type Direction,
  type Locale,
} from "@/lib/i18n";

type I18nContextValue = {
  locale: Locale;
  dir: Direction;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(localeStorageKey);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage can be unavailable in privacy modes.
  }

  try {
    const cookie = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${localeCookieName}=`));
    const value = cookie?.slice(localeCookieName.length + 1);
    if (isLocale(value)) return value;
  } catch {
    // Ignore cookie access failures.
  }

  return null;
}

function applyDocumentLocale(locale: Locale) {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = directionFor(locale);
  root.dataset.locale = locale;
  document.title = getDictionary(locale).meta.title;
}

function persistLocale(locale: Locale) {
  try {
    window.localStorage.setItem(localeStorageKey, locale);
  } catch {
    // Persistence is best-effort; the current session still switches.
  }

  document.cookie = `${localeCookieName}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
}

export function LanguageProvider({
  children,
  initialLocale = defaultLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(normalizeLocale(initialLocale));

  useEffect(() => {
    const timer = setTimeout(() => {
      const stored = readStoredLocale();
      if (stored) {
        setLocaleState(stored);
        applyDocumentLocale(stored);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
    applyDocumentLocale(next);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      dir: directionFor(locale),
      t: getDictionary(locale),
      setLocale,
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside LanguageProvider");
  }
  return context;
}
