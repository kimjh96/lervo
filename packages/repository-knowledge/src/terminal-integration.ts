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
import { RepositoryKnowledgeError } from "./types.js";

export type TerminalIntegrationProvider = "codex" | "claude";

export interface TerminalIntegrationTarget {
  provider: TerminalIntegrationProvider;
  path: ".codex/hooks.json" | ".claude/settings.json";
  action: "create" | "update" | "unchanged" | "blocked";
  beforeHash: string | null;
  afterHash: string | null;
}

export interface TerminalIntegrationBlocker {
  provider: TerminalIntegrationProvider;
  path: string;
  code: "invalid_json" | "invalid_hook_shape" | "hooks_disabled" | "conflicting_lervo_hook" | "unsafe_file";
}

export interface TerminalIntegrationPlan {
  schemaVersion: 1;
  planKind: "terminal_integration";
  planId: string;
  operationId: string;
  approvalHash: string;
  status: "current" | "review_required" | "blocked";
  projectId: string;
  repositoryRoot: string;
  contractId: "lervo_terminal_hooks_v1";
  providers: readonly ["codex", "claude"];
  targets: TerminalIntegrationTarget[];
  blockers: TerminalIntegrationBlocker[];
  operations: DurableKnowledgeUserFileOperation[];
}

export interface TerminalIntegrationReceipt {
  schemaVersion: 1;
  operation: "terminal_integration_update";
  planId: string;
  operationId: string;
  projectId: string;
  approvalHash: string;
  contractId: TerminalIntegrationPlan["contractId"];
  targetDigests: Array<{ provider: TerminalIntegrationProvider; pathDigest: string; afterHash: string }>;
  appliedAt: string;
}

const MAXIMUM_CONFIG_BYTES = 256 * 1024;
const FORMAT = { insertSpaces: true, tabSize: 2, eol: "\n", insertFinalNewline: true } as const;
const PROVIDERS = ["codex", "claude"] as const;
const EVENTS = ["UserPromptSubmit", "Stop"] as const;

function configurationPath(provider: TerminalIntegrationProvider): TerminalIntegrationTarget["path"] {
  return provider === "codex" ? ".codex/hooks.json" : ".claude/settings.json";
}

export function terminalHookCommand(provider: TerminalIntegrationProvider): string {
  return `lervo terminal hook --provider ${provider} --contract 1`;
}

function hookEntry(provider: TerminalIntegrationProvider): Record<string, unknown> {
  return {
    hooks: [{
      type: "command",
      command: terminalHookCommand(provider),
      timeout: 30,
    }],
  };
}

async function safeOptionalText(path: string): Promise<{ content: string; contentHash: string } | null> {
  let handle;
  try {
    try {
      const stats = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAXIMUM_CONFIG_BYTES) throw new Error("unsafe");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.byteLength !== before.size) throw new Error("changed");
    return { content: new TextDecoder("utf-8", { fatal: true }).decode(bytes), contentHash: sha256(bytes) };
  } catch {
    throw new RepositoryKnowledgeError("knowledge_source_unsafe", "A provider hook configuration cannot be read safely.");
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

function mergeTarget(provider: TerminalIntegrationProvider, existing: { content: string; contentHash: string } | null): {
  target: TerminalIntegrationTarget;
  content?: string;
  blocker?: TerminalIntegrationBlocker;
} {
  const path = configurationPath(provider);
  const original = existing?.content ?? "{}\n";
  const errors: ParseError[] = [];
  const parsed = parse(original, errors, { allowTrailingComma: true, disallowComments: false }) as unknown;
  if (errors.length > 0 || !isObject(parsed)) {
    return { target: { provider, path, action: "blocked", beforeHash: existing?.contentHash ?? null, afterHash: null }, blocker: { provider, path, code: "invalid_json" } };
  }
  if (provider === "claude" && parsed.disableAllHooks === true) {
    return { target: { provider, path, action: "blocked", beforeHash: existing?.contentHash ?? null, afterHash: null }, blocker: { provider, path, code: "hooks_disabled" } };
  }
  if (parsed.hooks !== undefined && !isObject(parsed.hooks)) {
    return { target: { provider, path, action: "blocked", beforeHash: existing?.contentHash ?? null, afterHash: null }, blocker: { provider, path, code: "invalid_hook_shape" } };
  }

  let output = original;
  for (const event of EVENTS) {
    const current = parse(output, [], { allowTrailingComma: true, disallowComments: false }) as Record<string, unknown>;
    const hooks = isObject(current.hooks) ? current.hooks : {};
    const eventEntries = hooks[event] === undefined ? [] : hooks[event];
    if (!Array.isArray(eventEntries) || !eventEntries.every(isObject)) {
      return { target: { provider, path, action: "blocked", beforeHash: existing?.contentHash ?? null, afterHash: null }, blocker: { provider, path, code: "invalid_hook_shape" } };
    }
    let found = false;
    let lervoHandlerCount = 0;
    const expectedCommand = terminalHookCommand(provider);
    const providerCommand = new RegExp(`\\blervo\\s+terminal\\s+hook\\b[^\\n]*--provider\\s+${provider}\\b`, "u");
    for (const group of eventEntries) {
      if (!Array.isArray(group.hooks) || !group.hooks.every(isObject)) {
        return { target: { provider, path, action: "blocked", beforeHash: existing?.contentHash ?? null, afterHash: null }, blocker: { provider, path, code: "invalid_hook_shape" } };
      }
      for (const handler of group.hooks) {
        if (typeof handler.command !== "string") continue;
        if (providerCommand.test(handler.command)) {
          lervoHandlerCount += 1;
          found ||= handler.command === expectedCommand && handler.type === "command" && handler.timeout === 30;
        } else if (/\blervo\s+terminal\s+hook\b/u.test(handler.command)) {
          return { target: { provider, path, action: "blocked", beforeHash: existing?.contentHash ?? null, afterHash: null }, blocker: { provider, path, code: "conflicting_lervo_hook" } };
        }
      }
    }
    if (lervoHandlerCount > 0 && (!found || lervoHandlerCount > 1)) {
      const next: Record<string, unknown>[] = eventEntries.flatMap((group) => {
        const handlers = (group.hooks as Record<string, unknown>[]).filter((handler) => typeof handler.command !== "string" || !providerCommand.test(handler.command));
        return handlers.length === 0 ? [] : [{ ...group, hooks: handlers }];
      });
      next.push(hookEntry(provider));
      output = applyEdits(output, modify(output, ["hooks", event], next, { formattingOptions: FORMAT }));
    } else if (!found) {
      output = applyEdits(output, modify(output, ["hooks", event], [...eventEntries, hookEntry(provider)], { formattingOptions: FORMAT }));
    }
  }
  const afterHash = sha256(output);
  return {
    target: {
      provider,
      path,
      action: existing === null ? "create" : existing.contentHash === afterHash ? "unchanged" : "update",
      beforeHash: existing?.contentHash ?? null,
      afterHash,
    },
    content: output,
  };
}

export function serializableTerminalIntegrationPlan(plan: TerminalIntegrationPlan): Omit<TerminalIntegrationPlan, "operations"> & { operations: Array<Omit<DurableKnowledgeUserFileOperation, "content">> } {
  return { ...plan, operations: plan.operations.map(({ content: _content, ...operation }) => operation) };
}

export async function createTerminalIntegrationPlan(repositoryRoot: string): Promise<TerminalIntegrationPlan> {
  const root = resolve(repositoryRoot);
  const project = await loadProjectManifest(root);
  const existing = await Promise.all(PROVIDERS.map(async (provider) => [provider, await safeOptionalText(resolve(root, configurationPath(provider)))] as const));
  const blockers: TerminalIntegrationBlocker[] = [];
  try {
    const config = await safeOptionalText(resolve(root, ".codex/config.toml"));
    if (config !== null && codexHooksDisabled(config.content)) blockers.push({ provider: "codex", path: ".codex/config.toml", code: "hooks_disabled" });
  } catch (error) {
    if (error instanceof RepositoryKnowledgeError) blockers.push({ provider: "codex", path: ".codex/config.toml", code: "unsafe_file" });
    else throw error;
  }
  const merged = existing.map(([provider, file]) => mergeTarget(provider, file));
  for (const item of merged) if (item.blocker !== undefined) blockers.push(item.blocker);
  const targets = merged.map((item) => item.target);
  const operations: DurableKnowledgeUserFileOperation[] = blockers.length > 0 ? [] : merged.flatMap((item) => {
    if (item.target.action === "unchanged" || item.target.action === "blocked" || item.content === undefined || item.target.afterHash === null) return [];
    return [{
      path: item.target.path,
      action: item.target.action,
      ownership: "user" as const,
      mediaType: "application/json" as const,
      content: item.content,
      ...(item.target.beforeHash === null ? {} : { expectedCurrentHash: item.target.beforeHash }),
      desiredHash: item.target.afterHash,
    }];
  });
  const operationId = stableId("ktermop", { projectId: project.projectId, contractId: "lervo_terminal_hooks_v1", targets });
  const operationBindings = operations.map(({ content: _content, ...operation }) => operation);
  const approvalHash = sha256(canonicalJson({ operationId, contractId: "lervo_terminal_hooks_v1", targets, operations: operationBindings }));
  const planId = stableId("ktermplan", { projectId: project.projectId, operationId, approvalHash, blockers });
  return {
    schemaVersion: 1,
    planKind: "terminal_integration",
    planId,
    operationId,
    approvalHash,
    status: blockers.length > 0 ? "blocked" : operations.length > 0 ? "review_required" : "current",
    projectId: project.projectId,
    repositoryRoot: root,
    contractId: "lervo_terminal_hooks_v1",
    providers: PROVIDERS,
    targets,
    blockers,
    operations,
  };
}

export async function applyTerminalIntegrationPlan(input: {
  plan: TerminalIntegrationPlan;
  approvedOperationId: string;
  approvedHash: string;
  now: Date;
  recordApplied: (receipt: TerminalIntegrationReceipt) => void | Promise<void>;
  failureInjector?: (checkpoint: KnowledgeMaterializationCheckpoint) => "interrupt" | void | Promise<"interrupt" | void>;
}): Promise<TerminalIntegrationReceipt> {
  if (input.plan.status !== "review_required") throw new RepositoryKnowledgeError("knowledge_plan_stale", "The terminal integration plan has no applicable changes.");
  if (input.approvedOperationId !== input.plan.operationId || input.approvedHash !== input.plan.approvalHash) {
    throw new RepositoryKnowledgeError("knowledge_approval_required", "Terminal integration requires the exact operation ID and approval hash.");
  }
  const current = await createTerminalIntegrationPlan(input.plan.repositoryRoot);
  if (current.planId !== input.plan.planId) throw new RepositoryKnowledgeError("knowledge_plan_stale", "Provider hook configuration changed after planning.");
  const receipt: TerminalIntegrationReceipt = {
    schemaVersion: 1,
    operation: "terminal_integration_update",
    planId: current.planId,
    operationId: current.operationId,
    projectId: current.projectId,
    approvalHash: current.approvalHash,
    contractId: current.contractId,
    targetDigests: current.targets.flatMap((target) => target.afterHash === null ? [] : [{ provider: target.provider, pathDigest: sha256(target.path), afterHash: target.afterHash }]),
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
