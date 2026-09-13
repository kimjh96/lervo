import { createHash } from "node:crypto";

import { canonicalJson, readEventReaderCapabilities } from "@lervo/event-contract";
import type { EventReaderCapabilities } from "@lervo/schemas";

import { NodeRuntimeError } from "./errors.js";

export type NodeRuntimeComponentHealth =
  { status: "pending" | "ready" | "disabled" } | { status: "unavailable"; failureCode: string };

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
  const component = value as { status?: unknown; failureCode?: unknown };
  if (["pending", "ready", "disabled"].includes(component.status as string)) {
    return component.failureCode === undefined;
  }
  return (
    component.status === "unavailable" &&
    typeof component.failureCode === "string" &&
    component.failureCode.length > 0 &&
    component.failureCode.length <= 128 &&
    !/[\0\r\n]/u.test(component.failureCode)
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
