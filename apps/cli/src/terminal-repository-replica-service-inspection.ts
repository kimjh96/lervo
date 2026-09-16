import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import type { TerminalLifecycleInspection } from "./terminal-hook-contract.js";

const serviceLabel = "dev.lervo.repository-replica";
const maximumDefinitionBytes = 128 * 1024;

type LifecycleIssue = TerminalLifecycleInspection["issues"][number];

function launchdServiceLoaded(uid: number): Promise<boolean> {
  return new Promise((done) => {
    execFile(
      "launchctl",
      ["print", `gui/${uid}/${serviceLabel}`],
      { encoding: "utf8", maxBuffer: 4_096, timeout: 5_000 },
      (error) => done(error === null),
    );
  });
}

export async function inspectTerminalRepositoryReplicaService(
  input: {
    platform?: NodeJS.Platform;
    homeDirectory?: string;
    uid?: number;
    serviceLoaded?: (uid: number) => Promise<boolean>;
  } = {},
): Promise<LifecycleIssue[]> {
  if ((input.platform ?? process.platform) !== "darwin") return [];
  const definition = resolve(
    input.homeDirectory ?? homedir(),
    "Library",
    "LaunchAgents",
    `${serviceLabel}.plist`,
  );
  let metadata;
  try {
    metadata = await lstat(definition);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [
      {
        code: "repository_replica_service_inspection_failed",
        command: "inspect the installed repository replica service",
      },
    ];
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumDefinitionBytes ||
    (metadata.mode & 0o077) !== 0
  ) {
    return [
      {
        code: "repository_replica_service_definition_unsafe",
        command: "review the owner-only repository replica service definition",
      },
    ];
  }
  const uid = input.uid ?? process.getuid?.();
  if (uid === undefined) {
    return [
      {
        code: "repository_replica_service_inspection_failed",
        command: "inspect the installed repository replica service",
      },
    ];
  }
  const loaded = await (input.serviceLoaded ?? launchdServiceLoaded)(uid);
  return loaded
    ? []
    : [
        {
          code: "repository_replica_service_inactive",
          command:
            'launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/dev.lervo.repository-replica.plist"',
        },
      ];
}
