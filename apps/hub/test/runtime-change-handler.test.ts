import { createServer, type Server } from "node:http";
import type { HubRuntimeChangeSource } from "@lervo/hub-sync";
import { AuthenticatedHubHttpTransport } from "@lervo/sync";
import { afterEach, expect, it, vi } from "vitest";
import { ConfiguredBearerAuthenticator } from "../src/auth.js";
import { createHubRuntimeChangeHandler } from "../src/runtime-change-handler.js";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
const token = "runtime-change-token-aaaaaaaaaaaaaaaaaaaa";
const identity = `sha256:${"a".repeat(64)}`;
const target = {
  projectId: "prj_runtime_change_01",
  projectIdentityHash: `sha256:${"b".repeat(64)}`,
};
const cursor = "12345678-1234-1234-1234-123456789abc";
const destinationId = "hub:runtime";
const credential = {
  token,
  principalId: "node:runtime",
  projects: [{ destinationId, projectId: target.projectId }],
  permissions: ["workstream.read" as const, "command.delivery" as const],
};

async function serve(
  store: HubRuntimeChangeSource,
  authenticator = new ConfiguredBearerAuthenticator([credential]),
) {
  const handler = createHubRuntimeChangeHandler({
    workstream: { store, authenticator, hubIdentityHash: identity },
    command: { store, authenticator, hubIdentityHash: identity },
  });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("address");
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  const transport = new AuthenticatedHubHttpTransport({
    baseUrl,
    allowInsecureHttpForTests: true,
    bearerToken: token,
    expectedHubIdentityHash: identity,
    destinationId,
    target,
    requestTimeoutMs: 30_000,
  });
  return { baseUrl, transport };
}

it("returns only authenticated bounded hints through the Node transport", async () => {
  const waitForRuntimeChange = vi.fn().mockResolvedValue({ cursor, status: "changed" });
  const { transport } = await serve({ waitForRuntimeChange });
  const response = await transport.waitForRuntimeChange({
    topic: "workstream",
    cursor: null,
    signal: new AbortController().signal,
  });
  expect(response).toEqual({
    authentication: { status: "verified", destinationId, peerIdentityHash: identity },
    body: { schemaVersion: 1, cursor, status: "changed" },
  });
  expect(waitForRuntimeChange).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: target.projectId,
      repositoryIdentityHash: target.projectIdentityHash,
      destinationId,
      topic: "workstream",
    }),
  );
});

it("rejects a wrong command principal or project without subscribing", async () => {
  const waitForRuntimeChange = vi.fn().mockResolvedValue({ cursor, status: "changed" });
  const { transport, baseUrl } = await serve({ waitForRuntimeChange });
  await expect(
    transport.waitForRuntimeChange({
      topic: "command",
      nodeId: "node:other",
      cursor: null,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow();
  const response = await fetch(
    `${baseUrl}v1/runtime-changes/projects/prj_other_project_01?destinationId=${destinationId}&repositoryIdentityHash=${target.projectIdentityHash}&topic=workstream`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(response.status).toBe(403);
  expect(waitForRuntimeChange).not.toHaveBeenCalled();
});

it("cancels the server subscription when the Node aborts its idle wait", async () => {
  let received: AbortSignal | undefined;
  const { transport } = await serve({
    waitForRuntimeChange: (input) =>
      new Promise((resolve) => {
        received = input.signal;
        input.signal.addEventListener("abort", () => resolve({ cursor, status: "timeout" }), {
          once: true,
        });
      }),
  });
  const controller = new AbortController();
  const pending = transport.waitForRuntimeChange({
    topic: "workstream",
    cursor,
    signal: controller.signal,
  });
  const outcome = pending.catch(() => "aborted");
  await vi.waitFor(() => expect(received).toBeDefined());
  controller.abort();
  expect(await outcome).toBe("aborted");
  await vi.waitFor(() => expect(received?.aborted).toBe(true));
});

it("rechecks revoked credentials after a held request wakes", async () => {
  const auth = new ConfiguredBearerAuthenticator([credential]);
  const authenticate = vi.spyOn(auth, "authenticate");
  let release: (() => void) | undefined;
  const { transport } = await serve(
    {
      waitForRuntimeChange: () =>
        new Promise((resolve) => {
          release = () => resolve({ cursor, status: "changed" });
        }),
    },
    auth,
  );
  const pending = transport.waitForRuntimeChange({
    topic: "workstream",
    cursor,
    signal: new AbortController().signal,
  });
  const outcome = pending.catch(() => "revoked");
  await vi.waitFor(() => expect(release).toBeDefined());
  authenticate.mockResolvedValue(null);
  release!();
  expect(await outcome).toBe("revoked");
});
