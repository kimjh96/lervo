import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  ClaudeAdapter,
  type ClaudeAgentClient,
  type ClaudeToolUseHandler,
} from "@lervo/adapter-claude";
import {
  CodexAdapter,
  type CodexAppServerClient,
  type CodexThreadStartOptions,
} from "@lervo/adapter-codex";
import {
  managedLinkedEvidenceDeterministicSelectionPolicy,
  projectManagedLinkedEvidenceCanary,
} from "@lervo/context";
import { applyInitPlan, createInitPlan, serializeYaml } from "@lervo/project";
import {
  createSearchAttempt,
  createSearchRecommendationBatch,
  LexicalSearchIndex,
} from "@lervo/search";
import { LocalManagedLinkedEvidenceCanaryStore } from "@lervo/search-local";
import type { DocumentManifest } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  executeManagedLinkedEvidenceCanary,
  recordManagedLinkedEvidenceCanaryCompletion,
  type ManagedLinkedEvidenceCanaryAuthorization,
} from "../src/managed-linked-evidence-canary.js";
import { managedLinkedEvidenceCanonicalDigest } from "../src/managed-linked-evidence-canary-contract.js";
import { resolveDeterministicManagedLinkedEvidenceSelection } from "../src/managed-linked-evidence-deterministic-selection.js";

const roots: string[] = [];
const projectId = "prj_canary_fixture";
const runId = "run_canary_fixture";
const providerSessionId = "11111111-1111-4111-8111-111111111111";
const providerTurnId = "22222222-2222-4222-8222-222222222222";

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

class Queue {
  private readonly values: unknown[] = [];
  private wake: (() => void) | undefined;

  push(...values: unknown[]) {
    this.values.push(...values);
    this.wake?.();
    this.wake = undefined;
  }

  async *iterate(signal: AbortSignal): AsyncIterable<unknown> {
    let index = 0;
    while (!signal.aborted) {
      if (index < this.values.length) {
        yield structuredClone(this.values[index++]);
        continue;
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  }
}

class SelectionCodexClient implements CodexAppServerClient {
  readonly queue = new Queue();
  readonly schemas: Array<Record<string, unknown> | undefined> = [];
  turns = 0;
  invalidSelection = false;

  async startThread(_options: CodexThreadStartOptions) {
    this.queue.push({ method: "thread/started", params: { thread: { id: "codex-canary" } } });
    return { threadId: "codex-canary" };
  }

  async injectItems() {}

  async startTurn(
    threadId: string,
    _instructions: string,
    options?: { outputSchema?: Record<string, unknown> },
  ) {
    this.turns += 1;
    this.schemas.push(options?.outputSchema);
    const token = (
      (
        (options?.outputSchema?.properties as Record<string, unknown>).evidenceTokens as Record<
          string,
          unknown
        >
      ).items as { enum: string[] }
    ).enum[0]!;
    this.queue.push(
      { method: "turn/started", params: { threadId, turn: { id: "codex-canary-turn" } } },
      {
        method: "thread/tokenUsage/updated",
        params: {
          threadId,
          turnId: "codex-canary-turn",
          tokenUsage: {
            total: {
              inputTokens: 10,
              cachedInputTokens: 2,
              outputTokens: 2,
              reasoningOutputTokens: 0,
              totalTokens: 12,
            },
            modelContextWindow: 100,
          },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          turnId: "codex-canary-turn",
          item: {
            type: "agentMessage",
            id: "codex-canary-result",
            text: JSON.stringify({
              evidenceTokens: [
                this.invalidSelection
                  ? `lervo-e4:doc_unknown_0001:sha256:${"0".repeat(64)}`
                  : token,
              ],
            }),
          },
        },
      },
      {
        method: "turn/completed",
        params: { threadId, turn: { id: "codex-canary-turn", status: "completed" } },
      },
    );
    return { turnId: "codex-canary-turn" };
  }

  async respondFileChangeApproval() {}
  async interruptTurn() {}
  async unsubscribe() {}
  notifications(signal: AbortSignal) {
    return this.queue.iterate(signal);
  }
  async close() {}
}

class SelectionClaudeClient implements ClaudeAgentClient {
  readonly queue = new Queue();
  turns = 0;
  token = "";

  attachToolUseHandler(_handler: ClaudeToolUseHandler) {}

  async appendContext() {
    this.queue.push({
      type: "system",
      subtype: "init",
      session_id: providerSessionId,
      uuid: "33333333-3333-4333-8333-333333333333",
    });
  }

  async startTurn(turnId: string) {
    this.turns += 1;
    this.queue.push({
      type: "result",
      subtype: "success",
      is_error: false,
      user_message_uuid: turnId,
      uuid: "44444444-4444-4444-8444-444444444444",
      session_id: providerSessionId,
      duration_ms: 1,
      result: "ignored structured result",
      structured_output: { evidenceTokens: [this.token] },
      modelUsage: {
        "claude-fixture": {
          inputTokens: 7,
          outputTokens: 2,
          cacheReadInputTokens: 3,
          cacheCreationInputTokens: 0,
          contextWindow: 100,
        },
      },
    });
  }

  async interrupt() {}
  messages(signal: AbortSignal) {
    return this.queue.iterate(signal);
  }
  async close() {}
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-canary-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({ root, projectId, now: new Date("2026-08-29T00:00:00Z") }),
  );
  await mkdir(resolve(root, "docs"), { recursive: true });
  await mkdir(resolve(root, ".lervo/documents"), { recursive: true });
  const current = "# Current\n\nUse [the exact boundary](linked.md).\n";
  const linked = "# Exact boundary\n\nThe managed canary remains default-off.\n";
  const records = [
    ["doc_canary_current", "docs/current.md", current],
    ["doc_canary_linked", "docs/linked.md", linked],
  ] as const;
  for (const [documentId, path, content] of records) {
    const manifest: DocumentManifest = {
      schemaVersion: 1,
      documentId,
      record: {
        path,
        kind: "canonical",
        responsibleParty: { kind: "team", id: "platform" },
        connectedPaths: ["unrelated/**"],
        verifiedRevision: "fixture-v1",
        verifiedAt: "2026-08-29T00:00:00Z",
        reviewIntervalDays: 30,
        ownership: { mode: "user" },
      },
      contentPolicy: {
        mode: "user_managed",
        mediaType: "text/markdown; charset=utf-8",
        profileId: "canary/fixture",
        locale: "en",
        audience: "human",
        metadataPlacement: "sidecar",
        historyMode: "separate_documents",
        splitStrategy: "topic_documents",
        automaticWrites: false,
        splitRecommendedAtBytes: 32_768,
        oversizeReviewAtBytes: 65_536,
        overflowAction: "report_split_recommended",
      },
      relations: { supersedesDocumentIds: [], relatedDocumentIds: [] },
    };
    await writeFile(resolve(root, path), content);
    await writeFile(resolve(root, `.lervo/documents/${documentId}.yaml`), serializeYaml(manifest));
  }
  const response = new LexicalSearchIndex([
    {
      kind: "document",
      sourceId: records[0][0],
      path: records[0][1],
      contentHash: hash(current),
      labels: [],
      text: current,
    },
  ]).search("current exact boundary");
  const operationalBatch = createSearchRecommendationBatch({
    attempt: createSearchAttempt({
      projectId,
      observedAt: new Date("2026-08-29T00:00:00Z"),
      nonce: "a".repeat(32),
      response,
    }),
    recommendationLimit: 1,
    maximumSelections: 1,
  });
  const corpus = records.map(([documentId, path, text]) => ({
    documentId,
    path,
    text,
    contentHash: hash(text),
  }));
  const projection = projectManagedLinkedEvidenceCanary({
    corpus,
    recommendations: [corpus[0]!],
    existingPaths: [records[0][1]],
  });
  return { root, operationalBatch, projection };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed linked-evidence provider selection", () => {
  it("resolves every exact current candidate without creating a selection adapter", async () => {
    const provider = "codex" as const;
    const value = await fixture();
    const selectedVersions = value.projection.candidates.map(({ documentId, contentHash }) => ({
      documentId,
      contentHash,
    }));
    const authorization: ManagedLinkedEvidenceCanaryAuthorization = {
      schemaVersion: 1,
      enabled: true,
      policyId: "linked-evidence-managed-canary-v1",
      canaryId: "canary_fixture_01",
      projectId,
      runId,
      provider,
      sourceSnapshotId: value.projection.sourceSnapshotId,
      recommendationBatchId: value.operationalBatch.batchId,
      selectionAttemptId: `lsel_${"2".repeat(24)}`,
      maximumProviderCalls: 0,
      managedContextEffectsAuthorized: true,
      deterministicSelection: {
        kind: managedLinkedEvidenceDeterministicSelectionPolicy.kind,
        policyId: managedLinkedEvidenceDeterministicSelectionPolicy.policyId,
        policyDigest: managedLinkedEvidenceDeterministicSelectionPolicy.digest,
        sourceProjectionDigest: value.projection.projectionDigest,
        projectedSelectionDigest: managedLinkedEvidenceCanonicalDigest(selectedVersions),
        projectedSelectionCount: selectedVersions.length,
      },
    };
    const outcome = await resolveDeterministicManagedLinkedEvidenceSelection({
      repositoryRoot: value.root,
      projectId,
      runId,
      provider,
      authorization,
      operationalBatch: value.operationalBatch,
      recommendationBatches: [value.operationalBatch],
      graphRecommendations: [],
    });

    expect(outcome.selections).toEqual([
      expect.objectContaining({ documentId: "doc_canary_linked", rank: 1 }),
    ]);
    expect(outcome).toMatchObject({
      adapterReceiptId: null,
      usage: null,
      durationMs: 0,
      selectionProviderVisibleBytes: 0,
      selectionPolicy: {
        kind: "deterministic_policy",
        policyId: managedLinkedEvidenceDeterministicSelectionPolicy.policyId,
      },
    });
    const selection = outcome.selections[0]!;
    const recordedAt = "2026-08-29T00:00:02.000Z";
    await recordManagedLinkedEvidenceCanaryCompletion({
      repositoryRoot: value.root,
      outcome,
      evidence: [
        {
          receiptId: "receipt_selected_01",
          projectId,
          runId,
          sessionId: "session_task_01",
          documentId: selection.documentId,
          state: "selected",
          recordedAt,
          required: true,
          scope: { kind: "full" },
          policyVersion: hash("policy"),
          reasonCode: "explicit_link",
          ruleId: `linked_evidence_canary:${selection.selectionAttemptId}`,
        },
        {
          receiptId: "receipt_loaded_01",
          projectId,
          runId,
          sessionId: "session_task_01",
          documentId: selection.documentId,
          state: "loaded",
          recordedAt,
          scope: { kind: "full" },
          contentHash: selection.contentHash,
          byteCount: outcome.selectedBytes,
          sourceRevision: "fixture-v1",
        },
        {
          receiptId: "receipt_injected_01",
          projectId,
          runId,
          sessionId: "session_task_01",
          documentId: selection.documentId,
          state: "injected",
          recordedAt,
          scope: { kind: "full" },
          contentHash: selection.contentHash,
          provider,
          providerSessionId,
          adapterId: "codex.app-server",
          adapterReceiptId: "receipt_delivery_01",
          envelopeId: "envelope_task_01",
          targetTurnId: "turn_task_01",
          contextGeneration: 0,
          controlledInput: true,
        },
      ],
      recordedAt: new Date(recordedAt),
    });
    expect(await (await LocalManagedLinkedEvidenceCanaryStore.open(value.root)).list()).toEqual([
      expect.objectContaining({
        schemaVersion: 2,
        adapterReceiptId: null,
        selectionProviderVisibleBytes: 0,
        usage: null,
        status: "completed",
        selectionPolicy: expect.objectContaining({ kind: "deterministic_policy" }),
      }),
    ]);
  });

  it("uses exactly one no-tool Claude adapter turn with the structured contract", async () => {
    const provider = "claude" as const;
    const value = await fixture();
    const authorization: ManagedLinkedEvidenceCanaryAuthorization = {
      schemaVersion: 1,
      enabled: true,
      policyId: "linked-evidence-managed-canary-v1",
      canaryId: "canary_fixture_01",
      projectId,
      runId,
      provider,
      sourceSnapshotId: value.projection.sourceSnapshotId,
      recommendationBatchId: value.operationalBatch.batchId,
      selectionAttemptId: `lsel_${"2".repeat(24)}`,
      maximumProviderCalls: 1,
      managedContextEffectsAuthorized: true,
    };
    const claude = new SelectionClaudeClient();
    claude.token = value.projection.candidates[0]!.token;
    const outcome = await executeManagedLinkedEvidenceCanary({
      repositoryRoot: value.root,
      projectId,
      runId,
      provider,
      request: "Determine the exact current boundary",
      authorization,
      operationalBatch: value.operationalBatch,
      recommendationBatches: [value.operationalBatch],
      graphRecommendations: [],
      resolveArtifact: async () => new Uint8Array(),
      createAdapter: ({ selectionBoundary, structuredOutputSchema }) => {
        expect(selectionBoundary).toBe("read_only_no_tools");
        return new ClaudeAdapter({
          repositoryRoot: value.root,
          permissionMode: "plan",
          tools: [],
          ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
          clientFactory: async () => claude,
          createProviderSessionId: () => providerSessionId,
          createProviderMessageId: () => providerTurnId,
          now: () => new Date("2026-08-29T00:00:01Z"),
        });
      },
      now: () => new Date("2026-08-29T00:00:01Z"),
      timeoutMs: 1_000,
    });

    expect(outcome.selections).toEqual([
      expect.objectContaining({ documentId: "doc_canary_linked", rank: 1 }),
    ]);
    expect(claude.turns).toBe(1);
    const selection = outcome.selections[0]!;
    const recordedAt = "2026-08-29T00:00:02.000Z";
    await recordManagedLinkedEvidenceCanaryCompletion({
      repositoryRoot: value.root,
      outcome,
      evidence: [
        {
          receiptId: "receipt_selected_01",
          projectId,
          runId,
          sessionId: "session_task_01",
          documentId: selection.documentId,
          state: "selected",
          recordedAt,
          required: true,
          scope: { kind: "full" },
          policyVersion: hash("policy"),
          reasonCode: "explicit_link",
          ruleId: `linked_evidence_canary:${selection.selectionAttemptId}`,
        },
        {
          receiptId: "receipt_loaded_01",
          projectId,
          runId,
          sessionId: "session_task_01",
          documentId: selection.documentId,
          state: "loaded",
          recordedAt,
          scope: { kind: "full" },
          contentHash: selection.contentHash,
          byteCount: outcome.selectedBytes,
          sourceRevision: "fixture-v1",
        },
        {
          receiptId: "receipt_injected_01",
          projectId,
          runId,
          sessionId: "session_task_01",
          documentId: selection.documentId,
          state: "injected",
          recordedAt,
          scope: { kind: "full" },
          contentHash: selection.contentHash,
          provider,
          providerSessionId,
          adapterId: "claude.agent-sdk",
          adapterReceiptId: "receipt_delivery_01",
          envelopeId: "envelope_task_01",
          targetTurnId: "turn_task_01",
          contextGeneration: 0,
          controlledInput: true,
        },
      ],
      recordedAt: new Date(recordedAt),
    });
    expect(await (await LocalManagedLinkedEvidenceCanaryStore.open(value.root)).list()).toEqual([
      expect.objectContaining({
        providerArm: provider,
        selectedCount: 1,
        loadedCount: 1,
        injectedCount: 1,
        referencedCount: 0,
        status: "completed",
      }),
    ]);
  });

  it("uses exactly one Codex Responses turn with tool choice none", async () => {
    const value = await fixture();
    const candidate = value.projection.candidates[0]!;
    const requests: Array<Record<string, unknown>> = [];
    const responseFetch: typeof fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          id: "resp_fixture_01",
          model: "codex-observed-fixture",
          status: "completed",
          output: [
            {
              type: "message",
              id: "msg_fixture_01",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ evidenceTokens: [candidate.token] }),
                },
              ],
            },
          ],
          usage: {
            input_tokens: 120,
            input_tokens_details: { cached_tokens: 20 },
            output_tokens: 12,
            output_tokens_details: { reasoning_tokens: 4 },
            total_tokens: 132,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const outcome = await executeManagedLinkedEvidenceCanary({
      repositoryRoot: value.root,
      projectId,
      runId,
      provider: "codex",
      request: "Determine the exact current boundary",
      authorization: {
        schemaVersion: 1,
        enabled: true,
        policyId: "linked-evidence-managed-canary-v1",
        canaryId: "canary_codex_responses_01",
        projectId,
        runId,
        provider: "codex",
        sourceSnapshotId: value.projection.sourceSnapshotId,
        recommendationBatchId: value.operationalBatch.batchId,
        selectionAttemptId: `lsel_${"5".repeat(24)}`,
        maximumProviderCalls: 1,
        managedContextEffectsAuthorized: true,
      },
      operationalBatch: value.operationalBatch,
      recommendationBatches: [value.operationalBatch],
      graphRecommendations: [],
      resolveArtifact: async () => new Uint8Array(),
      createAdapter: ({ selectionBoundary, structuredOutputSchema }) => {
        expect(selectionBoundary).toBe("read_only_no_tools");
        return new CodexAdapter({
          repositoryRoot: value.root,
          sandbox: "read-only",
          approvalPolicy: "never",
          transport: {
            kind: "responses_api_no_tools",
            apiKey: "fixture-key",
            model: "codex-fixture",
            fetch: responseFetch,
          },
          ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
          now: () => new Date("2026-08-29T00:00:01Z"),
        });
      },
      now: () => new Date("2026-08-29T00:00:01Z"),
      timeoutMs: 1_000,
    });

    expect(outcome.selections).toEqual([
      expect.objectContaining({ documentId: candidate.documentId, rank: 1 }),
    ]);
    expect(outcome.usage).toEqual({
      inputTokens: 120,
      cachedInputTokens: 20,
      outputTokens: 12,
      reasoningOutputTokens: 4,
      totalTokens: 132,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: "codex-fixture",
      tools: [],
      tool_choice: "none",
      store: false,
      max_output_tokens: 512,
      text: {
        format: {
          type: "json_schema",
          name: "lervo_managed_selection",
          strict: true,
        },
      },
    });
  });

  it("stops a Codex app-server session before its selection turn", async () => {
    const value = await fixture();
    const client = new SelectionCodexClient();
    await expect(
      executeManagedLinkedEvidenceCanary({
        repositoryRoot: value.root,
        projectId,
        runId,
        provider: "codex",
        request: "Determine the exact current boundary",
        authorization: {
          schemaVersion: 1,
          enabled: true,
          policyId: "linked-evidence-managed-canary-v1",
          canaryId: "canary_codex_boundary_01",
          projectId,
          runId,
          provider: "codex",
          sourceSnapshotId: value.projection.sourceSnapshotId,
          recommendationBatchId: value.operationalBatch.batchId,
          selectionAttemptId: `lsel_${"1".repeat(24)}`,
          maximumProviderCalls: 1,
          managedContextEffectsAuthorized: true,
        },
        operationalBatch: value.operationalBatch,
        recommendationBatches: [value.operationalBatch],
        graphRecommendations: [],
        resolveArtifact: async () => new Uint8Array(),
        createAdapter: ({ selectionBoundary, structuredOutputSchema }) => {
          expect(selectionBoundary).toBe("read_only_no_tools");
          return new CodexAdapter({
            repositoryRoot: value.root,
            sandbox: "read-only",
            approvalPolicy: "never",
            ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
            clientFactory: async () => client,
            now: () => new Date("2026-08-29T00:00:01Z"),
          });
        },
        now: () => new Date("2026-08-29T00:00:01Z"),
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "canary_selection_unavailable" });
    expect(client.turns).toBe(0);
    expect(await (await LocalManagedLinkedEvidenceCanaryStore.open(value.root)).list()).toEqual([
      expect.objectContaining({
        providerArm: "codex",
        status: "failed",
        failureCode: "canary_selection_unavailable",
        selectedCount: 0,
        usage: null,
      }),
    ]);
  });

  it("rejects an ineligible run before creating an adapter", async () => {
    const value = await fixture();
    let adapterCreations = 0;
    await expect(
      executeManagedLinkedEvidenceCanary({
        repositoryRoot: value.root,
        projectId,
        runId,
        provider: "codex",
        request: "Determine the exact current boundary",
        authorization: {
          schemaVersion: 1,
          enabled: true,
          policyId: "linked-evidence-managed-canary-v1",
          canaryId: "canary_fixture_01",
          projectId,
          runId: "run_other_fixture",
          provider: "codex",
          sourceSnapshotId: value.projection.sourceSnapshotId,
          recommendationBatchId: value.operationalBatch.batchId,
          selectionAttemptId: `lsel_${"3".repeat(24)}`,
          maximumProviderCalls: 1,
          managedContextEffectsAuthorized: true,
        },
        operationalBatch: value.operationalBatch,
        recommendationBatches: [value.operationalBatch],
        graphRecommendations: [],
        resolveArtifact: async () => new Uint8Array(),
        createAdapter: () => {
          adapterCreations += 1;
          throw new Error("must not create adapter");
        },
        now: () => new Date("2026-08-29T00:00:01Z"),
      }),
    ).rejects.toMatchObject({ code: "canary_not_eligible" });
    expect(adapterCreations).toBe(0);
  });

  it("records one invalid selection failure without retry", async () => {
    const value = await fixture();
    const client = new SelectionClaudeClient();
    client.token = `lervo-e4:doc_unknown_0001:sha256:${"0".repeat(64)}`;
    await expect(
      executeManagedLinkedEvidenceCanary({
        repositoryRoot: value.root,
        projectId,
        runId,
        provider: "claude",
        request: "Determine the exact current boundary",
        authorization: {
          schemaVersion: 1,
          enabled: true,
          policyId: "linked-evidence-managed-canary-v1",
          canaryId: "canary_failure_01",
          projectId,
          runId,
          provider: "claude",
          sourceSnapshotId: value.projection.sourceSnapshotId,
          recommendationBatchId: value.operationalBatch.batchId,
          selectionAttemptId: `lsel_${"4".repeat(24)}`,
          maximumProviderCalls: 1,
          managedContextEffectsAuthorized: true,
        },
        operationalBatch: value.operationalBatch,
        recommendationBatches: [value.operationalBatch],
        graphRecommendations: [],
        resolveArtifact: async () => new Uint8Array(),
        createAdapter: ({ structuredOutputSchema }) =>
          new ClaudeAdapter({
            repositoryRoot: value.root,
            permissionMode: "plan",
            tools: [],
            ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
            clientFactory: async () => client,
            createProviderSessionId: () => providerSessionId,
            createProviderMessageId: () => providerTurnId,
            now: () => new Date("2026-08-29T00:00:01Z"),
          }),
        now: () => new Date("2026-08-29T00:00:01Z"),
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "canary_selection_invalid" });
    expect(client.turns).toBe(1);
    expect(await (await LocalManagedLinkedEvidenceCanaryStore.open(value.root)).list()).toEqual([
      expect.objectContaining({
        status: "failed",
        failureCode: "canary_selection_invalid",
        selectedCount: 0,
      }),
    ]);
  });
});
