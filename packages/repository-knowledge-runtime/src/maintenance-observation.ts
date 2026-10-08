import { resolve } from "node:path";

import type { KnowledgeConvergenceStatus } from "@lervo/repository-knowledge";
import { knowledgeConvergenceStates } from "@lervo/schemas";
import type { ConvergenceOwnerVerdict } from "./convergence-owner-verdict.js";
import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";

export const MAINTENANCE_OBSERVATION_PATH = ".lervo/state/knowledge/maintenance-observation.json";
const MAXIMUM_BYTES = 1024 * 1024;
const STATES = new Set<string>(["idle", ...knowledgeConvergenceStates]);

export interface MaintenanceObservationV1 {
  schemaVersion: 1;
  projectId: string;
  observedAt: string;
  ownerGeneration: number | null;
  ownerHostHash: string | null;
  source: "inspection" | "worker";
  status: KnowledgeConvergenceStatus;
  /** Verification was true only at capture; reading this record never proves present currency. */
  verifiedAt: string | null;
}

function validObservation(value: unknown): value is MaintenanceObservationV1 {
  if (value === null || typeof value !== "object") return false;
  const item = value as Partial<MaintenanceObservationV1>;
  const status = item.status;
  return (
    item.schemaVersion === 1 &&
    typeof item.projectId === "string" &&
    typeof item.observedAt === "string" &&
    Number.isFinite(Date.parse(item.observedAt)) &&
    (item.verifiedAt === null ||
      (typeof item.verifiedAt === "string" && Number.isFinite(Date.parse(item.verifiedAt)))) &&
    (item.ownerGeneration === null ||
      (Number.isSafeInteger(item.ownerGeneration) && item.ownerGeneration! > 0)) &&
    (item.ownerHostHash === null || typeof item.ownerHostHash === "string") &&
    (item.source === "inspection" || item.source === "worker") &&
    status !== undefined &&
    status !== null &&
    typeof status === "object" &&
    STATES.has(status.state) &&
    Number.isSafeInteger(status.outstanding) &&
    status.outstanding >= 0 &&
    (status.debtCounts === null ||
      (typeof status.debtCounts === "object" &&
        ["canonicalization", "normalization", "lifecycle", "historical"].every((key) => {
          const count =
            status.debtCounts?.[key as keyof NonNullable<KnowledgeConvergenceStatus["debtCounts"]>];
          return Number.isSafeInteger(count) && count! >= 0;
        })))
  );
}

export async function readMaintenanceObservation(
  root: string,
  projectId: string,
): Promise<MaintenanceObservationV1 | null> {
  const read = await readPrivateJsonFile(
    resolve(root, MAINTENANCE_OBSERVATION_PATH),
    MAXIMUM_BYTES,
  );
  return read.status === "read" &&
    validObservation(read.value) &&
    read.value.projectId === projectId
    ? read.value
    : null;
}

export async function recordMaintenanceObservation(input: {
  root: string;
  projectId: string;
  status: KnowledgeConvergenceStatus;
  source: MaintenanceObservationV1["source"];
  owner: ConvergenceOwnerVerdict | null;
  baselineCurrent?: boolean;
  now?: Date;
}): Promise<void> {
  const at = (input.now ?? new Date()).toISOString();
  const value: MaintenanceObservationV1 = {
    schemaVersion: 1,
    projectId: input.projectId,
    observedAt: at,
    verifiedAt: input.baselineCurrent === true ? at : null,
    source: input.source,
    status: input.status,
    ownerGeneration: input.owner?.holder?.generation ?? null,
    ownerHostHash: input.owner?.hostHash ?? null,
  };
  if (!validObservation(value) || Buffer.byteLength(JSON.stringify(value)) > MAXIMUM_BYTES)
    throw Object.assign(new Error("Maintenance observation is invalid."), {
      code: "maintenance_observation_unavailable",
    });
  await writePrivateJsonFile(resolve(input.root, MAINTENANCE_OBSERVATION_PATH), value);
}
