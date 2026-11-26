import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfiguredBearerAuthenticator, createHubServer } from "../src/index.js";
import { credentials, traceSource } from "./http-fixture.js";

const identity = `sha256:${"8".repeat(64)}`;
const servers: ReturnType<typeof createHubServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

async function start(checkReady: () => Promise<unknown>): Promise<string> {
  const server = createHubServer({
    trace: { authenticator: new ConfiguredBearerAuthenticator(credentials), source: traceSource() },
    health: { hubIdentityHash: identity, checkReady },
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("Hub health HTTP API", () => {
  it("separates process liveness from bounded storage readiness without authentication", async () => {
    const checkReady = vi.fn(async () => ({ valid: true }));
    const base = await start(checkReady);

    const live = await fetch(`${base}/v1/health/live`);
    expect(live.status).toBe(200);
    expect(live.headers.get("x-lervo-hub-identity")).toBe(identity);
    expect(live.headers.get("cache-control")).toBe("no-store");
    expect(await live.json()).toEqual({ schemaVersion: 1, status: "live" });
    expect(checkReady).not.toHaveBeenCalled();

    const ready = await fetch(`${base}/v1/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ schemaVersion: 1, status: "ready" });
    expect(checkReady).toHaveBeenCalledOnce();

    const capabilities = await fetch(`${base}/v1/health/capabilities`);
    expect(capabilities.status).toBe(200);
    expect(capabilities.headers.get("x-lervo-hub-identity")).toBe(identity);
    expect(capabilities.headers.get("cache-control")).toBe("no-store");
    expect(await capabilities.json()).toEqual({
      schemaVersion: 1,
      capability: "event_reader",
      readableEventSchemaVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    });
    expect(checkReady).toHaveBeenCalledOnce();
  });

  it("returns a fixed secret-free not-ready response when the storage check fails", async () => {
    const base = await start(async () => {
      throw new Error("private database path");
    });
    const response = await fetch(`${base}/v1/health/ready`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      status: "not_ready",
      failureCode: "storage_unavailable",
    });
    expect(await (await fetch(`${base}/v1/health/live`)).json()).toMatchObject({ status: "live" });
  });

  it("rejects methods, queries, and unknown health paths without running readiness", async () => {
    const checkReady = vi.fn(async () => undefined);
    const base = await start(checkReady);

    expect((await fetch(`${base}/v1/health/ready`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base}/v1/health/ready?detail=1`)).status).toBe(400);
    expect((await fetch(`${base}/v1/health/private`)).status).toBe(404);
    expect(checkReady).not.toHaveBeenCalled();
  });
});
