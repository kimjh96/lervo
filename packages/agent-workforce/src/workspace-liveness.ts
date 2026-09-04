import type { AgentWorkspace } from "./workspace-types.js";

export interface WorkspaceWriterLiveness {
  schemaVersion: 1;
  status: "absent" | "recently_observed" | "stale_observation" | "legacy_unknown";
  lastSeenAt: string | null;
  ageMs: number | null;
  staleAfterMs: number;
  releasesWriterAuthority: false;
}

export function observeWorkspaceWriterLiveness(input: {
  workspace: AgentWorkspace;
  observedAt: Date;
  staleAfterMs?: number;
}): WorkspaceWriterLiveness {
  const staleAfterMs = input.staleAfterMs ?? 2 * 60 * 1_000;
  if (
    !Number.isSafeInteger(staleAfterMs) ||
    staleAfterMs < 1_000 ||
    staleAfterMs > 24 * 60 * 60 * 1_000
  )
    throw new Error("The workspace liveness threshold is invalid.");
  if (input.workspace.writerSession === null)
    return {
      schemaVersion: 1,
      status: "absent",
      lastSeenAt: null,
      ageMs: null,
      staleAfterMs,
      releasesWriterAuthority: false,
    };
  const lastSeenAt = input.workspace.writerSession.lastSeenAt;
  if (lastSeenAt === undefined)
    return {
      schemaVersion: 1,
      status: "legacy_unknown",
      lastSeenAt: null,
      ageMs: null,
      staleAfterMs,
      releasesWriterAuthority: false,
    };
  const ageMs = Math.max(0, input.observedAt.getTime() - Date.parse(lastSeenAt));
  return {
    schemaVersion: 1,
    status: ageMs > staleAfterMs ? "stale_observation" : "recently_observed",
    lastSeenAt,
    ageMs,
    staleAfterMs,
    releasesWriterAuthority: false,
  };
}
