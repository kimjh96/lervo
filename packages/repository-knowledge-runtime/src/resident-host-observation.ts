import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { defaultNodeFleetRegistryPath, listNodeFleetInstances } from "@lervo/repository-registry";

import {
  hostKnowledgeResidentStatusPath,
  hostResidentScanStalled,
  readHostKnowledgeResidentStatus,
} from "./host-resident-status.js";

/**
 * ADR-0470: which process should host this checkout's resident, as this host can observe it.
 * - `node`: a registered Node serves the checkout.
 * - `host_serving` / `host_held`: the running host resident serves or holds it.
 * - `host_unlisted`: a host resident runs but has not listed the checkout (not registered yet).
 * - `host_absent`: no Node serves it and no host resident runs.
 * - `host_stalled`: the host resident heartbeats, but its repository scan has not finished.
 */
export type ResidentHostObservation =
  | { kind: "node" }
  | { kind: "host_serving" }
  | { kind: "host_held"; reason: string | null; detail: string | null }
  | { kind: "host_unlisted" }
  | { kind: "host_absent" }
  | { kind: "host_stalled" };

export async function observeResidentHost(
  repositoryRoot: string,
  now: Date = new Date(),
): Promise<ResidentHostObservation> {
  const root = await realpath(resolve(repositoryRoot)).catch(() => resolve(repositoryRoot));
  const instances = await Promise.resolve()
    .then(() => listNodeFleetInstances(defaultNodeFleetRegistryPath()))
    .catch(() => []);
  for (const instance of instances)
    if ((await realpath(instance.repositoryRoot).catch(() => null)) === root)
      return { kind: "node" };
  const path = hostKnowledgeResidentStatusPath();
  const reading =
    path === null
      ? ({ status: "absent" } as const)
      : await readHostKnowledgeResidentStatus(path, now);
  if (reading.status !== "running" || reading.record.role !== "active")
    return { kind: "host_absent" };
  if (hostResidentScanStalled(reading.record, now)) return { kind: "host_stalled" };
  const entry = reading.record.repositories.find((item) => item.repositoryRoot === root);
  if (entry?.state === "serving") return { kind: "host_serving" };
  if (entry?.state === "held")
    return { kind: "host_held", reason: entry.reason, detail: entry.detail };
  if (entry?.state === "node_served") return { kind: "node" };
  return { kind: "host_unlisted" };
}
