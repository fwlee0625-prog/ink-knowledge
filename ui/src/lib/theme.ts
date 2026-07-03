import { useEffect, useState } from "react";
import type { ThemePreference } from "../types";

export type ResolvedTheme = "light" | "dark";

const systemDarkQuery = "(prefers-color-scheme: dark)";

function currentSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }

  return window.matchMedia(systemDarkQuery).matches ? "dark" : "light";
}

export function useThemeMode(preference: ThemePreference): ResolvedTheme {
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => currentSystemTheme());
  const resolvedTheme = preference === "system" ? systemTheme : preference;

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const media = window.matchMedia(systemDarkQuery);
    const updateSystemTheme = () => setSystemTheme(media.matches ? "dark" : "light");

    updateSystemTheme();
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  return resolvedTheme;
}
