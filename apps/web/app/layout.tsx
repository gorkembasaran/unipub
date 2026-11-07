import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DemoBanner } from "./components/DemoBanner";
import { I18nProvider } from "./i18n/I18nProvider";
import { getRequestLocale, getSiteMetadata } from "./seo";
import { ThemeProvider, themeInitScript } from "./theme/ThemeProvider";

export function generateMetadata(): Metadata {
  return getSiteMetadata(getRequestLocale());
}

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  const locale = getRequestLocale();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ThemeProvider>
          <I18nProvider locale={locale}>
            <DemoBanner />
            {children}
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
