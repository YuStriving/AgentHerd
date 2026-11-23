import { describe, expect, it } from "vitest";
import {
  applySystemProxy,
  macProxy,
  NO_PROXY_DEFAULT,
  windowsProxy,
  withSystemProxy,
} from "../src/proxy.ts";

const REG = (enable: string, server: string) => `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    MigrateProxy    REG_DWORD    0x1
    ProxyEnable    REG_DWORD    ${enable}
    ProxyServer    REG_SZ    ${server}
    ProxyOverride    REG_SZ    localhost;127.*;<local>
`;

const SCUTIL = `<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7891
  HTTPSProxy : 127.0.0.1
}`;

describe("system proxy (ADR 0050)", () => {
  it("reads the Windows proxy when it is on", () => {
    expect(windowsProxy(REG("0x1", "127.0.0.1:7890"))).toBe("http://127.0.0.1:7890");
    expect(windowsProxy(REG("0x0", "127.0.0.1:7890"))).toBeUndefined();
    expect(windowsProxy(REG("0x1", "http=h:1;https=h:2;ftp=h:3"))).toBe("http://h:2");
    expect(windowsProxy(REG("0x1", "HTTP=h:1;HTTPS=h:2"))).toBe("http://h:2");
    expect(windowsProxy(REG("0x1", "socks5://h:1080"))).toBe("socks5://h:1080");
    expect(windowsProxy("")).toBeUndefined();
  });

  it("reads the macOS proxy, HTTPS first", () => {
    expect(macProxy(SCUTIL)).toBe("http://127.0.0.1:7891");
    expect(macProxy(SCUTIL.replace("HTTPSEnable : 1", "HTTPSEnable : 0"))).toBe(
      "http://127.0.0.1:7890",
    );
    expect(macProxy("<dictionary> {\n}")).toBeUndefined();
  });

  it("keeps a proxy the environment already has, and survives a failing query", () => {
    const asked: string[] = [];
    const query = (cmd: string) => {
      asked.push(cmd);
      return REG("0x1", "127.0.0.1:7890");
    };
    expect(withSystemProxy({ HTTPS_PROXY: "http://mine:1" }, "win32", query)).toEqual({
      HTTPS_PROXY: "http://mine:1",
      NO_PROXY: NO_PROXY_DEFAULT,
    });
    expect(withSystemProxy({ PATH: "p", SystemRoot: "D:\\Win" }, "win32", query)).toEqual({
      PATH: "p",
      SystemRoot: "D:\\Win",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      HTTP_PROXY: "http://127.0.0.1:7890",
      NO_PROXY: NO_PROXY_DEFAULT,
      NODE_USE_ENV_PROXY: "1",
    });
    expect(asked[0]).toBe("D:\\Win\\System32\\reg.exe");
    expect(
      withSystemProxy(
        { PATH: "p", NO_PROXY: "10.0.0.0/8", NODE_USE_ENV_PROXY: "0" },
        "win32",
        query,
      ),
    ).toMatchObject({
      NO_PROXY: "10.0.0.0/8",
      NODE_USE_ENV_PROXY: "0",
    });
    expect(
      withSystemProxy({ PATH: "p" }, "win32", () => {
        throw new Error("no reg");
      }),
    ).toEqual({ PATH: "p" });
    expect(withSystemProxy({ PATH: "p" }, "linux", query)).toEqual({ PATH: "p" });

    const mutable: NodeJS.ProcessEnv = { PATH: "p" };
    applySystemProxy(mutable, "win32", query);
    expect(mutable).toMatchObject({
      HTTPS_PROXY: "http://127.0.0.1:7890",
      HTTP_PROXY: "http://127.0.0.1:7890",
      NO_PROXY: NO_PROXY_DEFAULT,
      NODE_USE_ENV_PROXY: "1",
    });
  });
});
