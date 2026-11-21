import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, isTheme, THEMES, themeFrom, themeText } from "../src/shared/theme.ts";

describe("the app's colours (设置 → 外观 → 颜色)", () => {
  it("offers following the system, light and dark, following the system by default", () => {
    expect(THEMES.map((t) => t.value)).toEqual(["system", "light", "dark"]);
    expect(THEMES.map((t) => t.label)).toEqual(["跟随系统", "浅色", "深色"]);
    expect(DEFAULT_THEME).toBe("system");
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("black")).toBe(false);
  });

  it("keeps the choice in theme.json and reads anything else as the default", () => {
    expect(themeFrom(themeText("dark"))).toBe("dark");
    expect(themeFrom(themeText("light"))).toBe("light");
    expect(themeFrom(undefined)).toBe("system");
    expect(themeFrom("not json")).toBe("system");
    expect(themeFrom('{"theme":"black"}')).toBe("system");
  });
});
