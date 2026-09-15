import {
  type Context,
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type Translations = Record<string, string>;
type TranslateVals = Record<string, string | number>;

export type Translate = (key: string, vals?: TranslateVals, fallback?: string) => string;

interface i18n {
  locale: string;
  locales: string[];
  setLocale: (locale: string) => void;
  t: Translate;
}

const STORAGE_KEY: string = "ui-locale";
const FALLBACK_LOCALE: string = "en";
const RTL_LOCALES: Set<string> = new Set([
  "ar",
  "arc",
  "hbo",
  "syc",
  "ckb",
  "dv",
  "fa",
  "he",
  "ks",
  "ps",
  "sam",
  "sd",
  "ug",
  "ur",
  "yi",
]);
const LOCALE_ALIASES: Record<string, string> = {
  ay: "ayr",
  in: "id",
  iw: "he",
  nb: "no",
  nn: "no",
  tl: "fil",
};

const storage = {
  get: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, val: string): void => {
    try {
      localStorage.setItem(key, val);
    } catch {}
  },
};

const i18nDict: Record<string, Translations> = import.meta.glob<Translations>("./locales/*.json", {
  eager: true,
  import: "default",
});

const norm: (locale: string) => string = (locale: string): string =>
  locale.toLowerCase().replaceAll("_", "-");

const translations: Map<string, Translations> = new Map<string, Translations>();
const localeLookup: Map<string, string> = new Map<string, string>();

for (const [path, dict] of Object.entries(i18nDict)) {
  const locale: string = path.slice(10, -5);
  translations.set(locale, dict);
  localeLookup.set(norm(locale), locale);
}

export const availableLocales: string[] = [...translations.keys()].sort();
const fallbackTranslations: Translations = translations.get(FALLBACK_LOCALE) ?? {};

function resolveLocale(locale?: string | null): string | null {
  if (!locale) return null;
  const key: string = norm(locale);
  const base: string = key.split("-")[0];
  return localeLookup.get(key) ?? localeLookup.get(base) ?? LOCALE_ALIASES[base] ?? null;
}

export function initialLocale(): string {
  const candidates: (string | null)[] = [
    new URLSearchParams(location.search).get("lang"),
    storage.get(STORAGE_KEY),
    ...(navigator.languages || [navigator.language]),
    document.documentElement.lang,
  ];
  for (const candidate of candidates) {
    const matched: string | null = resolveLocale(candidate);
    if (matched) return matched;
  }
  return FALLBACK_LOCALE;
}

function interpolate(template: string, vals?: TranslateVals): string {
  if (!vals) return template;
  return template.replace(/\{(\w+)}/g, (match: string, key: string): string =>
    key in vals ? String(vals[key]) : match,
  );
}

function initTranslator(locale: string): Translate {
  const dict: Translations = translations.get(locale) ?? fallbackTranslations;
  const isFallback: boolean = dict === fallbackTranslations;
  return (key: string, vals: TranslateVals | undefined, fallback: string | undefined): string => {
    const template: string =
      dict[key] ?? (!isFallback ? fallbackTranslations[key] : undefined) ?? fallback ?? key;
    return interpolate(template, vals);
  };
}

const i18nContext: Context<i18n | null> = createContext<i18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState(initialLocale);
  const setLocale: (candidate: string) => void = useCallback((candidate: string): void => {
    const matched: string | null = resolveLocale(candidate);
    if (matched) setLocaleState(matched);
  }, []);

  useEffect((): void => {
    document.documentElement.lang = locale;
    document.documentElement.dir = RTL_LOCALES.has(locale) ? "rtl" : "ltr";
    storage.set(STORAGE_KEY, locale);
  }, [locale]);

  useEffect((): (() => void) => {
    const syncLocale: (event: StorageEvent) => void = (event: StorageEvent): void => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const matched: string | null = resolveLocale(storage.get(STORAGE_KEY));
      setLocaleState(matched ?? FALLBACK_LOCALE);
    };
    window.addEventListener("storage", syncLocale);
    return (): void => window.removeEventListener("storage", syncLocale);
  }, []);

  const value: i18n = useMemo<i18n>(
    (): {
      locale: string;
      locales: string[];
      setLocale: (candidate: string) => void;
      t: (key: string, vals?: TranslateVals, fallback?: string) => string;
    } => ({
      locale,
      locales: availableLocales,
      setLocale,
      t: initTranslator(locale),
    }),
    [locale, setLocale],
  );
  return <i18nContext.Provider value={value}>{children}</i18nContext.Provider>;
}

export function useI18n(): i18n {
  const context: i18n | null = useContext(i18nContext);
  if (!context) {
    throw new Error("i18n must be used in the context provider tree.");
  }
  return context;
}
