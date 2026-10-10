import { describe, expect, it } from "vitest";
import { createContextQualityPlan, validateContextQualityPlan } from "../src/index.js";
import { qualityFixture, qualityHash } from "./quality-fixture.js";

describe("exact context quality plans", () => {
  it("admits only a fully bound, covered plan and verifies its exact source bytes", () => {
    const fixture = qualityFixture();
    const plan = createContextQualityPlan(fixture);
    expect(plan).toMatchObject({
      status: "ready",
      reasonCodes: [],
      coverage: { required: 1, resolved: 1, loaded: 1 },
    });
    expect(() => validateContextQualityPlan(plan, fixture.request, fixture.sources)).not.toThrow();
    fixture.sources[0]!.bytes[0] = 0;
    expect(() => validateContextQualityPlan(plan, fixture.request, fixture.sources)).toThrow(
      "context_binding_stale",
    );
  });

  it("never equates unavailable applicability, corpus, retrieval or token counts with success", () => {
    for (const field of ["applicability", "corpus", "retrieval", "tokens"] as const) {
      const fixture = qualityFixture();
      if (field === "applicability") fixture.evidence.applicability = "unobserved";
      if (field === "corpus") fixture.evidence.corpusCoverage.disposition = "unobserved";
      if (field === "retrieval")
        fixture.evidence.retrieval = { disposition: "not_run", resultDigest: null };
      if (field === "tokens") fixture.evidence.tokenCount = null;
      expect(["incomplete", "unavailable"]).toContain(createContextQualityPlan(fixture).status);
    }
  });

  it("does not treat a title, partial clause or evidence-role section as required rule delivery", () => {
    const fixture = qualityFixture();
    fixture.evidence.sections = fixture.evidence.sections.filter((s) => s.role !== "obligation");
    expect(createContextQualityPlan(fixture)).toMatchObject({
      status: "incomplete",
      coverage: { loaded: 0, missingRuleIds: ["publication_language"] },
    });
    const partial = qualityFixture();
    partial.evidence.sections[0]!.byteEnd = 7;
    partial.evidence.sections[0]!.sectionHash = qualityHash(
      partial.sources[0]!.bytes.subarray(0, 7),
    );
    expect(() => createContextQualityPlan(partial)).toThrow("context_required_section_missing");
    const mislabeled = qualityFixture();
    mislabeled.evidence.sections[0]!.role = "evidence";
    expect(() => createContextQualityPlan(mislabeled)).toThrow("context_contract_invalid");
  });

  it("retains unresolved rules, conflicts and undelivered condition/exception references", () => {
    for (const disposition of ["unresolved", "conflict"] as const) {
      const fixture = qualityFixture();
      fixture.evidence.obligations[0]!.disposition = disposition;
      expect(createContextQualityPlan(fixture).status).toBe("incomplete");
    }
    const fixture = qualityFixture();
    fixture.evidence.obligations[0]!.exceptionRefs = ["exception_clause"];
    expect(createContextQualityPlan(fixture).coverage.loaded).toBe(0);
  });

  it("requires complete coverage denominators even for no-evidence answers", () => {
    const fixture = qualityFixture();
    fixture.evidence.sections = [];
    fixture.evidence.obligations = [];
    fixture.evidence.selectedEvidenceCount = 0;
    fixture.evidence.tokenCount = 0;
    expect(createContextQualityPlan(fixture).status).toBe("no_evidence");
    fixture.evidence.corpusCoverage.eligible = null;
    expect(() => createContextQualityPlan(fixture)).toThrow("context_contract_invalid");
  });

  it("separates timing and attempt receipts from deterministic plan identity", () => {
    const fixture = qualityFixture();
    const plan = createContextQualityPlan(fixture);
    const observed = {
      ...plan,
      costObservation: { elapsedMs: 42, reason: "observed" as const },
      retrievalReceiptRefs: ["receipt_two"],
    };
    expect(() =>
      validateContextQualityPlan(observed, fixture.request, fixture.sources),
    ).not.toThrow();
    expect(
      createContextQualityPlan({
        ...fixture,
        evidence: { ...fixture.evidence, retrievalReceiptRefs: ["receipt_two"] },
      }).planDigest,
    ).toBe(plan.planDigest);
    expect(() =>
      validateContextQualityPlan(
        { ...plan, coverage: { ...plan.coverage, loaded: 0 } },
        fixture.request,
        fixture.sources,
      ),
    ).toThrow("context_binding_stale");
  });

  it("rejects duplicate sections, invalid UTF-8 boundaries and false source scopes", () => {
    const duplicate = qualityFixture();
    duplicate.evidence.sections.push(duplicate.evidence.sections[0]!);
    expect(() => createContextQualityPlan(duplicate)).toThrow("context_contract_invalid");
    const unsafe = qualityFixture();
    unsafe.evidence.corpusCoverage.scopeDigest = qualityHash("another-scope");
    expect(() => createContextQualityPlan(unsafe)).toThrow("context_binding_stale");
    const utf8 = qualityFixture();
    utf8.sources[1]!.bytes = Buffer.from("한글");
    Object.assign(utf8.evidence.sections[1]!, {
      sourceHash: qualityHash(utf8.sources[1]!.bytes),
      byteStart: 1,
      byteEnd: 3,
      sectionHash: qualityHash(utf8.sources[1]!.bytes.subarray(1, 3)),
    });
    expect(() => createContextQualityPlan(utf8)).toThrow("context_contract_invalid");
  });
});

it("rejects contradictory timing observations without changing semantic identity", () => {
  const fixture = qualityFixture();
  const plan = createContextQualityPlan(fixture);
  plan.costObservation = { elapsedMs: null, reason: "observed" };
  expect(() => validateContextQualityPlan(plan, fixture.request, fixture.sources)).toThrow();
});
