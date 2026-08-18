import { createHash } from "node:crypto";

import { canonicalJson } from "@roven/event-contract";
import type {
  AdapterDescriptor,
  AdapterNormalizedEvent,
  AdapterSession,
  AdapterStopResult,
} from "@roven/schemas";

import type { ManagedEventSpec } from "./telemetry.js";

const systemActor = { kind: "system" } as const;

export function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function runRequestedSpecs(input: {
  requestDigest: string;
  roleId: string;
  risk: string;
  policyVersion: string;
  occurredAt: string;
}): ManagedEventSpec[] {
  return [
    {
      type: "run.requested",
      occurredAt: input.occurredAt,
      actor: { kind: "user" },
      payload: {
        requestDigest: input.requestDigest,
        role: input.roleId,
        risk: input.risk,
      },
    },
    {
      type: "run.resolved",
      occurredAt: input.occurredAt,
      actor: systemActor,
      payload: {
        role: input.roleId,
        risk: input.risk,
        policyVersion: input.policyVersion,
      },
    },
  ];
}

export function adapterStartedSpec(
  descriptor: AdapterDescriptor,
  session: AdapterSession,
): ManagedEventSpec {
  return {
    type: "adapter.started",
    occurredAt: session.startedAt,
    actor: { kind: "provider", provider: session.provider },
    payload: {
      adapterId: descriptor.adapterId,
      adapterVersion: descriptor.adapterVersion,
      providerSessionId: session.providerSessionId,
      capabilities: descriptor.capabilities,
    },
  };
}

export function adapterStoppedSpec(
  session: AdapterSession,
  result: AdapterStopResult,
): ManagedEventSpec {
  return {
    type: "adapter.stopped",
    occurredAt: result.stoppedAt,
    actor: { kind: "provider", provider: session.provider },
    payload: {
      adapterId: result.adapterId,
      providerSessionId: result.providerSessionId,
      status: result.status,
    },
  };
}

export function providerSignalSpec(
  event: AdapterNormalizedEvent,
  provider: string,
  recordedAt: string,
): ManagedEventSpec | null {
  if (event.type === "provider.tool.called") {
    return {
      type: "tool.called",
      occurredAt: recordedAt,
      actor: { kind: "provider", provider },
      payload: {
        toolName: event.payload.toolName,
        inputDigest: event.payload.inputDigest,
        status: event.payload.status,
        durationMs: event.payload.durationMs,
      },
    };
  }
  if (event.type === "provider.command.executed") {
    return {
      type: "command.executed",
      occurredAt: recordedAt,
      actor: { kind: "provider", provider },
      payload: {
        commandDigest: event.payload.commandDigest,
        cwdRelative: event.payload.cwdRelative,
        status: event.payload.status,
        exitCode: event.payload.exitCode,
        outputDigest: event.payload.outputDigest,
        durationMs: event.payload.durationMs,
      },
    };
  }
  return null;
}

export function unmanagedChangeSpec(input: {
  paths: readonly string[];
  beforeRevision: string;
  afterRevision: string;
  detectedAt: string;
}): ManagedEventSpec {
  return {
    type: "unmanaged_change.detected",
    occurredAt: input.detectedAt,
    actor: systemActor,
    payload: { ...input },
  };
}

export function runCompletedSpec(input: {
  terminalEvent: AdapterNormalizedEvent;
  occurredAt: string;
}): ManagedEventSpec {
  return {
    type: "run.completed",
    occurredAt: input.occurredAt,
    actor: systemActor,
    payload: {
      resultDigest: digest({
        eventId: input.terminalEvent.eventId,
        type: input.terminalEvent.type,
        payload: input.terminalEvent.payload,
      }),
      artifactIds: [],
      verificationStatus: "not_run",
    },
  };
}

export function runFailedSpec(input: {
  failureCode: string;
  retryable: boolean;
  phase: string;
  occurredAt: string;
}): ManagedEventSpec {
  return {
    type: "run.failed",
    occurredAt: input.occurredAt,
    actor: systemActor,
    payload: {
      failureCode: input.failureCode,
      retryable: input.retryable,
      diagnosticDigest: digest({ failureCode: input.failureCode, phase: input.phase }),
    },
  };
}
