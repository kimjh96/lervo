import { resolve } from "node:path";
import { loadProjectManifest } from "@lervo/project";
import {
  applyDurableKnowledgeOperations,
  type DurableKnowledgeUserFileOperation,
  type KnowledgeMaterializationCheckpoint,
} from "./durable-apply.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";
import { safeOptionalText } from "./terminal-integration-files.js";
import {
  configurationPath,
  codexHooksDisabled,
  mergeTarget,
} from "./terminal-integration-provider.js";
import { runtimeTarget, inspectTerminalRuntimeArtifact } from "./terminal-runtime-artifact.js";
import {
  CONTRACT_ID,
  PROVIDERS,
  RUNTIME_PATH,
  RUNTIME_MANIFEST_PATH,
  type TerminalIntegrationPlan,
  type TerminalIntegrationReceipt,
  type TerminalIntegrationInspection,
  type TerminalIntegrationRuntimeTarget,
  type TerminalIntegrationBlocker,
  type TerminalRuntimeAsset,
  type TerminalRuntimeOperation,
} from "./terminal-integration-contract.js";
export type {
  TerminalIntegrationProvider,
  TerminalIntegrationTarget,
  TerminalIntegrationBlocker,
  TerminalIntegrationRuntimeTarget,
  TerminalIntegrationPlan,
  TerminalIntegrationReceipt,
  TerminalIntegrationInspection,
} from "./terminal-integration-contract.js";
export { TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES } from "./terminal-integration-contract.js";
export {
  terminalHookCommand,
  terminalHookWindowsCommand,
} from "./terminal-integration-provider.js";

export function serializableTerminalIntegrationPlan(plan: TerminalIntegrationPlan): Omit<
  TerminalIntegrationPlan,
  "operations"
> & {
  operations: Array<Omit<DurableKnowledgeUserFileOperation | TerminalRuntimeOperation, "content">>;
} {
  return {
    ...plan,
    operations: plan.operations.map(({ content: _content, ...operation }) => operation),
  };
}

export async function inspectTerminalIntegration(
  repositoryRoot: string,
): Promise<TerminalIntegrationInspection> {
  const root = resolve(repositoryRoot);
  const existing = await Promise.all(
    PROVIDERS.map(
      async (provider) =>
        [provider, await safeOptionalText(resolve(root, configurationPath(provider)))] as const,
    ),
  );
  const blockers: TerminalIntegrationBlocker[] = [];
  try {
    const config = await safeOptionalText(resolve(root, ".codex/config.toml"));
    if (config !== null && codexHooksDisabled(config.content))
      blockers.push({ provider: "codex", path: ".codex/config.toml", code: "hooks_disabled" });
  } catch (error) {
    if (error instanceof RepositoryKnowledgeError)
      blockers.push({ provider: "codex", path: ".codex/config.toml", code: "unsafe_file" });
    else throw error;
  }
  const merged = existing.map(([provider, file]) => mergeTarget(provider, file));
  for (const item of merged) if (item.blocker !== undefined) blockers.push(item.blocker);
  let runtime: TerminalIntegrationRuntimeTarget;
  try {
    runtime = await inspectTerminalRuntimeArtifact(root);
    if (runtime.action === "blocked")
      blockers.push({ provider: "runtime", path: RUNTIME_PATH, code: "runtime_invalid" });
  } catch {
    runtime = {
      path: RUNTIME_PATH,
      manifestPath: RUNTIME_MANIFEST_PATH,
      action: "blocked",
      beforeHash: null,
      afterHash: sha256(""),
      byteCount: 0,
    };
    blockers.push({ provider: "runtime", path: RUNTIME_PATH, code: "unsafe_file" });
  }
  const targets = merged.map((item) => item.target);
  return {
    schemaVersion: 1,
    contractId: CONTRACT_ID,
    status:
      blockers.length > 0
        ? "blocked"
        : targets.every((target) => target.action === "unchanged") && runtime.action === "unchanged"
          ? "current"
          : "stale",
    targets,
    runtime,
    blockers,
  };
}

export async function createTerminalIntegrationPlan(
  repositoryRoot: string,
  runtimeContent: string,
  priorApplicationEventId: string | null = null,
  runtimeAssets: readonly TerminalRuntimeAsset[] = [],
): Promise<TerminalIntegrationPlan> {
  const root = resolve(repositoryRoot);
  const project = await loadProjectManifest(root);
  const existing = await Promise.all(
    PROVIDERS.map(
      async (provider) =>
        [provider, await safeOptionalText(resolve(root, configurationPath(provider)))] as const,
    ),
  );
  const blockers: TerminalIntegrationBlocker[] = [];
  try {
    const config = await safeOptionalText(resolve(root, ".codex/config.toml"));
    if (config !== null && codexHooksDisabled(config.content))
      blockers.push({ provider: "codex", path: ".codex/config.toml", code: "hooks_disabled" });
  } catch (error) {
    if (error instanceof RepositoryKnowledgeError)
      blockers.push({ provider: "codex", path: ".codex/config.toml", code: "unsafe_file" });
    else throw error;
  }
  const merged = existing.map(([provider, file]) => mergeTarget(provider, file));
  for (const item of merged) if (item.blocker !== undefined) blockers.push(item.blocker);
  const targets = merged.map((item) => item.target);
  let desiredRuntime: Awaited<ReturnType<typeof runtimeTarget>>;
  try {
    desiredRuntime = await runtimeTarget(root, runtimeContent, runtimeAssets);
  } catch (error) {
    if (!(error instanceof RepositoryKnowledgeError)) throw error;
    blockers.push({ provider: "runtime", path: RUNTIME_PATH, code: "runtime_invalid" });
    desiredRuntime = {
      target: {
        path: RUNTIME_PATH,
        manifestPath: RUNTIME_MANIFEST_PATH,
        action: "blocked",
        beforeHash: null,
        afterHash: sha256(""),
        byteCount: 0,
      },
      operations: [],
    };
  }
  const userOperations: DurableKnowledgeUserFileOperation[] =
    blockers.length > 0
      ? []
      : merged.flatMap((item) => {
          if (
            item.target.action === "unchanged" ||
            item.target.action === "blocked" ||
            item.content === undefined ||
            item.target.afterHash === null
          )
            return [];
          return [
            {
              path: item.target.path,
              action: item.target.action,
              ownership: "user" as const,
              mediaType: "application/json" as const,
              content: item.content,
              ...(item.target.beforeHash === null
                ? {}
                : { expectedCurrentHash: item.target.beforeHash }),
              desiredHash: item.target.afterHash,
            },
          ];
        });
  const operations: Array<DurableKnowledgeUserFileOperation | TerminalRuntimeOperation> =
    blockers.length > 0 ? [] : [...desiredRuntime.operations, ...userOperations];
  const operationId = stableId("ktermop", {
    projectId: project.projectId,
    contractId: CONTRACT_ID,
    targets,
    runtime: desiredRuntime.target,
  });
  const operationBindings = operations.map(({ content: _content, ...operation }) => operation);
  const approvalHash =
    userOperations.length === 0
      ? null
      : sha256(
          canonicalJson({
            operationId,
            contractId: CONTRACT_ID,
            targets,
            runtime: desiredRuntime.target,
            operations: operationBindings,
          }),
        );
  const planId = stableId("ktermplan", {
    projectId: project.projectId,
    priorApplicationEventId,
    operationId,
    approvalHash,
    blockers,
  });
  return {
    schemaVersion: 1,
    planKind: "terminal_integration",
    planId,
    priorApplicationEventId,
    operationId,
    approvalHash,
    status:
      blockers.length > 0
        ? "blocked"
        : userOperations.length > 0
          ? "review_required"
          : operations.length > 0
            ? "ready"
            : "current",
    projectId: project.projectId,
    repositoryRoot: root,
    contractId: CONTRACT_ID,
    providers: PROVIDERS,
    runtime: desiredRuntime.target,
    targets,
    blockers,
    operations,
  };
}

export async function applyTerminalIntegrationPlan(input: {
  plan: TerminalIntegrationPlan;
  runtimeContent: string;
  runtimeAssets?: readonly TerminalRuntimeAsset[];
  approvedOperationId?: string;
  approvedHash?: string;
  now: Date;
  recordApplied: (receipt: TerminalIntegrationReceipt) => void | Promise<void>;
  failureInjector?: (
    checkpoint: KnowledgeMaterializationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<TerminalIntegrationReceipt> {
  if (input.plan.status !== "review_required" && input.plan.status !== "ready")
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The terminal integration plan has no applicable changes.",
    );
  if (
    input.plan.status === "review_required" &&
    (input.approvedOperationId !== input.plan.operationId ||
      input.approvedHash !== input.plan.approvalHash)
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_approval_required",
      "Terminal integration requires the exact operation ID and approval hash.",
    );
  }
  if (
    input.plan.status === "ready" &&
    (input.approvedOperationId !== undefined || input.approvedHash !== undefined)
  )
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "Generated-only terminal runtime reconciliation does not accept user approval coordinates.",
    );
  const current = await createTerminalIntegrationPlan(
    input.plan.repositoryRoot,
    input.runtimeContent,
    input.plan.priorApplicationEventId,
    input.runtimeAssets,
  );
  if (current.planId !== input.plan.planId)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "Provider hook configuration changed after planning.",
    );
  const receipt: TerminalIntegrationReceipt = {
    schemaVersion: 1,
    operation: "terminal_integration_update",
    planId: current.planId,
    operationId: current.operationId,
    projectId: current.projectId,
    approvalHash: current.approvalHash,
    contractId: current.contractId,
    targetDigests: current.targets.flatMap((target) =>
      target.afterHash === null
        ? []
        : [
            {
              provider: target.provider,
              pathDigest: sha256(target.path),
              afterHash: target.afterHash,
            },
          ],
    ),
    runtimePathDigest: sha256(current.runtime.path),
    runtimeAfterHash: current.runtime.afterHash,
    appliedAt: input.now.toISOString(),
  };
  return applyDurableKnowledgeOperations({
    repositoryRoot: current.repositoryRoot,
    projectId: current.projectId,
    planId: current.planId,
    operations: current.operations,
    documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
      repositoryRoot: current.repositoryRoot,
      operations: current.operations,
    }),
    receipt,
    recordApplied: input.recordApplied,
    ...(input.failureInjector === undefined ? {} : { failureInjector: input.failureInjector }),
  });
}

export type { TerminalRuntimeAsset } from "./terminal-integration-contract.js";
export { loadTerminalHookNativeAssets } from "./terminal-runtime-assets.js";
export { verifyTerminalHookRuntimeArtifact } from "./terminal-runtime-artifact.js";
