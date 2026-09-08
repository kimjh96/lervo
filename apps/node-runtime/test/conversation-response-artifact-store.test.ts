import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SQLiteConversationResponseArtifactStore } from "../src/conversation-response-artifact-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("conversation response artifact store", () => {
  it("retains one immutable generated artifact across restart", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-response-artifact-"));
    roots.push(root);
    const path = resolve(root, "response-artifacts.sqlite");
    const contentHash = `sha256:${"a".repeat(64)}`;
    const record = {
      requestDigest: `sha256:${"b".repeat(64)}`,
      artifact: {
        artifactId: `art_${"a".repeat(64)}`,
        uri: `lervo-cas://sha256/${"a".repeat(64)}`,
        mediaType: "text/markdown; charset=utf-8" as const,
        contentHash,
        byteCount: 42,
      },
      createdAt: "2026-09-08T09:00:00.000Z",
    };
    let store = await SQLiteConversationResponseArtifactStore.open(path, 2);
    await store.put(record);
    store.close();

    store = await SQLiteConversationResponseArtifactStore.open(path, 2);
    await expect(store.get(record.requestDigest)).resolves.toEqual(record.artifact);
    await expect(
      store.put({
        ...record,
        artifact: { ...record.artifact, byteCount: 43 },
      }),
    ).rejects.toThrow("another artifact");
    await expect(store.get(record.requestDigest)).resolves.toEqual(record.artifact);
    store.close();
  });
});
