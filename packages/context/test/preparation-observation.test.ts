import { packInstructionSources } from "../src/instruction-packing.js";
import { describe, expect, it } from "vitest";
import { validateSchema } from "@lervo/schemas";

import {
  isContextPreparationReport,
  observeContextPreparation,
  type PreparationObservationInput,
} from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;
const first = { sourceId: "doc_first", contentHash: hash };
const second = { sourceId: "doc_second", contentHash: hash };

function input(): PreparationObservationInput {
  return {
    requestDigest: hash,
    sourceSnapshotId: "ksnap_fixture",
    retrieval: "completed",
    candidateCount: 2,
    selected: [first, second],
    loads: [
      { ...first, disposition: "full", preparedByteCount: 10, reason: null },
      { ...second, disposition: "prefix", preparedByteCount: 30, reason: "prefix_only" },
    ],
  };
}

describe("bounded context preparation observations", () => {
  it("counts actual preparation without promoting policy, relevance, injection, or use", () => {
    const report = observeContextPreparation(input());
    expect(report).toMatchObject({
      selectedCount: 2,
      fullCount: 1,
      prefixCount: 1,
      unavailableCount: 0,
      preparedByteCount: 40,
      reasonCodes: ["prefix_only"],
      applicability: "unobserved",
      corpusCoverage: "unobserved",
      delivery: "unobserved",
      internalUse: "unknown",
      artifactCompliance: "unobserved",
    });
    expect(validateSchema("contextPreparationReport", report).valid).toBe(true);
    expect(JSON.stringify(report)).not.toContain("doc_first");
  });

  it("preserves selection order and normalizes incidental load completion order", () => {
    const original = input();
    const report = observeContextPreparation(original);
    expect(
      observeContextPreparation({ ...original, loads: [...original.loads!].reverse() }),
    ).toEqual(report);
    expect(
      observeContextPreparation({ ...original, selected: [...original.selected].reverse() })
        .observationDigest,
    ).not.toBe(report.observationDigest);
    expect(
      observeContextPreparation({ ...original, sourceSnapshotId: "ksnap_changed" })
        .observationDigest,
    ).not.toBe(report.observationDigest);
  });

  it("distinguishes unsearched, failed, and completed empty retrieval without claiming absence", () => {
    const base = { ...input(), selected: [], loads: [] };
    const skipped = observeContextPreparation({
      ...base,
      retrieval: "not_run",
      candidateCount: null,
    });
    const failed = observeContextPreparation({
      ...base,
      retrieval: "unavailable",
      candidateCount: null,
    });
    const empty = observeContextPreparation({ ...base, candidateCount: 0 });
    expect(skipped.reasonCodes).toEqual(["retrieval_not_run"]);
    expect(failed.reasonCodes).toEqual(["retrieval_unavailable"]);
    expect(empty).toMatchObject({
      retrieval: "completed",
      candidateCount: 0,
      corpusCoverage: "unobserved",
    });
    expect(new Set([skipped, failed, empty].map((r) => r.observationDigest)).size).toBe(3);
  });

  it("does not count search index reads as final context loading", () => {
    expect(observeContextPreparation({ ...input(), loads: null })).toMatchObject({
      loading: "unobserved",
      fullCount: null,
      prefixCount: null,
      unavailableCount: null,
      preparedByteCount: null,
      reasonCodes: ["loading_unobserved"],
    });
  });

  it("retains bounded failed-load reasons and never counts them as prepared bytes", () => {
    expect(
      observeContextPreparation({
        ...input(),
        selected: [first],
        loads: [
          { ...first, disposition: "unavailable", preparedByteCount: 0, reason: "source_changed" },
        ],
      }),
    ).toMatchObject({
      selectedCount: 1,
      fullCount: 0,
      unavailableCount: 1,
      preparedByteCount: 0,
      reasonCodes: ["source_changed"],
    });
  });

  it.each([
    { selected: [first, first] },
    { selected: [first, { ...first, contentHash: `sha256:${"b".repeat(64)}` }] },
    { loads: [] },
    { candidateCount: 1 },
    { candidateCount: Number.NaN },
    {
      selected: Array.from({ length: 51 }, (_, i) => ({ ...first, sourceId: `doc_${i}` })),
      loads: null,
    },
    { sourceSnapshotId: "/private/secret" },
    { retrieval: "not_run", candidateCount: 0, selected: [], loads: [] },
    {
      loads: [
        { ...first, disposition: "unavailable", preparedByteCount: 20, reason: "source_changed" },
      ],
    },
    {
      loads: [
        {
          ...first,
          contentHash: `sha256:${"b".repeat(64)}`,
          disposition: "full",
          preparedByteCount: 1,
          reason: null,
        },
      ],
    },
  ])("rejects inconsistent or unbounded observations without leaking their input", (patch) => {
    expect(() =>
      observeContextPreparation({ ...input(), ...patch } as PreparationObservationInput),
    ).toThrow("Invalid context preparation observation.");
  });

  it("rejects unknown wire versions, extra private fields, and invented injection", () => {
    const report = observeContextPreparation(input());
    for (const patch of [{ schemaVersion: 2 }, { prompt: "secret" }, { delivery: "injected" }]) {
      expect(validateSchema("contextPreparationReport", { ...report, ...patch }).valid).toBe(false);
    }
  });

  it("rejects schema-shaped reports with impossible counts or missing failure reasons", () => {
    const report = observeContextPreparation(input());
    for (const patch of [
      { fullCount: 5 },
      { reasonCodes: [] },
      { preparedByteCount: 0 },
      { loading: "unobserved" },
      { candidateCount: 0 },
      { corpusCoverage: "incomplete" },
    ]) {
      expect(isContextPreparationReport({ ...report, ...patch })).toBe(false);
    }
  });
});

it("keeps historical reports readable and exposes missing bindings on new observations", () => {
  const report = observeContextPreparation(input());
  expect(report.planningReadiness).toMatchObject({
    status: "unavailable",
    reasonCode: "context_binding_unavailable",
  });
  const historical = { ...report };
  delete historical.planningReadiness;
  expect(isContextPreparationReport(historical)).toBe(true);
  expect(isContextPreparationReport({ ...report, planningReadiness: { status: "ready" } })).toBe(
    false,
  );
});

it("rejects fabricated complete or empty owner-rule diagnostics", () => {
  const instructions = packInstructionSources({
    sources: [],
    targetDigest: hash,
    maximumBytes: 4096,
  }).report;
  const report = { ...observeContextPreparation(input()), instructions };
  expect(isContextPreparationReport(report)).toBe(true);
  expect(
    isContextPreparationReport({ ...report, instructions: { ...instructions, observedCount: 1 } }),
  ).toBe(false);
  expect(
    isContextPreparationReport({
      ...report,
      instructions: { ...instructions, status: "unavailable" },
    }),
  ).toBe(false);
  expect(
    isContextPreparationReport({
      ...report,
      instructions: { ...instructions, unresolvedCount: 1, observedCount: 1, omittedCount: 1 },
    }),
  ).toBe(false);
});
