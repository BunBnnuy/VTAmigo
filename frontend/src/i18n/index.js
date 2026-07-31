import { useMemo } from "react";
import en from "./locales/en.js";
import es from "./locales/es.js";
import ja from "./locales/ja.js";
import ko from "./locales/ko.js";

export const LOCALES = { en, es, ja, ko };

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
];

const DEFAULT_LANGUAGE = "en";

// Picks the best supported language from the browser's configured
// languages (navigator.languages, falling back to navigator.language),
// matching on the primary subtag (e.g. "es-MX" -> "es"). Defaults to
// English when nothing supported is found.
export function detectLanguage() {
  const candidates = (typeof navigator !== "undefined" && (navigator.languages || [navigator.language])) || [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const primary = candidate.toLowerCase().split("-")[0];
    if (LOCALES[primary]) return primary;
  }
  return DEFAULT_LANGUAGE;
}

function resolve(dict, path) {
  return path.split(".").reduce((acc, key) => (acc && typeof acc === "object" ? acc[key] : undefined), dict);
}

function interpolate(str, vars) {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

export function translate(lang, key, vars) {
  const dict = LOCALES[lang] || LOCALES[DEFAULT_LANGUAGE];
  const value = resolve(dict, key) ?? resolve(LOCALES[DEFAULT_LANGUAGE], key);
  if (value === undefined) return key;
  return interpolate(value, vars);
}

export function useTranslation(lang) {
  const resolvedLang = LOCALES[lang] ? lang : DEFAULT_LANGUAGE;
  return useMemo(() => {
    const t = (key, vars) => translate(resolvedLang, key, vars);
    return { t, lang: resolvedLang };
  }, [resolvedLang]);
}
