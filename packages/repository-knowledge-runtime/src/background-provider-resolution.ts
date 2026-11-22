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
import {
  modelRouteFor,
  resolveModelRoute,
  type ModelReasoningEffort,
  type ModelSelection,
} from "@lervo/execution-contract";
import { readHostModelSelection } from "./model-selection-host.js";

export interface BackgroundProviderContext {
  storage: ProjectStorage;
  provider: BackgroundProvider;
  executable?: string;
  providerCliIdentity?: ProviderCliIdentity;
  admissionDirectory?: string;
  liveWorkPending?: () => Promise<boolean>;
  /**
   * ADR-0612: the model and effort of the `background` role for the admitted provider, set by
   * admission. Absent means the provider defaults with low effort, as before.
   */
  modelRoute?: { model: string | null; reasoningEffort: ModelReasoningEffort | null };
  /** The selection to resolve from; read from the host when absent. Replaced only in tests. */
  modelSelection?: ModelSelection;
}

/**
 * The providers admission may try, in order. With routes, only the providers the `background`
 * role lists and the delegation allows, in the role's order: naming a provider in a delegation
 * allows it but never selects it, so a provider the role leaves out is never probed or spent on.
 * Without routes, the delegation's own order, as before ADR-0612. Empty when the role lists only
 * providers the delegation does not allow.
 */
function admissionOrder(
  selection: ModelSelection,
  allowed: readonly BackgroundProvider[],
): BackgroundProvider[] {
  const routes = selection.roles.background;
  if (routes === undefined || routes.length === 0) return [...allowed];
  return routes
    .map((route) => route.provider)
    .filter((provider): provider is BackgroundProvider => allowed.includes(provider));
}

/** The delegation bounds fallback; a configured executable is still probed, never trusted. */
export async function admittedBackgroundContext<T extends BackgroundProviderContext>(
  context: T,
): Promise<
  T & {
    executable: string;
    providerCliIdentityHash: string;
    providerCliIdentity: ProviderCliIdentity;
    modelRoute?: { model: string | null; reasoningEffort: ModelReasoningEffort | null };
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
  // ADR-0612: the selection orders the providers the delegation allows; admission still decides
  // which of them can run here, so an unavailable one falls through to the next.
  const selection = context.modelSelection ?? (await readHostModelSelection()).selection;
  const order = admissionOrder(selection, loaded.delegation.providers);
  // The role names only providers the delegation does not allow: nothing may run, as when no
  // delegated provider is admitted, and the stage waits for a change to either.
  if (order.length === 0) throw new KnowledgeConvergenceRuntimeError("provider_not_admitted");
  const chosen = await resolveModelRoute({
    selection,
    role: "background",
    allowed: order,
  });
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
    // A configured executable belongs to the context's provider, so it keeps that provider first.
    preferred:
      context.executable !== undefined
        ? context.provider
        : (chosen.route?.provider ?? context.provider),
    allowed: order,
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
    modelRoute: modelRouteFor(selection, "background", selected.provider),
  };
}
