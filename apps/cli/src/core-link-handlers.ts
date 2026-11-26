import type {
  HostedDecodedContent,
  HostedStreamDecoder,
  HostedTranscriptItem,
  HostedTurnUsage,
} from "@lervo/adapter-contract";
import type { ResourceAccountingDescriptor } from "@lervo/schemas";

import type { HostedProviderSummary } from "./hosted-session-adapters.js";
import type { HostedTurnUsageOutcome } from "./hosted-turn-usage-events.js";
import type { RepositorySummary, WorkspaceSummary } from "./workspace-list-service.js";
import type { WorkspaceStartResult } from "./workspace-start.js";
import type { WorkspaceOpenResult } from "./workspace-launch-service.js";
import type { RoomJoinResult } from "./workspace-room.js";
import type { RoomContext } from "./room-router.js";

/** What the core link asks of the Lervo core. Failures are thrown with a stable `code`. */
export interface CoreLinkHandlers {
  startWorkspace(arguments_: Record<string, unknown>): Promise<WorkspaceStartResult>;
  listWorkspaces(): Promise<{ workspaces: WorkspaceSummary[] }>;
  listRepositories(): Promise<{ repositories: RepositorySummary[] }>;
  listProviders(): Promise<{ providers: HostedProviderSummary[]; defaultProvider: string }>;
  openWorkspace(workspaceId: string, mode?: "native" | "cli"): Promise<WorkspaceOpenResult>;
  createDecoder(provider: string): HostedStreamDecoder;
  readTranscript(
    workspaceId: string,
    offset: number,
    limit: number,
  ): Promise<{ items: HostedTranscriptItem[]; complete: boolean }>;
  /** Retires a hosted workspace without discarding work. */
  retireWorkspace(workspaceId: string): Promise<object>;
  /** Answers a project command (Lervo ADE projects, "Core link"). */
  runProjectCommand?(command: string, arguments_: Record<string, unknown>): Promise<object>;
  /** Answers an agent command (Lervo ADE agents, "Core link"). */
  runAgentCommand?(command: string, arguments_: Record<string, unknown>): Promise<object>;
  /** Prepares an agent's session in a conversation (Lervo ADE rooms). */
  joinRoom?(arguments_: Record<string, unknown>): Promise<RoomJoinResult>;
  /** What the core knows of a session's conversation, for routing its mentions. */
  loadRoomContext?(sessionId: string): Promise<RoomContext | null>;
  /** The agents an owner's turn goes to (Lervo ADE rooms, "Routing"). */
  routeRoom?(arguments_: Record<string, unknown>): Promise<{ agents: string[] }>;
  /** What the core recorded about turns of a workspace's hosted session. */
  summarizeTurns?(arguments_: Record<string, unknown>): Promise<object>;
  /** Records a hosted session's process exit unless its own hook recorded the end. */
  recordSessionExit(sessionId: string, exitCode: number | null): Promise<{ status: string }>;
  /**
   * What the core adds to a decoded or transcript item before the session host receives it, such
   * as the Lervo command a shell call ran.
   */
  annotate?(content: HostedDecodedContent): HostedDecodedContent;
  /** Records the usage a hosted session's decoder reported for its finished turns. */
  recordTurnUsage(
    sessionId: string,
    accounting: ResourceAccountingDescriptor,
    usage: readonly HostedTurnUsage[],
  ): Promise<HostedTurnUsageOutcome>;
}
