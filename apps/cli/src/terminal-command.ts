import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { access, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { delimiter, dirname, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

import { createTerminalCoverageReport } from "@lervo/diagnostics";
import type { EventDraft } from "@lervo/event-contract";
import { captureRepositorySnapshot } from "@lervo/orchestrator";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { validateSchema, type EventEnvelope, type TerminalTurnDeclaredEventPayload } from "@lervo/schemas";
import {
  canonicalJson,
  createKnowledgeInstructionBridgePlan,
  createKnowledgeMigrationPlan,
  createRepositoryLayoutMigrationPlan,
  createTerminalIntegrationPlan,
  formatWorkstreamContext,
  inspectConfiguredDocumentNormalization,
  lintRepositoryKnowledge,
  queryRepositoryKnowledge,
  sha256,
  type KnowledgeQueryHit,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import type { CliIo } from "./types.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

export const terminalUsage = "  lervo terminal status [--root <path>] [--json]\n  lervo terminal coverage [--root <path>] [--provider <codex|claude>] [--limit <1-100>] [--json]\n  lervo terminal declare --provider <codex|claude> --observation <observation-id> --stdin [--root <path>] [--json]\n  lervo terminal hook --provider <codex|claude> --contract 1";

type HookEvent = "UserPromptSubmit" | "Stop";

const MAXIMUM_CONTEXT_BYTES = 28 * 1024;
const MAXIMUM_DOCUMENT_CONTEXT_BYTES = 12 * 1024;
const MAXIMUM_WORKSTREAM_CONTEXT_BYTES = 8 * 1024;
const TRUNCATION_NOTICE = "\n[Lervo content truncated]";
const TERMINAL_OBSERVATION_POLICY_VERSION = sha256("lervo.terminal.unmanaged-observation.v1");
const EVIDENCE_TOKEN = /lervo-ref:(concept_[a-f0-9]{24}):(sha256:[a-f0-9]{64})/gu;

function evidenceMarker(document: Pick<PreparedDocument, "conceptId" | "contentHash">): string {
  return `<!-- lervo-ref:${document.conceptId}:${document.contentHash} -->`;
}

interface PreparedDocument {
  conceptId: string;
  path: string;
  contentHash: string;
  scope: "full" | "prefix";
  deliveredByteCount: number;
  assurance: KnowledgeQueryHit["assurance"];
  freshness: KnowledgeQueryHit["freshness"];
}

type ParsedHookInput = {
  event: HookEvent;
  providerSessionId: string;
  providerTurnId: string | null;
  prompt?: string;
  lastAssistantMessage?: string | null;
};

interface LifecycleInspection {
  schemaVersion: 1;
  status: "current" | "action_required";
  repositoryRoot: string;
  issues: Array<{ code: string; command: string }>;
  activation: TerminalActivationReceipt[];
  runtimeActivation: {
    status: "observed" | "partial" | "not_observed";
    evidenceMeaning: "hook_endpoint_observed_not_provider_authorship";
    observations: Array<{
      provider: TerminalIntegrationProvider;
      hookEvent: HookEvent;
      status: "observed" | "not_observed";
      occurredAt: string | null;
    }>;
  };
  activationReadiness: {
    status: "ready" | "action_required";
    actions: Array<{
      provider: TerminalIntegrationProvider;
      code: "codex_hook_review_or_activation_required" | "claude_hook_activation_required";
      instruction: string;
    }>;
  };
  repositoryChange: {
    beforeRevision: string;
    afterRevision: string;
    changed: boolean;
  };
}

interface PreparedTurnExpectation {
  contextEventId: string;
  observationId: string;
  provider: TerminalIntegrationProvider;
  workstreamId: string | null;
  revision: number | null;
  repositoryRevision: string;
}

interface TerminalActivationReceipt {
  schemaVersion: 1;
  contractId: "lervo_terminal_hooks_v1";
  provider: TerminalIntegrationProvider;
  hookEvent: HookEvent;
  result: "context_prepared" | "completion_allowed" | "completion_blocked";
  occurredAt: string;
  queryDigest?: string;
  sourceSnapshotId?: string;
  recommendationCount?: number;
  loadedDocumentCount?: number;
  contextHash?: string;
  repositoryRevision?: string;
  observationEventId?: string;
  referenceCount?: number;
}

async function repositoryRootFrom(start: string): Promise<string> {
  let current = resolve(start);
  while (true) {
    try {
      const manifest = await lstat(resolve(current, ".lervo/project.yaml"));
      if (manifest.isFile() && !manifest.isSymbolicLink()) return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error("No initialized Lervo repository contains the hook working directory.");
    current = parent;
  }
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (maximumBytes <= 0) return "";
  if (Buffer.byteLength(value) <= maximumBytes) return value;
  let bytes = 0;
  let end = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > maximumBytes) break;
    bytes += characterBytes;
    end += character.length;
  }
  return value.slice(0, end);
}

async function loadHit(root: string, hit: KnowledgeQueryHit, remainingBytes: number): Promise<{ content: string; scope: "full" | "prefix" } | null> {
  const target = resolve(root, hit.path);
  const child = relative(root, target);
  if (child === ".." || child.startsWith(`..${sep}`) || remainingBytes <= 0) return null;
  let handle;
  try {
    handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.isSymbolicLink() || before.size > 131_072) return null;
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.byteLength !== before.size || sha256(bytes) !== hit.contentHash) return null;
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (Buffer.byteLength(content) <= remainingBytes) return { content, scope: "full" };
    const noticeBytes = Buffer.byteLength(TRUNCATION_NOTICE);
    if (remainingBytes <= noticeBytes) return null;
    return { content: `${truncateUtf8(content, remainingBytes - noticeBytes)}${TRUNCATION_NOTICE}`, scope: "prefix" };
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

async function promptContext(root: string, prompt: string, provider: TerminalIntegrationProvider, observationId: string): Promise<{
  additionalContext: string;
  sourceSnapshotId: string;
  recommendationCount: number;
  documents: PreparedDocument[];
  repositoryRevision: string;
  workstream: {
    workstreamId: string;
    revision: number;
    snapshotHash: string;
    scope: "full" | "prefix";
    deliveredByteCount: number;
    context: string;
  } | null;
}> {
  const [supplementalSources, repositorySnapshot] = await Promise.all([
    collectLocalKnowledgeSources(root),
    captureRepositorySnapshot(root),
  ]);
  const result = await queryRepositoryKnowledge({ repositoryRoot: root, query: prompt, limit: 6, supplementalSources });
  const workstreamStorage = await openProjectStorage(root);
  let currentWorkstream;
  try { currentWorkstream = await verifiedCurrentWorkstream(workstreamStorage); }
  finally { await workstreamStorage.close(); }
  const workstream = currentWorkstream === null ? null : (() => {
    const full = formatWorkstreamContext(currentWorkstream);
    const noticeBytes = Buffer.byteLength(TRUNCATION_NOTICE);
    const context = Buffer.byteLength(full) <= MAXIMUM_WORKSTREAM_CONTEXT_BYTES
      ? full
      : `${truncateUtf8(full, MAXIMUM_WORKSTREAM_CONTEXT_BYTES - noticeBytes)}${TRUNCATION_NOTICE}`;
    return {
      workstreamId: currentWorkstream.workstreamId,
      revision: currentWorkstream.revision,
      snapshotHash: sha256(`${canonicalJson(currentWorkstream)}\n`),
      scope: context === full ? "full" as const : "prefix" as const,
      deliveredByteCount: Buffer.byteLength(context),
      context,
    };
  })();
  const preamble = [
    "Lervo terminal integration v1 queried this repository for the current user prompt.",
    `sourceSnapshotId: ${result.sourceSnapshotId}`,
    "The following exact-hash publications were loaded and prepared for return through the provider hook. This proves hook-side preparation, not provider acceptance, managed delivery, understanding, or later use.",
    "Use current repository bytes as authority, follow AGENTS.md, and do not treat a recommendation as semantic truth.",
    "If the final response explicitly relies on a supplied publication, append its exact Lervo evidence marker as a standalone Markdown HTML comment. Keep the marker out of prose and code. Markdown renderers hide the comment, while raw output retains verifiable evidence. A marker proves only an output reference, never understanding or internal use.",
    `For a repository-changing turn, finish repository verification and knowledge refresh first, then declare the bounded disposition with \`lervo terminal declare --provider ${provider} --observation ${observationId} --stdin\`. The stdin JSON fields are: taskMode=change|review|continuation|approval_response; canonicalizationDisposition=canonical_sources_current|canonical_sources_updated|pending_user_approval; knowledgeDisposition=current|refreshed|pending_user_approval; deliberationDisposition=not_requested|completed|no_consensus|failed; deliberationId=null unless bound to a completed Lervo deliberation. If the user explicitly requests or mentions Codex-Claude deliberation for the task, run \`lervo deliberate --auto --caller ${provider} "<bounded topic>"\` and bind its result instead of declaring not_requested. This declaration is an unmanaged agent claim checked against repository, knowledge, workstream, and deliberation evidence; it is not proof of internal reasoning. This is agent bookkeeping; never ask the user to run it. A read-only turn needs no declaration.`,
    workstream === null
      ? "If this turn changes repository-authored bytes, the agent must create a bounded checkpoint through the `lervo workstream start --actor agent --provider <current-provider>` plan/apply flow before completion. A read-only inquiry does not create artificial continuation state. The user must not be asked to run bookkeeping commands."
      : "If this turn changes repository-authored bytes, the agent must record the next bounded revision through the `lervo workstream update --actor agent --provider <current-provider>` plan/apply flow before completion. Preserve identity and origin, replace stale facts instead of accumulating prose, and do not ask the user to run bookkeeping commands. A read-only inquiry does not advance the workstream.",
  ].join("\n\n");
  const sections: string[] = [];
  const documents: PreparedDocument[] = [];
  let usedBytes = Buffer.byteLength(preamble) + (workstream === null ? 0 : Buffer.byteLength("\n\n") + workstream.deliveredByteCount);
  for (const hit of result.hits) {
    const sectionPrefix = [
      `## ${hit.path}`,
      `Lervo recommendation: score=${hit.score}; freshness=${hit.freshness}; assurance=${hit.assurance}; contentHash=${hit.contentHash}`,
      `Lervo evidence marker: ${evidenceMarker(hit)}`,
      "",
    ].join("\n");
    const separatorBytes = Buffer.byteLength("\n\n");
    const availableBytes = MAXIMUM_CONTEXT_BYTES - usedBytes - separatorBytes - Buffer.byteLength(sectionPrefix);
    const content = await loadHit(root, hit, Math.min(availableBytes, MAXIMUM_DOCUMENT_CONTEXT_BYTES));
    if (content === null) continue;
    const section = `${sectionPrefix}${content.content}`;
    sections.push(section);
    documents.push({
      conceptId: hit.conceptId,
      path: hit.path,
      contentHash: hit.contentHash,
      scope: content.scope,
      deliveredByteCount: Buffer.byteLength(content.content),
      assurance: hit.assurance,
      freshness: hit.freshness,
    });
    usedBytes += separatorBytes + Buffer.byteLength(section);
    if (MAXIMUM_CONTEXT_BYTES - usedBytes <= 512) break;
  }
  const fallback = "No matching publication was found. Inspect AGENTS.md and docs/knowledge/index.md before making repository changes.";
  const additionalContext = [preamble, ...(workstream === null ? [] : [workstream.context]), sections.length === 0 ? fallback : sections.join("\n\n")].join("\n\n");
  if (Buffer.byteLength(additionalContext) > MAXIMUM_CONTEXT_BYTES) throw new Error("Prepared provider context exceeds the bounded output limit.");
  return { additionalContext, sourceSnapshotId: result.sourceSnapshotId, recommendationCount: result.hits.length, documents, repositoryRevision: repositorySnapshot.revision, workstream };
}

function activationPath(root: string, provider: TerminalIntegrationProvider, event: HookEvent): string {
  return resolve(root, ".lervo/state/terminal-integration", `${provider}-${event === "UserPromptSubmit" ? "user-prompt-submit" : "stop"}.json`);
}

async function writeActivationReceipt(root: string, receipt: TerminalActivationReceipt): Promise<void> {
  const directory = resolve(root, ".lervo/state/terminal-integration");
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("Unsafe terminal activation state directory.");
  const target = activationPath(root, receipt.provider, receipt.hookEvent);
  const temporary = resolve(directory, `.activation-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    await handle.writeFile(`${JSON.stringify(receipt)}\n`);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

async function readActivationReceipts(root: string): Promise<TerminalActivationReceipt[]> {
  const receipts: TerminalActivationReceipt[] = [];
  for (const provider of ["codex", "claude"] as const) {
    for (const event of ["UserPromptSubmit", "Stop"] as const) {
      try {
        const path = activationPath(root, provider, event);
        const stats = await lstat(path);
        if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 16 * 1024) continue;
        const value = JSON.parse(await readFile(path, "utf8")) as TerminalActivationReceipt;
        if (value.schemaVersion === 1 && value.contractId === "lervo_terminal_hooks_v1" && value.provider === provider && value.hookEvent === event && typeof value.occurredAt === "string") receipts.push(value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      }
    }
  }
  return receipts.sort((left, right) => left.provider.localeCompare(right.provider) || left.hookEvent.localeCompare(right.hookEvent));
}

async function inspectRuntimeActivation(root: string, receipts: TerminalActivationReceipt[]): Promise<LifecycleInspection["runtimeActivation"]> {
  const storage = await openProjectStorage(root);
  try {
    const observations: LifecycleInspection["runtimeActivation"]["observations"] = [];
    for (const provider of ["codex", "claude"] as const) {
      for (const hookEvent of ["UserPromptSubmit", "Stop"] as const) {
        const receipt = receipts.find((item) => item.provider === provider && item.hookEvent === hookEvent);
        const event = receipt?.observationEventId === undefined ? null : storage.events.get(receipt.observationEventId);
        const expectedType = hookEvent === "UserPromptSubmit" ? "terminal.context.prepared" : "terminal.turn.observed";
        const observed = receipt !== undefined && event !== null && event.type === expectedType && event.actor.kind === "provider" && event.actor.provider === provider && event.occurredAt === receipt.occurredAt;
        observations.push({ provider, hookEvent, status: observed ? "observed" : "not_observed", occurredAt: observed ? receipt.occurredAt : null });
      }
    }
    const observedCount = observations.filter((item) => item.status === "observed").length;
    return {
      status: observedCount === observations.length ? "observed" : observedCount === 0 ? "not_observed" : "partial",
      evidenceMeaning: "hook_endpoint_observed_not_provider_authorship",
      observations,
    };
  } finally {
    await storage.close();
  }
}

function allEvents(events: ProjectStorage["events"]): EventEnvelope[] {
  const result: EventEnvelope[] = [];
  let afterSeq = 0;
  while (true) {
    const batch = events.list({ afterSeq, limit: 1000 });
    if (batch.length === 0) break;
    result.push(...batch);
    afterSeq = batch.at(-1)!.seq;
    if (batch.length < 1000) break;
  }
  return result;
}

function latestTurnDeclaration(
  events: ProjectStorage["events"],
  contextEventId: string,
  provider: TerminalIntegrationProvider,
): { event: EventEnvelope; payload: TerminalTurnDeclaredEventPayload } | null {
  const declarations = allEvents(events).filter((event) =>
    event.type === "terminal.turn.declared" &&
    event.actor.kind === "agent" &&
    event.actor.provider === provider &&
    event.payload.contextEventId === contextEventId);
  const event = declarations.at(-1);
  if (event === undefined) return null;
  const validation = validateSchema("terminalTurnDeclaredEventPayload", event.payload);
  if (!validation.valid) throw new Error("The terminal turn declaration event is invalid.");
  return { event, payload: event.payload as TerminalTurnDeclaredEventPayload };
}

function deliberationDeclarationMatches(
  events: ProjectStorage["events"],
  declaration: TerminalTurnDeclaredEventPayload,
): boolean {
  if (declaration.deliberationDisposition === "not_requested") return declaration.deliberationId === null;
  const completed = allEvents(events).filter((event) =>
    event.type === "deliberation.completed" && event.payload.deliberationId === declaration.deliberationId).at(-1);
  if (completed === undefined) return false;
  const status = completed.payload.status;
  return (declaration.deliberationDisposition === "completed" && status === "converged") ||
    (declaration.deliberationDisposition === "no_consensus" && status === "no_consensus") ||
    (declaration.deliberationDisposition === "failed" && status === "failed");
}

function activationReadiness(runtime: LifecycleInspection["runtimeActivation"]): LifecycleInspection["activationReadiness"] {
  const missingProviders = (["codex", "claude"] as const).filter((provider) =>
    runtime.observations.some((item) => item.provider === provider && item.status === "not_observed"));
  const actions: LifecycleInspection["activationReadiness"]["actions"] = missingProviders.map((provider) => provider === "codex"
    ? {
        provider,
        code: "codex_hook_review_or_activation_required",
        instruction: "Open Codex in this repository, run /hooks, review and trust the Lervo UserPromptSubmit and Stop command hooks, then submit one prompt and complete one turn.",
      }
    : {
        provider,
        code: "claude_hook_activation_required",
        instruction: "Open Claude Code in this repository, submit one prompt, and complete one turn so both installed Lervo hooks are observed.",
      });
  return { status: actions.length === 0 ? "ready" : "action_required", actions };
}

async function inspectLifecycle(root: string, expected?: PreparedTurnExpectation): Promise<LifecycleInspection> {
  const [supplementalSources, currentRepository] = await Promise.all([
    collectLocalKnowledgeSources(root),
    captureRepositorySnapshot(root),
  ]);
  const repositoryChange = {
    beforeRevision: expected?.repositoryRevision ?? currentRepository.revision,
    afterRevision: currentRepository.revision,
    changed: expected !== undefined && expected.repositoryRevision !== currentRepository.revision,
  };
  const issues: LifecycleInspection["issues"] = [];
  const executableAvailable = (await Promise.all((process.env.PATH ?? "").split(delimiter).filter(Boolean).map(async (directory) => {
    try {
      await access(resolve(directory, process.platform === "win32" ? "lervo.cmd" : "lervo"), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }))).some(Boolean);
  if (!executableAvailable) issues.push({ code: "terminal_executable_unavailable", command: "install the built Lervo CLI in the provider process PATH" });
  try {
    const handoff = await lstat(resolve(root, "HANDOFF.md"));
    if (handoff.isFile() && !handoff.isSymbolicLink()) issues.push({ code: "legacy_root_handoff_pending", command: "lervo migrate knowledge" });
    else issues.push({ code: "legacy_root_handoff_unsafe", command: "review HANDOFF.md and run lervo migrate knowledge" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const workstreamStorage = await openProjectStorage(root);
  try {
    const current = await verifiedCurrentWorkstream(workstreamStorage);
    const checkpointRequired = expected === undefined || repositoryChange.changed;
    if (checkpointRequired && current === null) {
      issues.push({ code: "workstream_missing", command: "lervo workstream start --stdin" });
    } else if (checkpointRequired && expected !== undefined && current !== null) {
      if (expected.workstreamId !== null && current.workstreamId !== expected.workstreamId) {
        issues.push({ code: "workstream_identity_changed", command: "lervo workstream current --json" });
      } else if (expected.revision !== null && current.revision <= expected.revision) {
        issues.push({ code: "workstream_checkpoint_required", command: "lervo workstream update --stdin" });
      }
    }
    if (expected !== undefined && repositoryChange.changed) {
      const declaration = latestTurnDeclaration(workstreamStorage.events, expected.contextEventId, expected.provider);
      if (declaration === null) {
        issues.push({
          code: "turn_declaration_missing",
          command: `lervo terminal declare --provider ${expected.provider} --observation ${expected.observationId} --stdin`,
        });
      } else {
        if (declaration.payload.repositoryRevision !== currentRepository.revision) {
          issues.push({
            code: "turn_declaration_stale",
            command: `lervo terminal declare --provider ${expected.provider} --observation ${expected.observationId} --stdin`,
          });
        }
        if (declaration.payload.canonicalizationDisposition === "not_applicable_read_only") {
          issues.push({ code: "canonicalization_disposition_invalid", command: "review canonical repository sources and redeclare the turn" });
        }
        if (declaration.payload.knowledgeDisposition === "not_applicable_read_only") {
          issues.push({ code: "knowledge_disposition_invalid", command: "run lervo migrate knowledge and redeclare the turn" });
        }
        if (declaration.payload.canonicalizationDisposition === "pending_user_approval" || declaration.payload.knowledgeDisposition === "pending_user_approval") {
          issues.push({ code: "turn_approval_pending", command: "obtain the required user decision before applying or completing the repository change" });
        }
        if (!deliberationDeclarationMatches(workstreamStorage.events, declaration.payload)) {
          issues.push({ code: "deliberation_declaration_invalid", command: "complete or accurately redeclare the requested deliberation lifecycle" });
        }
      }
    }
  } catch {
    issues.push({ code: "workstream_state_invalid", command: "lervo workstream current --json" });
  } finally {
    await workstreamStorage.close();
  }
  const terminal = await createTerminalIntegrationPlan(root);
  if (terminal.status !== "current") issues.push({ code: terminal.status === "blocked" ? "terminal_integration_blocked" : "terminal_integration_stale", command: "lervo migrate knowledge" });
  const layout = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root, supplementalSources });
  if (layout.status !== "current") issues.push({ code: `repository_layout_${layout.status}`, command: "lervo migrate knowledge" });
  if (layout.status === "current") {
    const bridge = await createKnowledgeInstructionBridgePlan({ repositoryRoot: root, provider: "claude", supplementalSources });
    if (bridge.status !== "current") issues.push({ code: `claude_instruction_bridge_${bridge.status}`, command: "lervo migrate knowledge" });
  }
  if (layout.status === "current" && issues.every((item) => !item.code.startsWith("claude_instruction_bridge_"))) {
    const structural = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate", supplementalSources });
    if (structural.operations.some((item) => item.action !== "unchanged")) issues.push({ code: `repository_knowledge_${structural.status}`, command: "lervo migrate knowledge" });
  }
  const lint = await lintRepositoryKnowledge(root, { supplementalSources });
  if (!lint.valid) issues.push({ code: "repository_knowledge_lint_failed", command: "lervo knowledge lint" });
  const normalization = await inspectConfiguredDocumentNormalization({ repositoryRoot: root, supplementalSources });
  if (normalization.pendingDocuments.length > 0) issues.push({ code: "document_normalization_pending", command: "lervo migrate knowledge --provider codex" });
  const activation = await readActivationReceipts(root);
  const runtimeActivation = await inspectRuntimeActivation(root, activation);
  return {
    schemaVersion: 1,
    status: issues.length === 0 ? "current" : "action_required",
    repositoryRoot: root,
    issues,
    activation,
    runtimeActivation,
    activationReadiness: activationReadiness(runtimeActivation),
    repositoryChange,
  };
}

function parseHookInput(value: string): ParsedHookInput {
  if (Buffer.byteLength(value) > 256 * 1024) throw new Error("Hook input exceeds the bounded input limit.");
  const parsed = JSON.parse(value) as {
    hook_event_name?: unknown;
    session_id?: unknown;
    turn_id?: unknown;
    prompt?: unknown;
    last_assistant_message?: unknown;
  };
  if (parsed?.hook_event_name !== "UserPromptSubmit" && parsed?.hook_event_name !== "Stop") throw new Error("Unsupported provider hook event.");
  if (typeof parsed.session_id !== "string" || parsed.session_id.trim() === "" || parsed.session_id.length > 512) throw new Error("The provider session coordinate is missing or invalid.");
  if (parsed.turn_id !== undefined && (typeof parsed.turn_id !== "string" || parsed.turn_id.trim() === "" || parsed.turn_id.length > 512)) throw new Error("The provider turn coordinate is invalid.");
  if (parsed.hook_event_name === "UserPromptSubmit" && (typeof parsed.prompt !== "string" || parsed.prompt.trim() === "" || parsed.prompt.length > 64 * 1024)) throw new Error("The prompt is missing or exceeds the bounded prompt limit.");
  if (parsed.hook_event_name === "Stop" && parsed.last_assistant_message !== undefined && parsed.last_assistant_message !== null && typeof parsed.last_assistant_message !== "string") throw new Error("The provider completion message is invalid.");
  return {
    event: parsed.hook_event_name,
    providerSessionId: parsed.session_id,
    providerTurnId: typeof parsed.turn_id === "string" ? parsed.turn_id : null,
    ...(typeof parsed.prompt === "string" ? { prompt: parsed.prompt } : {}),
    ...(parsed.last_assistant_message === null || typeof parsed.last_assistant_message === "string" ? { lastAssistantMessage: parsed.last_assistant_message } : {}),
  };
}

interface UnmanagedCoordinates {
  runId: string;
  sessionId: string;
  providerSessionDigest: string;
  providerTurnDigest: string | null;
}

function digestSuffix(digest: string): string {
  return digest.slice("sha256:".length, "sha256:".length + 24);
}

function unmanagedCoordinates(provider: TerminalIntegrationProvider, input: ParsedHookInput): UnmanagedCoordinates {
  const providerSessionDigest = sha256(`${provider}\0${input.providerSessionId}`);
  const providerTurnDigest = input.providerTurnId === null ? null : sha256(`${provider}\0${input.providerSessionId}\0${input.providerTurnId}`);
  const suffix = digestSuffix(providerSessionDigest);
  return {
    runId: `run_unmanaged_${suffix}`,
    sessionId: `ses_unmanaged_${suffix}`,
    providerSessionDigest,
    providerTurnDigest,
  };
}

function newIdentifier(prefix: "evt" | "tobs" | "tdecl"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function assertRepositoryRelativePath(path: string): void {
  const normalized = path.replaceAll("\\", "/");
  if (path === "" || normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized) || normalized.split("/").includes("..")) throw new Error("Prepared context contains an unsafe repository path.");
}

function eventDraft(input: {
  eventId?: string;
  projectId: string;
  coordinates: UnmanagedCoordinates;
  provider: TerminalIntegrationProvider;
  actorKind?: "provider" | "agent";
  type: EventDraft["type"];
  occurredAt: string;
  payload: Readonly<Record<string, unknown>>;
}): EventDraft {
  return {
    eventId: input.eventId ?? newIdentifier("evt"),
    projectId: input.projectId,
    runId: input.coordinates.runId,
    sessionId: input.coordinates.sessionId,
    type: input.type,
    occurredAt: input.occurredAt,
    actor: { kind: input.actorKind ?? "provider", provider: input.provider },
    schemaVersion: 1,
    policyVersion: TERMINAL_OBSERVATION_POLICY_VERSION,
    payload: input.payload,
  };
}

async function recordPreparedContext(input: {
  root: string;
  provider: TerminalIntegrationProvider;
  coordinates: UnmanagedCoordinates;
  prompt: string;
  observationId: string;
  context: Awaited<ReturnType<typeof promptContext>>;
  occurredAt: string;
}): Promise<string> {
  input.context.documents.forEach((document) => assertRepositoryRelativePath(document.path));
  const storage = await openProjectStorage(input.root);
  try {
    const result = storage.events.append(eventDraft({
      projectId: storage.manifest.projectId,
      coordinates: input.coordinates,
      provider: input.provider,
      type: "terminal.context.prepared",
      occurredAt: input.occurredAt,
      payload: {
        observationId: input.observationId,
        executionMode: "unmanaged",
        providerSessionDigest: input.coordinates.providerSessionDigest,
        providerTurnDigest: input.coordinates.providerTurnDigest,
        sourceSnapshotId: input.context.sourceSnapshotId,
        repositoryRevision: input.context.repositoryRevision,
        queryDigest: sha256(input.prompt),
        contextHash: sha256(input.context.additionalContext),
        recommendationCount: input.context.recommendationCount,
        loadedDocuments: input.context.documents,
        workstreamId: input.context.workstream?.workstreamId ?? null,
        workstreamRevision: input.context.workstream?.revision ?? null,
        workstreamSnapshotHash: input.context.workstream?.snapshotHash ?? null,
        workstreamScope: input.context.workstream?.scope ?? null,
        workstreamDeliveredByteCount: input.context.workstream?.deliveredByteCount ?? null,
      },
    }));
    return result.event.eventId;
  } finally {
    await storage.close();
  }
}

function findLatestPreparedContext(
  events: ProjectStorage["events"],
  coordinates: UnmanagedCoordinates,
  provider: TerminalIntegrationProvider,
) {
  let afterSeq = 0;
  let found: ReturnType<typeof events.list>[number] | null = null;
  while (true) {
    const batch = events.list({ runId: coordinates.runId, afterSeq, limit: 1000 });
    if (batch.length === 0) break;
    for (const event of batch) {
      afterSeq = event.seq;
      if (event.type !== "terminal.context.prepared" || event.actor.kind !== "provider" || event.actor.provider !== provider) continue;
      const payload = event.payload as Record<string, unknown>;
      if (payload.providerSessionDigest !== coordinates.providerSessionDigest) continue;
      if (coordinates.providerTurnDigest !== null && payload.providerTurnDigest !== coordinates.providerTurnDigest) continue;
      found = event;
    }
    if (batch.length < 1000) break;
  }
  return found;
}

async function preparedTurnExpectation(
  root: string,
  coordinates: UnmanagedCoordinates,
  provider: TerminalIntegrationProvider,
): Promise<PreparedTurnExpectation> {
  const storage = await openProjectStorage(root);
  try {
    const context = findLatestPreparedContext(storage.events, coordinates, provider);
    if (context === null) throw new Error("No matching prepared terminal context exists for this provider turn.");
    const payload = context.payload as Record<string, unknown>;
    const workstreamId = payload.workstreamId;
    const revision = payload.workstreamRevision;
    const repositoryRevision = payload.repositoryRevision;
    const bothNull = workstreamId === null && revision === null;
    const bothPresent = typeof workstreamId === "string" && Number.isSafeInteger(revision) && Number(revision) >= 1;
    if (!bothNull && !bothPresent) throw new Error("Prepared workstream coordinates are incomplete.");
    if (typeof repositoryRevision !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(repositoryRevision)) throw new Error("Prepared repository revision is invalid.");
    if (typeof payload.observationId !== "string") throw new Error("Prepared terminal observation coordinate is invalid.");
    return {
      contextEventId: context.eventId,
      observationId: payload.observationId,
      provider,
      workstreamId: bothPresent ? workstreamId : null,
      revision: bothPresent ? Number(revision) : null,
      repositoryRevision,
    };
  } finally {
    await storage.close();
  }
}

function observedReferences(lastAssistantMessage: string | null | undefined, documents: PreparedDocument[]): PreparedDocument[] {
  if (typeof lastAssistantMessage !== "string") return [];
  const expected = new Map(documents.map((document) => [`${document.conceptId}\0${document.contentHash}`, document]));
  const observed = new Map<string, PreparedDocument>();
  for (const match of lastAssistantMessage.matchAll(new RegExp(EVIDENCE_TOKEN.source, EVIDENCE_TOKEN.flags))) {
    const key = `${match[1]}\0${match[2]}`;
    const document = expected.get(key);
    if (document !== undefined) observed.set(key, document);
  }
  return [...observed.values()];
}

async function recordObservedTurn(input: {
  root: string;
  provider: TerminalIntegrationProvider;
  coordinates: UnmanagedCoordinates;
  hookInput: ParsedHookInput;
  lifecycle: LifecycleInspection;
  occurredAt: string;
}): Promise<{ eventId: string; referenceCount: number }> {
  const storage = await openProjectStorage(input.root);
  try {
    const context = findLatestPreparedContext(storage.events, input.coordinates, input.provider);
    if (context === null) throw new Error("No matching prepared terminal context exists for this provider turn.");
    const payload = context.payload as Record<string, unknown>;
    if (!Array.isArray(payload.loadedDocuments)) throw new Error("Prepared terminal context evidence is incomplete.");
    const documents = payload.loadedDocuments as unknown as PreparedDocument[];
    for (const document of documents) assertRepositoryRelativePath(document.path);
    const references = observedReferences(input.hookInput.lastAssistantMessage, documents);
    const finalWorkstream = await verifiedCurrentWorkstream(storage);
    const referenceEventIds = references.map(() => newIdentifier("evt"));
    const turnEventId = newIdentifier("evt");
    storage.events.transact((transaction) => {
      references.forEach((document, index) => transaction.append(eventDraft({
        eventId: referenceEventIds[index]!,
        projectId: storage.manifest.projectId,
        coordinates: input.coordinates,
        provider: input.provider,
        type: "terminal.reference.observed",
        occurredAt: input.occurredAt,
        payload: {
          observationId: newIdentifier("tobs"),
          contextEventId: context.eventId,
          conceptId: document.conceptId,
          path: document.path,
          contentHash: document.contentHash,
          scope: document.scope,
          referenceKind: "output_citation",
          providerSessionDigest: input.coordinates.providerSessionDigest,
          providerTurnDigest: input.coordinates.providerTurnDigest,
        },
      })));
      transaction.append(eventDraft({
        eventId: turnEventId,
        projectId: storage.manifest.projectId,
        coordinates: input.coordinates,
        provider: input.provider,
        type: "terminal.turn.observed",
        occurredAt: input.occurredAt,
        payload: {
          observationId: newIdentifier("tobs"),
          contextEventId: context.eventId,
          referenceEventIds,
          referenceCount: references.length,
          referenceTelemetry: typeof input.hookInput.lastAssistantMessage === "string" ? "observed" : "unavailable",
          lifecycleStatus: input.lifecycle.status,
          completionResult: input.lifecycle.status === "current" ? "allowed" : "blocked",
          repositoryRevisionBefore: input.lifecycle.repositoryChange.beforeRevision,
          repositoryRevisionAfter: input.lifecycle.repositoryChange.afterRevision,
          repositoryChanged: input.lifecycle.repositoryChange.changed,
          finalWorkstreamId: finalWorkstream?.workstreamId ?? null,
          finalWorkstreamRevision: finalWorkstream?.revision ?? null,
          finalWorkstreamSnapshotHash: finalWorkstream === null ? null : sha256(`${canonicalJson(finalWorkstream)}\n`),
          providerSessionDigest: input.coordinates.providerSessionDigest,
          providerTurnDigest: input.coordinates.providerTurnDigest,
        },
      }));
    });
    return { eventId: turnEventId, referenceCount: references.length };
  } finally {
    await storage.close();
  }
}

function parseTurnDeclarationDraft(value: string): Pick<
  TerminalTurnDeclaredEventPayload,
  "taskMode" | "canonicalizationDisposition" | "knowledgeDisposition" | "deliberationDisposition" | "deliberationId"
> {
  if (Buffer.byteLength(value) > 16 * 1024) throw new Error("The terminal turn declaration exceeds 16 KiB.");
  const parsed = JSON.parse(value) as Record<string, unknown>;
  const allowed = new Set(["taskMode", "canonicalizationDisposition", "knowledgeDisposition", "deliberationDisposition", "deliberationId"]);
  if (parsed === null || Array.isArray(parsed) || Object.keys(parsed).some((key) => !allowed.has(key))) throw new Error("The terminal turn declaration contains unsupported fields.");
  const taskModes = ["inquiry", "change", "review", "continuation", "approval_response"] as const;
  const canonicalization = ["not_applicable_read_only", "canonical_sources_current", "canonical_sources_updated", "pending_user_approval"] as const;
  const knowledge = ["not_applicable_read_only", "current", "refreshed", "pending_user_approval"] as const;
  const deliberation = ["not_requested", "completed", "no_consensus", "failed"] as const;
  if (!taskModes.includes(parsed.taskMode as typeof taskModes[number])) throw new Error("The terminal taskMode is invalid.");
  if (!canonicalization.includes(parsed.canonicalizationDisposition as typeof canonicalization[number])) throw new Error("The canonicalizationDisposition is invalid.");
  if (!knowledge.includes(parsed.knowledgeDisposition as typeof knowledge[number])) throw new Error("The knowledgeDisposition is invalid.");
  if (!deliberation.includes(parsed.deliberationDisposition as typeof deliberation[number])) throw new Error("The deliberationDisposition is invalid.");
  if (parsed.deliberationId !== null && (typeof parsed.deliberationId !== "string" || !/^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(parsed.deliberationId))) throw new Error("The deliberationId is invalid.");
  return parsed as ReturnType<typeof parseTurnDeclarationDraft>;
}

async function runDeclare(args: string[], io: CliIo): Promise<number> {
  let storage: ProjectStorage | undefined;
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        provider: { type: "string" }, observation: { type: "string" }, stdin: { type: "boolean" },
        root: { type: "string" }, json: { type: "boolean" },
      },
    });
    if (parsed.values.provider !== "codex" && parsed.values.provider !== "claude") throw new Error("--provider must be codex or claude.");
    if (typeof parsed.values.observation !== "string" || !/^tobs_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(parsed.values.observation)) throw new Error("--observation is invalid.");
    if (!parsed.values.stdin || io.stdin === undefined) throw new Error("The declaration must be supplied through --stdin.");
    const draft = parseTurnDeclarationDraft(await io.stdin());
    const root = await repositoryRootFrom(resolve(io.cwd, parsed.values.root ?? "."));
    storage = await openProjectStorage(root);
    const context = allEvents(storage.events).filter((event) =>
      event.type === "terminal.context.prepared" &&
      event.actor.kind === "provider" && event.actor.provider === parsed.values.provider &&
      event.payload.observationId === parsed.values.observation).at(-1);
    if (context === undefined) throw new Error("No matching prepared terminal observation exists.");
    const contextRevision = context.payload.repositoryRevision;
    if (typeof contextRevision !== "string") throw new Error("The prepared terminal observation has no repository revision.");
    const repository = await captureRepositorySnapshot(root);
    const repositoryChanged = contextRevision !== repository.revision;
    if (repositoryChanged && draft.taskMode === "inquiry") throw new Error("An inquiry declaration cannot bind changed repository bytes.");
    if (repositoryChanged && (draft.canonicalizationDisposition === "not_applicable_read_only" || draft.knowledgeDisposition === "not_applicable_read_only")) throw new Error("A repository-changing turn requires canonicalization and knowledge dispositions.");
    if (!repositoryChanged && (draft.canonicalizationDisposition !== "not_applicable_read_only" || draft.knowledgeDisposition !== "not_applicable_read_only")) throw new Error("An unchanged turn must use read-only canonicalization and knowledge dispositions.");
    const occurredAt = new Date().toISOString();
    const payload: TerminalTurnDeclaredEventPayload = {
      declarationId: newIdentifier("tdecl"),
      contextEventId: context.eventId,
      repositoryRevision: repository.revision,
      ...draft,
      declaredAt: occurredAt,
    };
    const validation = validateSchema("terminalTurnDeclaredEventPayload", payload);
    if (!validation.valid) throw new Error("The terminal turn declaration does not satisfy the bounded contract.");
    if (!deliberationDeclarationMatches(storage.events, payload)) throw new Error("The declared deliberation result is not bound to a matching completed deliberation event.");
    const providerSessionDigest = context.payload.providerSessionDigest;
    const providerTurnDigest = context.payload.providerTurnDigest;
    if (typeof providerSessionDigest !== "string" || (providerTurnDigest !== null && typeof providerTurnDigest !== "string")) throw new Error("The prepared provider coordinates are invalid.");
    const recorded = storage.events.append(eventDraft({
      projectId: storage.manifest.projectId,
      coordinates: {
        runId: context.runId,
        sessionId: context.sessionId,
        providerSessionDigest,
        providerTurnDigest,
      },
      provider: parsed.values.provider,
      actorKind: "agent",
      type: "terminal.turn.declared",
      occurredAt,
      payload,
    }));
    io.stdout(parsed.values.json
      ? `${JSON.stringify({ schemaVersion: 1, status: "declared", eventId: recorded.event.eventId, ...payload }, null, 2)}\n`
      : `Terminal turn disposition declared.\nobservation: ${parsed.values.observation}\nrepositoryRevision: ${repository.revision}\n`);
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${terminalUsage}\n`);
    return 1;
  } finally {
    await storage?.close();
  }
}

async function runHook(args: string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseArgs({ args, strict: true, allowPositionals: false, options: { provider: { type: "string" }, contract: { type: "string" } } });
    if (parsed.values.provider !== "codex" && parsed.values.provider !== "claude") throw new Error("--provider must be codex or claude.");
    const provider = parsed.values.provider;
    if (parsed.values.contract !== "1") throw new Error("Unsupported terminal integration contract.");
    if (io.stdin === undefined) throw new Error("Provider hook input is unavailable.");
    const input = parseHookInput(await io.stdin());
    const root = await repositoryRootFrom(io.cwd);
    const coordinates = unmanagedCoordinates(provider, input);
    const occurredAt = new Date().toISOString();
    if (input.event === "UserPromptSubmit") {
      const observationId = newIdentifier("tobs");
      const context = await promptContext(root, input.prompt!, provider, observationId);
      const observationEventId = await recordPreparedContext({ root, provider, coordinates, prompt: input.prompt!, observationId, context, occurredAt });
      await writeActivationReceipt(root, {
        schemaVersion: 1,
        contractId: "lervo_terminal_hooks_v1",
        provider,
        hookEvent: input.event,
        result: "context_prepared",
        occurredAt,
        queryDigest: sha256(input.prompt!),
        sourceSnapshotId: context.sourceSnapshotId,
        recommendationCount: context.recommendationCount,
        loadedDocumentCount: context.documents.length,
        contextHash: sha256(context.additionalContext),
        repositoryRevision: context.repositoryRevision,
        observationEventId,
      });
      io.stdout(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context.additionalContext } })}\n`);
      return 0;
    }
    const expectation = await preparedTurnExpectation(root, coordinates, provider);
    const lifecycle = await inspectLifecycle(root, expectation);
    const observation = await recordObservedTurn({ root, provider, coordinates, hookInput: input, lifecycle, occurredAt });
    if (lifecycle.status === "current") {
      await writeActivationReceipt(root, { schemaVersion: 1, contractId: "lervo_terminal_hooks_v1", provider, hookEvent: input.event, result: "completion_allowed", occurredAt, observationEventId: observation.eventId, referenceCount: observation.referenceCount });
      io.stdout("{}\n");
      return 0;
    }
    const reason = [
      "Lervo blocked terminal completion because the repository lifecycle is not current.",
      ...lifecycle.issues.map((item) => `${item.code}: run ${item.command}, review the read-only plan, and apply only the exact current plan/approval.`),
      "Complete the required migration or lint work, then try to finish again.",
    ].join("\n");
    await writeActivationReceipt(root, { schemaVersion: 1, contractId: "lervo_terminal_hooks_v1", provider, hookEvent: input.event, result: "completion_blocked", occurredAt, observationEventId: observation.eventId, referenceCount: observation.referenceCount });
    io.stdout(`${JSON.stringify({ decision: "block", reason })}\n`);
    return 0;
  } catch {
    io.stderr("Lervo terminal integration failed closed without exposing prompt or provider configuration content.\n");
    return 2;
  }
}

async function runCoverage(args: string[], io: CliIo): Promise<number> {
  let storage: ProjectStorage | undefined;
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        provider: { type: "string" },
        limit: { type: "string" },
        json: { type: "boolean" },
      },
    });
    if (parsed.values.provider !== undefined && parsed.values.provider !== "codex" && parsed.values.provider !== "claude") throw new Error("--provider must be codex or claude.");
    const limit = parsed.values.limit === undefined ? 20 : Number(parsed.values.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be an integer between 1 and 100.");
    const root = await repositoryRootFrom(resolve(io.cwd, parsed.values.root ?? "."));
    storage = await openProjectStorage(root);
    const report = createTerminalCoverageReport({
      projectId: storage.manifest.projectId,
      events: storage.events,
      ...(parsed.values.provider === undefined ? {} : { provider: parsed.values.provider }),
      limit,
    });
    if (parsed.values.json) {
      io.stdout(`${JSON.stringify(report, null, 2)}\n`);
    } else if (report.reports.length === 0) {
      io.stdout("No unmanaged terminal context observations were found.\n");
    } else {
      const lines = report.reports.map((item) => {
        const referenced = item.coverage.explicitReference.value === null
          ? item.coverage.explicitReference.reason
          : `${item.coverage.explicitReference.numerator}/${item.coverage.explicitReference.denominator}`;
        return `  ${item.provider} ${item.occurredAt}: prepared=${item.documents.length}; referenced=${referenced}; completion=${item.completion.result}`;
      });
      io.stdout(`Unmanaged terminal context observations: ${report.reports.length}\n${lines.join("\n")}\nManaged delivery and internal use remain unsupported for direct provider execution.\n`);
    }
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${terminalUsage}\n`);
    return 1;
  } finally {
    await storage?.close();
  }
}

export async function runTerminalCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] === "hook") return runHook(args.slice(1), io);
  if (args[0] === "declare") return runDeclare(args.slice(1), io);
  if (args[0] === "coverage") return runCoverage(args.slice(1), io);
  if (args[0] === "status") {
    try {
      const parsed = parseArgs({ args: args.slice(1), strict: true, allowPositionals: false, options: { root: { type: "string" }, json: { type: "boolean" } } });
      const root = await repositoryRootFrom(resolve(io.cwd, parsed.values.root ?? "."));
      const result = await inspectLifecycle(root);
      io.stdout(parsed.values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : [
            `Lervo terminal lifecycle: ${result.status}`,
            `Hook endpoint observation: ${result.runtimeActivation.status} (does not prove provider authorship)`,
            `Activation readiness: ${result.activationReadiness.status}`,
            ...result.issues.map((item) => `  ${item.code}: ${item.command}`),
            ...result.activationReadiness.actions.map((item) => `  ${item.provider} [${item.code}]: ${item.instruction}`),
            "",
          ].join("\n"));
      return result.status === "current" && result.activationReadiness.status === "ready" ? 0 : 1;
    } catch (error) {
      io.stderr(`${error instanceof Error ? error.message : String(error)}\n${terminalUsage}\n`);
      return 1;
    }
  }
  io.stderr(`Specify a supported terminal subcommand.\n${terminalUsage}\n`);
  return 1;
}
