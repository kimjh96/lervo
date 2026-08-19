import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import type {
  AdapterDescriptor,
  AdapterNormalizedEvent,
  AdapterSession,
  AdapterStopResult,
} from "@lervo/schemas";
import type { VerificationResult, VerificationSuite } from "@lervo/schemas";
import { verificationSuiteHash } from "@lervo/verification-contract";

import type { ManagedEventSpec } from "./telemetry.js";
import type {
  ManagedProviderResultArtifact,
  ManagedResolvedSkill,
} from "./provider-run-types.js";

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

export function skillResolvedSpecs(
  skills: readonly ManagedResolvedSkill[],
  occurredAt: string,
): ManagedEventSpec[] {
  return skills.map((skill) => ({
    type: "skill.resolved",
    occurredAt,
    actor: systemActor,
    payload: {
      skillId: skill.skillId,
      source: skill.sourceKind,
      version: skill.version,
      contentHash: skill.contentHash,
      trustStatus: skill.trustStatus,
    },
  }));
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
      executionMode: session.executionMode,
      capabilities: session.effectiveCapabilities,
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
  resultArtifact: ManagedProviderResultArtifact;
  verificationStatus: "passed" | "failed" | "not_run";
  verificationArtifactIds: readonly string[];
  occurredAt: string;
}): ManagedEventSpec {
  return {
    type: "run.completed",
    occurredAt: input.occurredAt,
    actor: systemActor,
    payload: {
      resultDigest: input.resultArtifact.contentHash,
      artifactIds: [...new Set([
        input.resultArtifact.artifactId,
        ...input.verificationArtifactIds,
      ])],
      verificationStatus: input.verificationStatus,
    },
  };
}

export function verificationStartedSpec(input: {
  suite: VerificationSuite;
  repositoryRevision: string;
  occurredAt: string;
}): ManagedEventSpec {
  return {
    type: "verification.started",
    occurredAt: input.occurredAt,
    actor: systemActor,
    payload: {
      suiteId: input.suite.suiteId,
      suiteHash: verificationSuiteHash(input.suite),
      repositoryRevision: input.repositoryRevision,
    },
  };
}

export function verificationCompletedSpec(input: {
  result: VerificationResult;
  resultArtifactId: string;
  resultContentHash: string;
}): ManagedEventSpec {
  return {
    type: "verification.completed",
    occurredAt: input.result.completedAt,
    actor: systemActor,
    payload: {
      verificationId: input.result.verificationId,
      suiteId: input.result.suiteId,
      suiteHash: input.result.suiteHash,
      repositoryRevision: input.result.repositoryRevision,
      status: input.result.status,
      resultArtifactId: input.resultArtifactId,
      resultContentHash: input.resultContentHash,
      nonPassedCommandIds: input.result.commands
        .filter((command) => command.status !== "passed")
        .map((command) => command.commandId),
    },
  };
}

export function runFailedSpec(input: {
  failureCode: string;
  retryable: boolean;
  failures: ReadonlyArray<{ code: string; phase: string; retryable: boolean }>;
  occurredAt: string;
}): ManagedEventSpec {
  return {
    type: "run.failed",
    occurredAt: input.occurredAt,
    actor: systemActor,
    payload: {
      failureCode: input.failureCode,
      retryable: input.retryable,
      diagnosticDigest: digest({ failures: input.failures }),
    },
  };
}
