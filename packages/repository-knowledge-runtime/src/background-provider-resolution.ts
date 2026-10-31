import { readConvergenceOwnerHost } from "./convergence-owner-host.js";
import { listAssignments } from "@lervo/agent-workforce";
import { hasCurrentForegroundLease } from "./foreground-admission.js";
import { probeBackgroundProviderCli } from "./provider-cli-probe-budget.js";
import { type ProviderCliIdentity } from "./provider-cli-identity.js";
import { resolve } from "node:path";
import type { ProjectStorage } from "@lervo/project-storage";
import { assertConvergenceDelegation, loadConvergenceDelegation } from "./delegation.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { resolveAdmittedProviderCli } from "./provider-cli-admission.js";
import type { BackgroundProvider } from "./provider-cli-detection.js";
import { knowledgeProviderAdmissionState } from "./provider-admission.js";

export interface BackgroundProviderContext {
  storage: ProjectStorage;
  provider: BackgroundProvider;
  executable?: string;
  providerCliIdentity?: ProviderCliIdentity;
  admissionDirectory?: string;
  liveWorkPending?: () => Promise<boolean>;
}

/** The delegation bounds fallback; a configured executable is still probed, never trusted. */
export async function admittedBackgroundContext<T extends BackgroundProviderContext>(
  context: T,
): Promise<
  T & {
    executable: string;
    providerCliIdentityHash: string;
    providerCliIdentity: ProviderCliIdentity;
  }
> {
  const loaded = await loadConvergenceDelegation(context.storage.paths.repositoryRoot);
  if (
    loaded === null ||
    loaded.delegation.state !== "active" ||
    Date.parse(loaded.delegation.expiresAt) <= Date.now() ||
    loaded.delegation.projectId !== context.storage.manifest.projectId
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  const liveWorkPending =
    context.liveWorkPending ??
    (async () =>
      hasCurrentForegroundLease(
        await listAssignments(context.storage.paths.repositoryRoot),
        Date.now(),
      ));
  const { selected } = await resolveAdmittedProviderCli({
    providerPaused: async (provider) =>
      knowledgeProviderAdmissionState({
        provider,
        ...(context.admissionDirectory === undefined
          ? {}
          : { directory: context.admissionDirectory }),
      }),
    probe: async (identity) => {
      await assertConvergenceDelegation({
        repositoryRoot: context.storage.paths.repositoryRoot,
        projectId: context.storage.manifest.projectId,
        expectedHash: loaded.contentHash,
        provider: identity.provider,
      });
      return probeBackgroundProviderCli({
        storage: context.storage,
        identity,
        delegationHash: loaded.contentHash,
        maximumCalls: loaded.delegation.resourceCeilings.maximumProviderCalls,
        liveWorkPending,
        ...(context.admissionDirectory === undefined
          ? {}
          : { admissionDirectory: context.admissionDirectory }),
      });
    },
    hostLabel:
      (await readConvergenceOwnerHost(context.storage.paths.repositoryRoot))?.config.hostLabel ??
      (process.platform === "darwin" ? "macos" : "linux"),
    storage: context.storage,
    preferred: context.provider,
    allowed: loaded.delegation.providers,
    ...(context.executable === undefined ? {} : { executable: context.executable }),
    ...(context.admissionDirectory === undefined
      ? {}
      : { directory: resolve(context.admissionDirectory, "provider-clis") }),
  });
  if (selected === null) throw new KnowledgeConvergenceRuntimeError("provider_not_admitted");
  return {
    ...context,
    provider: selected.provider,
    executable: selected.executable,
    providerCliIdentityHash: selected.identityHash,
    providerCliIdentity: selected,
  };
}
