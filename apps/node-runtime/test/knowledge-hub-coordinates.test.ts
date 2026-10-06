import type { fork } from "node:child_process";
import { EventEmitter } from "node:events";

import { expect, it, vi } from "vitest";

import {
  decodeKnowledgeHubCoordinates,
  encodeKnowledgeHubCoordinates,
  KNOWLEDGE_HUB_COORDINATES_ENVIRONMENT,
} from "../src/knowledge-hub-coordinates.js";
import { startKnowledgeWorkerProcess } from "../src/knowledge-worker-process.js";

const hub = {
  baseUrl: "https://hub.example/",
  bearerTokenFile: "/owner-only/hub-token",
  destinationId: "hub:primary",
  hubIdentityHash: `sha256:${"a".repeat(64)}`,
};

it("round-trips only the four Hub coordinates and rejects anything else", () => {
  expect(decodeKnowledgeHubCoordinates(encodeKnowledgeHubCoordinates(hub))).toEqual(hub);
  expect(decodeKnowledgeHubCoordinates(undefined)).toBeNull();
  expect(decodeKnowledgeHubCoordinates("not json")).toBeNull();
  expect(decodeKnowledgeHubCoordinates(JSON.stringify({ ...hub, token: "secret" }))).toBeNull();
  expect(decodeKnowledgeHubCoordinates(JSON.stringify({ ...hub, baseUrl: 1 }))).toBeNull();
});

it("hands the Node's Hub coordinates, never a token, to its resident knowledge child", async () => {
  const child = Object.assign(new EventEmitter(), {
    connected: true,
    send: vi.fn((_message: unknown, callback: (error: Error | null) => void) => {
      callback(null);
      queueMicrotask(() => child.emit("close"));
    }),
    kill: vi.fn(),
  });
  const launch = vi.fn(() => child) as unknown as typeof fork;
  const stop = startKnowledgeWorkerProcess(
    {
      entry: "/runtime/bin.js",
      repositoryRoot: "/repository",
      provider: "codex",
      hub,
      onFailure: () => undefined,
    },
    launch,
  );
  await stop();
  const options = (launch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![2] as {
    env: Record<string, string>;
  };
  expect(decodeKnowledgeHubCoordinates(options.env[KNOWLEDGE_HUB_COORDINATES_ENVIRONMENT])).toEqual(
    hub,
  );
  expect(JSON.stringify(options.env[KNOWLEDGE_HUB_COORDINATES_ENVIRONMENT])).not.toContain(
    "secret",
  );
});
