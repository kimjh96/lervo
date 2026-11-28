import { MAXIMUM_OWNER_TITLE_CHARACTERS } from "@lervo/session-host-contract";

import { CommandFailure } from "./command-error-output.js";
import {
  changeHostedConversationProfile,
  type HostedConversationChange,
  hostedConversationProfilesPath,
} from "./hosted-conversation-profiles.js";
import { hostedLaunchRecordsPath, hostedWorkspaceIds } from "./hosted-launch-records.js";

/** Where a workspace command reads the launch records and keeps the owner's choices. */
export interface WorkspaceCommandPaths {
  readonly records: string;
  readonly profiles: string;
}

const defaultPaths = (): WorkspaceCommandPaths => ({
  records: hostedLaunchRecordsPath(),
  profiles: hostedConversationProfilesPath(),
});

/** The title the owner typed, its spaces collapsed, or a failure when nothing or too much is left. */
function ownerTitle(value: unknown): string {
  const title = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  if (title.length === 0 || [...title].length > MAXIMUM_OWNER_TITLE_CHARACTERS)
    throw new CommandFailure(
      "workspace_argument_invalid",
      `title holds 1 to ${MAXIMUM_OWNER_TITLE_CHARACTERS} characters.`,
    );
  return title;
}

function pinned(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new CommandFailure("workspace_argument_invalid", "pinned is true or false.");
  return value;
}

/**
 * Answers `workspace.rename` and `workspace.pin` (Lervo ADE sessions, "Renaming and pinning"): the
 * owner's title for a conversation and its pin, kept host-side beside the launch records, so they
 * survive the agent's workstream updates and a reinstalled interface. A workspace without a kept
 * launch record fails with `workspace_not_found`.
 */
export async function runCoreLinkWorkspaceCommand(
  command: string,
  workspaceId: string,
  arguments_: Record<string, unknown>,
  paths: WorkspaceCommandPaths = defaultPaths(),
): Promise<object> {
  const change: HostedConversationChange =
    command === "workspace.rename"
      ? { title: ownerTitle(arguments_.title) }
      : { pinned: pinned(arguments_.pinned) };
  const kept = await hostedWorkspaceIds(paths.records);
  if (!kept.has(workspaceId))
    throw new CommandFailure("workspace_not_found", "No hosted launch names the workspace.");
  const profile = await changeHostedConversationProfile(paths.profiles, workspaceId, change, kept);
  return "title" in change
    ? { workspaceId, title: change.title }
    : { workspaceId, pinnedAt: profile?.pinnedAt ?? null };
}
