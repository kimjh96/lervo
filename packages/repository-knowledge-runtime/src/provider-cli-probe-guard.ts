import type { ProviderCliProbeResult } from "@lervo/repository-knowledge-compiler";
import type { ProviderCliIdentity } from "./provider-cli-identity.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

// Only active probes occupy this host guard. Completed results belong to the private cache.
const active = new Map<string, Promise<ProviderCliProbeResult>>();
export async function probeOnce(
  identity: ProviderCliIdentity,
  probe?: (identity: ProviderCliIdentity) => Promise<ProviderCliProbeResult>,
): Promise<ProviderCliProbeResult> {
  if (probe === undefined)
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  const prior = active.get(identity.identityHash);
  if (prior !== undefined) return prior;
  const operation = probe(identity);
  active.set(identity.identityHash, operation);
  try {
    return await operation;
  } finally {
    active.delete(identity.identityHash);
  }
}
