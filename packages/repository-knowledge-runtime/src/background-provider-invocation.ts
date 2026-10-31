import type { CreateProcessProviderOptions } from "@lervo/repository-knowledge-compiler";
import { providerCliIdentityCurrent } from "./provider-cli-identity.js";
import { recordWorkerProviderSelection } from "./provider-cli-selection.js";
import {
  admittedBackgroundContext,
  type BackgroundProviderContext,
} from "./background-provider-resolution.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/** Each adapter checks the admitted file immediately before spawning a model call. */
export function backgroundProviderOptions(
  context: BackgroundProviderContext,
): Pick<
  CreateProcessProviderOptions,
  "provider" | "executable" | "environment" | "identityHash" | "beforeCall" | "onCall"
> {
  const identity = context.providerCliIdentity;
  if (identity === undefined) throw new KnowledgeConvergenceRuntimeError("provider_not_admitted");
  return {
    provider: identity.provider,
    executable: identity.executable,
    environment: identity.environment,
    identityHash: identity.identityHash,
    beforeCall: async () => {
      if (!(await providerCliIdentityCurrent(identity))) {
        // Abandon the batch even if readmission succeeds. The next turn builds a new descriptor.
        await admittedBackgroundContext({ ...context, executable: identity.executable });
        throw new KnowledgeConvergenceRuntimeError("provider_not_admitted");
      }
    },
    onCall: () => recordWorkerProviderSelection(context.storage.paths.repositoryRoot, identity),
  };
}
