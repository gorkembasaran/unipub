"use client";

import { isDemoMode } from "../demoMode";
import { useI18n } from "../i18n/I18nProvider";

export function DemoBanner() {
  const { t } = useI18n();

  if (!isDemoMode) {
    return null;
  }

  return (
    <div className="demo-banner" role="note">
      {t("demo.banner")}{" "}
      <a href="https://github.com/gorkembasaran/unipub" target="_blank" rel="noreferrer">
        GitHub
      </a>
    </div>
  );
}
