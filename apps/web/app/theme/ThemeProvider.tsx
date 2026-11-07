"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

type Theme = "light" | "dark";
const themeStorageKey = "theme";

type ThemeContextValue = {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggle: () => undefined,
  setTheme: () => undefined,
});

function resolveTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(themeStorageKey) as Theme | null;
  if (stored === "light" || stored === "dark") return stored;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function readThemeFromDocument(): Theme | null {
  if (typeof document === "undefined") return null;
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" || attr === "dark" ? attr : null;
}

export const themeInitScript = `
  (() => {
    try {
      const stored = window.localStorage.getItem("${themeStorageKey}");
      const theme =
        stored === "light" || stored === "dark"
          ? stored
          : window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
      document.documentElement.setAttribute("data-theme", theme);
    } catch {
      document.documentElement.setAttribute("data-theme", "light");
    }
  })();
`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initialTheme = readThemeFromDocument() ?? resolveTheme();
    setThemeState(initialTheme);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || typeof window === "undefined" || typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem(themeStorageKey, theme);
  }, [ready, theme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== themeStorageKey) return;
      if (event.newValue === "light" || event.newValue === "dark") {
        setThemeState(event.newValue);
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      toggle: () => setThemeState((prev) => (prev === "light" ? "dark" : "light")),
      setTheme: (t: Theme) => setThemeState(t),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
