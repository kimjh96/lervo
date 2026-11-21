import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  localProcessAlive,
  localProcessIdentity,
  type LocalProcessIdentity,
} from "@lervo/project-storage";

/**
 * ADR-0602: one record per watching process and wake source while that source cannot deliver
 * wakes: the repository watch, or a Hub change wait. Only its owner writes or clears it, and a
 * reader counts it only while that process lives.
 */
export const REPOSITORY_WATCH_STATE_DIRECTORY = ".lervo/state/repository-watch";

export type WakeSourceIssueCode =
  | "repository_watch_unavailable"
  | "hub_knowledge_changes_unavailable"
  | "hub_runtime_changes_unavailable"
  | "hub_upgrade_required"
  | "process_presence_unavailable"
  | "process_exit_wait_unavailable"
  | "conversation_change_signal_unavailable";

const CODES: ReadonlySet<string> = new Set<WakeSourceIssueCode>([
  "repository_watch_unavailable",
  "hub_knowledge_changes_unavailable",
  "hub_runtime_changes_unavailable",
  "hub_upgrade_required",
  "process_presence_unavailable",
  "process_exit_wait_unavailable",
  "conversation_change_signal_unavailable",
]);

export interface RepositoryWatchIssue {
  code: WakeSourceIssueCode;
  /** The errno, or the Hub failure code, when one is known. */
  errno: string | null;
  detail: string;
  command: string;
}

interface RepositoryWatchRecord extends RepositoryWatchIssue {
  identity: LocalProcessIdentity;
}

function remediation(code: WakeSourceIssueCode, errno: string | null): string {
  if (code === "process_presence_unavailable")
    return "make this user's Lervo state directory (and its run/presence directory) owned by this user and closed to everyone else, then restart the Lervo services";
  if (code === "conversation_change_signal_unavailable")
    return "raise the file watch limit (Linux: sysctl fs.inotify.max_user_watches=524288) and restart the Lervo Node";
  if (code === "process_exit_wait_unavailable")
    return "run every Lervo service for this repository as one user, in one container or namespace and with one LERVO_USER_STATE_DIRECTORY; restart a Lervo process that is stuck";
  if (code === "hub_upgrade_required")
    return "upgrade the Hub to this Lervo release first (deploy the Hub before Nodes and hosts); until then each repository runs one full knowledge cycle an hour";
  if (code !== "repository_watch_unavailable")
    return "check that the Hub is running and reachable and that this host's Hub token is valid; the wait reconnects on its own";
  switch (errno) {
    case "ENOSPC":
      return "raise the file watch limit (Linux: sysctl fs.inotify.max_user_watches=524288) and restart the Lervo services";
    case "EMFILE":
    case "ENFILE":
      return "raise the open file limit for the Lervo services and restart them";
    default:
      return "move the repository to a filesystem with change notifications, then restart the Lervo services";
  }
}

export interface RepositoryWatchReporter {
  /** Records why this watch failed. Never throws. */
  failed(error: unknown): Promise<void>;
  /** Clears this watch's record once it is armed, or when it stops. Never throws. */
  armed(): Promise<void>;
}

function detail(code: WakeSourceIssueCode, errno: string | null): string {
  const cause = errno ?? "unknown error";
  switch (code) {
    case "repository_watch_unavailable":
      return `Repository changes cannot be watched (${cause}), so edits wake nothing until the watch is armed.`;
    case "hub_knowledge_changes_unavailable":
      return `The Hub's knowledge change wait failed (${cause}), so lease releases, owner rules and host records from other hosts wake nothing until it reconnects.`;
    case "process_presence_unavailable":
      return `This process could not hold its presence socket (${cause}), so readers cannot prove it runs and judge it by its last write's age.`;
    case "conversation_change_signal_unavailable":
      return `A Node conversation loop has no change signal (${cause}), so it checks on its interval instead of waiting for a change.`;
    case "process_exit_wait_unavailable":
      return `This process cannot see the exit of the process it waits behind (${cause}), so it moves on only when that process's record changes or its lease ends.`;
    case "hub_upgrade_required":
      return `The Hub is older than this release and refuses its newer waits (${cause}), so lease releases, owner rules and host records from other hosts are picked up only by an hourly full cycle, and Node waits use the older bounded hold.`;
    case "hub_runtime_changes_unavailable":
      return `The Hub's runtime change wait failed (${cause}), so Hub workstreams and commands wake nothing until it reconnects.`;
  }
}

export function repositoryWatchReporter(
  root: string,
  code: WakeSourceIssueCode = "repository_watch_unavailable",
): RepositoryWatchReporter {
  const identity = localProcessIdentity();
  const id = `${identity.boot}-${identity.pid}-${randomBytes(6).toString("hex")}`;
  const path = resolve(root, REPOSITORY_WATCH_STATE_DIRECTORY, `${id}.json`);
  return {
    failed: async (error) => {
      try {
        const failure = error as { code?: unknown; failureCode?: unknown } | null;
        const named = failure?.failureCode ?? failure?.code;
        const errno = typeof named === "string" ? named : null;
        const record: RepositoryWatchRecord = {
          code,
          errno,
          detail: detail(code, errno),
          command: remediation(code, errno),
          identity,
        };
        await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
        const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
        await writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
        await rename(temporary, path);
      } catch {
        // The state directory is unwritable; the service's own health reports its failure.
      }
    },
    armed: async () => {
      await rm(path, { force: true }).catch(() => undefined);
    },
  };
}

/** The issues of every live process whose repository watch is not armed. */
export async function readRepositoryWatchIssues(root: string): Promise<RepositoryWatchIssue[]> {
  const directory = resolve(root, REPOSITORY_WATCH_STATE_DIRECTORY);
  let names: string[];
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const issues: RepositoryWatchIssue[] = [];
  for (const name of names) {
    try {
      const value = JSON.parse(
        await readFile(resolve(directory, name), "utf8"),
      ) as Partial<RepositoryWatchRecord>;
      if (value.code === undefined || !CODES.has(value.code) || value.identity === undefined)
        continue;
      // A record of a process proven gone (dead, or of another boot of this host) is removed; one
      // that cannot be judged here stays visible.
      if (localProcessAlive(value.identity) === false) {
        await rm(resolve(directory, name), { force: true });
        continue;
      }
      issues.push({
        code: value.code,
        errno: value.errno ?? null,
        detail: String(value.detail),
        command: String(value.command),
      });
    } catch {
      // Removed or partially written meanwhile.
    }
  }
  return issues;
}

/**
 * ADR-0602: attention for an issue reported as text, then null once it clears: written on the
 * first report, rewritten when it changes, and cleared by null or `clear`. Never throws.
 */
export function issueAttention(
  root: string,
  code: WakeSourceIssueCode,
): { report(issue: string | null): void; clear(): Promise<void> } {
  let reporter: RepositoryWatchReporter | null = null;
  let last: string | null = null;
  let writing: Promise<void> = Promise.resolve();
  const report = (issue: string | null) => {
    if (issue === last) return;
    last = issue;
    reporter ??= repositoryWatchReporter(root, code);
    const target = reporter;
    writing = writing.then(() =>
      issue === null ? target.armed() : target.failed(Object.assign(new Error(issue), { code })),
    );
  };
  return {
    report,
    clear: async () => {
      if (last !== null) report(null);
      await writing;
    },
  };
}
