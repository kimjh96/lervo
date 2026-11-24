import type { RepositorySummary, WorkspaceSummary } from "@lervo/session-host-contract";

import type { ListCache, Lists } from "../../ports/lists";

const KEY = "lervo.lists";
/** The stored format; another version is ignored and replaced at the next save. */
const FORMAT = 1;
/** The most a stored copy may take, in UTF-16 code units; larger lists are not kept. */
const MAX_LENGTH = 512 * 1024;
/** The contract's bound on each list. */
const MAX_ITEMS = 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function isWorkspace(value: unknown): value is WorkspaceSummary {
  if (!isRecord(value)) return false;
  const required = [
    "workspaceId",
    "projectId",
    "repositoryName",
    "branch",
    "provider",
    "conversationMode",
    "sessionId",
    "preparedAt",
  ];
  return (
    required.every((field) => text(value[field])) &&
    (value.title === null || typeof value.title === "string") &&
    (value.conversationModes === undefined || Array.isArray(value.conversationModes))
  );
}

const isRepository = (value: unknown): value is RepositorySummary =>
  isRecord(value) && text(value.projectId) && text(value.name);

function parse(stored: string | null): Lists | null {
  if (stored === null) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (!isRecord(value) || value.format !== FORMAT) return null;
    const { workspaces, repositories } = value;
    if (
      !Array.isArray(workspaces) ||
      !Array.isArray(repositories) ||
      workspaces.length > MAX_ITEMS ||
      repositories.length > MAX_ITEMS ||
      !workspaces.every(isWorkspace) ||
      !repositories.every(isRepository)
    )
      return null;
    return { workspaces, repositories };
  } catch {
    return null;
  }
}

/**
 * The lists in the webview's local storage, beside the drafts. They hold workspace titles,
 * branches, and repository names, which this host's core already lists, and nothing a session
 * said. One copy of at most 512 Ki code units is kept; a larger one is dropped rather than cut.
 */
export function localLists(storage: Storage = localStorage): ListCache {
  return {
    load: () => parse(storage.getItem(KEY)),
    save(lists) {
      const serialized = JSON.stringify({ format: FORMAT, ...lists });
      try {
        if (serialized.length > MAX_LENGTH) storage.removeItem(KEY);
        else storage.setItem(KEY, serialized);
      } catch {
        // A full or refused storage keeps the previous copy; the core still answers each launch.
      }
    },
  };
}
