import { delimiter, dirname } from "node:path";

import { describe, expect, it } from "vitest";

import {
  NodeConversationRequestedRuntimeProcess,
  requestedRuntimeEnvironment,
} from "../src/node-requested-runtime-process.js";
import { availablePort, removeTemporaryRoots, temporaryRoot } from "./fixture.js";

describe("Node requested runtime process", () => {
  it("makes the configured executable directory available to nested lifecycle commands", () => {
    const executable = "/configured/package-manager/bin/pnpm";
    const inheritedPath = ["/runtime/node/bin", "/usr/bin", "/bin"].join(delimiter);
    const environment = requestedRuntimeEnvironment(executable, {
      HOME: "/user/home",
      Path: inheritedPath,
    });

    expect(environment.Path?.split(delimiter)).toEqual([
      dirname(executable),
      "/runtime/node/bin",
      "/usr/bin",
      "/bin",
    ]);
    expect(environment.PATH).toBeUndefined();
    expect(environment.HOME).toBe("/user/home");
  });

  it("waits for loopback readiness and stops the owned process group", async () => {
    const root = await temporaryRoot();
    const port = await availablePort();
    const processPort = new NodeConversationRequestedRuntimeProcess();
    const child = await processPort.start({
      runtimeId: "preview",
      displayName: "Preview",
      executable: process.execPath,
      arguments: [
        "-e",
        `require("node:http").createServer((_request,response)=>response.end("ready")).listen(${port},"127.0.0.1")`,
      ],
      workingDirectory: root,
      healthUrl: `http://127.0.0.1:${port}/`,
      maximumLifetimeMs: 60_000,
      startupTimeoutMs: 5_000,
      stopTimeoutMs: 2_000,
    });

    await expect(
      fetch(`http://127.0.0.1:${port}/`).then((response) => response.text()),
    ).resolves.toBe("ready");
    await child.stop(2_000);
    await expect(child.exited).resolves.toMatchObject({ signal: "SIGTERM" });
    await removeTemporaryRoots();
  });
});
