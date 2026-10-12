import { describe, expect, it } from "vitest";
import {
  bindContextQualityRequest,
  normalizeContextQualityIngress,
  validateContextQualityRequest,
} from "../src/index.js";
import { qualityFixture, qualityHash } from "./quality-fixture.js";

describe("normalized context quality requests", () => {
  it("normalizes path and set syntax while preserving language and exact task content", () => {
    const { ingress } = qualityFixture();
    ingress.task.targetPaths = ["docs\\readme.md", "./docs/readme.md"];
    ingress.task.retrievalLanguages = ["KO", "en"];
    const normalized = normalizeContextQualityIngress(ingress);
    expect(normalized.task.targetPaths).toEqual(["docs/readme.md"]);
    expect(normalized.task.retrievalLanguages).toEqual(["en", "ko"]);
    expect(normalized.task).toMatchObject({
      intent: "문서를 수정해줘",
      publicationLocale: "en",
      conversationLocale: "ko",
    });
    expect(ingress.task.targetPaths).toHaveLength(2);
  });

  it("keeps surface, correlation and receipt capabilities outside semantic identity", () => {
    const { ingress, bindings, request } = qualityFixture();
    for (const kind of ["terminal", "managed_run", "conversation", "native_chat"] as const) {
      const candidate = bindContextQualityRequest(
        {
          ...ingress,
          requestId: `attempt_${kind}`,
          origin: { kind, adapterBuildId: qualityHash(kind), correlationId: `turn_${kind}` },
        },
        {
          ...bindings,
          executionCapabilities: {
            ...bindings.executionCapabilities,
            exactDeliveryAcknowledgement: true,
          },
        },
      );
      expect(candidate.semanticInputDigest).toBe(request.semanticInputDigest);
      expect(() => validateContextQualityRequest(candidate)).not.toThrow();
    }
  });

  it("binds privacy, policy, source, builds, queries and resource ceilings independently", () => {
    const { ingress, bindings, request } = qualityFixture();
    const variants = [
      { scopeDigest: qualityHash("different-privacy-scope") },
      { policySetDigest: qualityHash("new-exception") },
      { sourceSnapshotId: "snapshot_two" },
      { retrievalPlanId: "retrieval_two" },
      { builds: { ...bindings.builds, retrieval: qualityHash("new-build") } },
      { projectedQueries: ["different query"] },
      { profile: { ...bindings.profile, maximumBytes: 2048 } },
    ];
    for (const patch of variants)
      expect(
        bindContextQualityRequest(ingress, { ...bindings, ...patch }).semanticInputDigest,
      ).not.toBe(request.semanticInputDigest);
  });

  it("rejects ingress authority claims, unsafe targets and UTF-8 budget overflow", () => {
    const { ingress, bindings } = qualityFixture();
    for (const value of [
      { ...ingress, scopeDigest: bindings.scopeDigest },
      { ...ingress, task: { ...ingress.task, targetPaths: ["../private"] } },
      { ...ingress, task: { ...ingress.task, intent: "한".repeat(6000) } },
    ]) {
      expect(() => normalizeContextQualityIngress(value)).toThrow("context_contract_invalid");
    }
  });

  it("rejects wrong project/task observations and changes after binding", () => {
    const { ingress, bindings, request } = qualityFixture();
    for (const patch of [
      { projectId: "prj_other001" },
      { taskRevision: 2 },
      { taskDigest: qualityHash("old-task") },
    ]) {
      expect(() => bindContextQualityRequest(ingress, { ...bindings, ...patch })).toThrow(
        "context_binding_stale",
      );
    }
    request.task.targetPaths = ["docs/other.md"];
    expect(() => validateContextQualityRequest(request)).toThrow("context_binding_stale");
  });
});
