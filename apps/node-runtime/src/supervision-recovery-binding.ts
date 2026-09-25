import { openProjectStorage } from "@lervo/project-storage";

import type { loadNodeRuntimeConfig } from "./config.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import { resolveStandingSupervisionBinding } from "./supervision-standing.js";

type SupervisionConfig = NonNullable<
  Awaited<ReturnType<typeof loadNodeRuntimeConfig>>["outcomeSupervision"]
>;

/**
 * The binding a repair command must use. Standing supervision follows its reviewed successor
 * mandates at runtime, so its configured root binding is resolved to the current one.
 */
export async function resolveRecoveryBinding(
  repositoryRoot: string,
  supervision: SupervisionConfig,
): Promise<NodeSupervisionBinding> {
  if (!supervision.standing) return supervision.binding;
  const storage = await openProjectStorage(repositoryRoot);
  try {
    return (
      await resolveStandingSupervisionBinding(storage, supervision.binding, () =>
        new Date().toISOString(),
      )
    ).binding;
  } finally {
    await storage.close();
  }
}
