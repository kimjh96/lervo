import type {
  ImprovementObservationAdapterDescriptorV1,
  ImprovementObservationCollectionRequestV1,
} from "@lervo/application-contract";
import { describe, expect, it } from "vitest";

import {
  collectLocalImprovementObservations,
  parseLocalImprovementObservationRequest,
} from "../src/improvement-observation-collection.js";
import { formatLocalImprovementObservationReport } from "../src/improvement-observation-format.js";
import type { LocalImprovementObservationHostV1 } from "../src/local-improvement-observation-host.js";

const descriptor: ImprovementObservationAdapterDescriptorV1 = {
  schemaVersion: 1,
  adapterId: "iobs_local_fixture",
  adapterVersion: "1.1.0",
  descriptorHash: `sha256:${"a".repeat(64)}`,
  availability: "available",
  authentication: "adapter_verified",
  rawEvidence: "adapter_private",
  capabilities: ["rate_observation.verify"],
};

const request: ImprovementObservationCollectionRequestV1 = {
  phase: "baseline",
  patternId: `pattern_${"b".repeat(24)}`,
  window: {
    startedAt: "2026-09-01T00:00:00.000Z",
    endedAt: "2026-09-01T01:00:00.000Z",
  },
  metricIds: ["verification_success", "repeated_failure", "rework"],
};

describe("local improvement observation collection", () => {
  it("requires an explicit version on the host request document", () => {
    expect(parseLocalImprovementObservationRequest({ schemaVersion: 1, ...request })).toEqual(
      request,
    );
    expect(() => parseLocalImprovementObservationRequest(request)).toThrow(
      "must use schema version 1",
    );
  });

  it("keeps descriptor inspection, collection, and presentation claims explicit", async () => {
    const inspected: string[] = [];
    const collected: ImprovementObservationCollectionRequestV1[] = [];
    const host: LocalImprovementObservationHostV1 = {
      adapterId: descriptor.adapterId,
      verifier: {
        inspect: async (adapterId) => {
          inspected.push(adapterId);
          return descriptor;
        },
        verify: async (input) => input.observations,
      },
      collector: {
        collect: async (input) => {
          collected.push(input);
          return {
            observations: [
              {
                metricId: "verification_success",
                numerator: 9,
                denominator: 12,
                evidenceSetHash: `sha256:${"c".repeat(64)}`,
                observationReceiptHash: `sha256:${"d".repeat(64)}`,
              },
              {
                metricId: "repeated_failure",
                numerator: 2,
                denominator: 12,
                evidenceSetHash: `sha256:${"e".repeat(64)}`,
                observationReceiptHash: `sha256:${"f".repeat(64)}`,
              },
            ],
            unavailable: [{ metricId: "rework", reason: "metric_unsupported" }],
          };
        },
      },
    };

    const report = await collectLocalImprovementObservations({ request, host });

    expect(inspected).toEqual([descriptor.adapterId]);
    expect(collected).toEqual([request]);
    expect(report).toMatchObject({
      schemaVersion: 1,
      source: "local_repository_events",
      adapter: descriptor,
      requestedMetricIds: ["verification_success", "repeated_failure", "rework"],
      attribution: "unestablished",
      canonicalMutation: "none",
      unavailable: [{ metricId: "rework", reason: "metric_unsupported" }],
    });
    expect(formatLocalImprovementObservationReport(report)).toContain(
      "verification_success: 9/12 (75.00%)",
    );
    expect(formatLocalImprovementObservationReport(report)).toContain(
      "Attribution is unestablished. No canonical state was changed.",
    );
  });
});
