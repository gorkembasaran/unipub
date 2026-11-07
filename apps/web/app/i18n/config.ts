export const locales = ["tr", "en", "de", "pl", "es", "pt", "nl", "ko", "ja"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "tr";
export const localeStorageKey = "unipub-locale";
export const legacyLocaleStorageKey = "locale";
export const localeCookieName = "unipub-locale";
