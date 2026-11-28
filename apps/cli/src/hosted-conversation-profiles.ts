// What the owner set for a hosted conversation (Lervo ADE sessions, "Renaming and pinning"): its
// title and whether it is pinned. Host-local, owner-only state beside the hosted launch records.
// The workstream title stays the agent's, and launch records are appended per launch, so neither
// can hold an owner's choice that must survive the agent's updates and every reopen.
import { dirname, resolve } from "node:path";

import { readPrivateJsonFile, writePrivateJsonFile } from "@lervo/repository-knowledge-runtime";

import { HOSTED_LAUNCH_RECORD_LIMIT, hostedLaunchRecordsPath } from "./hosted-launch-records.js";

const MAX_FILE_BYTES = 1024 * 1024;

/** The owner's choices for one conversation; a conversation without any has no profile. */
export interface HostedConversationProfile {
  readonly workspaceId: string;
  /** The title the owner gave it, which replaces its workstream title in every list. */
  readonly title?: string;
  /** When the owner pinned it, so the list shows it first. */
  readonly pinnedAt?: string;
}

/** What one change sets: a new title, or the conversation pinned or unpinned. */
export type HostedConversationChange = { title: string } | { pinned: boolean };

/** Where the profiles live: beside the hosted launch records, in the user state directory. */
export function hostedConversationProfilesPath(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(dirname(hostedLaunchRecordsPath(environment)), "hosted-conversations.json");
}

function isProfile(value: unknown): value is HostedConversationProfile {
  const profile = value as Partial<HostedConversationProfile> | null;
  return (
    typeof profile?.workspaceId === "string" &&
    (profile.title === undefined || typeof profile.title === "string") &&
    (profile.pinnedAt === undefined || typeof profile.pinnedAt === "string")
  );
}

/** Every kept profile by workspace ID; an absent or unreadable file holds none. */
export async function readHostedConversationProfiles(
  path: string,
): Promise<Map<string, HostedConversationProfile>> {
  const file = await readPrivateJsonFile(path, MAX_FILE_BYTES);
  if (file.status !== "read") return new Map();
  const profiles = (file.value as { conversations?: unknown }).conversations;
  return new Map(
    (Array.isArray(profiles) ? profiles.filter(isProfile) : []).map((profile) => [
      profile.workspaceId,
      profile,
    ]),
  );
}

/** The title the owner gave a conversation, or null when it gave none. */
export async function ownerConversationTitle(
  path: string,
  workspaceId: string,
): Promise<string | null> {
  return (await readHostedConversationProfiles(path)).get(workspaceId)?.title ?? null;
}

/** The profile after `change`, or null when it no longer holds a choice. */
function changed(
  workspaceId: string,
  before: HostedConversationProfile | undefined,
  change: HostedConversationChange,
  now: Date,
): HostedConversationProfile | null {
  const title = "title" in change ? change.title : before?.title;
  const pinnedAt =
    "pinned" in change
      ? change.pinned
        ? (before?.pinnedAt ?? now.toISOString())
        : undefined
      : before?.pinnedAt;
  if (title === undefined && pinnedAt === undefined) return null;
  return {
    workspaceId,
    ...(title === undefined ? {} : { title }),
    ...(pinnedAt === undefined ? {} : { pinnedAt }),
  };
}

/**
 * Applies one change to a conversation's profile and returns the profile, or null when it holds
 * nothing any longer. Profiles of conversations without a kept launch record are dropped, so the
 * file never holds more than the launch records name.
 */
export async function changeHostedConversationProfile(
  path: string,
  workspaceId: string,
  change: HostedConversationChange,
  kept: ReadonlySet<string>,
  now = new Date(),
): Promise<HostedConversationProfile | null> {
  const profiles = await readHostedConversationProfiles(path);
  const profile = changed(workspaceId, profiles.get(workspaceId), change, now);
  profiles.delete(workspaceId);
  if (profile !== null) profiles.set(workspaceId, profile);
  const conversations = [...profiles.values()]
    .filter((entry) => kept.has(entry.workspaceId))
    .slice(-HOSTED_LAUNCH_RECORD_LIMIT);
  await writePrivateJsonFile(path, { schemaVersion: 1, conversations });
  return profile;
}
