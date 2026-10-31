import { resolve } from "node:path";
import {
  isProviderCliAdmissionProjection,
  type ProviderCliAdmissionProjection,
  type ProviderCliObservation,
} from "@lervo/sync-contract";
import { readPrivateJsonFile } from "./private-state-file.js";
import { readWorkerProviderSelection } from "./provider-cli-selection.js";
export const PROVIDER_CLI_STATE_PATH = ".lervo/state/knowledge/provider-clis.json";
export async function readProviderCliProjection(
  root: string,
): Promise<ProviderCliAdmissionProjection | null> {
  const file = await readPrivateJsonFile(resolve(root, PROVIDER_CLI_STATE_PATH), 64 * 1024);
  return file.status === "read" && isProviderCliAdmissionProjection(file.value)
    ? { ...file.value, selected: await readWorkerProviderSelection(root) }
    : null;
}

export async function providerCliProjection(
  root: string,
  observedAt: Date,
  detectionFailure: string | null,
  providers: ProviderCliObservation[],
  waiting: boolean,
): Promise<ProviderCliAdmissionProjection> {
  return {
    observedAt: observedAt.toISOString(),
    detectionFailure,
    providers,
    selected: await readWorkerProviderSelection(root),
    waiting,
  };
}
