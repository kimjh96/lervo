import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  appendRepositoryChange,
  planRepositoryChangeInRepository,
  processRepositoryKnowledgeJobs,
  REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
} from "@lervo/repository-knowledge";

import { createChangeReviewHost } from "../src/change-review-host.js";
import { convergenceDelegationPlanHash, type ConvergenceDelegation } from "../src/delegation.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const changeEventId = "evt_0123456789abcdef0123456789abcdef";

async function queueChange(f: Awaited<ReturnType<typeof fixture>>, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(resolve(f.root, path, ".."), { recursive: true });
    await writeFile(resolve(f.root, path), content);
  }
  const planned = (await planRepositoryChangeInRepository({
    repositoryRoot: f.root,
    projectId: f.storage.manifest.projectId,
    sourceKind: "terminal_turn",
    sourceEventId: "evt_fedcba9876543210fedcba9876543210",
    before: { revision: digest("before"), files: {} },
    after: {
      revision: digest("after"),
      files: Object.fromEntries(
        Object.entries(files).map(([path, bytes]) => [path, digest(bytes)]),
      ),
    },
    occurredAt: new Date().toISOString(),
  }))!;
  await f.storage.artifacts.put(planned.manifestContent);
  f.events.transact((transaction) =>
    appendRepositoryChange(
      transaction,
      {
        eventId: changeEventId,
        projectId: f.storage.manifest.projectId,
        runId: "run_0123456789abcdef0123456789abcdef",
        sessionId: "ses_0123456789abcdef0123456789abcdef",
        occurredAt: new Date().toISOString(),
        actor: { kind: "system" },
        policyVersion: digest("policy"),
      },
      planned,
      { admitted: true },
    ),
  );
}

function reviewHost(f: Awaited<ReturnType<typeof fixture>>, lifecycleCurrent = true) {
  const host = createChangeReviewHost({
    storage: f.storage,
    provider: "claude",
    executable: f.executable,
    admissionDirectory: f.admissionDirectory,
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
  });
  // The knowledge lifecycle is a separate owner; these cases exercise the reviewer alone.
  return lifecycleCurrent
    ? { ...host, inspectKnowledge: async () => ({ current: true, snapshotHash: digest("s") }) }
    : host;
}

const of = (f: Awaited<ReturnType<typeof fixture>>, type: string) =>
  f.events.list({ limit: 1_000 }).filter((event) => event.type === type);

async function reviewCalls(f: Awaited<ReturnType<typeof fixture>>) {
  try {
    return (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { request: { task: string } })
      .filter((call) => call.request.task === "repository_change_knowledge_review");
  } catch {
    return [];
  }
}

async function limitProviderCalls(f: Awaited<ReturnType<typeof fixture>>, calls: number) {
  const { review: _review, ...plan } = f.delegation!;
  const limited = {
    ...plan,
    resourceCeilings: { ...plan.resourceCeilings, maximumProviderCalls: calls },
  };
  const delegation: ConvergenceDelegation = {
    ...limited,
    review: { ...f.delegation!.review, planHash: convergenceDelegationPlanHash(limited) },
  };
  await writeFile(
    resolve(f.root, ".lervo/knowledge/convergence-delegation.json"),
    JSON.stringify(delegation),
  );
}

it(
  "settles a clean change to current through the governed provider review and records usage",
  { timeout: 120_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    await queueChange(f, { "src/clean.ts": "export const clean = 1;\n" });
    const [outcome] = await processRepositoryKnowledgeJobs({
      repositoryRoot: f.root,
      events: f.events,
      artifacts: f.artifacts,
      workerId: "worker",
      host: reviewHost(f),
    });
    expect(outcome).toMatchObject({ changeEventId, terminalState: "current", failureCode: null });
    expect(await reviewCalls(f)).toHaveLength(1);
    // ADR-0536: the provider CLI admission probe records its own usage before the review call.
    const usage = of(f, "resource.usage.recorded").find(
      (event) => (event.payload as { stage?: unknown }).stage === "repository_change_review",
    );
    expect(usage?.payload).toMatchObject({
      status: "observed",
      source: "provider_reported",
      channel: "knowledge_worker",
      turnEventId: changeEventId,
      stage: "repository_change_review",
      usage: { inputTokens: expect.any(Number), totalTokens: expect.any(Number) },
    });
    expect(of(f, "repository.knowledge.resolved")[0]?.payload).toMatchObject({
      terminalState: "current",
      classification: "implementation_only",
    });
  },
);

it(
  "fails closed with attention when the review budget or authority is exhausted",
  { timeout: 120_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    await limitProviderCalls(f, 1);
    // Seventy paths need two sub-jobs; the delegation admits one call for the job.
    await queueChange(
      f,
      Object.fromEntries(
        Array.from({ length: 70 }, (_, index) => [
          `src/f${index}.ts`,
          `export const f = ${index};\n`,
        ]),
      ),
    );
    const [outcome] = await processRepositoryKnowledgeJobs({
      repositoryRoot: f.root,
      events: f.events,
      artifacts: f.artifacts,
      workerId: "worker",
      host: reviewHost(f),
    });
    expect(outcome).toMatchObject({
      terminalState: "attention_required",
      failureCode: "knowledge_review_budget_exhausted",
    });
    expect(of(f, "repository.knowledge.resolved")[0]?.payload).toMatchObject({
      subJobIndex: 1,
      subJobCount: 2,
    });
    expect(await reviewCalls(f)).toHaveLength(1);
    expect(f.events.outstandingCount(REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION)).toBe(0);

    const unauthorized = await fixture(false);
    fixtures.push(unauthorized);
    await queueChange(unauthorized, { "src/clean.ts": "export const clean = 1;\n" });
    const [denied] = await processRepositoryKnowledgeJobs({
      repositoryRoot: unauthorized.root,
      events: unauthorized.events,
      artifacts: unauthorized.artifacts,
      workerId: "worker",
      host: reviewHost(unauthorized),
    });
    expect(denied).toMatchObject({
      terminalState: "attention_required",
      failureCode: "knowledge_authority_unavailable",
    });
    expect(await reviewCalls(unauthorized)).toHaveLength(0);
  },
);

it(
  "re-queues a placeholder-reviewed job once and reviews it with the real v4 reviewer",
  { timeout: 120_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    await queueChange(f, { "src/clean.ts": "export const clean = 1;\n" });
    // The pre-ADR-0457 v4 worker settled every change job through its placeholder reviewer.
    f.events.transact((transaction) => {
      const [delivery] = transaction.claim({
        workerId: "placeholder",
        claimedAt: new Date().toISOString(),
        leaseDurationMs: 60_000,
        destinationId: REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
        limit: 1,
      });
      transaction.append({
        eventId: "evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        projectId: f.storage.manifest.projectId,
        runId: delivery!.event.runId,
        sessionId: delivery!.event.sessionId,
        occurredAt: new Date().toISOString(),
        actor: { kind: "system" },
        schemaVersion: 3,
        policyVersion: digest("policy"),
        type: "repository.knowledge.resolved",
        payload: {
          changeEventId,
          changeEventHash: delivery!.event.eventHash,
          sourceKind: "terminal_turn",
          terminalState: "attention_required",
          classification: "needs_review",
          attemptCount: 1,
          failureCode: "review_needs_attention",
          knowledgeSnapshotHash: null,
          canonicalizationCandidateId: null,
          resolvedAt: new Date().toISOString(),
        },
      });
      transaction.acknowledge({
        eventId: changeEventId,
        destinationId: REPOSITORY_KNOWLEDGE_OUTBOX_DESTINATION,
        workerId: "placeholder",
        acknowledgedAt: new Date().toISOString(),
      });
    });
    const run = () =>
      runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: "fixture",
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        maximumStages: 1,
        liveWorkPending: async () => false,
      });
    const first = await run();
    expect(first).toMatchObject({ status: "processed" });
    const outcomes = first.status === "processed" ? first.outcomes : [];
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.failureCode).not.toBe("review_needs_attention");
    expect(await reviewCalls(f)).toHaveLength(1);
    const [, successor] = of(f, "repository.knowledge.resolved");
    expect(successor?.payload).toMatchObject({
      changeEventId,
      supersedesResolutionEventId: expect.stringMatching(/^evt_/u),
      subJobCount: 1,
    });
    expect(
      of(f, "resource.usage.recorded").some(
        (event) => event.payload.channel === "knowledge_worker",
      ),
    ).toBe(true);
    const second = await run();
    expect(second.status === "processed" ? second.outcomes : null).toEqual([]);
    expect(of(f, "repository.knowledge.resolved")).toHaveLength(2);
  },
);
