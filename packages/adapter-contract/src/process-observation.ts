import {
  type AdapterProcessObservation,
  type AdapterProcessObservationEvidence,
  type AdapterProcessObservationStatus,
  type AdapterSession,
  validateSchema,
} from "@lervo/schemas";

export type AdapterNativeProcessState =
  | {
      status: Exclude<AdapterProcessObservationStatus, "unobservable">;
      evidence: "owned_process_state";
    }
  | {
      status: "unobservable";
      evidence: Exclude<AdapterProcessObservationEvidence, "owned_process_state">;
    };

export interface AdapterProcessObservationBindingReport {
  passed: boolean;
  violations: string[];
}

export function createAdapterProcessObservation(input: {
  session: AdapterSession;
  state: AdapterNativeProcessState;
  observedAt: string;
}): AdapterProcessObservation {
  return {
    kind: "process_observation",
    schemaVersion: 1,
    adapterId: input.session.adapterId,
    projectId: input.session.projectId,
    runId: input.session.runId,
    sessionId: input.session.sessionId,
    providerSessionId: input.session.providerSessionId,
    ...input.state,
    observedAt: input.observedAt,
  };
}

export function inspectAdapterProcessObservationBinding(input: {
  session: AdapterSession;
  observation: AdapterProcessObservation;
}): AdapterProcessObservationBindingReport {
  const violations: string[] = [];
  const validation = validateSchema("adapterProcessObservation", input.observation);
  if (!validation.valid) {
    violations.push(
      validation.errors.map((error) => `${error.instancePath} ${error.message}`).join("; "),
    );
  }
  if (
    input.observation.adapterId !== input.session.adapterId ||
    input.observation.projectId !== input.session.projectId ||
    input.observation.runId !== input.session.runId ||
    input.observation.sessionId !== input.session.sessionId ||
    input.observation.providerSessionId !== input.session.providerSessionId
  ) {
    violations.push("process observation differs from its exact managed session coordinates");
  }
  if (Date.parse(input.observation.observedAt) < Date.parse(input.session.startedAt)) {
    violations.push("process observation predates the managed session");
  }
  return { passed: violations.length === 0, violations };
}
