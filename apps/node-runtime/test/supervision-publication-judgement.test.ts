import type {
  OperatingActionPlanV1,
  SupervisedResultDeliveryV2,
} from "@lervo/application-contract";
import { FileSystemCas } from "@lervo/cas";
import type { ConversationReplyCandidate } from "@lervo/interaction";
import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";
import { managedExecutionIdentity } from "@lervo/work-controller";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resultWritingContract } from "../src/conversation-result-publication.js";
import { assertNativePublicationJudgement } from "../src/supervision-publication-judgement.js";

// This suite isolates what the publication permit must prove about the exact model result, so the
// owner-reasoning receipt lookup is replaced. It therefore does not prove that the receipt is read
// for the reasoning plan rather than another plan; the publication_retry scenario in
// supervision-native-completion.test.ts covers that binding with real recorded evidence.
const receipt = vi.hoisted(() => ({ status: "confirmed" }));
vi.mock("../src/supervision-reasoning-receipt.js", () => ({
  inspectOwnerReasoning: async () => ({ status: receipt.status }),
}));

const roots: string[] = [];
beforeEach(() => {
  receipt.status = "confirmed";
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const authority = {
  projectId: `prj_${"7".repeat(16)}`,
  workstreamId: `wks_${"8".repeat(24)}`,
  supervisionId: "supervision.native-publication",
  ownerAgentId: `agt_${"a".repeat(24)}`,
  mandateHash: hash("b"),
};
const text = "The saved value was updated and verified.";
const completionEventId = `evt_${"c".repeat(32)}`;
const semanticChecks = resultWritingContract.verification.semanticChecks
  .filter((check) => check.required)
  .map((check) => ({ checkId: check.checkId, status: "passed" as const, violationCount: 0 }));

interface Variation {
  plan?: Record<string, unknown>;
  decision?: Record<string, unknown>;
  details?: Record<string, unknown>;
  trigger?: Record<string, unknown>;
  acceptedGoal?: Record<string, unknown>;
  resultWritingContract?: unknown;
  evaluation?: Record<string, unknown>;
  effect?: (effect: SupervisedResultDeliveryV2) => Partial<SupervisedResultDeliveryV2>;
  terminal?: boolean;
}

async function judgement(variation: Variation = {}) {
  const root = await mkdtemp(join(tmpdir(), "lervo-publication-judgement-"));
  roots.push(root);
  const artifacts = await FileSystemCas.open(root);
  const put = async (value: unknown) =>
    (await artifacts.put(typeof value === "string" ? value : JSON.stringify(value))).contentHash;
  const resultArtifactHash = await put(text);
  const completionPlanHash = hash("d");
  const context = {
    trigger: { nextAction: "publish_result", ...variation.trigger },
    facts: {
      acceptedGoal: {
        completionPlanHash,
        completionEventId,
        resultArtifactHash,
        text,
        ...variation.acceptedGoal,
      },
      resultWritingContract: variation.resultWritingContract ?? resultWritingContract,
    },
  };
  const effectHash = await put({ contextArtifactHash: await put(context) });
  const reasoningPlanHash = await put({
    ...authority,
    effectContract: "work.owner_reasoning.v1",
    effectHash,
    ...variation.plan,
  });
  const reasoningResultHash = await put({
    schemaVersion: 1,
    operation: "prepare_publication",
    rationale: "The accepted result is ready for its origin conversation.",
    details: JSON.stringify({
      resultContentHash: resultArtifactHash,
      writingPolicyId: resultWritingContract.writingPolicyId,
      checks: semanticChecks,
      ...variation.details,
    }),
    ...variation.decision,
  });
  const runId = managedExecutionIdentity(authority.projectId, reasoningPlanHash).runId;
  const recorded = (variation.terminal === false
    ? []
    : [
        { seq: 1, runId, type: "run.completed", payload: { resultDigest: reasoningResultHash } },
      ]) as unknown as EventEnvelope[];
  const events = {
    list: ({
      runId: id,
      afterSeq = 0,
      limit,
    }: {
      runId: string;
      afterSeq?: number;
      limit: number;
    }) => recorded.filter((event) => event.runId === id && event.seq > afterSeq).slice(0, limit),
  } as unknown as EventStore;
  const exact = {
    reasoningPlanHash,
    reasoningResultHash,
    resultArtifactHash,
    completionPlanHash,
    completionEventId,
  } as SupervisedResultDeliveryV2;
  const candidate = {
    publicationEvidence: {
      evaluation: {
        checks: [
          { kind: "deterministic", checkId: "length", status: "passed", violationCount: 0 },
          ...semanticChecks.map((check) => ({ kind: "semantic", ...check })),
        ],
        evaluators: [
          { kind: "deterministic", evaluatorId: "lervo.writing" },
          { kind: "model", evaluatorId: `lervo.native-owner.${reasoningResultHash.slice(7, 31)}` },
        ],
        ...variation.evaluation,
      },
    },
  } as unknown as ConversationReplyCandidate;
  return assertNativePublicationJudgement({
    events,
    artifacts,
    effect: { ...exact, ...variation.effect?.(exact) },
    completionPlan: authority as unknown as OperatingActionPlanV1,
    candidate,
  });
}

it("accepts a permit backed by the exact settled native publication verdict", async () => {
  await expect(judgement()).resolves.toBeUndefined();
});

it.each([
  { effectContract: "work.managed_execution.v1" },
  { projectId: `prj_${"6".repeat(16)}` },
  { workstreamId: `wks_${"5".repeat(24)}` },
  { supervisionId: "supervision.other" },
  { ownerAgentId: `agt_${"4".repeat(24)}` },
  { mandateHash: hash("3") },
])("rejects a reasoning plan outside the completion authority %j", async (plan) => {
  await expect(judgement({ plan })).rejects.toThrow(/settled independent owner judgement/u);
});

it("rejects owner reasoning whose receipt is not settled", async () => {
  receipt.status = "uncertain";
  await expect(judgement()).rejects.toThrow(/settled independent owner judgement/u);
});

it.each([
  {
    name: "the accepted result",
    variation: { effect: (effect) => ({ reasoningResultHash: effect.resultArtifactHash }) },
  },
  { name: "an unrecorded run", variation: { terminal: false } },
] satisfies { name: string; variation: Variation }[])(
  "rejects a permit that substitutes $name for the model result",
  async ({ variation }) => {
    await expect(judgement(variation)).rejects.toThrow(/substituted its semantic model result/u);
  },
);

it.each([
  { name: "another operation", variation: { decision: { operation: "complete_workstream" } } },
  { name: "an extra detail", variation: { details: { notes: "unexpected" } } },
  { name: "another result", variation: { details: { resultContentHash: hash("e") } } },
  {
    name: "another writing policy",
    variation: { details: { writingPolicyId: "writing_en-human" } },
  },
  { name: "another trigger", variation: { trigger: { nextAction: "complete_workstream" } } },
  {
    name: "another completion plan",
    variation: { acceptedGoal: { completionPlanHash: hash("f") } },
  },
  {
    name: "another completion event",
    variation: { acceptedGoal: { completionEventId: `evt_${"9".repeat(32)}` } },
  },
  {
    name: "another accepted result",
    variation: { acceptedGoal: { resultArtifactHash: hash("1") } },
  },
  { name: "changed accepted text", variation: { acceptedGoal: { text: "Different text." } } },
  {
    name: "another result writing contract",
    variation: { resultWritingContract: { ...resultWritingContract, writingPolicyId: "other" } },
  },
  {
    name: "different semantic checks",
    variation: {
      details: { checks: semanticChecks.map((check) => ({ ...check, violationCount: 1 })) },
    },
  },
  {
    name: "another model evaluator",
    variation: {
      evaluation: { evaluators: [{ kind: "model", evaluatorId: "lervo.native-owner.other" }] },
    },
  },
] satisfies { name: string; variation: Variation }[])(
  "rejects a permit with $name",
  async ({ variation }) => {
    await expect(judgement(variation)).rejects.toThrow(/differs from the accepted goal/u);
  },
);
