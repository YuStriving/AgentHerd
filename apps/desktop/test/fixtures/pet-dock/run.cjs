const { app, BrowserWindow } = require("electron");

app.whenReady().then(async () => {
  // A hidden window must keep its timers and frames running at full speed.
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  try {
    // The page is the last argument, after any switches given to Electron.
    await win.loadFile(process.argv[process.argv.length - 1]);
    // Electron hides what a rejected page script threw; bring the message back with it.
    const outcome = await win.webContents.executeJavaScript(
      "window.runDockScenario().then((ok) => ({ ok }), (e) => ({ error: String(e?.stack ?? e) }))",
    );
    if (outcome.error !== undefined) throw new Error(outcome.error);
    console.log(`SEARCH_RESULT ${JSON.stringify(outcome.ok)}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
