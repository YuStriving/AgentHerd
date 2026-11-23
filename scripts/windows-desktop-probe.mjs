// One bounded probe. Connecting alone does not prove the desktop's utility host works.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { connectHost, socketPath } from "../packages/host/src/server.ts";

const home = resolve(process.argv[2]);
setTimeout(() => {
  console.log("Host status timed out");
  process.exit(1);
}, 3000).unref();
let client;
try {
  client = await connectHost(socketPath(home));
  const status = await client.host.status();
  assert.equal(resolve(status.home).toLowerCase(), home.toLowerCase());
  assert.ok(status.version);
  console.log(`Visible AgentHerd main window; host ${status.version} answered for ${home}`);
} catch (error) {
  console.log(`Host status not ready: ${error.message}`);
  process.exitCode = 1;
} finally {
  client?.close();
}
