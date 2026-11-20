import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  localProcessAlive,
  localProcessIdentity,
  type LocalProcessIdentity,
} from "@lervo/project-storage";

/**
 * ADR-0602: one record per watching process while its repository watch cannot be armed. Only
 * its owner writes or clears it, and a reader counts it only while that process lives.
 */
export const REPOSITORY_WATCH_STATE_DIRECTORY = ".lervo/state/repository-watch";

export interface RepositoryWatchIssue {
  code: "repository_watch_unavailable";
  errno: string | null;
  detail: string;
  command: string;
}

interface RepositoryWatchRecord extends RepositoryWatchIssue {
  identity: LocalProcessIdentity;
}

function remediation(errno: string | null): string {
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

export function repositoryWatchReporter(root: string): RepositoryWatchReporter {
  const identity = localProcessIdentity();
  const id = `${identity.boot}-${identity.pid}-${randomBytes(6).toString("hex")}`;
  const path = resolve(root, REPOSITORY_WATCH_STATE_DIRECTORY, `${id}.json`);
  return {
    failed: async (error) => {
      try {
        const errno = (error as NodeJS.ErrnoException | null)?.code ?? null;
        const record: RepositoryWatchRecord = {
          code: "repository_watch_unavailable",
          errno,
          detail: `Repository changes cannot be watched (${errno ?? "unknown error"}), so edits wake nothing until the watch is armed.`,
          command: remediation(errno),
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
      if (value.code !== "repository_watch_unavailable" || value.identity === undefined) continue;
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
