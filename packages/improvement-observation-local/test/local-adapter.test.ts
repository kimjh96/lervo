import type { ImprovementObservationCollectionRequestV1 } from "@lervo/application-contract";
import { evaluateImprovementObservationPortConformance } from "@lervo/improvement-observation-conformance";
import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it, vi } from "vitest";

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
  failure?: { suiteHash?: string; nonPassedCommandIds?: string[] },
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
      suiteHash: failure?.suiteHash ?? hash,
      repositoryRevision: hash,
      status,
      resultArtifactId: `art_${String(seq).padStart(16, "0")}`,
      resultContentHash: hash,
      nonPassedCommandIds:
        failure?.nonPassedCommandIds ?? (status === "passed" ? [] : ["quality.check"]),
    },
    previousHash: seq === 1 ? null : hash,
    eventHash: hash,
  } as EventEnvelope;
}

function eventStore(events: EventEnvelope[], head?: EventEnvelope) {
  return {
    latest: () => head ?? events.at(-1) ?? null,
    list: (options: { afterSeq?: number; limit?: number; types?: readonly string[] }) =>
      events
        .filter(
          (event) =>
            event.seq > (options.afterSeq ?? 0) &&
            (options.types === undefined || options.types.includes(event.type)),
        )
        .slice(0, options.limit ?? 1_000),
  };
}

function collectionRequest(
  metricIds: ImprovementObservationCollectionRequestV1["metricIds"] = ["verification_success"],
): ImprovementObservationCollectionRequestV1 {
  return {
    phase: "baseline",
    patternId,
    window: {
      startedAt: "2026-09-02T00:00:00.000Z",
      endedAt: "2026-09-02T00:00:09.000Z",
    },
    metricIds,
  };
}

function adapterFor(events: EventEnvelope[], maximumEvidenceEvents?: number) {
  return createLocalImprovementObservationAdapter({
    evidenceSource: createEventStoreImprovementEvidenceSource({
      projectId,
      events: eventStore(events),
      ...(maximumEvidenceEvents === undefined ? {} : { maximumEvidenceEvents }),
    }),
  });
}

describe("local improvement observation adapter", () => {
  it("passes shared exact-verification conformance for every supported metric", async () => {
    const adapter = adapterFor([verificationEvent(1, "failed"), verificationEvent(2, "failed")]);

    for (const metricId of ["verification_success", "repeated_failure"] as const) {
      const report = await evaluateImprovementObservationPortConformance({
        adapterId: LOCAL_IMPROVEMENT_OBSERVATION_ADAPTER_ID,
        port: adapter,
        collector: adapter,
        collectionRequest: collectionRequest([metricId]),
        unsupportedMetricId: "source_recall",
      });

      expect(report.status).toBe("passed");
      expect(report.checks).toHaveLength(9);
      expect(report.checks.every((check) => check.status === "passed")).toBe(true);
    }
  });

  it("counts only later exact failure signatures as repeated failures", async () => {
    const otherSuiteHash = `sha256:${"b".repeat(64)}`;
    const adapter = adapterFor([
      verificationEvent(1, "failed"),
      verificationEvent(2, "passed"),
      verificationEvent(3, "failed"),
      verificationEvent(4, "failed", undefined, undefined, {
        nonPassedCommandIds: ["quality.check", "typecheck"],
      }),
      verificationEvent(5, "failed", undefined, undefined, { suiteHash: otherSuiteHash }),
      verificationEvent(6, "cancelled"),
      verificationEvent(7, "failed"),
    ]);

    const result = await adapter.collect(
      collectionRequest(["verification_success", "repeated_failure"]),
    );

    expect(result.unavailable).toEqual([]);
    expect(result.observations).toMatchObject([
      { metricId: "verification_success", numerator: 1, denominator: 7 },
      { metricId: "repeated_failure", numerator: 2, denominator: 7 },
    ]);
  });

  it("preserves failed-command order in the exact recurrence signature", async () => {
    const adapter = adapterFor([
      verificationEvent(1, "failed", undefined, undefined, {
        nonPassedCommandIds: ["quality.check", "typecheck"],
      }),
      verificationEvent(2, "failed", undefined, undefined, {
        nonPassedCommandIds: ["typecheck", "quality.check"],
      }),
    ]);

    const result = await adapter.collect(collectionRequest(["repeated_failure"]));

    expect(result.observations).toMatchObject([
      { metricId: "repeated_failure", numerator: 0, denominator: 2 },
    ]);
  });

  it("does not seed recurrence from failures before the observation window", async () => {
    const adapter = adapterFor([
      verificationEvent(1, "failed", "2026-09-01T23:59:59.999Z"),
      verificationEvent(2, "failed", "2026-09-02T00:00:01.000Z"),
    ]);

    const result = await adapter.collect(collectionRequest(["repeated_failure"]));

    expect(result.observations).toMatchObject([
      { metricId: "repeated_failure", numerator: 0, denominator: 1 },
    ]);
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
      emptyAdapter.collect(collectionRequest(["verification_success", "repeated_failure"])),
    ).resolves.toEqual({
      observations: [],
      unavailable: [
        { metricId: "verification_success", reason: "no_eligible_evidence" },
        { metricId: "repeated_failure", reason: "no_eligible_evidence" },
      ],
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
    await expect(
      boundedAdapter.collect(collectionRequest(["verification_success", "repeated_failure"])),
    ).resolves.toEqual({
      observations: [],
      unavailable: [
        { metricId: "verification_success", reason: "evidence_limit_exceeded" },
        { metricId: "repeated_failure", reason: "evidence_limit_exceeded" },
      ],
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

  it("reads typed evidence however far the store head is beyond 100,000 events", async () => {
    // ADR-0554: only verification completions are read, so a long history never fails the read.
    const head = {
      ...verificationEvent(150_000, "passed"),
      type: "run.requested",
    } as EventEnvelope;
    const events = [verificationEvent(1, "failed"), verificationEvent(2, "passed"), head];
    const store = eventStore(events, head);
    const list = vi.spyOn(store, "list");
    const adapter = createLocalImprovementObservationAdapter({
      evidenceSource: createEventStoreImprovementEvidenceSource({ projectId, events: store }),
    });
    await expect(adapter.collect(collectionRequest())).resolves.toEqual(
      await adapterFor(events.slice(0, 2)).collect(collectionRequest()),
    );
    expect(
      list.mock.calls.every(([options]) => options.types?.join() === "verification.completed"),
    ).toBe(true);
    const foreign = { ...verificationEvent(3, "passed"), projectId: "prj_observation_other" };
    await expect(
      adapterFor([verificationEvent(1, "passed"), foreign as EventEnvelope]).collect(
        collectionRequest(),
      ),
    ).rejects.toMatchObject({ code: "evidence_invalid" });
  });

  it("rejects status and non-passed-command contradictions", async () => {
    const passedWithFailure = adapterFor([
      verificationEvent(1, "passed", undefined, undefined, {
        nonPassedCommandIds: ["quality.check"],
      }),
    ]);
    await expect(passedWithFailure.collect(collectionRequest())).rejects.toMatchObject({
      code: "evidence_invalid",
    });

    const failedWithoutFailure = adapterFor([
      verificationEvent(1, "failed", undefined, undefined, { nonPassedCommandIds: [] }),
    ]);
    await expect(
      failedWithoutFailure.collect(collectionRequest(["repeated_failure"])),
    ).rejects.toMatchObject({ code: "evidence_invalid" });
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
