import { describe, expect, it, vi } from "vitest";
import type { WorkforceAssignment } from "@lervo/agent-workforce";
import { canonicalJson, sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import type { ArtifactStore } from "@lervo/storage-contract";
import { inspectRetainedCanonicalIntegration } from "../src/canonical-integration-recovery.js";
import { readConvergenceAssignmentResult } from "../src/convergence-stage-artifact.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";

const assignments = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("@lervo/agent-workforce", async (load) => ({
  ...(await load<typeof import("@lervo/agent-workforce")>()),
  listAssignments: async () => assignments.value,
}));
vi.mock("../src/delegation.js", async (load) => ({
  ...(await load<typeof import("../src/delegation.js")>()),
  assertConvergenceDelegation: async () => ({}),
}));

const state = {
  obligationId: "kconv_0123456789abcdef01234567",
  snapshotHash: sha256("snapshot"),
  baseline: { projectId: "prj_reader", delegationHash: sha256("delegation") },
  receipts: [],
  stageData: {},
} as unknown as KnowledgeConvergenceInput;

function context(artifacts: Pick<ArtifactStore, "get">): ConvergenceRuntimeContext {
  return {
    provider: "codex",
    storage: { paths: { repositoryRoot: "/nonexistent/reader" }, artifacts },
  } as unknown as ConvergenceRuntimeContext;
}

function writer(contentHash: string): WorkforceAssignment {
  return {
    assignmentId: "asn_writer",
    taskType: "knowledge.convergence.canonical_integration.reader",
    status: "completed",
    convergence: {
      stage: "canonical_integration",
      inputArtifactHash: sha256(canonicalJson(state)),
    },
    resultArtifacts: [{ artifactId: "art_writer", contentHash }],
  } as unknown as WorkforceAssignment;
}

const absent = async () => {
  throw Object.assign(new Error("absent"), { code: "not_found" });
};

describe("readers of a pruned convergence assignment result (ADR-0586)", () => {
  it("stops integration recovery as uncertain when the writer's stage result was pruned", async () => {
    const get = vi.fn(absent);
    assignments.value = [writer(sha256("pruned writer result"))];
    // A landed integration must not be mistaken for divergence or parked without its effect.
    await expect(
      inspectRetainedCanonicalIntegration(context({ get }), state, []),
    ).rejects.toMatchObject({ code: "knowledge_effect_uncertain" });
    expect(get).toHaveBeenCalledOnce();
  });

  it("keeps integrity failures uncertain as well", async () => {
    assignments.value = [writer(sha256("expected bytes"))];
    const get = async () => new TextEncoder().encode("different bytes");
    await expect(
      inspectRetainedCanonicalIntegration(context({ get }), state, []),
    ).rejects.toMatchObject({ code: "knowledge_effect_uncertain" });
  });

  it("separates a pruned record from an invalid one and rethrows transient failures", async () => {
    const hash = sha256("record");
    expect(await readConvergenceAssignmentResult({ get: absent } as never, hash)).toEqual({
      state: "result_unavailable",
    });
    const corrupt = async () => {
      throw Object.assign(new Error("corrupt"), { code: "corrupt_object" });
    };
    expect(await readConvergenceAssignmentResult({ get: corrupt } as never, hash)).toEqual({
      state: "invalid",
    });
    const busy = async () => {
      throw Object.assign(new Error("EMFILE"), { code: "EMFILE" });
    };
    await expect(readConvergenceAssignmentResult({ get: busy } as never, hash)).rejects.toThrow(
      "EMFILE",
    );
  });
});
