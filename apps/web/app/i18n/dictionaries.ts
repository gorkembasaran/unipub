import tr from "./locales/tr.json";
import en from "./locales/en.json";

import de from "./locales/de.json";
import pl from "./locales/pl.json";
import es from "./locales/es.json";
import pt from "./locales/pt.json";
import nl from "./locales/nl.json";
import ko from "./locales/ko.json";
import ja from "./locales/ja.json";

import type { Locale } from "./config";

const dictionaries: Record<Locale, Record<string, string>> = {
  tr,
  en,
  de,
  pl,
  es,
  pt,
  nl,
  ko,
  ja,
};

export function getDictionary(locale: Locale) {
  return dictionaries[locale] ?? dictionaries.en;
}
