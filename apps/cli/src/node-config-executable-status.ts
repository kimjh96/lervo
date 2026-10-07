import { readFile } from "node:fs/promises";
import { homedir } from "node:os";

import {
  inspectNodeConfiguredExecutables,
  listNodeConfiguredExecutables,
  loadNodeRuntimeConfig,
  type NodeConfiguredExecutableProblem,
} from "@lervo/node-runtime";
import {
  nodeFleetServiceTargetPath,
  type NodeFleetInstanceRegistration,
} from "@lervo/repository-registry";

import { currentCliInstallRoot, runningCliInstallRoot } from "./cli-install-pointer.js";
import { planNodeConfigExecutableMigration } from "./node-config-executable-migration.js";
import { nodeRuntimesDirectory } from "./node-runtime-pointer.js";
import { readNodeServiceCoordinates } from "./node-service-coordinates.js";

/**
 * ADR-0487: what a registered Node's configuration names, observed before the next restart.
 * `attention` means a restart would fail or degrade because a configured executable is unusable;
 * `pinnedFields` names the fields that `lervo upgrade` would move to the host's stable pointers.
 */
export interface NodeConfiguredExecutablesReport {
  status: "ready" | "attention" | "unavailable";
  missing: Array<Pick<NodeConfiguredExecutableProblem, "field" | "path" | "kind" | "problem">>;
  pinnedFields: string[];
}

const unavailable: NodeConfiguredExecutablesReport = {
  status: "unavailable",
  missing: [],
  pinnedFields: [],
};

/** Read-only: follows the installed service definition to its configuration. */
export async function inspectRegisteredNodeExecutables(input: {
  registration: Pick<NodeFleetInstanceRegistration, "serviceManager" | "serviceIdentity">;
  homeDirectory?: string;
}): Promise<NodeConfiguredExecutablesReport> {
  const home = input.homeDirectory ?? homedir();
  let configPath: string;
  try {
    configPath = (
      await readNodeServiceCoordinates({
        manager: input.registration.serviceManager,
        path: nodeFleetServiceTargetPath(
          home,
          input.registration.serviceManager,
          input.registration.serviceIdentity,
        ),
      })
    ).config;
  } catch {
    return unavailable;
  }
  const [config, content] = await Promise.all([
    loadNodeRuntimeConfig(configPath).catch(() => null),
    readFile(configPath, "utf8").catch(() => null),
  ]);
  if (config === null || content === null) return unavailable;
  const problems = await inspectNodeConfiguredExecutables(listNodeConfiguredExecutables(config));
  const migration = planNodeConfigExecutableMigration({
    content,
    cliPointerRoot: currentCliInstallRoot(home),
    runningInstallRoot: await runningCliInstallRoot(),
    nodeRuntimesDirectory: nodeRuntimesDirectory(home),
    nodeRuntimePointerPresent: true,
  });
  return {
    status: problems.length === 0 ? "ready" : "attention",
    missing: problems.map(({ field, path, kind, problem }) => ({ field, path, kind, problem })),
    pinnedFields: migration.rewrites.map((rewrite) => rewrite.field),
  };
}
