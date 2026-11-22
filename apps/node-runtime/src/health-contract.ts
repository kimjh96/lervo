import { createHash } from "node:crypto";

import { canonicalJson, readEventReaderCapabilities } from "@lervo/event-contract";
import type { EventReaderCapabilities } from "@lervo/schemas";
import type { SupervisionResourceBudgetV1 } from "@lervo/application-contract";

import { NodeRuntimeError } from "./errors.js";

export type NodeRuntimeComponentHealth =
  | { status: "pending" | "ready" | "disabled" }
  | { status: "dormant"; reasonCode: "workstream_inactive" | "local_result_canonical" }
  | {
      status: "attention";
      reasonCode: "goal_budget_insufficient";
      resourceBudget: SupervisionResourceBudgetV1 & { scope: "goal" };
    }
  /**
   * ADR-0561: work Lervo holds as its own debt, such as a supervision escalation the principal
   * proxy could not settle or divergent workstream heads it could not reconcile yet. It never waits
   * for the owner and does not degrade the Node. `since` is the first observation of this reason.
   */
  | { status: "lervo_debt"; reasonCode: string; since?: string }
  | { status: "unavailable"; failureCode: string; reasonCodes?: string[] };

/** Bounded identifier codes only; never prose, paths, or provider output. */
export function boundedHealthReasonCodes(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    value.every((code) => typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code))
  );
}

export interface NodeRuntimeEventReaderIdentity {
  projectId: string;
  repositoryIdentityHash: string;
  destinationId: string;
}

export interface NodeRuntimeHealthSnapshot {
  schemaVersion: 1;
  status: "starting" | "ready" | "degraded" | "stopping";
  processId: number;
  startedAt: string;
  updatedAt: string;
  /**
   * ADR-0611: the process presence the Node holds while it runs (ADR-0602), recorded only once
   * its socket listens. Readers probe it to tell a live idle Node from a gone one without a clock.
   */
  presenceToken?: string;
  eventReader?: EventReaderCapabilities;
  eventReaderIdentity?: NodeRuntimeEventReaderIdentity;
  sync: NodeRuntimeComponentHealth;
  workstreamReplication: NodeRuntimeComponentHealth;
  workspaceCoordination: NodeRuntimeComponentHealth;
  remoteControl: NodeRuntimeComponentHealth;
  conversation?: NodeRuntimeComponentHealth;
  supervision?: NodeRuntimeComponentHealth;
}

function componentHealth(value: unknown): value is NodeRuntimeComponentHealth {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const component = value as {
    status?: unknown;
    reasonCode?: unknown;
    failureCode?: unknown;
    reasonCodes?: unknown;
    resourceBudget?: unknown;
  };
  if (["pending", "ready", "disabled"].includes(component.status as string)) {
    return (
      component.reasonCode === undefined &&
      component.failureCode === undefined &&
      component.reasonCodes === undefined &&
      component.resourceBudget === undefined
    );
  }
  if (component.status === "dormant") {
    return (
      ["workstream_inactive", "local_result_canonical"].includes(String(component.reasonCode)) &&
      component.failureCode === undefined &&
      component.reasonCodes === undefined &&
      component.resourceBudget === undefined
    );
  }
  if (component.status === "lervo_debt") {
    const since = (component as { since?: unknown }).since;
    return (
      boundedHealthReasonCodes([component.reasonCode]) &&
      component.failureCode === undefined &&
      component.reasonCodes === undefined &&
      component.resourceBudget === undefined &&
      (since === undefined || (typeof since === "string" && Number.isFinite(Date.parse(since))))
    );
  }
  if (component.status === "attention") {
    const budget = component.resourceBudget as Partial<SupervisionResourceBudgetV1> | undefined;
    return (
      component.reasonCode === "goal_budget_insufficient" &&
      component.failureCode === undefined &&
      component.reasonCodes === undefined &&
      budget !== undefined &&
      budget.schemaVersion === 1 &&
      budget.scope === "goal" &&
      [
        budget.limitTokens,
        budget.observedTokens,
        budget.reservedTokens,
        budget.requestedTokens,
        budget.remainingTokens,
      ].every((item) => Number.isSafeInteger(item) && item! >= 0) &&
      budget.remainingTokens ===
        Math.max(0, budget.limitTokens! - budget.observedTokens! - budget.reservedTokens!)
    );
  }
  return (
    component.status === "unavailable" &&
    component.reasonCode === undefined &&
    component.resourceBudget === undefined &&
    typeof component.failureCode === "string" &&
    component.failureCode.length > 0 &&
    component.failureCode.length <= 128 &&
    !/[\0\r\n]/u.test(component.failureCode) &&
    (component.reasonCodes === undefined || boundedHealthReasonCodes(component.reasonCodes))
  );
}

function eventReaderIdentity(value: unknown): value is NodeRuntimeEventReaderIdentity {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  return (
    Object.keys(identity).sort().join("\0") ===
      ["destinationId", "projectId", "repositoryIdentityHash"].sort().join("\0") &&
    typeof identity.projectId === "string" &&
    /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(identity.projectId) &&
    typeof identity.repositoryIdentityHash === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(identity.repositoryIdentityHash) &&
    typeof identity.destinationId === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(identity.destinationId)
  );
}

export function readNodeRuntimeHealthSnapshot(value: unknown): NodeRuntimeHealthSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new NodeRuntimeError(
      "health_snapshot_invalid",
      "The Node runtime health snapshot is invalid.",
    );
  }
  const snapshot = value as NodeRuntimeHealthSnapshot;
  try {
    if (
      snapshot.schemaVersion !== 1 ||
      !["starting", "ready", "degraded", "stopping"].includes(snapshot.status) ||
      !Number.isSafeInteger(snapshot.processId) ||
      snapshot.processId < 1 ||
      !Number.isFinite(Date.parse(snapshot.startedAt)) ||
      !Number.isFinite(Date.parse(snapshot.updatedAt)) ||
      (snapshot.presenceToken !== undefined &&
        (typeof snapshot.presenceToken !== "string" ||
          !/^[a-z0-9-]{1,160}$/u.test(snapshot.presenceToken))) ||
      !componentHealth(snapshot.sync) ||
      !componentHealth(snapshot.workstreamReplication) ||
      !componentHealth(snapshot.workspaceCoordination) ||
      !componentHealth(snapshot.remoteControl) ||
      (snapshot.conversation !== undefined && !componentHealth(snapshot.conversation)) ||
      (snapshot.supervision !== undefined && !componentHealth(snapshot.supervision)) ||
      (snapshot.eventReader !== undefined && !validEventReader(snapshot.eventReader)) ||
      (snapshot.eventReaderIdentity !== undefined &&
        !eventReaderIdentity(snapshot.eventReaderIdentity))
    ) {
      throw new Error("invalid health fields");
    }
  } catch (error) {
    throw new NodeRuntimeError(
      "health_snapshot_invalid",
      "The Node runtime health snapshot is invalid.",
      { cause: error },
    );
  }
  return structuredClone(snapshot);
}

function validEventReader(value: EventReaderCapabilities): boolean {
  readEventReaderCapabilities(value);
  return true;
}

export function calculateNodeRuntimeReaderIdentityHash(
  identity: NodeRuntimeEventReaderIdentity,
): string {
  if (!eventReaderIdentity(identity)) {
    throw new NodeRuntimeError("health_snapshot_invalid", "The Node reader identity is invalid.");
  }
  return `sha256:${createHash("sha256").update(canonicalJson(identity)).digest("hex")}`;
}
