import type { DocumentRouteResolutionContext } from "@lervo/repository-knowledge";

import { assertConvergenceDelegation, loadConvergenceDelegation } from "./delegation.js";
import { knowledgeProviderAdmissionState } from "./provider-admission.js";

/** A missing or unvalidated background authority never promises that a resident can classify. */
export async function inspectDocumentRouteResolutionContext(input: {
  repositoryRoot: string;
  admissionDirectory?: string;
}): Promise<DocumentRouteResolutionContext> {
  const unavailable: DocumentRouteResolutionContext = { providerAvailable: false };
  try {
    const loaded = await loadConvergenceDelegation(input.repositoryRoot);
    if (loaded === null) return unavailable;
    for (const provider of loaded.delegation.providers) {
      const delegation = await assertConvergenceDelegation({
        repositoryRoot: input.repositoryRoot,
        projectId: loaded.delegation.projectId,
        expectedHash: loaded.contentHash,
        provider,
      });
      if (delegation.resourceCeilings.maximumProviderCalls < 1) continue;
      const admission = await knowledgeProviderAdmissionState({
        provider,
        ...(input.admissionDirectory === undefined ? {} : { directory: input.admissionDirectory }),
      });
      if (!admission.paused) return { providerAvailable: true };
    }
    return unavailable;
  } catch {
    return unavailable;
  }
}
