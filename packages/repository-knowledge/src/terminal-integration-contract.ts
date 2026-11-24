import type {
  DurableKnowledgeUserFileOperation,
  DurableKnowledgeBinaryFileOperation,
  DurableKnowledgeDeleteOperation,
} from "./durable-apply.js";
import type { KnowledgeFileOperation } from "./types.js";

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

export interface TerminalRuntimeAsset {
  path:
    | "native/file-sync-darwin.node"
    | "native/file-sync.json"
    | "native/cas-io-darwin.node"
    | "native/cas-io.json";
  content: Uint8Array;
}

export interface TerminalRuntimeAssetBinding {
  path: TerminalRuntimeAsset["path"];
  contentHash: string;
  byteCount: number;
}

export type TerminalRuntimeOperation =
  | KnowledgeFileOperation
  | DurableKnowledgeBinaryFileOperation
  | (DurableKnowledgeDeleteOperation & { content?: never });

export interface TerminalIntegrationRuntimeTarget {
  path: ".lervo/generated/terminal-hooks/runtime-v2.mjs";
  manifestPath: ".lervo/generated/terminal-hooks/runtime-v2.json";
  action: "create" | "update" | "unchanged" | "blocked";
  beforeHash: string | null;
  afterHash: string;
  byteCount: number;
  assets?: Array<TerminalRuntimeAssetBinding & { beforeHash?: string | null }>;
  manifestBeforeHash?: string | null;
}

export interface TerminalIntegrationPlan {
  schemaVersion: 1;
  planKind: "terminal_integration";
  planId: string;
  priorApplicationEventId: string | null;
  operationId: string;
  /** Content hash binding the provider hook operations; null when only the runtime changes. */
  approvalHash: string | null;
  status: "current" | "ready" | "blocked";
  projectId: string;
  repositoryRoot: string;
  contractId: "lervo_terminal_hooks_v2";
  providers: readonly ["codex", "claude"];
  runtime: TerminalIntegrationRuntimeTarget;
  targets: TerminalIntegrationTarget[];
  blockers: TerminalIntegrationBlocker[];
  operations: Array<DurableKnowledgeUserFileOperation | TerminalRuntimeOperation>;
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

export const MAXIMUM_CONFIG_BYTES = 256 * 1024;
/**
 * The host bundle budget also bounds legacy repository artifacts during migration.
 */
export const TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES = 8 * 1024 * 1024;
export const TERMINAL_HOOK_LAUNCHER_MAXIMUM_BYTES = 16 * 1024;
export const FORMAT = {
  insertSpaces: true,
  tabSize: 2,
  eol: "\n",
  insertFinalNewline: true,
} as const;
export const PROVIDERS = ["codex", "claude"] as const;
export const EVENTS = ["UserPromptSubmit", "Stop"] as const;
/**
 * The hook events registered per provider. Claude also gets `SessionStart` (ADR-0562 section 4),
 * which answers each session epoch's start, resume, clear, or compaction with the base block.
 * Codex keeps the two events until its session-start support is confirmed.
 */
export function terminalIntegrationEvents(
  provider: (typeof PROVIDERS)[number],
): readonly ("SessionStart" | (typeof EVENTS)[number])[] {
  return provider === "claude" ? ["SessionStart", ...EVENTS] : EVENTS;
}
export const CONTRACT_ID = "lervo_terminal_hooks_v2" as const;
export const RUNTIME_PATH = ".lervo/generated/terminal-hooks/runtime-v2.mjs" as const;
export const RUNTIME_MANIFEST_PATH = ".lervo/generated/terminal-hooks/runtime-v2.json" as const;
