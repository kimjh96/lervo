import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { FileSystemCas } from "@lervo/cas";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { OwnerReasoningContext } from "../src/supervision-reasoning-context.js";
import { ownerReasoningInstructions } from "../src/supervision-reasoning-instructions.js";
import { ownerReasoningPromptContext } from "../src/supervision-reasoning-prompt.js";
import {
  bindOwnerDecisionReferences,
  boundResultDetails,
} from "../src/supervision-reasoning-references.js";
import {
  materializeNativeOwnerProposal,
  type NativeOwnerPlanInput,
} from "../src/supervision-native-plans.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
// Sorted, as canonical facts keep them.
const facts = {
  handoffs: { pendingIncoming: [hash("1"), hash("2")] },
  tasks: { assignments: [{ artifactHashes: [hash("b")] }, { artifactHashes: [hash("a")] }] },
};
const request = {
  objective: "Inspect one source policy",
  deliverables: ["Review"],
  acceptanceCriteria: ["Evidence-backed finding"],
};
const recipientProjectId = `prj_${"a".repeat(16)}`;

it("binds the cited handoff reference to its exact pending offer hash", () => {
  expect(
    bindOwnerDecisionReferences("accept_team_support", { handoffReference: "h2" }, facts),
  ).toEqual({ handoffHash: hash("2") });
});

it("binds cited evidence references to exact result hashes in the cited order", () => {
  expect(
    bindOwnerDecisionReferences(
      "request_team_support",
      { recipientProjectId, request: { ...request, evidenceReferences: ["e2", "e1"] } },
      facts,
    ),
  ).toEqual({
    recipientProjectId,
    request: { ...request, evidenceArtifactHashes: [hash("b"), hash("a")] },
  });
});

it.each([
  {
    name: "an unknown handoff",
    operation: "accept_team_support",
    details: { handoffReference: "h3" },
  },
  {
    name: "a returned handoff hash",
    operation: "accept_team_support",
    details: { handoffHash: hash("1") },
  },
  {
    name: "an unknown evidence reference",
    operation: "escalate",
    details: { recipientProjectId, request: { ...request, evidenceReferences: ["e3"] } },
  },
  {
    name: "returned evidence hashes",
    operation: "request_team_support",
    details: { recipientProjectId, request: { ...request, evidenceArtifactHashes: [hash("a")] } },
  },
])("refuses $name", ({ operation, details }) => {
  expect(bindOwnerDecisionReferences(operation, details, facts)).toBeNull();
});

it("leaves local attention and other operations unchanged", () => {
  const attention = { reasonCode: "scope_missing" };
  expect(bindOwnerDecisionReferences("escalate", attention, facts)).toBe(attention);
  const review = { assignmentId: "asn_x", verdict: "accepted" };
  expect(bindOwnerDecisionReferences("review_artifacts", review, facts)).toBe(review);
});

it.each([
  {
    name: "an unknown handoff reference",
    operation: "accept_team_support",
    details: { handoffReference: "h9" },
  },
  {
    name: "a returned handoff hash",
    operation: "accept_team_support",
    details: { handoffHash: hash("1") },
  },
  {
    name: "an unknown evidence reference",
    operation: "request_team_support",
    details: { recipientProjectId, request: { ...request, evidenceReferences: ["e9"] } },
  },
  {
    name: "returned evidence hashes",
    operation: "escalate",
    details: { recipientProjectId, request: { ...request, evidenceArtifactHashes: [hash("a")] } },
  },
])("refuses $name as an invalid owner proposal", async ({ operation, details }) => {
  const root = await mkdtemp(join(tmpdir(), "lervo-owner-references-"));
  roots.push(root);
  const artifacts = await FileSystemCas.open(root);
  const plan = await materializeNativeOwnerProposal({
    storage: { artifacts },
    facts,
    decision: {
      schemaVersion: 1,
      operation,
      rationale: "Ask for or accept the scoped request.",
      details: JSON.stringify(details),
    },
    base: {
      responsibilityArtifactHash: hash("c"),
      deadline: "2026-11-21T00:00:00.000Z",
      roleId: "developer",
      provider: "codex",
    } as unknown as OperatingActionPlanV1,
    reasoningPlanHash: hash("d"),
    resultArtifactHash: hash("e"),
    now: () => "2026-11-20T00:00:00.000Z",
  } as unknown as NativeOwnerPlanInput);
  expect(plan.effectContract).toBe("work.owner_attention.v1");
  const effect = JSON.parse(
    new TextDecoder().decode(await artifacts.get(`lervo-cas://sha256/${plan.effectHash.slice(7)}`)),
  ) as { reasonCode: string };
  expect(effect.reasonCode).toBe("owner_proposal_invalid");
});

it("accepts a recorded decision without its result hash, or with the exact bound one", () => {
  const keys = "checks,writingPolicyId";
  const details = { checks: [], writingPolicyId: "writing_en-human" };
  expect(boundResultDetails(details, keys, hash("a"))).toBe(true);
  expect(boundResultDetails({ ...details, resultContentHash: hash("a") }, keys, hash("a"))).toBe(
    true,
  );
  expect(boundResultDetails({ ...details, resultContentHash: hash("b") }, keys, hash("a"))).toBe(
    false,
  );
  expect(boundResultDetails({ ...details, extra: 1 }, keys, hash("a"))).toBe(false);
});

const context = {
  facts: {
    ...facts,
    workstream: { notes: [] },
    assignments: [],
    responsibilities: [],
    peers: [
      {
        projectId: recipientProjectId,
        incoming: [{ handoffHash: hash("2") }, { handoffHash: hash("9") }],
      },
    ],
  },
  planning: { sources: [] },
  trigger: { reasonCode: "r", nextAction: "dispatch", assignmentIds: [] },
  results: [
    { contentHash: hash("a"), text: "first" },
    { contentHash: hash("b"), text: "second" },
  ],
} as unknown as OwnerReasoningContext;

it("shows the owner each pending handoff and result by its short reference", () => {
  const prompt = ownerReasoningPromptContext(context) as {
    facts: {
      handoffs: { pendingIncoming: string[] };
      peers: { incoming: { handoffReference: string | null }[] }[];
    };
    results: { evidenceReference: string | null; contentHash: string }[];
  };
  expect(prompt.facts.handoffs.pendingIncoming).toEqual(["h1", "h2"]);
  expect(prompt.facts.peers[0]!.incoming.map((item) => item.handoffReference)).toEqual([
    "h2",
    null,
  ]);
  expect(prompt.results.map((item) => [item.evidenceReference, item.contentHash])).toEqual([
    ["e1", hash("a")],
    ["e2", hash("b")],
  ]);
});

it("never asks the owner to return a hash", () => {
  const text = ownerReasoningInstructions(context, "2026-11-20T00:00:00.000Z").join("\n");
  for (const field of ["resultContentHash", "handoffHash", "evidenceArtifactHashes"])
    expect(text).not.toContain(field);
  expect(text).not.toMatch(/resultArtifactHash/u);
  expect(text).toContain("exactly handoffReference");
  expect(text).toContain("acceptanceCriteria and evidenceReferences");
  expect(text).toContain("Its details contain exactly writingPolicyId and checks.");
  expect(text).toContain("Its details contain exactly assignmentId, writingPolicyId, and checks.");
});
