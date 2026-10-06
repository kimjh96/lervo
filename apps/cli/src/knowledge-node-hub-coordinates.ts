import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  createNodeFleetOnboardingPlan,
  defaultNodeFleetRegistryPath,
  listNodeFleetInstances,
} from "@lervo/repository-registry";
import type { ConvergenceOwnerHubCandidate } from "@lervo/repository-knowledge-runtime";
import { readOwnerOnlyText } from "@lervo/runtime-security";

import { readNodeServiceCoordinates } from "./node-service-coordinates.js";

type HubCoordinates = ConvergenceOwnerHubCandidate["hub"];

/** Only the Hub block of a Node runtime configuration; continuity validates it again. */
function hubBlock(value: unknown, configDirectory: string): HubCoordinates | null {
  const hub = (value as { hub?: Record<string, unknown> } | null)?.hub;
  if (
    hub === null ||
    typeof hub !== "object" ||
    typeof hub.baseUrl !== "string" ||
    typeof hub.bearerTokenFile !== "string" ||
    typeof hub.destinationId !== "string" ||
    typeof hub.hubIdentityHash !== "string"
  )
    return null;
  return {
    baseUrl: hub.baseUrl,
    bearerTokenFile: isAbsolute(hub.bearerTokenFile)
      ? hub.bearerTokenFile
      : resolve(configDirectory, hub.bearerTokenFile),
    destinationId: hub.destinationId,
    hubIdentityHash: hub.hubIdentityHash,
  };
}

/**
 * ADR-0469: the Hub coordinates of the Node registered on this host for exactly this checkout,
 * read from its service definition and owner-only runtime configuration. Null when no single
 * registered Node serves this checkout. It reads only the `hub` block, never the token.
 */
export async function registeredNodeHubCoordinates(
  repositoryRoot: string,
): Promise<HubCoordinates | null> {
  try {
    const root = await realpath(resolve(repositoryRoot));
    const registryPath = defaultNodeFleetRegistryPath();
    const matches = [];
    for (const instance of await listNodeFleetInstances(registryPath))
      if ((await realpath(instance.repositoryRoot).catch(() => null)) === root)
        matches.push(instance);
    if (matches.length !== 1) return null;
    const registration = matches[0]!;
    const plan = await createNodeFleetOnboardingPlan({
      registryPath,
      repositoryRoot: root,
      nodeId: registration.nodeId,
      destinationId: registration.destinationId,
      runtimeVersion: registration.runtimeVersion,
      serviceManager: registration.serviceManager,
    });
    if (plan.service.targetContentHash === null) return null;
    const service = await readNodeServiceCoordinates({
      manager: registration.serviceManager,
      path: plan.service.targetPath,
      expectedContentHash: plan.service.targetContentHash,
    });
    const config = JSON.parse(await readOwnerOnlyText(service.config, 1024 * 1024)) as unknown;
    const configured = (config as { repositoryRoot?: unknown } | null)?.repositoryRoot;
    if (
      typeof configured !== "string" ||
      (await realpath(resolve(dirname(service.config), configured)).catch(() => null)) !== root
    )
      return null;
    const hub = hubBlock(config, dirname(service.config));
    return hub?.destinationId === registration.destinationId ? hub : null;
  } catch {
    return null;
  }
}
