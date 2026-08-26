import {
  listWorkspaceCoordinationEvents,
  listWorkspaces,
  type AgentWorkspace,
  type WorkspaceCoordinationEvent,
} from "@lervo/agent-workforce";
import {
  hubWorkspaceCoordinationDigest,
  isHubWorkspaceSummary,
  type HubWorkspaceSummary,
} from "@lervo/hub-sync";

export interface HubWorkspaceSummaryTransport {
  publishWorkspaceSummary(summary: HubWorkspaceSummary): Promise<unknown>;
  readWorkspaceSummaries(): Promise<unknown>;
}

function verifiedBody(value: unknown): unknown | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as {
    authentication?: { status?: unknown };
    body?: unknown;
  };
  return response.authentication?.status === "verified" && "body" in response
    ? response.body
    : null;
}

export function hubWorkspaceSummaryFromEvent(input: {
  event: WorkspaceCoordinationEvent;
  workspace: AgentWorkspace;
  nodeId: string;
  repositoryIdentityHash: string;
}): HubWorkspaceSummary {
  if (
    input.event.workspaceId !== input.workspace.workspaceId ||
    input.event.generation !== input.workspace.generation ||
    input.event.assignmentId !== input.workspace.assignmentId ||
    input.event.repositoryInstanceId !== input.workspace.repositoryInstanceId
  )
    throw new Error("The workspace event differs from its local workspace identity.");
  const content = {
    schemaVersion: 1 as const,
    projectId: input.workspace.projectId,
    repositoryIdentityHash: input.repositoryIdentityHash,
    workspaceId: input.event.workspaceId,
    assignmentId: input.event.assignmentId,
    nodeId: input.nodeId,
    generation: input.event.generation,
    state: input.event.state,
    hostKind: input.event.hostKind,
    processObservation: "unavailable" as const,
    terminalCount: null,
    integrationEvidenceId: input.event.integrationEvidenceId,
    cleanupPlanId: input.event.cleanupPlanId,
    updatedAt: input.event.occurredAt,
  };
  return { ...content, contentHash: hubWorkspaceCoordinationDigest(content) };
}

export async function reconcileHubWorkspaceSummaries(input: {
  repositoryRoot: string;
  nodeId: string;
  repositoryIdentityHash: string;
  transport: HubWorkspaceSummaryTransport;
}): Promise<{ published: number; skipped: number }> {
  const remoteBody = verifiedBody(await input.transport.readWorkspaceSummaries());
  if (
    remoteBody === null ||
    typeof remoteBody !== "object" ||
    Array.isArray(remoteBody) ||
    !Array.isArray((remoteBody as { summaries?: unknown }).summaries) ||
    !(remoteBody as { summaries: unknown[] }).summaries.every(isHubWorkspaceSummary)
  )
    throw new Error("The Hub workspace summary read was not authenticated and valid.");
  const remote = new Map(
    ((remoteBody as { summaries: HubWorkspaceSummary[] }).summaries ?? []).map((summary) => [
      summary.workspaceId,
      summary,
    ]),
  );
  const workspaces = new Map(
    (await listWorkspaces(input.repositoryRoot)).map((workspace) => [
      workspace.workspaceId,
      workspace,
    ]),
  );
  let published = 0;
  let skipped = 0;
  for (const event of await listWorkspaceCoordinationEvents(input.repositoryRoot)) {
    const workspace = workspaces.get(event.workspaceId);
    if (workspace === undefined) throw new Error("A local workspace event has no current record.");
    const current = remote.get(event.workspaceId);
    if (
      current !== undefined &&
      (current.generation > event.generation ||
        (current.generation === event.generation &&
          Date.parse(current.updatedAt) >= Date.parse(event.occurredAt)))
    ) {
      skipped += 1;
      continue;
    }
    const summary = hubWorkspaceSummaryFromEvent({
      event,
      workspace,
      nodeId: input.nodeId,
      repositoryIdentityHash: input.repositoryIdentityHash,
    });
    const result = verifiedBody(await input.transport.publishWorkspaceSummary(summary));
    if (
      result === null ||
      typeof result !== "object" ||
      Array.isArray(result) ||
      !["created", "updated", "duplicate"].includes(String((result as { status?: unknown }).status))
    )
      throw new Error("The Hub workspace summary write was not authenticated and valid.");
    remote.set(event.workspaceId, summary);
    published += 1;
  }
  return { published, skipped };
}
