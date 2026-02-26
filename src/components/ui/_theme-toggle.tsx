import { useSyncExternalStore } from "react";
import { cn } from "../../lib";

export type ThemePreference = "light" | "system" | "dark";

export const THEME_CHANGE = "gmail-chat-theme-change";

function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

function applyTheme(pref: ThemePreference) {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.mode = resolved;
  const bg = resolved === "dark" ? "#141414" : "#ffffff";
  document.documentElement.style.backgroundColor = bg;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", resolved);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
}

export function subscribeTheme(cb: () => void) {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if (getThemePreference() === "system") applyTheme("system");
    cb();
  };
  mql.addEventListener("change", onSystemChange);
  window.addEventListener(THEME_CHANGE, cb);
  return () => {
    mql.removeEventListener("change", onSystemChange);
    window.removeEventListener(THEME_CHANGE, cb);
  };
}

/** Returns the resolved theme applied to the DOM — always "light" or "dark". */
export function getTheme(): "light" | "dark" {
  return (document.documentElement.dataset.theme ?? document.documentElement.dataset.mode ?? "dark") as "light" | "dark";
}

/** Returns the user's stored preference — "light", "dark", or "system". */
export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

export function setThemePreference(pref: ThemePreference) {
  localStorage.setItem("theme", pref);
  applyTheme(pref);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE));
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getTheme);

  const toggle = () => {
    const pref = getThemePreference();
    const next: ThemePreference = pref === "light" ? "system" : pref === "system" ? "dark" : "light";
    setThemePreference(next);
  };

  const pref = getThemePreference();

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn("inline-flex h-11 w-11 items-center justify-center rounded-lg text-foreground-300 transition-colors hover:bg-background-200 hover:text-foreground-200", className)}
      aria-label={`Theme: ${pref}. Click to switch.`}
    >
      {pref === "dark" ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : pref === "light" ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      )}
    </button>
  );
}
