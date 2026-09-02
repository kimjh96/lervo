import {
  AssignmentConnectorPortError,
  type AssignmentConnectorPortErrorCodeV1,
  type AssignmentConnectorPortV1,
  type AssignmentConnectorRoutePlanV1,
} from "@lervo/application-contract";

export type AssignmentConnectorConformanceScenarioV1 =
  | "authorization_failed"
  | "conflict"
  | "contradictory_evidence"
  | "delivered"
  | "descriptor_drift"
  | "destination_drift"
  | "rejected"
  | "unknown";

export interface AssignmentConnectorConformanceHarnessV1 {
  port: AssignmentConnectorPortV1;
  plan: AssignmentConnectorRoutePlanV1;
  externalAttemptCount(): number;
  reservationPersistedBeforeEffect(): boolean;
  privateMarkers: readonly string[];
  durableEvidence(): unknown;
}

export interface AssignmentConnectorConformanceCheckV1 {
  checkId: string;
  status: "passed" | "failed";
  failureCode: string | null;
}

export interface AssignmentConnectorConformanceReportV1 {
  schemaVersion: 1;
  status: "passed" | "failed";
  checks: AssignmentConnectorConformanceCheckV1[];
}

async function expectedFailure(
  work: () => Promise<unknown>,
  code: AssignmentConnectorPortErrorCodeV1,
): Promise<boolean> {
  try {
    await work();
    return false;
  } catch (error) {
    return error instanceof AssignmentConnectorPortError && error.code === code;
  }
}

function containsPrivateMarker(value: unknown, markers: readonly string[]): boolean {
  const serialized = JSON.stringify(value);
  return markers.some((marker) => marker.length > 0 && serialized.includes(marker));
}

async function deliverOnce(harness: AssignmentConnectorConformanceHarnessV1) {
  const reservation = await harness.port.reserve(harness.plan);
  if (reservation.status !== "reserved") return { reservation, observation: null };
  const observation = await harness.port.deliver({
    plan: harness.plan,
    reservationId: reservation.reservationId,
  });
  return { reservation, observation };
}

/** Runs the provider-neutral safety cases required of every assignment connector. */
export async function evaluateAssignmentConnectorPortConformance(input: {
  connectorId: string;
  destinationId: string;
  createHarness(
    scenario: AssignmentConnectorConformanceScenarioV1,
  ): Promise<AssignmentConnectorConformanceHarnessV1>;
}): Promise<AssignmentConnectorConformanceReportV1> {
  const checks: AssignmentConnectorConformanceCheckV1[] = [];
  const check = (checkId: string, passed: boolean, failureCode: string) =>
    checks.push({
      checkId,
      status: passed ? "passed" : "failed",
      failureCode: passed ? null : failureCode,
    });

  try {
    const delivered = await input.createHarness("delivered");
    const firstInspection = await delivered.port.inspect({
      connectorId: input.connectorId,
      destinationId: input.destinationId,
    });
    const secondInspection = await delivered.port.inspect({
      connectorId: input.connectorId,
      destinationId: input.destinationId,
    });
    check(
      "inspection_stable",
      JSON.stringify(firstInspection) === JSON.stringify(secondInspection),
      "inspection_drift",
    );
    check(
      "inspection_private",
      !containsPrivateMarker(firstInspection, delivered.privateMarkers),
      "native_identifier_exposed",
    );
    check(
      "unknown_connector_rejected",
      await expectedFailure(
        () =>
          delivered.port.inspect({
            connectorId: "con_unknown",
            destinationId: input.destinationId,
          }),
        "connector_not_found",
      ),
      "unknown_connector_accepted",
    );

    const deliveredResult = await deliverOnce(delivered);
    check(
      "durable_reservation_before_effect",
      deliveredResult.reservation.status === "reserved" &&
        delivered.reservationPersistedBeforeEffect(),
      "effect_preceded_reservation",
    );
    check(
      "delivered_mapped",
      deliveredResult.observation?.status === "delivered" && delivered.externalAttemptCount() === 1,
      "delivered_mapping_failed",
    );
    const replay = await delivered.port.reserve(delivered.plan);
    check(
      "same_outbound_replayed_current",
      replay.status === "current" &&
        replay.observation.status === "delivered" &&
        delivered.externalAttemptCount() === 1,
      "same_outbound_replayed_effect",
    );
    check(
      "durable_evidence_private",
      !containsPrivateMarker(delivered.durableEvidence(), delivered.privateMarkers),
      "private_value_persisted",
    );

    for (const scenario of ["rejected", "unknown"] as const) {
      const harness = await input.createHarness(scenario);
      const result = await deliverOnce(harness);
      check(
        `${scenario}_mapped`,
        result.observation?.status === scenario && harness.externalAttemptCount() === 1,
        `${scenario}_mapping_failed`,
      );
      const current = await harness.port.reserve(harness.plan);
      check(
        `${scenario}_not_retried`,
        current.status === "current" &&
          current.observation.status === scenario &&
          harness.externalAttemptCount() === 1,
        `${scenario}_replayed_effect`,
      );
    }

    const unauthorized = await input.createHarness("authorization_failed");
    check(
      "authorization_failure_before_effect",
      (await expectedFailure(
        () => unauthorized.port.reserve(unauthorized.plan),
        "authorization_failed",
      )) && unauthorized.externalAttemptCount() === 0,
      "unauthorized_effect_attempted",
    );

    for (const scenario of ["descriptor_drift", "destination_drift"] as const) {
      const stale = await input.createHarness(scenario);
      check(
        `${scenario}_blocked`,
        (await expectedFailure(() => stale.port.reserve(stale.plan), "authorization_failed")) &&
          stale.externalAttemptCount() === 0,
        `${scenario}_accepted`,
      );
    }

    const conflicted = await input.createHarness("conflict");
    const conflict = await conflicted.port.reserve(conflicted.plan);
    check(
      "reservation_conflict_preserved",
      conflict.status === "conflict" && conflicted.externalAttemptCount() === 0,
      "reservation_conflict_ignored",
    );

    const contradictory = await input.createHarness("contradictory_evidence");
    check(
      "contradictory_evidence_rejected",
      await expectedFailure(
        () => contradictory.port.reserve(contradictory.plan),
        "delivery_state_invalid",
      ),
      "contradictory_evidence_accepted",
    );

    const foreignPlan = { ...delivered.plan, planId: `${delivered.plan.planId}_foreign` };
    check(
      "foreign_plan_rejected",
      await expectedFailure(() => delivered.port.reserve(foreignPlan), "request_invalid"),
      "foreign_plan_accepted",
    );
  } catch (error) {
    checks.push({
      checkId: "conformance_execution",
      status: "failed",
      failureCode:
        error instanceof AssignmentConnectorPortError ? error.code : "unexpected_failure",
    });
  }

  return {
    schemaVersion: 1,
    status: checks.every((item) => item.status === "passed") ? "passed" : "failed",
    checks,
  };
}
