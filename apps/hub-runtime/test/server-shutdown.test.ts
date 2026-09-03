import { createServer } from "node:http";
import { connect } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { closeHubRuntimeServer } from "../src/server-shutdown.js";
import { availablePort } from "./fixture.js";

const openSockets = new Set<ReturnType<typeof connect>>();

afterEach(() => {
  for (const socket of openSockets) socket.destroy();
  openSockets.clear();
});

describe("Hub runtime HTTP server shutdown", () => {
  it("reports a graceful drain after completed requests", async () => {
    const port = await availablePort();
    const server = createServer((_request, response) => response.end("ready"));
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    const response = await fetch(`http://127.0.0.1:${port}`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ready");

    await expect(closeHubRuntimeServer(server, { drainTimeoutMs: 100 })).resolves.toBe("graceful");
  });

  it("forces an incomplete active request closed after the bounded drain", async () => {
    const port = await availablePort();
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    const server = createServer((request) => {
      requestStarted();
      request.resume();
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

    const socket = connect(port, "127.0.0.1");
    openSockets.add(socket);
    socket.on("error", () => undefined);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write("POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 100\r\n\r\nx");
    await started;

    await expect(closeHubRuntimeServer(server, { drainTimeoutMs: 20 })).resolves.toBe("forced");
  });
});
