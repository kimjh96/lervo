import { randomUUID } from "node:crypto";

import type { EventDraft, EventDraftV1 } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import { sha256, type TerminalIntegrationProvider } from "@lervo/repository-knowledge";
import { visitEventsOfTypes } from "@lervo/storage-contract";

import type {
  ParsedTerminalHookInput,
  UnmanagedTerminalCoordinates,
} from "./terminal-hook-contract.js";

export const TERMINAL_OBSERVATION_POLICY_VERSION = sha256(
  "lervo.terminal.unmanaged-observation.v1",
);

export const TERMINAL_HOOK_BUILD_DIGEST = sha256(
  "lervo.terminal.hook-runtime.degraded-context-and-native-skill.v6",
);

/**
 * The last event of one type that matches, through the observed head. A typed read retains only
 * that event, so the length of history bounds neither memory nor success (ADR-0554).
 */
export function latestTerminalEventOfType(
  events: Pick<ProjectStorage["events"], "latest" | "list">,
  type: string,
  matches: (event: EventEnvelope) => boolean,
): EventEnvelope | undefined {
  let latest: EventEnvelope | undefined;
  visitEventsOfTypes({
    events,
    types: [type],
    throughSeq: events.latest()?.seq ?? 0,
    visit: (event) => {
      if (matches(event)) latest = event;
    },
  });
  return latest;
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
