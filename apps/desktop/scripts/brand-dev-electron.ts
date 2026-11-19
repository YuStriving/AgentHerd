// macOS shows the bundle name of the running .app in the menu bar, the Dock and Cmd-Tab. In
// development that bundle is node_modules' Electron.app, so it says "Electron". Rename the dev
// bundle to AgentHerd; packaged builds get the name from the packager. Safe to run repeatedly.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const NAME = "AgentHerd";

if (process.platform === "darwin") {
  const require = createRequire(import.meta.url);
  const electronDir = dirname(require.resolve("electron/package.json"));
  const plist = join(electronDir, "dist/Electron.app/Contents/Info.plist");
  if (existsSync(plist)) {
    for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
      execFileSync("plutil", ["-replace", key, "-string", NAME, plist]);
    }
    // The edit breaks Electron's signature, and macOS refuses notifications to an app whose
    // signature is broken (ADR 0079): sign the dev bundle again, ad hoc, when it no longer checks.
    const bundle = join(electronDir, "dist/Electron.app");
    try {
      execFileSync("codesign", ["--verify", bundle], { stdio: "ignore" });
    } catch {
      execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "ignore" });
    }
  }
}
