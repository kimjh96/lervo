import {
  ImprovementObservationPortError,
  type ImprovementMetricIdV1,
  type ImprovementMetricObservationV1,
  type ImprovementObservationCollectionRequestV1,
  type ImprovementObservationCollectorV1,
  type ImprovementObservationPortErrorCodeV1,
  type ImprovementObservationPortV1,
} from "@lervo/application-contract";

export interface ImprovementObservationConformanceCheckV1 {
  checkId: string;
  status: "passed" | "failed";
  failureCode: string | null;
}

export interface ImprovementObservationConformanceReportV1 {
  schemaVersion: 1;
  status: "passed" | "failed";
  checks: ImprovementObservationConformanceCheckV1[];
}

function changedPatternId(patternId: string): string {
  const suffix = patternId.at(-1) === "0" ? "1" : "0";
  return `${patternId.slice(0, -1)}${suffix}`;
}

function changedWindow(input: ImprovementObservationCollectionRequestV1) {
  const startedAt = new Date(Date.parse(input.window.startedAt) + 1).toISOString();
  return { startedAt, endedAt: input.window.endedAt };
}

function changedObservation(
  observation: ImprovementMetricObservationV1,
): ImprovementMetricObservationV1 {
  return {
    ...observation,
    numerator:
      observation.numerator === observation.denominator
        ? observation.numerator - 1
        : observation.numerator + 1,
  };
}

async function expectedFailure(
  work: () => Promise<unknown>,
  code: ImprovementObservationPortErrorCodeV1,
): Promise<boolean> {
  try {
    await work();
    return false;
  } catch (error) {
    return error instanceof ImprovementObservationPortError && error.code === code;
  }
}

/**
 * Runs the behavior shared by every exact improvement-observation adapter without
 * depending on a test framework or adapter-native evidence.
 */
export async function evaluateImprovementObservationPortConformance(input: {
  adapterId: string;
  port: ImprovementObservationPortV1;
  collector: ImprovementObservationCollectorV1;
  collectionRequest: ImprovementObservationCollectionRequestV1;
  unsupportedMetricId: ImprovementMetricIdV1;
}): Promise<ImprovementObservationConformanceReportV1> {
  const checks: ImprovementObservationConformanceCheckV1[] = [];
  const check = (checkId: string, passed: boolean, failureCode: string) =>
    checks.push({
      checkId,
      status: passed ? "passed" : "failed",
      failureCode: passed ? null : failureCode,
    });

  try {
    const first = await input.port.inspect(input.adapterId);
    const second = await input.port.inspect(input.adapterId);
    check(
      "descriptor_stable",
      JSON.stringify(first) === JSON.stringify(second),
      "descriptor_drift",
    );

    const collection = await input.collector.collect(input.collectionRequest);
    const observation = collection.observations[0];
    check(
      "supported_metric_collected",
      observation !== undefined && collection.unavailable.length === 0,
      "supported_metric_unavailable",
    );
    if (observation === undefined) {
      return { schemaVersion: 1, status: "failed", checks };
    }

    const verified = await input.port.verify({
      phase: input.collectionRequest.phase,
      patternId: input.collectionRequest.patternId,
      window: input.collectionRequest.window,
      observations: collection.observations,
    });
    check(
      "exact_observation_verified",
      JSON.stringify(verified) === JSON.stringify(collection.observations),
      "verification_changed_observation",
    );
    check(
      "count_tamper_rejected",
      await expectedFailure(
        () =>
          input.port.verify({
            phase: input.collectionRequest.phase,
            patternId: input.collectionRequest.patternId,
            window: input.collectionRequest.window,
            observations: [changedObservation(observation)],
          }),
        "observation_mismatch",
      ),
      "count_tamper_accepted",
    );
    check(
      "phase_drift_rejected",
      await expectedFailure(
        () =>
          input.port.verify({
            phase: input.collectionRequest.phase === "baseline" ? "treatment" : "baseline",
            patternId: input.collectionRequest.patternId,
            window: input.collectionRequest.window,
            observations: collection.observations,
          }),
        "observation_mismatch",
      ),
      "phase_drift_accepted",
    );
    check(
      "pattern_drift_rejected",
      await expectedFailure(
        () =>
          input.port.verify({
            phase: input.collectionRequest.phase,
            patternId: changedPatternId(input.collectionRequest.patternId),
            window: input.collectionRequest.window,
            observations: collection.observations,
          }),
        "observation_mismatch",
      ),
      "pattern_drift_accepted",
    );
    check(
      "window_drift_rejected",
      await expectedFailure(
        () =>
          input.port.verify({
            phase: input.collectionRequest.phase,
            patternId: input.collectionRequest.patternId,
            window: changedWindow(input.collectionRequest),
            observations: collection.observations,
          }),
        "observation_mismatch",
      ),
      "window_drift_accepted",
    );
    const unsupported = await input.collector.collect({
      ...input.collectionRequest,
      metricIds: [input.unsupportedMetricId],
    });
    check(
      "unsupported_metric_unavailable",
      unsupported.observations.length === 0 &&
        unsupported.unavailable.length === 1 &&
        unsupported.unavailable[0]?.metricId === input.unsupportedMetricId &&
        unsupported.unavailable[0]?.reason === "metric_unsupported",
      "unsupported_metric_inferred",
    );
    check(
      "unknown_adapter_rejected",
      await expectedFailure(() => input.port.inspect("iobs_unknown"), "adapter_not_found"),
      "unknown_adapter_accepted",
    );
  } catch (error) {
    checks.push({
      checkId: "conformance_execution",
      status: "failed",
      failureCode:
        error instanceof ImprovementObservationPortError ? error.code : "unexpected_failure",
    });
  }
  return {
    schemaVersion: 1,
    status: checks.every((item) => item.status === "passed") ? "passed" : "failed",
    checks,
  };
}
