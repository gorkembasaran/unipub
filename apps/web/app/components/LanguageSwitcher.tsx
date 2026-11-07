"use client";

import { Check, ChevronDown, Globe2 } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "../i18n/I18nProvider";
import { locales, type Locale } from "../i18n/config";

const localeLabelKeys = {
  tr: "home.lang.tr",
  en: "home.lang.en",
  de: "home.lang.de",
  pl: "home.lang.pl",
  es: "home.lang.es",
  pt: "home.lang.pt",
  nl: "home.lang.nl",
  ko: "home.lang.ko",
  ja: "home.lang.ja",
} satisfies Record<(typeof locales)[number], string>;

const localeFlags = {
  tr: "🇹🇷",
  en: "🇬🇧",
  de: "🇩🇪",
  pl: "🇵🇱",
  es: "🇪🇸",
  pt: "🇵🇹",
  nl: "🇳🇱",
  ko: "🇰🇷",
  ja: "🇯🇵",
} satisfies Record<(typeof locales)[number], string>;

type LanguageSwitcherProps = {
  triggerClassName?: string;
};

export default function LanguageSwitcher({
  triggerClassName = "home-lang-trigger home-icon-action",
}: LanguageSwitcherProps) {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const popoverId = useId();
  const langMenuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [langModalOpen, setLangModalOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const closeMenu = (restoreFocus = false) => {
    setLangModalOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
  };

  const focusOption = (index: number) => {
    optionRefs.current[index]?.focus();
  };

  const handleLocaleSelect = (code: Locale) => {
    if (!setLocale || isPending) return;

    if (code === locale) {
      closeMenu(true);
      return;
    }

    setLocale(code);
    closeMenu(true);
    startTransition(() => {
      router.refresh();
    });
  };

  useEffect(() => {
    if (!langModalOpen) return;

    const activeIndex = Math.max(0, locales.indexOf(locale));
    requestAnimationFrame(() => {
      focusOption(activeIndex);
    });

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!langMenuRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [langModalOpen, locale]);

  const handleOptionKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption((index + 1) % locales.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption((index - 1 + locales.length) % locales.length);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusOption(locales.length - 1);
    }
  };

  return (
    <div className="home-lang-wrap" ref={langMenuRef}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        onClick={() => setLangModalOpen((open) => !open)}
        aria-label={t("home.lang.title")}
        aria-haspopup="menu"
        aria-expanded={!!langModalOpen}
        aria-controls={langModalOpen ? popoverId : undefined}
        disabled={isPending}
      >
        <Globe2 size={18} className="home-lang-trigger-globe" />
        <span className="home-lang-trigger-flag" aria-hidden="true">
          {localeFlags[locale]}
        </span>
        <ChevronDown
          size={14}
          className={
            langModalOpen
              ? "home-lang-trigger-icon home-lang-trigger-caret is-open"
              : "home-lang-trigger-icon home-lang-trigger-caret"
          }
        />
      </button>

      {langModalOpen ? (
        <div
          id={popoverId}
          className="home-lang-popover"
          role="menu"
          aria-label={t("home.lang.title")}
        >
          <div className="home-lang-popover-head">
            <div className="home-lang-popover-title">{t("home.lang.title")}</div>
            <div className="home-lang-popover-sub">{t("home.lang.subtitle")}</div>
          </div>

          <div className="home-lang-options">
            {locales.map((code, index) => (
              <button
                key={code}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                className={locale === code ? "home-lang-option is-active" : "home-lang-option"}
                role="menuitemradio"
                aria-checked={locale === code ? true : false}
                disabled={isPending}
                onClick={() => handleLocaleSelect(code)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
              >
                <span className="home-lang-option-flag" aria-hidden="true">
                  {localeFlags[code]}
                </span>
                <span className="home-lang-option-label">{t(localeLabelKeys[code])}</span>
                <span className="home-lang-option-code">{code.toUpperCase()}</span>
                {locale === code ? <Check size={14} className="home-lang-option-check" /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
