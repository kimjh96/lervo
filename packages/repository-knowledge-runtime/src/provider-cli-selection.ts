import { resolve } from "node:path";
import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";
import type { ProviderCliIdentity } from "./provider-cli-identity.js";

const FILE = ".lervo/state/knowledge/provider-cli-selection.json";
export async function recordWorkerProviderSelection(
  root: string,
  identity: ProviderCliIdentity,
): Promise<void> {
  await writePrivateJsonFile(resolve(root, FILE), {
    provider: identity.provider,
    version: identity.version,
    executableHash: identity.executableHash,
    observedAt: new Date().toISOString(),
  });
}
export async function readWorkerProviderSelection(
  root: string,
): Promise<{ provider: "codex" | "claude"; version: string } | null> {
  const file = await readPrivateJsonFile(resolve(root, FILE), 1024);
  if (file.status !== "read") return null;
  const value = file.value as { provider?: unknown; version?: unknown } | null;
  return value !== null &&
    (value.provider === "codex" || value.provider === "claude") &&
    typeof value.version === "string" &&
    /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]{1,40})?$/u.test(value.version)
    ? { provider: value.provider, version: value.version }
    : null;
}
