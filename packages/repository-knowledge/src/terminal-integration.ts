import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

import {
  applyDurableKnowledgeOperations,
  type DurableKnowledgeUserFileOperation,
  type KnowledgeMaterializationCheckpoint,
} from "./durable-apply.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { RepositoryKnowledgeError, type KnowledgeFileOperation } from "./types.js";

export type TerminalIntegrationProvider = "codex" | "claude";

export interface TerminalIntegrationTarget {
  provider: TerminalIntegrationProvider;
  path: ".codex/hooks.json" | ".claude/settings.json";
  action: "create" | "update" | "unchanged" | "blocked";
  beforeHash: string | null;
  afterHash: string | null;
}

export interface TerminalIntegrationBlocker {
  provider: TerminalIntegrationProvider | "runtime";
  path: string;
  code:
    | "invalid_json"
    | "invalid_hook_shape"
    | "hooks_disabled"
    | "conflicting_lervo_hook"
    | "unsafe_file"
    | "runtime_invalid";
}

export interface TerminalIntegrationRuntimeTarget {
  path: ".lervo/generated/terminal-hooks/runtime-v2.mjs";
  manifestPath: ".lervo/generated/terminal-hooks/runtime-v2.json";
  action: "create" | "update" | "unchanged" | "blocked";
  beforeHash: string | null;
  afterHash: string;
  byteCount: number;
}

export interface TerminalIntegrationPlan {
  schemaVersion: 1;
  planKind: "terminal_integration";
  planId: string;
  priorApplicationEventId: string | null;
  operationId: string;
  approvalHash: string | null;
  status: "current" | "ready" | "review_required" | "blocked";
  projectId: string;
  repositoryRoot: string;
  contractId: "lervo_terminal_hooks_v2";
  providers: readonly ["codex", "claude"];
  runtime: TerminalIntegrationRuntimeTarget;
  targets: TerminalIntegrationTarget[];
  blockers: TerminalIntegrationBlocker[];
  operations: Array<DurableKnowledgeUserFileOperation | KnowledgeFileOperation>;
}

export interface TerminalIntegrationReceipt {
  schemaVersion: 1;
  operation: "terminal_integration_update";
  planId: string;
  operationId: string;
  projectId: string;
  approvalHash: string | null;
  contractId: TerminalIntegrationPlan["contractId"];
  targetDigests: Array<{
    provider: TerminalIntegrationProvider;
    pathDigest: string;
    afterHash: string;
  }>;
  runtimePathDigest: string;
  runtimeAfterHash: string;
  appliedAt: string;
}

export interface TerminalIntegrationInspection {
  schemaVersion: 1;
  contractId: "lervo_terminal_hooks_v2";
  status: "current" | "stale" | "blocked";
  targets: TerminalIntegrationTarget[];
  runtime: TerminalIntegrationRuntimeTarget;
  blockers: TerminalIntegrationBlocker[];
}

const MAXIMUM_CONFIG_BYTES = 256 * 1024;
const MAXIMUM_RUNTIME_BYTES = 4 * 1024 * 1024;
const FORMAT = { insertSpaces: true, tabSize: 2, eol: "\n", insertFinalNewline: true } as const;
const PROVIDERS = ["codex", "claude"] as const;
const EVENTS = ["UserPromptSubmit", "Stop"] as const;
const CONTRACT_ID = "lervo_terminal_hooks_v2" as const;
const RUNTIME_PATH = ".lervo/generated/terminal-hooks/runtime-v2.mjs" as const;
const RUNTIME_MANIFEST_PATH = ".lervo/generated/terminal-hooks/runtime-v2.json" as const;

function configurationPath(
  provider: TerminalIntegrationProvider,
): TerminalIntegrationTarget["path"] {
  return provider === "codex" ? ".codex/hooks.json" : ".claude/settings.json";
}

export function terminalHookCommand(provider: TerminalIntegrationProvider): string {
  return `node "$(git rev-parse --show-toplevel)/${RUNTIME_PATH}" --provider ${provider} --contract 2`;
}

export function terminalHookWindowsCommand(provider: TerminalIntegrationProvider): string {
  return `powershell.exe -NoProfile -NonInteractive -Command "$root = git rev-parse --show-toplevel; if ($LASTEXITCODE -ne 0) { exit 2 }; & node (Join-Path $root '${RUNTIME_PATH}') --provider ${provider} --contract 2"`;
}

function hookEntry(provider: TerminalIntegrationProvider): Record<string, unknown> {
  return {
    hooks: [
      {
        type: "command",
        command: terminalHookCommand(provider),
        ...(provider === "codex" ? { commandWindows: terminalHookWindowsCommand(provider) } : {}),
        timeout: 30,
      },
    ],
  };
}

async function safeOptionalText(
  path: string,
  maximumBytes = MAXIMUM_CONFIG_BYTES,
): Promise<{ content: string; contentHash: string } | null> {
  let handle;
  try {
    try {
      const stats = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maximumBytes)
        throw new Error("unsafe");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytes.byteLength !== before.size
    )
      throw new Error("changed");
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      contentHash: sha256(bytes),
    };
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "A provider hook configuration cannot be read safely.",
    );
  } finally {
    await handle?.close();
  }
}

function codexHooksDisabled(content: string): boolean {
  let section = "";
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    const heading = /^\[([^\]]+)\]$/u.exec(line);
    if (heading !== null) {
      section = heading[1]!.trim();
      continue;
    }
    if (section === "features" && /^hooks\s*=\s*false\s*$/iu.test(line)) return true;
  }
  return false;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function lervoTerminalProvider(command: string): TerminalIntegrationProvider | null {
  if (!(/\blervo\s+terminal\s+hook\b/u.test(command) || command.includes(RUNTIME_PATH)))
    return null;
  if (/--provider\s+codex\b/u.test(command)) return "codex";
  if (/--provider\s+claude\b/u.test(command)) return "claude";
  return null;
}

function mergeTarget(
  provider: TerminalIntegrationProvider,
  existing: { content: string; contentHash: string } | null,
): {
  target: TerminalIntegrationTarget;
  content?: string;
  blocker?: TerminalIntegrationBlocker;
} {
  const path = configurationPath(provider);
  const original = existing?.content ?? "{}\n";
  const errors: ParseError[] = [];
  const parsed = parse(original, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length > 0 || !isObject(parsed)) {
    return {
      target: {
        provider,
        path,
        action: "blocked",
        beforeHash: existing?.contentHash ?? null,
        afterHash: null,
      },
      blocker: { provider, path, code: "invalid_json" },
    };
  }
  if (provider === "claude" && parsed.disableAllHooks === true) {
    return {
      target: {
        provider,
        path,
        action: "blocked",
        beforeHash: existing?.contentHash ?? null,
        afterHash: null,
      },
      blocker: { provider, path, code: "hooks_disabled" },
    };
  }
  if (parsed.hooks !== undefined && !isObject(parsed.hooks)) {
    return {
      target: {
        provider,
        path,
        action: "blocked",
        beforeHash: existing?.contentHash ?? null,
        afterHash: null,
      },
      blocker: { provider, path, code: "invalid_hook_shape" },
    };
  }

  let output = original;
  for (const event of EVENTS) {
    const current = parse(output, [], {
      allowTrailingComma: true,
      disallowComments: false,
    }) as Record<string, unknown>;
    const hooks = isObject(current.hooks) ? current.hooks : {};
    const eventEntries = hooks[event] === undefined ? [] : hooks[event];
    if (!Array.isArray(eventEntries) || !eventEntries.every(isObject)) {
      return {
        target: {
          provider,
          path,
          action: "blocked",
          beforeHash: existing?.contentHash ?? null,
          afterHash: null,
        },
        blocker: { provider, path, code: "invalid_hook_shape" },
      };
    }
    let found = false;
    let lervoHandlerCount = 0;
    const expectedCommand = terminalHookCommand(provider);
    for (const group of eventEntries) {
      if (!Array.isArray(group.hooks) || !group.hooks.every(isObject)) {
        return {
          target: {
            provider,
            path,
            action: "blocked",
            beforeHash: existing?.contentHash ?? null,
            afterHash: null,
          },
          blocker: { provider, path, code: "invalid_hook_shape" },
        };
      }
      for (const handler of group.hooks) {
        if (typeof handler.command !== "string") continue;
        const commandProvider = lervoTerminalProvider(handler.command);
        if (commandProvider === provider) {
          lervoHandlerCount += 1;
          found ||=
            handler.command === expectedCommand &&
            handler.type === "command" &&
            handler.timeout === 30 &&
            (provider !== "codex" ||
              handler.commandWindows === terminalHookWindowsCommand(provider));
        } else if (
          commandProvider !== null ||
          /\blervo\s+terminal\s+hook\b/u.test(handler.command) ||
          handler.command.includes(RUNTIME_PATH)
        ) {
          return {
            target: {
              provider,
              path,
              action: "blocked",
              beforeHash: existing?.contentHash ?? null,
              afterHash: null,
            },
            blocker: { provider, path, code: "conflicting_lervo_hook" },
          };
        }
      }
    }
    if (lervoHandlerCount > 0 && (!found || lervoHandlerCount > 1)) {
      const next: Record<string, unknown>[] = eventEntries.flatMap((group) => {
        const handlers = (group.hooks as Record<string, unknown>[]).filter(
          (handler) =>
            typeof handler.command !== "string" ||
            lervoTerminalProvider(handler.command) !== provider,
        );
        return handlers.length === 0 ? [] : [{ ...group, hooks: handlers }];
      });
      next.push(hookEntry(provider));
      output = applyEdits(
        output,
        modify(output, ["hooks", event], next, { formattingOptions: FORMAT }),
      );
    } else if (!found) {
      output = applyEdits(
        output,
        modify(output, ["hooks", event], [...eventEntries, hookEntry(provider)], {
          formattingOptions: FORMAT,
        }),
      );
    }
  }
  const afterHash = sha256(output);
  return {
    target: {
      provider,
      path,
      action:
        existing === null ? "create" : existing.contentHash === afterHash ? "unchanged" : "update",
      beforeHash: existing?.contentHash ?? null,
      afterHash,
    },
    content: output,
  };
}

export function serializableTerminalIntegrationPlan(plan: TerminalIntegrationPlan): Omit<
  TerminalIntegrationPlan,
  "operations"
> & {
  operations: Array<Omit<DurableKnowledgeUserFileOperation | KnowledgeFileOperation, "content">>;
} {
  return {
    ...plan,
    operations: plan.operations.map(({ content: _content, ...operation }) => operation),
  };
}

function runtimeManifest(contentHash: string, byteCount: number): string {
  return `${canonicalJson({
    schemaVersion: 1,
    kind: "lervo_terminal_hook_runtime",
    contractId: CONTRACT_ID,
    runtimePath: RUNTIME_PATH,
    contentHash,
    byteCount,
  })}\n`;
}

function validRuntimeContent(content: string): boolean {
  const bytes = Buffer.byteLength(content);
  return bytes > 0 && bytes <= MAXIMUM_RUNTIME_BYTES && content.startsWith("#!/usr/bin/env node\n");
}

async function runtimeTarget(
  root: string,
  desiredContent: string,
): Promise<{ target: TerminalIntegrationRuntimeTarget; operations: KnowledgeFileOperation[] }> {
  if (!validRuntimeContent(desiredContent))
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The terminal hook runtime artifact is invalid.",
    );
  const desiredHash = sha256(desiredContent);
  const desiredManifest = runtimeManifest(desiredHash, Buffer.byteLength(desiredContent));
  const [existing, existingManifest] = await Promise.all([
    safeOptionalText(resolve(root, RUNTIME_PATH), MAXIMUM_RUNTIME_BYTES),
    safeOptionalText(resolve(root, RUNTIME_MANIFEST_PATH)),
  ]);
  const action =
    existing?.contentHash === desiredHash &&
    existingManifest?.contentHash === sha256(desiredManifest)
      ? ("unchanged" as const)
      : existing === null
        ? ("create" as const)
        : ("update" as const);
  const operations: KnowledgeFileOperation[] = [];
  if (existing?.contentHash !== desiredHash)
    operations.push({
      path: RUNTIME_PATH,
      action: existing === null ? "create" : "update",
      ownership: "lervo_generated",
      mediaType: "text/javascript",
      content: desiredContent,
      ...(existing === null ? {} : { expectedCurrentHash: existing.contentHash }),
      desiredHash,
    });
  if (existingManifest?.contentHash !== sha256(desiredManifest))
    operations.push({
      path: RUNTIME_MANIFEST_PATH,
      action: existingManifest === null ? "create" : "update",
      ownership: "lervo_generated",
      mediaType: "application/json",
      content: desiredManifest,
      ...(existingManifest === null ? {} : { expectedCurrentHash: existingManifest.contentHash }),
      desiredHash: sha256(desiredManifest),
    });
  return {
    target: {
      path: RUNTIME_PATH,
      manifestPath: RUNTIME_MANIFEST_PATH,
      action,
      beforeHash: existing?.contentHash ?? null,
      afterHash: desiredHash,
      byteCount: Buffer.byteLength(desiredContent),
    },
    operations,
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
    const [artifact, manifestFile] = await Promise.all([
      safeOptionalText(resolve(root, RUNTIME_PATH), MAXIMUM_RUNTIME_BYTES),
      safeOptionalText(resolve(root, RUNTIME_MANIFEST_PATH)),
    ]);
    let valid = false;
    if (artifact !== null && manifestFile !== null && validRuntimeContent(artifact.content)) {
      const manifest = JSON.parse(manifestFile.content) as unknown;
      valid =
        isObject(manifest) &&
        Object.keys(manifest).sort().join("\0") ===
          ["byteCount", "contentHash", "contractId", "kind", "runtimePath", "schemaVersion"]
            .sort()
            .join("\0") &&
        manifest.schemaVersion === 1 &&
        manifest.kind === "lervo_terminal_hook_runtime" &&
        manifest.contractId === CONTRACT_ID &&
        manifest.runtimePath === RUNTIME_PATH &&
        manifest.contentHash === artifact.contentHash &&
        manifest.byteCount === Buffer.byteLength(artifact.content);
    }
    runtime = {
      path: RUNTIME_PATH,
      manifestPath: RUNTIME_MANIFEST_PATH,
      action: valid ? "unchanged" : artifact === null ? "create" : "blocked",
      beforeHash: artifact?.contentHash ?? null,
      afterHash: artifact?.contentHash ?? sha256(""),
      byteCount: artifact === null ? 0 : Buffer.byteLength(artifact.content),
    };
    if (artifact !== null && !valid)
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
    desiredRuntime = await runtimeTarget(root, runtimeContent);
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
  const operations: Array<DurableKnowledgeUserFileOperation | KnowledgeFileOperation> =
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
    receipt,
    recordApplied: input.recordApplied,
    ...(input.failureInjector === undefined ? {} : { failureInjector: input.failureInjector }),
  });
}
