import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  applyKnowledgeInstructionBridgePlan,
  applyKnowledgeMigrationPlan,
  applyTerminalIntegrationPlan,
  createKnowledgeInstructionBridgePlan,
  createKnowledgeMigrationPlan,
  createTerminalIntegrationPlan,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

async function initializedRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-terminal-"));
  roots.push(root);
  await writeFile(resolve(root, "README.md"), "# Terminal fixture\n\nThe atlas cache uses immutable blue envelopes.\n");
  await writeFile(resolve(root, "AGENTS.md"), "# Agent instructions\n\nUse repository knowledge before changes.\n");
  const io = { cwd: root, stdout: () => undefined, stderr: () => undefined };
  expect(await runCli(["init"], io)).toBe(0);
  const structural = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
  await applyKnowledgeMigrationPlan(structural, new Date(), () => undefined);
  const bridge = await createKnowledgeInstructionBridgePlan({ repositoryRoot: root, provider: "claude" });
  await applyKnowledgeInstructionBridgePlan({ plan: bridge, approvedOperationId: bridge.operationId, approvedHash: bridge.approvalHash, now: new Date(), recordApplied: () => undefined });
  const terminal = await createTerminalIntegrationPlan(root);
  await applyTerminalIntegrationPlan({ plan: terminal, approvedOperationId: terminal.operationId, approvedHash: terminal.approvalHash, now: new Date(), recordApplied: () => undefined });
  const refreshed = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
  if (refreshed.operations.some((item) => item.action !== "unchanged")) await applyKnowledgeMigrationPlan(refreshed, new Date(), () => undefined);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("terminal integration CLI", () => {
  it("requires agent-authored continuation checkpoints only when repository bytes change", async () => {
    const root = await initializedRepository();
    const commandErrors: string[] = [];
    const quiet = { cwd: root, stdout: () => undefined, stderr: (message: string) => commandErrors.push(message) };
    const prompt = async (turnId: string) => {
      const messages: string[] = [];
      expect(await runCli(["terminal", "hook", "--provider", "claude", "--contract", "1"], {
        ...quiet,
        stdout: (message) => messages.push(message),
        stdin: async () => JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "continuity-session", turn_id: turnId, prompt: "Continue the repository task." }),
      })).toBe(0);
      return JSON.parse(messages.join("")).hookSpecificOutput.additionalContext as string;
    };
    const stop = async (turnId: string) => {
      const messages: string[] = [];
      expect(await runCli(["terminal", "hook", "--provider", "claude", "--contract", "1"], {
        ...quiet,
        stdout: (message) => messages.push(message),
        stdin: async () => JSON.stringify({ hook_event_name: "Stop", session_id: "continuity-session", turn_id: turnId, last_assistant_message: "Done." }),
      })).toBe(0);
      return JSON.parse(messages.join("")) as { decision?: string; reason?: string };
    };
    const declare = async (context: string, taskMode: "change" | "continuation") => {
      const observation = context.match(/--observation (tobs_[A-Za-z0-9_-]+)/u)?.[1];
      expect(observation).toMatch(/^tobs_/u);
      const declaration = JSON.stringify({
        taskMode,
        canonicalizationDisposition: "canonical_sources_current",
        knowledgeDisposition: "current",
        deliberationDisposition: "not_requested",
        deliberationId: null,
      });
      expect(await runCli(["terminal", "declare", "--provider", "claude", "--observation", observation!, "--stdin"], {
        ...quiet,
        stdin: async () => declaration,
      }), commandErrors.join("")).toBe(0);
    };
    expect(await prompt("turn-read-only")).toContain("must create a bounded checkpoint");
    expect((await stop("turn-read-only")).reason ?? "").not.toMatch(/workstream_(?:missing|checkpoint_required)/u);

    const startContext = await prompt("turn-start");
    expect(startContext).toContain("must create a bounded checkpoint");
    await writeFile(resolve(root, "feature.ts"), "export const firstCheckpoint = true;\n");
    expect(await stop("turn-start")).toMatchObject({ decision: "block", reason: expect.stringContaining("workstream_missing") });

    const draft = JSON.stringify({ schemaVersion: 1, status: "active", title: "Continuity fixture", objective: "Keep provider turns resumable.", nextActions: ["Advance the next revision."], blockers: [], notes: [], references: [], updatedAt: "2026-08-24T04:00:00.000Z" });
    const startPlanOutput: string[] = [];
    expect(await runCli(["workstream", "start", "--actor", "agent", "--provider", "claude", "--stdin", "--json"], { ...quiet, stdin: async () => draft, stdout: (message) => startPlanOutput.push(message) })).toBe(0);
    const startPlan = JSON.parse(startPlanOutput.join("")) as { planId: string };
    expect(await runCli(["workstream", "start", "--actor", "agent", "--provider", "claude", "--stdin", "--apply", startPlan.planId], { ...quiet, stdin: async () => draft }), commandErrors.join("")).toBe(0);
    expect(await stop("turn-start")).toMatchObject({ decision: "block", reason: expect.stringContaining("turn_declaration_missing") });
    await declare(startContext, "change");
    expect((await stop("turn-start")).reason ?? "").not.toMatch(/(?:workstream_(?:missing|checkpoint_required)|turn_declaration_)/u);

    const updateContext = await prompt("turn-update");
    expect(updateContext).toContain("revision: 1");
    await writeFile(resolve(root, "feature.ts"), "export const secondCheckpoint = true;\n");
    expect(await stop("turn-update")).toMatchObject({ decision: "block", reason: expect.stringContaining("workstream_checkpoint_required") });
    const currentOutput: string[] = [];
    expect(await runCli(["workstream", "current", "--json"], { ...quiet, stdout: (message) => currentOutput.push(message) })).toBe(0);
    const current = JSON.parse(currentOutput.join("")).workstream as Record<string, unknown>;
    const desired = JSON.stringify({ ...current, revision: 2, updatedAt: "2026-08-24T04:01:00.000Z" });
    const updatePlanOutput: string[] = [];
    expect(await runCli(["workstream", "update", "--actor", "agent", "--provider", "claude", "--stdin", "--json"], { ...quiet, stdin: async () => desired, stdout: (message) => updatePlanOutput.push(message) })).toBe(0);
    const updatePlan = JSON.parse(updatePlanOutput.join("")) as { planId: string };
    expect(await runCli(["workstream", "update", "--actor", "agent", "--provider", "claude", "--stdin", "--apply", updatePlan.planId], { ...quiet, stdin: async () => desired })).toBe(0);
    await declare(updateContext, "continuation");
    expect((await stop("turn-update")).reason ?? "").not.toMatch(/(?:workstream_(?:missing|checkpoint_required)|turn_declaration_)/u);

    const storage = await openProjectStorage(root);
    try {
      const recorded = storage.events.list().filter((event) => event.type === "workstream.snapshot.recorded");
      expect(recorded.slice(-2)).toMatchObject([
        { actor: { kind: "agent", provider: "claude" }, payload: { changeKind: "agent_start", revision: 1 } },
        { actor: { kind: "agent", provider: "claude" }, payload: { changeKind: "agent_update", revision: 2 } },
      ]);
    } finally {
      await storage.close();
    }
  }, 15_000);

  it("injects the structured current workstream independently of lexical knowledge hits", async () => {
    const root = await initializedRepository();
    await writeFile(resolve(root, "HANDOFF.md"), "# Active launch handoff\n\n## Current objective\n\nFinish the cobalt launch gate.\n\n## Next actions\n\n- Verify the device build.\n");
    const migrationOutput: string[] = [];
    expect(await runCli(["migrate", "knowledge", "--json"], { cwd: root, stdout: (message) => migrationOutput.push(message), stderr: () => undefined })).toBe(0);
    const migration = JSON.parse(migrationOutput.join("")) as { planId: string; operationId: string; approvalHash: string };
    expect(await runCli(["migrate", "knowledge", "--apply", migration.planId, "--approve-item", `${migration.operationId}=${migration.approvalHash}`], { cwd: root, stdout: () => undefined, stderr: () => undefined })).toBe(0);
    const messages: string[] = [];
    const errors: string[] = [];
    expect(await runCli(["terminal", "hook", "--provider", "codex", "--contract", "1"], {
      cwd: root,
      stdout: (message) => messages.push(message),
      stderr: (message) => errors.push(message),
      stdin: async () => JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "workstream-session", turn_id: "turn-workstream", prompt: "unrelated lexical phrase" }),
    }), errors.join("")).toBe(0);
    const output = JSON.parse(messages.join("")) as { hookSpecificOutput: { additionalContext: string } };
    expect(output.hookSpecificOutput.additionalContext).toContain("## Lervo current workstream");
    expect(output.hookSpecificOutput.additionalContext).toContain("Finish the cobalt launch gate.");
    const activation = JSON.parse(await readFile(resolve(root, ".lervo/state/terminal-integration/codex-user-prompt-submit.json"), "utf8"));
    const recorded = await openProjectStorage(root);
    try {
      expect(recorded.events.get(activation.observationEventId)?.payload).toMatchObject({
        workstreamId: expect.stringMatching(/^wks_/u),
        workstreamRevision: 1,
        workstreamSnapshotHash: expect.stringMatching(/^sha256:/u),
        workstreamScope: "full",
      });
    } finally {
      await recorded.close();
    }
    expect(errors).toEqual([]);
  });

  it("injects exact-hash Lervo query results for a natural provider prompt from a repository subtree", async () => {
    const root = await initializedRepository();
    await mkdir(resolve(root, "packages/fixture"), { recursive: true });
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: resolve(root, "packages/fixture"),
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
      stdin: async () => JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "codex-session-fixture", turn_id: "turn-1", prompt: "atlas cache envelopes" }),
    };
    expect(await runCli(["terminal", "hook", "--provider", "codex", "--contract", "1"], io), errors.join("")).toBe(0);
    const output = JSON.parse(messages.join("")) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(output.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(output.hookSpecificOutput.additionalContext).toContain("README.md");
    expect(output.hookSpecificOutput.additionalContext).toContain("immutable blue envelopes");
    expect(output.hookSpecificOutput.additionalContext).toContain("This proves hook-side preparation, not provider acceptance, managed delivery");
    expect(output.hookSpecificOutput.additionalContext).not.toContain("This proves delivery");
    expect(output.hookSpecificOutput.additionalContext).toMatch(/contentHash=sha256:[a-f0-9]{64}/u);
    expect(output.hookSpecificOutput.additionalContext).toMatch(/Lervo evidence marker: <!-- lervo-ref:concept_[a-f0-9]{24}:sha256:[a-f0-9]{64} -->/u);
    expect(output.hookSpecificOutput.additionalContext).toContain("standalone Markdown HTML comment");
    expect(Buffer.byteLength(output.hookSpecificOutput.additionalContext)).toBeLessThanOrEqual(28 * 1024);
    const activation = JSON.parse(await readFile(resolve(root, ".lervo/state/terminal-integration/codex-user-prompt-submit.json"), "utf8"));
    expect(activation).toMatchObject({ provider: "codex", hookEvent: "UserPromptSubmit", result: "context_prepared", loadedDocumentCount: expect.any(Number), observationEventId: expect.stringMatching(/^evt_/u) });
    expect(activation.queryDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(activation)).not.toContain("atlas cache envelopes");
    const storage = await openProjectStorage(root);
    try {
      const event = storage.events.get(activation.observationEventId as string);
      expect(event).toMatchObject({ type: "terminal.context.prepared", actor: { kind: "provider", provider: "codex" } });
      expect(JSON.stringify(event)).not.toContain("atlas cache envelopes");
      expect(JSON.stringify(event)).not.toContain("codex-session-fixture");
    } finally {
      await storage.close();
    }
    const statusMessages: string[] = [];
    expect([0, 1]).toContain(await runCli(["terminal", "status", "--json"], { cwd: root, stdout: (message: string) => statusMessages.push(message), stderr: (message: string) => errors.push(message) }));
    const status = JSON.parse(statusMessages.join("")) as {
      runtimeActivation: { status: string; evidenceMeaning: string; observations: Array<{ provider: string; hookEvent: string; status: string }> };
      activationReadiness: { status: string; actions: Array<{ provider: string; code: string; instruction: string }> };
    };
    expect(status.runtimeActivation.status).toBe("partial");
    expect(status.runtimeActivation.evidenceMeaning).toBe("hook_endpoint_observed_not_provider_authorship");
    expect(status.runtimeActivation.observations).toContainEqual({ provider: "codex", hookEvent: "UserPromptSubmit", status: "observed", occurredAt: expect.any(String) });
    expect(status.activationReadiness).toMatchObject({
      status: "action_required",
      actions: expect.arrayContaining([
        expect.objectContaining({ provider: "codex", instruction: expect.stringContaining("run /hooks") }),
        expect.objectContaining({ provider: "claude" }),
      ]),
    });
    expect(errors).toEqual([]);
  });

  it("bounds provider context by UTF-8 bytes without splitting a multibyte character", async () => {
    const root = await initializedRepository();
    await writeFile(resolve(root, "README.md"), `# Unicode ceiling\n\nneedle ${"🧭".repeat(30_000)}\n`);
    const refreshed = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
    await applyKnowledgeMigrationPlan(refreshed, new Date(), () => undefined);
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
      stdin: async () => JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "codex-session-unicode", turn_id: "turn-2", prompt: "unicode ceiling needle" }),
    };
    expect(await runCli(["terminal", "hook", "--provider", "codex", "--contract", "1"], io), errors.join("")).toBe(0);
    const output = JSON.parse(messages.join("")) as { hookSpecificOutput: { additionalContext: string } };
    expect(Buffer.byteLength(output.hookSpecificOutput.additionalContext)).toBeLessThanOrEqual(28 * 1024);
    expect(output.hookSpecificOutput.additionalContext).toContain("[Lervo content truncated]");
    expect(output.hookSpecificOutput.additionalContext).not.toContain("�");
    expect(errors).toEqual([]);
  });

  it("blocks provider completion when durable source bytes make the knowledge lifecycle stale", async () => {
    const root = await initializedRepository();
    const preparedErrors: string[] = [];
    expect(await runCli(["terminal", "hook", "--provider", "claude", "--contract", "1"], {
      cwd: root,
      stdout: () => undefined,
      stderr: (message: string) => preparedErrors.push(message),
      stdin: async () => JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "claude-session-stale", prompt: "repository guidance" }),
    }), preparedErrors.join("")).toBe(0);
    await writeFile(resolve(root, "README.md"), "# Terminal fixture\n\nChanged durable repository guidance.\n");
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
      stdin: async () => JSON.stringify({ hook_event_name: "Stop", session_id: "claude-session-stale", stop_hook_active: false, last_assistant_message: "Lifecycle check only." }),
    };
    expect(await runCli(["terminal", "hook", "--provider", "claude", "--contract", "1"], io), errors.join("")).toBe(0);
    const output = JSON.parse(messages.join("")) as { decision: string; reason: string };
    expect(output.decision).toBe("block");
    expect(output.reason).toMatch(/(?:repository_knowledge_|claude_instruction_bridge_|document_normalization_)/u);
    expect(output.reason).toContain("lervo migrate knowledge");
    expect(JSON.parse(await readFile(resolve(root, ".lervo/state/terminal-integration/claude-stop.json"), "utf8"))).toMatchObject({ provider: "claude", hookEvent: "Stop", result: "completion_blocked", referenceCount: 0, observationEventId: expect.stringMatching(/^evt_/u) });
    expect(errors).toEqual([]);
  });

  it("fails closed on malformed hook input without echoing it", async () => {
    const root = await initializedRepository();
    const secret = "prompt-secret-fixture";
    const messages: string[] = [];
    const errors: string[] = [];
    const io = { cwd: root, stdout: (message: string) => messages.push(message), stderr: (message: string) => errors.push(message), stdin: async () => `{${secret}` };
    expect(await runCli(["terminal", "hook", "--provider", "codex", "--contract", "1"], io)).toBe(2);
    expect(messages).toEqual([]);
    expect(errors.join("")).not.toContain(secret);
  });

  it("projects explicit unmanaged references without claiming managed delivery or internal use", async () => {
    const root = await initializedRepository();
    const promptMessages: string[] = [];
    const promptErrors: string[] = [];
    expect(await runCli(["terminal", "hook", "--provider", "codex", "--contract", "1"], {
      cwd: root,
      stdout: (message: string) => promptMessages.push(message),
      stderr: (message: string) => promptErrors.push(message),
      stdin: async () => JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "private-provider-session", turn_id: "turn-coverage", prompt: "atlas cache envelopes" }),
    }), promptErrors.join("")).toBe(0);
    const context = (JSON.parse(promptMessages.join("")) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    const marker = context.match(/<!-- lervo-ref:concept_[a-f0-9]{24}:sha256:[a-f0-9]{64} -->/u)?.[0];
    expect(marker).toBeDefined();

    const assistantMessage = `I relied on the repository publication.\n\n${marker}\nprivate response text`;
    const stopErrors: string[] = [];
    expect(await runCli(["terminal", "hook", "--provider", "codex", "--contract", "1"], {
      cwd: root,
      stdout: () => undefined,
      stderr: (message: string) => stopErrors.push(message),
      stdin: async () => JSON.stringify({ hook_event_name: "Stop", session_id: "private-provider-session", turn_id: "turn-coverage", last_assistant_message: assistantMessage }),
    }), stopErrors.join("")).toBe(0);

    const reportMessages: string[] = [];
    expect(await runCli(["terminal", "coverage", "--provider", "codex", "--limit", "1", "--json"], {
      cwd: root,
      stdout: (message: string) => reportMessages.push(message),
      stderr: (message: string) => stopErrors.push(message),
    }), stopErrors.join("")).toBe(0);
    const report = JSON.parse(reportMessages.join("")) as {
      reports: Array<{
        executionMode: string;
        capabilities: { providerContextAcceptance: string; internalUse: string; explicitOutputReference: string };
        coverage: { managedDelivery: { value: number | null; reason: string | null }; explicitReference: { numerator: number } };
        documents: Array<{ highestObservation: string }>;
      }>;
    };
    expect(report.reports[0]).toMatchObject({
      executionMode: "unmanaged",
      capabilities: { providerContextAcceptance: "unsupported", internalUse: "unsupported", explicitOutputReference: "observed" },
      coverage: { managedDelivery: { value: null, reason: "unmanaged_no_adapter_receipt" }, explicitReference: { numerator: 1 } },
    });
    expect(report.reports[0]?.documents.some((document) => document.highestObservation === "referenced")).toBe(true);
    const storage = await openProjectStorage(root);
    try {
      const persisted = JSON.stringify(storage.events.list({ limit: 1000 }));
      expect(persisted).not.toContain("private-provider-session");
      expect(persisted).not.toContain("private response text");
    } finally {
      await storage.close();
    }
  });

  it("migrates existing Claude settings through the normal knowledge command without replacing existing hooks", async () => {
    const root = await initializedRepository();
    await writeFile(resolve(root, ".claude/settings.json"), '{"permissions":{"deny":["Bash"]},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"existing-stop"}]}]}}\n');
    const messages: string[] = [];
    const errors: string[] = [];
    const io = { cwd: root, stdout: (message: string) => messages.push(message), stderr: (message: string) => errors.push(message) };
    expect(await runCli(["migrate", "knowledge", "--json"], io), errors.join("")).toBe(0);
    const intermediate = JSON.parse(messages.join("")) as { planId: string; operations: Array<{ action: string }>; userUpdates?: Array<{ operationId: string; approvalHash: string }> };
    if (intermediate.operations?.some((item) => item.action !== "unchanged")) {
      messages.length = 0;
      expect(await runCli([
        "migrate", "knowledge", "--apply", intermediate.planId,
        ...(intermediate.userUpdates ?? []).flatMap((item) => ["--approve-item", `${item.operationId}=${item.approvalHash}`]),
        "--json",
      ], io), errors.join("")).toBe(0);
      messages.length = 0;
      expect(await runCli(["migrate", "knowledge", "--json"], io), errors.join("")).toBe(0);
    }
    const plan = JSON.parse(messages.join("")) as { planKind: string; planId: string; operationId: string; approvalHash: string };
    expect(plan.planKind).toBe("terminal_integration");
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--apply", plan.planId, "--approve-item", `${plan.operationId}=${plan.approvalHash}`, "--json"], io), errors.join("")).toBe(0);
    const settings = JSON.parse(await readFile(resolve(root, ".claude/settings.json"), "utf8"));
    expect(settings.permissions).toEqual({ deny: ["Bash"] });
    expect(settings.hooks.Stop.some((item: { hooks: Array<{ command: string }> }) => item.hooks.some((hook) => hook.command === "existing-stop"))).toBe(true);
    expect(settings.hooks.Stop.some((item: { hooks: Array<{ command: string }> }) => item.hooks.some((hook) => hook.command.includes("lervo terminal hook")))).toBe(true);
  }, 15_000);
});
