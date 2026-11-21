// The app's colours (设置 → 外观 → 颜色): follow the system, or stay light or dark. Main applies the
// choice with nativeTheme.themeSource, so `prefers-color-scheme` in every window (the app, the
// pet) and the window frame follow it, and keeps it in userData/theme.json so the first frame is
// already right after a restart.

export const THEMES = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
] as const;

export type Theme = (typeof THEMES)[number]["value"];

export const DEFAULT_THEME: Theme = "system";

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((t) => t.value === value);
}

/** The saved choice from theme.json's text; anything unreadable is the default. */
export function themeFrom(text: string | undefined): Theme {
  if (text === undefined) return DEFAULT_THEME;
  try {
    const theme = (JSON.parse(text) as { theme?: unknown }).theme;
    return isTheme(theme) ? theme : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** theme.json's text for a choice. */
export function themeText(theme: Theme): string {
  return `${JSON.stringify({ theme })}\n`;
}
