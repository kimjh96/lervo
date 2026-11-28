import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import { defaultRepositoryRegistryPath } from "@lervo/repository-registry";
import {
  readConvergenceOwnerHost,
  type ConvergenceOwnerHubCandidate,
} from "@lervo/repository-knowledge-runtime";

import { hostRepositoryRoots } from "./knowledge-host-repositories.js";
import { registeredNodeHubCoordinates } from "./knowledge-node-hub-coordinates.js";

type HubCoordinates = ConvergenceOwnerHubCandidate["hub"];

const PROJECT_TOKEN = ["secrets", "hub-sync.token"] as const;

/**
 * Directories that hold per-project Node material (`<projectId>/config.json`, and
 * `<projectId>/secrets/hub-sync.token`): beside the user state directory, and on Linux also
 * `$XDG_CONFIG_HOME/lervo/nodes` (default `~/.config/lervo/nodes`).
 */
export function projectNodeDirectories(environment: NodeJS.ProcessEnv = process.env): string[] {
  const directories: string[] = [];
  try {
    directories.push(resolve(dirname(defaultRepositoryRegistryPath(environment)), "nodes"));
  } catch {
    // An unsafe state directory override contributes nothing.
  }
  if (process.platform === "linux") {
    const config = environment.XDG_CONFIG_HOME;
    directories.push(
      resolve(
        config !== undefined && isAbsolute(config) ? config : resolve(homedir(), ".config"),
        "lervo",
        "nodes",
      ),
    );
  }
  return [...new Set(directories)];
}

async function regularFile(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => null);
  return info !== null && info.isFile() && !info.isSymbolicLink();
}

/** Only the Hub block of a per-project Node configuration; continuity validates it again. */
async function projectConfigHub(directory: string): Promise<HubCoordinates | null> {
  try {
    const value = JSON.parse(await readFile(resolve(directory, "config.json"), "utf8")) as {
      hub?: Record<string, unknown>;
    };
    const hub = value.hub;
    if (
      typeof hub?.baseUrl !== "string" ||
      typeof hub.bearerTokenFile !== "string" ||
      typeof hub.destinationId !== "string" ||
      typeof hub.hubIdentityHash !== "string"
    )
      return null;
    return {
      baseUrl: hub.baseUrl,
      bearerTokenFile: isAbsolute(hub.bearerTokenFile)
        ? hub.bearerTokenFile
        : resolve(directory, hub.bearerTokenFile),
      destinationId: hub.destinationId,
      hubIdentityHash: hub.hubIdentityHash,
    };
  } catch {
    return null;
  }
}

/**
 * This project's own Hub credential: the Hub block of its per-project Node configuration, or
 * just its `secrets/hub-sync.token`. Hub credentials are scoped per project, so another
 * repository's token is only a last resort that the probe must prove for this project.
 */
async function projectCredential(
  projectId: string,
  directories: readonly string[],
): Promise<{ hub: HubCoordinates | null; tokenFile: string | null }> {
  for (const base of directories) {
    const directory = resolve(base, projectId);
    const hub = await projectConfigHub(directory);
    if (hub !== null) return { hub, tokenFile: hub.bearerTokenFile };
    const token = resolve(directory, ...PROJECT_TOKEN);
    if (await regularFile(token)) return { hub: null, tokenFile: token };
  }
  return { hub: null, tokenFile: null };
}

/**
 * ADR-0469/0470 Hub coordinates for a CLI-hosted resident, most specific first: the Node
 * registered for this exact checkout, this project's own credential (its per-project Node
 * configuration, or its token paired with a Hub another repository on this host uses), or, without
 * a token, that Hub paired with the path where its own token belongs. Another repository's token is
 * never offered (ADR-0656). A candidate is only a proposal; continuity probes it before using it.
 */
export async function knowledgeHostHubCandidates(
  repositoryRoot: string,
  nodeDirectories: readonly string[] = projectNodeDirectories(),
): Promise<ConvergenceOwnerHubCandidate[]> {
  const candidates: ConvergenceOwnerHubCandidate[] = [];
  const add = (
    hub: HubCoordinates,
    source: ConvergenceOwnerHubCandidate["source"],
    credential?: ConvergenceOwnerHubCandidate["credential"],
  ) => {
    if (
      candidates.length < 4 &&
      !candidates.some((candidate) => JSON.stringify(candidate.hub) === JSON.stringify(hub))
    )
      candidates.push({
        source,
        hub: { ...hub },
        ...(credential === undefined ? {} : { credential }),
      });
  };
  const node = await registeredNodeHubCoordinates(repositoryRoot);
  if (node !== null) add(node, "node_runtime");
  const projectId = await loadProjectManifest(repositoryRoot).then(
    (manifest) => manifest.projectId,
    () => null,
  );
  const own =
    projectId === null
      ? { hub: null, tokenFile: null }
      : await projectCredential(projectId, nodeDirectories);
  if (own.hub !== null) add(own.hub, "host_repository");
  const self = await realpath(resolve(repositoryRoot)).catch(() => resolve(repositoryRoot));
  const others: HubCoordinates[] = [];
  for (const root of await hostRepositoryRoots()) {
    if (root === self) continue;
    const host = await readConvergenceOwnerHost(root).catch(() => null);
    if (host?.config.coordination.mode === "hub") others.push(host.config.coordination.hub);
  }
  if (own.tokenFile !== null)
    for (const hub of others) add({ ...hub, bearerTokenFile: own.tokenFile }, "host_repository");
  // ADR-0656: another repository's token is never offered. Without a token of its own, the
  // project is offered the Hub other repositories use with the path where its own token belongs,
  // so the coordinates start working once the operator places that token.
  else if (projectId !== null && others[0] !== undefined)
    add(
      {
        ...others[0],
        bearerTokenFile: resolve(
          nodeDirectories[0] ?? resolve(homedir(), ".lervo", "nodes"),
          projectId,
          ...PROJECT_TOKEN,
        ),
      },
      "host_repository",
      "absent",
    );
  return candidates;
}
