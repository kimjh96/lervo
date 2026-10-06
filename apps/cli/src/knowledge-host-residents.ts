import { realpath } from "node:fs/promises";

import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { defaultNodeFleetRegistryPath, listNodeFleetInstances } from "@lervo/repository-registry";
import {
  defaultConvergenceContinuityPolicyPath,
  loadConvergenceDelegation,
  readConvergenceContinuityPolicy,
  startAutonomousKnowledgeWorker,
} from "@lervo/repository-knowledge-runtime";

import {
  createKnowledgeConvergenceContinuity,
  createKnowledgeConvergenceOwnership,
  createKnowledgePublisher,
  instructionCandidateTransport,
} from "./knowledge-convergence-ownership.js";
import { hostRepositoryRoots } from "./knowledge-host-repositories.js";

/** How often the host resident looks for newly registered or removed repositories. */
export const HOST_RESIDENT_SCAN_MILLISECONDS = 5 * 60_000;

type Provider = "codex" | "claude";

interface RunningResident {
  storage: ProjectStorage;
  stop: () => Promise<void>;
}

/**
 * The provider a checkout's resident uses: its delegation's, else the active host policy's
 * template provider so it can seed one. Null means continuity has nothing to own here.
 */
async function residentProvider(root: string, fallback: Provider | null): Promise<Provider | null> {
  const delegation = await loadConvergenceDelegation(root).catch(() => null);
  if (delegation !== null)
    return delegation.delegation.state === "revoked" ? null : delegation.delegation.providers[0]!;
  const path = defaultConvergenceContinuityPolicyPath();
  const policy = path === null ? null : await readConvergenceContinuityPolicy(path);
  if (policy?.status !== "loaded" || policy.policy.state !== "active") return null;
  return policy.policy.template?.providers[0] ?? fallback;
}

/** Checkouts served by a registered Node already have that Node's resident. */
async function nodeServedRoots(): Promise<Set<string>> {
  const instances = await Promise.resolve()
    .then(() => listNodeFleetInstances(defaultNodeFleetRegistryPath()))
    .catch(() => []);
  const roots = await Promise.all(
    instances.map((instance) => realpath(instance.repositoryRoot).catch(() => null)),
  );
  return new Set(roots.filter((root): root is string => root !== null));
}

/**
 * ADR-0469 host resident: one process keeps a knowledge resident for every repository this host
 * knows that is not served by its own Node, starting residents for newly registered checkouts
 * and stopping them for removed ones. Each resident is the ordinary resident with ownership,
 * continuity, and publication; this module only decides which checkouts get one.
 */
export function startHostKnowledgeResidents(input: {
  provider: Provider | null;
  onCycle?: (root: string, result: unknown) => void;
  onFailure: (root: string, error: unknown) => void;
  scanMilliseconds?: number;
}): () => Promise<void> {
  const residents = new Map<string, RunningResident>();
  let stopped = false;
  let scanning: Promise<void> = Promise.resolve();
  const scan = async () => {
    const served = await nodeServedRoots();
    const wanted = new Map<string, Provider>();
    for (const root of await hostRepositoryRoots()) {
      if (served.has(root)) continue;
      const provider = await residentProvider(root, input.provider);
      if (provider !== null) wanted.set(root, provider);
    }
    for (const [root, resident] of residents)
      if (!wanted.has(root)) {
        residents.delete(root);
        await resident.stop().finally(() => resident.storage.close());
      }
    for (const [root, provider] of wanted) {
      if (stopped || residents.has(root)) continue;
      try {
        const storage = await openProjectStorage(root);
        if ((storage.writableEventSchemaVersion ?? 1) < 4) {
          await storage.close();
          continue;
        }
        const stop = startAutonomousKnowledgeWorker({
          storage,
          workerId: `cli-host-${process.pid}`,
          provider,
          ownership: createKnowledgeConvergenceOwnership(storage, provider),
          continuity: createKnowledgeConvergenceContinuity(storage),
          instructionCandidateTransport,
          publish: createKnowledgePublisher(storage.paths.repositoryRoot),
          onCycle: (result) => input.onCycle?.(root, result),
          onFailure: (error) => input.onFailure(root, error),
        });
        residents.set(root, { storage, stop });
      } catch (error) {
        input.onFailure(root, error);
      }
    }
  };
  const rescan = () => {
    scanning = scanning.then(scan).catch((error: unknown) => input.onFailure("", error));
  };
  rescan();
  const timer = setInterval(rescan, input.scanMilliseconds ?? HOST_RESIDENT_SCAN_MILLISECONDS);
  return async () => {
    stopped = true;
    clearInterval(timer);
    await scanning;
    await Promise.all(
      [...residents.values()].map((resident) =>
        resident.stop().finally(() => resident.storage.close()),
      ),
    );
    residents.clear();
  };
}
