import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("callboard-theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  return {
    theme,
    toggle: () => setTheme((value) => (value === "dark" ? "light" : "dark")),
  };
}
