import { openProjectStorage } from "@lervo/project-storage";
import { defaultRepositoryRegistryPath, registerRepository } from "@lervo/repository-registry";
import {
  defaultConvergenceContinuityPolicyPath,
  readConvergenceContinuityPolicy,
  type ConvergenceContinuityState,
} from "@lervo/repository-knowledge-runtime";

import { createKnowledgeConvergenceContinuity } from "./knowledge-convergence-ownership.js";

export interface KnowledgeContinuityOnboarding {
  /** Whether the host registry now lists this checkout, so the doctor and residents cover it. */
  registered: boolean;
  delegation: string;
  ownerHost: string;
  findings: string[];
}

async function hostPolicyActive(): Promise<boolean> {
  const path = defaultConvergenceContinuityPolicyPath();
  if (path === null) return false;
  const policy = await readConvergenceContinuityPolicy(path);
  return policy.status === "loaded" && policy.policy.state === "active";
}

/**
 * ADR-0469 default onboarding: on a host whose owner installed (or adopted) a continuity policy,
 * a newly initialized or registered checkout joins the host registry and runs one continuity
 * reconciliation now. It derives the owner-host configuration and seeds the delegation, so the
 * first resident cycle can claim or wait for the lease. Without a policy nothing changes.
 * Failures never fail the calling command; the next resident cycle retries.
 */
export async function onboardKnowledgeContinuity(input: {
  repositoryRoot: string;
  register: boolean;
}): Promise<KnowledgeContinuityOnboarding | null> {
  try {
    if (!(await hostPolicyActive())) return null;
    const registered = input.register
      ? await registerRepository({
          registryPath: defaultRepositoryRegistryPath(),
          repositoryRoot: input.repositoryRoot,
        }).then(
          () => true,
          () => false,
        )
      : true;
    const storage = await openProjectStorage(input.repositoryRoot);
    let state: ConvergenceContinuityState | null;
    try {
      if ((storage.writableEventSchemaVersion ?? 1) < 4) return null;
      state = await createKnowledgeConvergenceContinuity(storage).reconcile({ force: true });
    } finally {
      await storage.close();
    }
    if (state === null) return null;
    return {
      registered,
      delegation: state.delegation.state,
      ownerHost: state.ownerHost.state,
      findings: state.findings
        .filter((finding) => finding.severity !== "info")
        .map((finding) => finding.code),
    };
  } catch {
    return null;
  }
}
