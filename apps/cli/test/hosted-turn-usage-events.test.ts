import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { CLAUDE_HOSTED_USAGE_ACCOUNTING } from "@lervo/adapter-claude";
import type { HostedTurnUsage } from "@lervo/adapter-contract";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { resourceAccountingDescriptorHash } from "@lervo/execution-contract";
import {
  applyInitPlan,
  createInitPlan,
  loadProjectManifest,
  resolveProjectPaths,
} from "@lervo/project";
import type { ArtifactStore } from "@lervo/storage-contract";
import { afterEach, describe, expect, it } from "vitest";

import type { HostedLaunchRecord } from "../src/hosted-launch-records.js";
import { providerSessionDigest } from "../src/hosted-session-events.js";
import { appendTurnUsage, turnUsageCoordinate } from "../src/hosted-turn-usage-events.js";

const record: HostedLaunchRecord = {
  schemaVersion: 1,
  workspaceId: "wsp_0123456789abcdef01234567",
  sessionId: "0b5f7d8e-4a1c-4c2e-9f3a-1d2e3f4a5b6c",
  provider: "claude",
  projectId: "prj_hosted_usage001",
  branch: "lervo/fix-the-login-form-1a2b3c",
  conversationMode: "native",
  argumentDigest: `sha256:${"a".repeat(64)}`,
  settingsDigest: `sha256:${"b".repeat(64)}`,
  mcpConfigDigest: null,
  preparedAt: "2026-11-25T10:00:00.000Z",
};

/** The first turn of the two-turn canary, as Claude Code 2026-11 reported it. */
const turn = (overrides: Partial<HostedTurnUsage> = {}): HostedTurnUsage => ({
  turnKey: "0a695bbb-0ada-4ba9-9faf-6253c67299a2",
  resultIndex: 0,
  modelKey: "claude-haiku-5-5",
  model: "claude-haiku-5-5",
  uncachedInputTokens: 2,
  cacheReadInputTokens: 11844,
  cacheCreationInputTokens: 11653,
  outputTokens: 5,
  reasoningOutputTokens: 0,
  contextWindow: 200000,
  costUsd: 0.00245174,
  costBasis: "list",
  ...overrides,
});

/** A content-addressed artifact store in memory, which can be told to fail. */
function artifacts(failing = false): ArtifactStore & { stored: Map<string, Uint8Array> } {
  const stored = new Map<string, Uint8Array>();
  const put = async (content: string | Uint8Array) => {
    if (failing) throw new Error("disk full");
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const hex = createHash("sha256").update(bytes).digest("hex");
    const uri = `lervo-cas://sha256/${hex}`;
    const created = !stored.has(uri);
    stored.set(uri, bytes);
    return { uri, contentHash: `sha256:${hex}`, byteCount: bytes.byteLength, created };
  };
  return {
    stored,
    put,
    putStream: async () => {
      throw new Error("unused");
    },
    get: async (uri) => {
      const bytes = stored.get(uri);
      if (bytes === undefined) throw new Error("missing");
      return bytes;
    },
    has: async (uri) => stored.has(uri),
  };
}

const roots: string[] = [];
const stores: SQLiteEventStore[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function storage(writableEventSchemaVersion: 10 | 11, failingArtifacts = false) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-hosted-usage-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: record.projectId }));
  const manifest = await loadProjectManifest(root);
  const events = await SQLiteEventStore.open({
    path: resolveProjectPaths(root).eventDatabase,
    projectId: manifest.projectId,
    writableEventSchemaVersion,
  });
  stores.push(events);
  return { manifest, events, writableEventSchemaVersion, artifacts: artifacts(failingArtifacts) };
}

const usageEvents = (store: Awaited<ReturnType<typeof storage>>) =>
  store.events.list({ types: ["resource.usage.recorded"] });
const at = "2026-11-25T10:01:00.000Z";
const accounting = CLAUDE_HOSTED_USAGE_ACCOUNTING;

describe("a hosted turn's usage", () => {
  it("records one schema-11 resource usage event per result and model, citing a stored descriptor", async () => {
    const store = await storage(11);
    expect(
      await appendTurnUsage(
        store,
        record,
        accounting,
        [turn(), turn({ modelKey: "claude-opus-5-5[1m]", model: "claude-opus-5-5[1m]" })],
        at,
      ),
    ).toEqual({ status: "recorded", recorded: 2, duplicates: 0, dropped: 0 });
    const [first] = usageEvents(store);
    const digest = providerSessionDigest(record.provider, record.sessionId);
    const coordinate = turnUsageCoordinate(digest, turn());
    expect(first?.eventId).toBe(`evt_${coordinate.slice(7, 39)}`);
    expect(first?.schemaVersion).toBe(11);
    const descriptorHash = resourceAccountingDescriptorHash(accounting);
    expect(store.artifacts.stored.has(`lervo-cas://sha256/${descriptorHash.slice(7)}`)).toBe(true);
    expect(first?.payload).toEqual({
      workId: null,
      resourceObservationId: `ruo_${coordinate.slice(7, 31)}`,
      sourceCoordinateDigest: coordinate,
      scope: "primary_provider",
      source: "provider_reported",
      accountingMode: "operation_delta",
      accountingDescriptorHash: descriptorHash,
      modelIdentity: {
        provider: "claude",
        requestedModel: null,
        answerModel: "claude-haiku-5-5",
        observedModelIds: ["claude-haiku-5-5"],
        answerModelEvidence: "response_object",
        unavailableReason: null,
      },
      status: "observed",
      // Input counts both cache kinds, as managed usage does.
      usage: {
        inputTokens: 23499,
        cachedInputTokens: 11844,
        outputTokens: 5,
        reasoningOutputTokens: 0,
        totalTokens: 23504,
        contextWindow: 200000,
      },
      reasonCode: null,
      hostedSession: { providerSessionDigest: digest, provider: "claude" },
      cacheCreationInputTokens: 11653,
      costUsd: 0.00245174,
      costBasis: "list",
    });
    expect(JSON.stringify(first)).not.toContain(turn().turnKey);
  });

  it("says reasoning is unreported, and names no model it cannot name", async () => {
    const store = await storage(11);
    await appendTurnUsage(
      store,
      record,
      accounting,
      [turn({ reasoningOutputTokens: null, modelKey: "weird model", model: null })],
      at,
    );
    expect(usageEvents(store)[0]?.payload).toMatchObject({
      status: "partial",
      reasonCode: "reasoning_unreported",
      usage: { reasoningOutputTokens: 0 },
      modelIdentity: {
        answerModel: null,
        observedModelIds: [],
        answerModelEvidence: "unavailable",
        unavailableReason: "model_name_invalid",
      },
    });
  });

  it("records a replayed result once, and drops a payload the screen refuses", async () => {
    const store = await storage(11);
    await appendTurnUsage(store, record, accounting, [turn()], at);
    expect(
      await appendTurnUsage(
        store,
        record,
        accounting,
        [turn(), turn({ turnKey: "second", reasoningOutputTokens: 9, outputTokens: 5 })],
        "2026-11-25T10:02:00.000Z",
      ),
    ).toEqual({ status: "recorded", recorded: 0, duplicates: 1, dropped: 1 });
    expect(usageEvents(store)).toHaveLength(1);
  });

  it("records nothing below writer schema 11, or when the descriptor cannot be stored", async () => {
    const old = await storage(10);
    expect(await appendTurnUsage(old, record, accounting, [turn()], at)).toEqual({
      status: "inactive",
    });
    const failing = await storage(11, true);
    expect(await appendTurnUsage(failing, record, accounting, [turn()], at)).toEqual({
      status: "descriptor_unavailable",
    });
    expect(usageEvents(failing)).toHaveLength(0);
  });

  it("stops at a store failure that is not a refusal, so the batch can be retried", async () => {
    const store = await storage(11);
    const busy = Object.create(store.events) as typeof store.events;
    let appends = 0;
    busy.append = ((draft: Parameters<typeof store.events.append>[0]) => {
      appends += 1;
      if (appends === 2)
        throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
      return store.events.append(draft);
    }) as typeof store.events.append;
    const batch = [turn(), turn({ turnKey: "second" }), turn({ turnKey: "third" })];
    expect(
      await appendTurnUsage({ ...store, events: busy }, record, accounting, batch, at),
    ).toEqual({ status: "storage_failed", recorded: 1, duplicates: 0, dropped: 0 });
    // The retry records the rest and finds the first already recorded.
    expect(await appendTurnUsage(store, record, accounting, batch, at)).toEqual({
      status: "recorded",
      recorded: 2,
      duplicates: 1,
      dropped: 0,
    });
    expect(usageEvents(store)).toHaveLength(3);
  });
});
