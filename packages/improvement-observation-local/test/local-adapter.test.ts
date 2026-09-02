import type { ImprovementObservationCollectionRequestV1 } from "@lervo/application-contract";
import { evaluateImprovementObservationPortConformance } from "@lervo/improvement-observation-conformance";
import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  LOCAL_IMPROVEMENT_OBSERVATION_ADAPTER_ID,
  createEventStoreImprovementEvidenceSource,
  createLocalImprovementObservationAdapter,
} from "../src/index.js";

const hash = `sha256:${"a".repeat(64)}`;
const projectId = "prj_observation_fixture";
const patternId = "pattern_111111111111111111111111";

function verificationEvent(
  seq: number,
  status: "passed" | "failed" | "cancelled",
  occurredAt = `2026-09-02T00:00:0${seq}.000Z`,
  verificationId = `ver_${String(seq).padStart(16, "0")}`,
): EventEnvelope {
  return {
    eventId: `evt_observation${String(seq).padStart(4, "0")}`,
    projectId,
    runId: `run_observation${String(seq).padStart(4, "0")}`,
    sessionId: `ses_observation${String(seq).padStart(4, "0")}`,
    seq,
    type: "verification.completed",
    occurredAt,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: hash,
    payload: {
      verificationId,
      suiteId: "quality",
      suiteHash: hash,
      repositoryRevision: hash,
      status,
      resultArtifactId: `art_${String(seq).padStart(16, "0")}`,
      resultContentHash: hash,
      nonPassedCommandIds: status === "passed" ? [] : ["quality.check"],
    },
    previousHash: seq === 1 ? null : hash,
    eventHash: hash,
  } as EventEnvelope;
}

function eventStore(events: EventEnvelope[]) {
  return {
    latest: () => events.at(-1) ?? null,
    list: (options: { afterSeq?: number; limit?: number }) =>
      events
        .filter((event) => event.seq > (options.afterSeq ?? 0))
        .slice(0, options.limit ?? 1_000),
  };
}

function collectionRequest(): ImprovementObservationCollectionRequestV1 {
  return {
    phase: "baseline",
    patternId,
    window: {
      startedAt: "2026-09-02T00:00:00.000Z",
      endedAt: "2026-09-02T00:00:09.000Z",
    },
    metricIds: ["verification_success"],
  };
}

function adapterFor(events: EventEnvelope[], maximumScannedEvents?: number) {
  return createLocalImprovementObservationAdapter({
    evidenceSource: createEventStoreImprovementEvidenceSource({
      projectId,
      events: eventStore(events),
      ...(maximumScannedEvents === undefined ? {} : { maximumScannedEvents }),
    }),
  });
}

describe("local improvement observation adapter", () => {
  it("passes shared exact-verification conformance", async () => {
    const adapter = adapterFor([verificationEvent(1, "passed"), verificationEvent(2, "failed")]);

    const report = await evaluateImprovementObservationPortConformance({
      adapterId: LOCAL_IMPROVEMENT_OBSERVATION_ADAPTER_ID,
      port: adapter,
      collector: adapter,
      collectionRequest: collectionRequest(),
      unsupportedMetricId: "source_recall",
    });

    expect(report.status).toBe("passed");
    expect(report.checks).toHaveLength(9);
    expect(report.checks.every((check) => check.status === "passed")).toBe(true);
  });

  it("counts canonical verification completions with inclusive boundaries", async () => {
    const adapter = adapterFor([
      verificationEvent(1, "passed", "2026-09-02T00:00:00.000Z"),
      verificationEvent(2, "failed"),
      verificationEvent(3, "cancelled", "2026-09-02T00:00:09.000Z"),
      verificationEvent(4, "passed", "2026-09-02T00:00:10.000Z"),
    ]);

    const result = await adapter.collect(collectionRequest());

    expect(result.unavailable).toEqual([]);
    expect(result.observations).toMatchObject([
      { metricId: "verification_success", numerator: 1, denominator: 3 },
    ]);
    await expect(
      adapter.verify({
        phase: "baseline",
        patternId,
        window: collectionRequest().window,
        observations: result.observations,
      }),
    ).resolves.toEqual(result.observations);
  });

  it("keeps unsupported, empty, and over-capacity evidence unavailable", async () => {
    const emptyAdapter = adapterFor([]);
    await expect(emptyAdapter.collect(collectionRequest())).resolves.toEqual({
      observations: [],
      unavailable: [{ metricId: "verification_success", reason: "no_eligible_evidence" }],
    });
    await expect(
      emptyAdapter.collect({ ...collectionRequest(), metricIds: ["user_correction"] }),
    ).resolves.toEqual({
      observations: [],
      unavailable: [{ metricId: "user_correction", reason: "metric_unsupported" }],
    });
    const boundedAdapter = adapterFor(
      [verificationEvent(1, "passed"), verificationEvent(2, "passed")],
      1,
    );
    await expect(boundedAdapter.collect(collectionRequest())).resolves.toEqual({
      observations: [],
      unavailable: [{ metricId: "verification_success", reason: "evidence_limit_exceeded" }],
    });
    const exactClaim = await adapterFor([verificationEvent(1, "passed")]).collect(
      collectionRequest(),
    );
    await expect(
      boundedAdapter.verify({
        phase: "baseline",
        patternId,
        window: collectionRequest().window,
        observations: exactClaim.observations,
      }),
    ).rejects.toMatchObject({ code: "evidence_limit_exceeded" });

    const evidenceBoundAdapter = createLocalImprovementObservationAdapter({
      evidenceSource: createEventStoreImprovementEvidenceSource({
        projectId,
        events: eventStore([verificationEvent(1, "passed"), verificationEvent(2, "passed")]),
        maximumEvidenceEvents: 1,
      }),
    });
    await expect(evidenceBoundAdapter.collect(collectionRequest())).resolves.toEqual({
      observations: [],
      unavailable: [{ metricId: "verification_success", reason: "evidence_limit_exceeded" }],
    });
  });

  it("rejects duplicate evidence identities and detects later backdated evidence", async () => {
    const duplicate = adapterFor([
      verificationEvent(1, "passed"),
      verificationEvent(2, "failed", undefined, "ver_0000000000000001"),
    ]);
    await expect(duplicate.collect(collectionRequest())).rejects.toMatchObject({
      code: "evidence_invalid",
    });

    const events = [verificationEvent(1, "passed")];
    const adapter = adapterFor(events);
    const initial = await adapter.collect(collectionRequest());
    events.push(verificationEvent(2, "failed"));
    await expect(
      adapter.verify({
        phase: "baseline",
        patternId,
        window: collectionRequest().window,
        observations: initial.observations,
      }),
    ).rejects.toMatchObject({
      code: "observation_mismatch",
    });
  });

  it("projects the maximum supported evidence set without changing counting semantics", async () => {
    const startedAt = Date.parse("2026-09-02T00:00:00.000Z");
    const events = Array.from({ length: 10_000 }, (_, index) =>
      verificationEvent(
        index + 1,
        index % 2 === 0 ? "passed" : "failed",
        new Date(startedAt + index).toISOString(),
      ),
    );
    const adapter = adapterFor(events);

    const result = await adapter.collect({
      ...collectionRequest(),
      window: {
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(startedAt + events.length - 1).toISOString(),
      },
    });

    expect(result.unavailable).toEqual([]);
    expect(result.observations[0]).toMatchObject({ numerator: 5_000, denominator: 10_000 });
  });
});
