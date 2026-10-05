import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

import {
  applyKnowledgeInstructionBridgePlan,
  applyKnowledgeMigrationPlan,
  applyTerminalIntegrationPlan,
  createDurableInstructionCandidate,
  createDurableInstructionPlan,
  createKnowledgeInstructionBridgePlan,
  createKnowledgeMigrationPlan,
  createTerminalIntegrationPlan,
  durableInstructionCatalogDigest,
  sha256,
  storeDurableInstructionCandidate,
  type GroundedDurableInstruction,
} from "@lervo/repository-knowledge";
import { listQueuedInstructionCaptures } from "@lervo/repository-knowledge-runtime";
import { openProjectStorage } from "@lervo/project-storage";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { inspectInstructionCatalog } from "../src/instruction-catalog.js";
import { runCli } from "../src/main.js";
import { queueTerminalOwnerTurn } from "../src/terminal-instruction-capture.js";

const roots: string[] = [];
const runtimeContent = "#!/usr/bin/env node\nprocess.stdout.write('{}\\n');\n";
const quiet = (root: string) => ({ cwd: root, stdout: () => undefined, stderr: () => undefined });
const noProjection = {
  projectSearchQueries: async () => {
    throw new Error("Compact prompts must not invoke a provider query projector.");
  },
};

beforeAll(() => {
  process.env.LERVO_TERMINAL_CONTEXT = "compact";
});
afterAll(() => {
  process.env.LERVO_TERMINAL_CONTEXT = "retrieval";
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-instruction-capture-"));
  roots.push(root);
  await writeFile(
    resolve(root, "AGENTS.md"),
    "# Agent instructions\n\nUse repository knowledge.\n",
  );
  expect(await runCli(["init"], quiet(root))).toBe(0);
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" }),
    new Date(),
    () => undefined,
  );
  const bridge = await createKnowledgeInstructionBridgePlan({
    repositoryRoot: root,
    provider: "claude",
  });
  await applyKnowledgeInstructionBridgePlan({
    plan: bridge,
    approvedOperationId: bridge.operationId,
    approvedHash: bridge.approvalHash,
    now: new Date(),
    recordApplied: () => undefined,
  });
  const terminal = await createTerminalIntegrationPlan(root, runtimeContent);
  await applyTerminalIntegrationPlan({
    plan: terminal,
    runtimeContent,
    approvedOperationId: terminal.operationId,
    approvedHash: terminal.approvalHash!,
    now: new Date(),
    recordApplied: () => undefined,
  });
  const refreshed = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
  if (refreshed.operations.some((item) => item.action !== "unchanged"))
    await applyKnowledgeMigrationPlan(refreshed, new Date(), () => undefined);
  return root;
}

async function hook(
  root: string,
  provider: "claude" | "codex",
  input: Record<string, unknown>,
): Promise<string> {
  const messages: string[] = [];
  expect(
    await runCli(
      ["terminal", "hook", "--provider", provider, "--contract", "2"],
      {
        ...quiet(root),
        stdout: (message) => messages.push(message),
        stdin: async () => JSON.stringify(input),
      },
      noProjection,
    ),
  ).toBe(0);
  return messages.join("");
}

function promptContext(output: string): string {
  return (JSON.parse(output) as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;
}

const ownerRule = "앞으로 Mac과 WSL 충돌을 한쪽 호스트로 제한해서 해결하지 마.";
const agentReply = "I resolved the conflict by disabling the WSL worker.";
const implicitCorrection = "That's not it. Don't do that again.";

describe("terminal owner-turn capture (ADR-0467)", () => {
  it("queues owner prompts with the preceding agent reply and keeps both out of events", async () => {
    const root = await repository();
    await hook(root, "claude", {
      hook_event_name: "UserPromptSubmit",
      session_id: "capture-session",
      turn_id: "turn-1",
      prompt: ownerRule,
    });
    await hook(root, "claude", {
      hook_event_name: "Stop",
      session_id: "capture-session",
      turn_id: "turn-1",
      last_assistant_message: agentReply,
    });
    await hook(root, "claude", {
      hook_event_name: "UserPromptSubmit",
      session_id: "capture-session",
      turn_id: "turn-2",
      prompt: implicitCorrection,
    });
    const queued = await listQueuedInstructionCaptures(root);
    expect(queued.map((capture) => [capture.ownerTurn, capture.precedingAgentTurn])).toEqual([
      [ownerRule, null],
      [implicitCorrection, agentReply],
    ]);
    expect(queued.every((capture) => capture.source === "terminal_prompt")).toBe(true);
    const storage = await openProjectStorage(root);
    try {
      const events = JSON.stringify(storage.events.list({ limit: 1_000 }));
      expect(events).not.toContain(ownerRule);
      expect(events).not.toContain(implicitCorrection);
      expect(events).not.toContain(agentReply);
    } finally {
      await storage.close();
    }
  });

  it("queues within the ADR-0451 hook budget without any provider call", async () => {
    const root = await repository();
    const durations: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      expect(
        await queueTerminalOwnerTurn({
          root,
          provider: "codex",
          providerSessionId: "latency-session",
          prompt: `Owner turn ${index}: keep both hosts available.`,
          workspaceBinding: null,
          now: new Date(),
        }),
      ).toBe(true);
      durations.push(performance.now() - started);
    }
    durations.sort((left, right) => left - right);
    expect(durations[Math.floor(durations.length * 0.95)]!).toBeLessThan(200);
    expect(await listQueuedInstructionCaptures(root)).toHaveLength(20);
  });

  it("does not capture prompts in assignment workspaces, which come from Lervo, not the owner", async () => {
    const root = await repository();
    expect(
      await queueTerminalOwnerTurn({
        root,
        provider: "claude",
        providerSessionId: "worker-session",
        prompt: ownerRule,
        workspaceBinding: { executionKind: "worker" } as never,
        now: new Date(),
      }),
    ).toBe(false);
    expect(await listQueuedInstructionCaptures(root)).toEqual([]);
  });

  it("shows captured candidates and applied owner rules to Claude and Codex prompts alike", async () => {
    const root = await repository();
    const instruction: GroundedDurableInstruction = {
      disposition: "canonical",
      speechAct: "directive",
      authority: "explicit_user",
      durability: "repository",
      operation: "add",
      scope: { kind: "repository", paths: [] },
      title: "Resolve host conflicts at the mechanism",
      statement: "Never resolve Mac and WSL conflicts by restricting work to one host.",
      exceptions: [],
      risk: "low",
      conflict: "none",
      confidence: "high",
      reasonIds: [],
    };
    const catalog = await inspectInstructionCatalog({
      repositoryRoot: root,
      supplementalSources: [],
    });
    const storage = await openProjectStorage(root);
    const projectId = storage.manifest.projectId;
    await storage.close();
    const plan = await createDurableInstructionPlan({
      repositoryRoot: root,
      projectId,
      requestDigest: sha256(ownerRule),
      resolverResultDigest: `sha256:${"e".repeat(64)}`,
      groundingStatus: "ready",
      catalogComplete: true,
      ambiguityReasons: [],
      instruction,
    });
    const candidate = await storeDurableInstructionCandidate({
      repositoryRoot: root,
      candidate: createDurableInstructionCandidate({
        plan,
        provider: "claude",
        sourceSnapshotId: catalog.sourceSnapshotId,
        instruction,
        now: new Date(),
        instructionCatalogDigest: durableInstructionCatalogDigest(
          catalog.semanticCatalog.canonicalInstructions.entries,
        ),
        capture: { source: "terminal_prompt", captureId: `kcap_${"1".repeat(24)}` },
      }),
    });

    const pending = promptContext(
      await hook(root, "codex", {
        hook_event_name: "UserPromptSubmit",
        session_id: "codex-session",
        prompt: "What should I work on next?",
      }),
    );
    expect(pending).toContain("Instruction capture: 1 instruction candidate awaits review");
    expect(pending).toContain("Resolve host conflicts at the mechanism");
    const attention: string[] = [];
    expect(
      await runCli(["application", "attention", "--json"], {
        ...quiet(root),
        stdout: (message) => attention.push(message),
      }),
    ).toBe(0);
    expect(JSON.parse(attention.join("")).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "durable_instruction_candidate",
          candidateId: candidate.candidateId,
          captureSource: "terminal_prompt",
        }),
      ]),
    );

    await writeFile(resolve(root, "README.md"), "# Unrelated change after capture\n");
    const errors: string[] = [];
    expect(
      await runCli(
        [
          "knowledge",
          "instruction",
          "review",
          candidate.candidateId,
          "--decision",
          "apply",
          "--reviewer",
          "repository-owner",
          "--approval",
          candidate.candidateHash,
        ],
        { ...quiet(root), stderr: (message) => errors.push(message) },
      ),
      errors.join(""),
    ).toBe(0);
    expect(await readFile(resolve(root, candidate.targetPath), "utf8")).toContain(
      instruction.statement!,
    );
    for (const provider of ["claude", "codex"] as const) {
      const context = promptContext(
        await hook(root, provider, {
          hook_event_name: "UserPromptSubmit",
          session_id: `${provider}-after-apply`,
          prompt: "Continue.",
        }),
      );
      expect(context).toContain(
        "Applied owner rules (follow them; full text in docs/instructions/generated/): Resolve host conflicts at the mechanism.",
      );
      expect(context).not.toContain("Instruction capture:");
    }
  });

  it("surfaces a held owner decision until the owner dismisses it", async () => {
    const root = await repository();
    const captureId = `kcap_${"2".repeat(24)}`;
    await mkdir(resolve(root, ".lervo/state/knowledge/instruction-capture"), { recursive: true });
    await writeFile(
      resolve(root, ".lervo/state/knowledge/instruction-capture/state.json"),
      JSON.stringify({
        schemaVersion: 1,
        budget: { day: "", hour: "", assessmentsToday: 0, assessmentsThisHour: 0, tokensToday: 0 },
        assessed: [],
        held: [
          {
            captureId,
            kind: "decision",
            source: "conversation",
            title: "Keep the knowledge worker on the Mac until the writer lease ships",
            statement: "The Mac host runs the knowledge worker until the writer lease exists.",
            subjectKey: "knowledge.worker.host",
            summaryHash: `sha256:${"3".repeat(64)}`,
            capturedAt: new Date().toISOString(),
          },
        ],
        lastCycleAt: null,
      }),
    );
    const attention: string[] = [];
    expect(
      await runCli(["application", "attention", "--json"], {
        ...quiet(root),
        stdout: (message) => attention.push(message),
      }),
    ).toBe(0);
    expect(JSON.parse(attention.join("")).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "captured_decision",
          captureId,
          captureSource: "conversation",
        }),
      ]),
    );
    const status: string[] = [];
    expect(
      await runCli(["knowledge", "instruction", "capture"], {
        ...quiet(root),
        stdout: (message) => status.push(message),
      }),
    ).toBe(0);
    expect(status.join("")).toContain(`decision ${captureId} (conversation`);
    expect(
      await runCli(["knowledge", "instruction", "capture", "--dismiss", captureId], quiet(root)),
    ).toBe(0);
    const after: string[] = [];
    await runCli(["application", "attention", "--json"], {
      ...quiet(root),
      stdout: (message) => after.push(message),
    });
    expect(
      (JSON.parse(after.join("")).items as Array<{ kind: string }>).some(
        (item) => item.kind === "captured_decision",
      ),
    ).toBe(false);
  });

  it("tells the agent that owner turns wait on a host that does not own convergence", async () => {
    const root = await repository();
    await writeFile(
      resolve(root, ".lervo/state/knowledge/convergence-owner.json"),
      JSON.stringify({
        schemaVersion: 1,
        recordedHolderKey: null,
        verdict: {
          role: "waiting_owner",
          reason: "convergence_owner_elsewhere",
          mode: "hub",
          hostHash: `sha256:${"1".repeat(64)}`,
          hostLabel: "mac",
          holder: null,
          validUntil: null,
          wakeAt: null,
          grantedAt: null,
          yieldUntil: null,
          observedAt: new Date().toISOString(),
        },
      }),
    );
    await queueTerminalOwnerTurn({
      root,
      provider: "claude",
      providerSessionId: "non-owner-session",
      prompt: ownerRule,
      workspaceBinding: null,
      now: new Date(),
    });
    const context = promptContext(
      await hook(root, "codex", {
        hook_event_name: "UserPromptSubmit",
        session_id: "non-owner-codex",
        prompt: "Continue.",
      }),
    );
    expect(context).toContain(
      "1 owner turn waits on this host until it owns knowledge convergence",
    );
    const status: string[] = [];
    expect(
      await runCli(["knowledge", "instruction", "capture", "--json"], {
        ...quiet(root),
        stdout: (message) => status.push(message),
      }),
    ).toBe(0);
    expect(JSON.parse(status.join(""))).toMatchObject({
      convergenceOwnerRole: "waiting_owner",
    });
    expect(status.join("")).not.toContain(ownerRule);
  });
});
