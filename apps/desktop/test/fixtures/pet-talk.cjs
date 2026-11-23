const { join } = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const out = process.argv[2];
const { PetWindow } = require(join(out, "pet-window.cjs"));
app.setPath("userData", join(out, "profile"));

// Leave the real window, preload and renderer in place. Only replace the host.
ipcMain.handle("host:connected", () => true);
ipcMain.handle("host:call", (_e, method) => {
  if (method === "pet") return { connected: true, pending: [], history: [], cards: [] };
  if (method === "status") return {};
  if (method === "tasks") return { tasks: [] };
  throw new Error(`Unexpected host call: ${method}`);
});

app.whenReady().then(async () => {
  const pet = new PetWindow({
    preload: join(out, "preload.cjs"),
    rendererDir: out,
    openApp: () => {
      throw new Error("Expected the pet, not the main window");
    },
  });
  try {
    pet.set(true);
    const [win] = BrowserWindow.getAllWindows();
    const js = (script) => win.webContents.executeJavaScript(script);
    const until = async (description, condition) => {
      const end = Date.now() + 5000;
      while (!(await js(condition))) {
        if (Date.now() >= end) throw new Error(`Timed out waiting for ${description}`);
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
    };
    const focused =
      'document.querySelector(".pet-tab.on")?.textContent === "对话" && document.activeElement.matches(".pet-input:enabled")';
    const closed = '!document.querySelector("[role=tablist]")';
    const pressTalk = () => pet.show("chat", true);
    let focusRequests = 0;
    const focus = win.focus.bind(win);
    win.focus = () => {
      focusRequests++;
      focus();
    };
    await until("the figure", 'document.querySelector(".pet-figure")');
    pet.show("cards");
    await until("the cards tab", 'document.querySelector(".pet-tab.on")?.textContent === "卡片"');
    pressTalk();
    await until("the focused input", focused);
    if (focusRequests !== 2) throw new Error("Switching to the conversation did not focus the pet");
    await js(`(() => {
      const input = document.querySelector(".pet-input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "unfinished message");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await until("the edited draft", '!document.querySelector(".pet-send").disabled');
    pressTalk();
    await until("the conversation to close on the second press", closed);
    if (focusRequests !== 2) throw new Error("Closing the conversation requested window focus");
    const figureVisible = win.isVisible() && (await js('!!document.querySelector(".pet-figure")'));
    pressTalk();
    await until("the reopened, focused input", focused);
    if (focusRequests !== 3) throw new Error("Reopening the conversation did not focus the pet");
    const draft = await js('document.querySelector(".pet-input").value');
    // The ordinary menu and notification route must still only open or focus the chat.
    await js('document.querySelector(".pet-input").blur()');
    pet.show("chat");
    await until("the input to refocus without closing", focused);
    console.log(`SEARCH_RESULT ${JSON.stringify({ figureVisible, draft })}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
