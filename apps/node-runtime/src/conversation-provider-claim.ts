import type { RepositoryWorkProvider } from "@lervo/adapter-contract";
import { deliberationProvesMultipleProviders } from "@lervo/deliberation-runtime";
import { openProjectStorage } from "@lervo/project-storage";
import { enforceProviderClaim, type ProviderClaimResult } from "@lervo/writing";

/**
 * Applies ADR-0460 `provider_claim_unproven` to a single-provider repository-work reply. A cited
 * deliberation proves several providers only through its recorded, usage-verified artifacts.
 */
export async function enforceRepositoryWorkProviderClaim(input: {
  repositoryRoot: string;
  provider: RepositoryWorkProvider;
  content: string;
}): Promise<ProviderClaimResult> {
  return enforceProviderClaim(input.content, {
    observedProvider: input.provider,
    isVerifiedDeliberation: async (deliberationId) => {
      // An unreadable event store cannot prove participation, so the claim is repaired.
      const storage = await openProjectStorage(input.repositoryRoot).catch(() => null);
      if (storage === null) return false;
      try {
        return deliberationProvesMultipleProviders({ events: storage.events, deliberationId });
      } catch {
        return false;
      } finally {
        await storage.close();
      }
    },
  });
}
