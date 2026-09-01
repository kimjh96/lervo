import { randomUUID } from "node:crypto";

import type { EventDraft, EventDraftV1 } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import { sha256, type TerminalIntegrationProvider } from "@lervo/repository-knowledge";

import type {
  ParsedTerminalHookInput,
  UnmanagedTerminalCoordinates,
} from "./terminal-hook-contract.js";

export const TERMINAL_OBSERVATION_POLICY_VERSION = sha256(
  "lervo.terminal.unmanaged-observation.v1",
);

export function allTerminalEvents(events: ProjectStorage["events"]): EventEnvelope[] {
  const result: EventEnvelope[] = [];
  let afterSeq = 0;
  while (true) {
    const batch = events.list({ afterSeq, limit: 1000 });
    if (batch.length === 0) break;
    result.push(...batch);
    afterSeq = batch.at(-1)!.seq;
    if (batch.length < 1000) break;
  }
  return result;
}

function digestSuffix(digest: string): string {
  return digest.slice("sha256:".length, "sha256:".length + 24);
}

export function unmanagedTerminalCoordinates(
  provider: TerminalIntegrationProvider,
  input: ParsedTerminalHookInput,
): UnmanagedTerminalCoordinates {
  const providerSessionDigest = sha256(`${provider}\0${input.providerSessionId}`);
  const providerTurnDigest =
    input.providerTurnId === null
      ? null
      : sha256(`${provider}\0${input.providerSessionId}\0${input.providerTurnId}`);
  const suffix = digestSuffix(providerSessionDigest);
  return {
    runId: `run_unmanaged_${suffix}`,
    sessionId: `ses_unmanaged_${suffix}`,
    providerSessionDigest,
    providerTurnDigest,
  };
}

export function newTerminalIdentifier(prefix: "evt" | "tobs" | "tdecl"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function assertTerminalRepositoryRelativePath(path: string): void {
  const normalized = path.replaceAll("\\", "/");
  if (
    path === "" ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized.split("/").includes("..")
  )
    throw new Error("Prepared context contains an unsafe repository path.");
}

export function terminalEventDraft(input: {
  eventId?: string;
  projectId: string;
  coordinates: UnmanagedTerminalCoordinates;
  provider: TerminalIntegrationProvider;
  actorKind?: "provider" | "agent" | "user";
  type: EventDraftV1["type"];
  occurredAt: string;
  payload: Readonly<Record<string, unknown>>;
}): EventDraft {
  return {
    eventId: input.eventId ?? newTerminalIdentifier("evt"),
    projectId: input.projectId,
    runId: input.coordinates.runId,
    sessionId: input.coordinates.sessionId,
    type: input.type,
    occurredAt: input.occurredAt,
    actor: { kind: input.actorKind ?? "provider", provider: input.provider },
    schemaVersion: 1,
    policyVersion: TERMINAL_OBSERVATION_POLICY_VERSION,
    payload: input.payload,
  };
}
