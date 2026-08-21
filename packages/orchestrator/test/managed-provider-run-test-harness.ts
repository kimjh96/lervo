import type { ProviderAdapter } from "@lervo/adapter-contract";

import {
  ManagedProviderRunCoordinator,
  type ManagedCapabilityApprovalVerifier,
  type ManagedEventStore,
} from "../src/index.js";
import {
  MemoryArtifactStore,
  policyVersion,
  projectId,
  role,
  runId,
  sequenceFactory,
  sessionId,
} from "./fixture.js";

export function clock() {
  let value = Date.parse("2026-08-18T01:00:00Z");
  return () => {
    const current = new Date(value);
    value += 1_000;
    return current;
  };
}

export function coordinator(
  adapter: ProviderAdapter,
  root: string,
  events: ManagedEventStore,
  deadlines?: ConstructorParameters<typeof ManagedProviderRunCoordinator>[0]["deadlines"],
  artifactStore: ConstructorParameters<
    typeof ManagedProviderRunCoordinator
  >[0]["artifactStore"] = new MemoryArtifactStore(),
  approvalVerifier?: ManagedCapabilityApprovalVerifier,
  maximumProviderSignals?: number,
) {
  return new ManagedProviderRunCoordinator({
    adapter,
    coordinates: { projectId, runId, sessionId, roleId: role.roleId },
    policyVersion,
    events,
    artifactStore,
    ...(deadlines === undefined ? {} : { deadlines }),
    now: clock(),
    createEventId: sequenceFactory("evt_managedrun"),
    ...(approvalVerifier === undefined ? {} : { approvalVerifier }),
    ...(maximumProviderSignals === undefined ? {} : { maximumProviderSignals }),
  });
}
