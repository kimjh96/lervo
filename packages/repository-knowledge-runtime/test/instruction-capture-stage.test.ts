import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { listDurableInstructionCandidates } from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import {
  enqueueInstructionCapture,
  listQueuedInstructionCaptures,
  INSTRUCTION_CAPTURE_QUEUE_ROOT,
} from "../src/instruction-capture-queue.js";
import { runInstructionCaptureCycle } from "../src/instruction-capture-stage.js";
import { readInstructionCaptureState } from "../src/instruction-capture-state.js";
import { fixture } from "./fixture.js";

const execute = promisify(execFile);
const fixtureProvider = resolve(
  import.meta.dirname,
  "../../../scripts/distribution/fixtures/instruction-capture-claude.mjs",
);
const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const none = {
  disposition: "none",
  speechAct: "other",
  authority: "inferred",
  durability: "unspecified",
  operation: "none",
  scope: { kind: "unspecified", paths: [] },
  title: null,
  statement: null,
  exceptions: [],
  risk: "unknown",
  conflict: "unknown",
  confidence: "low",
  reasonIds: [],
};

function canonicalRule(title: string, statement: string) {
  return {
    disposition: "canonical",
    speechAct: "directive",
    authority: "explicit_user",
    durability: "repository",
    operation: "add",
    scope: { kind: "repository", paths: [] },
    title,
    statement,
    exceptions: [],
    risk: "low",
    conflict: "none",
    confidence: "high",
    reasonIds: ["owner_stated_repository_rule"],
  };
}

const fixtures: Array<{ storage: { close(): Promise<void> }; directory: string }> = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

async function captureFixture(authorized = true) {
  const base = await fixture(authorized);
  const providerDirectory = resolve(base.directory, "capture-provider");
  await mkdir(providerDirectory, { recursive: true });
  const executable = resolve(providerDirectory, "claude");
  await copyFile(fixtureProvider, executable);
  await execute("chmod", ["0700", executable]);
  const f = {
    ...base,
    executable,
    /** Maps an owner turn to the classification the fixture provider returns for it. */
    async plan(entries: Array<{ ownerTurn: string; response?: unknown; fail?: boolean }>) {
      await writeFile(
        resolve(providerDirectory, "instruction-capture-plan.json"),
        JSON.stringify(
          Object.fromEntries(
            entries.map((entry) => [
              digest(entry.ownerTurn),
              entry.fail === true ? { fail: true } : { response: entry.response },
            ]),
          ),
        ),
      );
    },
    async calls(): Promise<Array<Record<string, unknown>>> {
      try {
        return (
          await readFile(resolve(providerDirectory, "instruction-capture-calls.jsonl"), "utf8")
        )
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>);
      } catch {
        return [];
      }
    },
    cycle(now = new Date()) {
      return runInstructionCaptureCycle({
        storage: base.storage,
        provider: "claude",
        executable,
        admissionDirectory: base.admissionDirectory,
        signal: new AbortController().signal,
        liveWorkPending: async () => false,
        now: () => now,
      });
    },
    eventsOf(type: string) {
      return base.events.list({ limit: 1_000 }).filter((event) => event.type === type);
    },
    enqueue(input: {
      ownerTurn: string;
      precedingAgentTurn?: string | null;
      source?: "terminal_prompt" | "conversation";
      conversationEventId?: string;
    }) {
      return enqueueInstructionCapture({
        repositoryRoot: base.root,
        source: input.source ?? "terminal_prompt",
        provider: input.source === "conversation" ? null : "claude",
        ownerTurn: input.ownerTurn,
        precedingAgentTurn: input.precedingAgentTurn ?? null,
        conversation:
          input.conversationEventId === undefined
            ? null
            : { conversationEventId: input.conversationEventId, agentId: null },
        now: new Date(),
      });
    },
  };
  fixtures.push(f);
  return f;
}

const ENGLISH_RULE = "Never resolve Mac/WSL conflicts by restricting work to one host.";
const KOREAN_RULE = "앞으로 Mac과 WSL 충돌을 한쪽 호스트로 제한해서 해결하지 마.";
const PARAPHRASED_RULE =
  "When the two machines disagree, the fix is the sync mechanism itself, not parking one of them.";
const IMPLICIT_CORRECTION = "That's not it. Don't do that again.";
const IMPLICIT_KOREAN_CORRECTION = "그건 아니야, 다시는 그렇게 하지 마.";
const PRECEDING_AGENT_TURN =
  "I resolved the conflict by disabling the WSL worker so only the Mac writes knowledge.";

describe("owner-turn instruction capture stage (ADR-0466)", () => {
  it(
    "turns English, Korean, paraphrased, and implicit owner rules into exact-review candidates",
    { timeout: 120_000 },
    async () => {
      const f = await captureFixture();
      const rules = [
        [ENGLISH_RULE, "Resolve host conflicts at the mechanism"],
        [KOREAN_RULE, "Keep both hosts working when they conflict"],
        [PARAPHRASED_RULE, "Fix the synchronization mechanism instead of disabling a host"],
        [IMPLICIT_CORRECTION, "Do not disable a host to resolve a conflict"],
      ] as const;
      await f.plan(
        rules.map(([ownerTurn, title], index) => ({
          ownerTurn,
          response: {
            schemaVersion: 1,
            captureClass: index === 3 ? "correction_of_agent_behavior" : "durable_instruction",
            durableInstruction: canonicalRule(title, `${title} in this repository.`),
            decision: null,
            reasonIds: [],
          },
        })),
      );
      await f.enqueue({ ownerTurn: ENGLISH_RULE });
      await f.enqueue({ ownerTurn: KOREAN_RULE });
      await f.enqueue({ ownerTurn: PARAPHRASED_RULE });
      await f.enqueue({ ownerTurn: IMPLICIT_CORRECTION, precedingAgentTurn: PRECEDING_AGENT_TURN });

      const result = await f.cycle();
      expect(result).toMatchObject({
        status: "completed",
        assessedCount: 4,
        instructionCandidateCount: 4,
        deferred: null,
      });
      const candidates = await listDurableInstructionCandidates(f.root);
      expect(candidates.map((candidate) => candidate.instruction.title).sort()).toEqual(
        rules.map(([, title]) => title).sort(),
      );
      expect(candidates.every((candidate) => candidate.captureSource === "terminal_prompt")).toBe(
        true,
      );
      expect(
        candidates.every((candidate) => candidate.instructionCatalogDigest !== undefined),
      ).toBe(true);
      const calls = await f.calls();
      expect(calls).toHaveLength(4);
      // Each later turn is judged against the rules already waiting, so rephrasings dedupe.
      expect(calls.map((call) => call.pendingOwnerRuleCount)).toEqual([0, 1, 2, 3]);
      expect(
        calls.find((call) => call.ownerTurnDigest === digest(IMPLICIT_CORRECTION)),
      ).toMatchObject({ precedingAgentTurnPresent: true });
      expect(f.eventsOf("knowledge.instruction_candidate.captured")).toHaveLength(4);
      expect(f.eventsOf("knowledge.instruction_capture.cycle.completed")[0]?.payload).toMatchObject(
        { assessedCount: 4, instructionCandidateCount: 4, usageObserved: 4 * 1_050 },
      );
      const usage = f
        .eventsOf("resource.usage.recorded")
        .filter((event) => (event.payload as { stage?: unknown }).stage === "instruction_capture");
      expect(usage).toHaveLength(4);
      expect(usage[0]!.payload).toMatchObject({ channel: "knowledge_worker" });
      expect(await listQueuedInstructionCaptures(f.root)).toEqual([]);
    },
  );

  it("never stores owner or agent turn text in events, and keeps queue files private", async () => {
    const f = await captureFixture();
    await f.plan([
      {
        ownerTurn: IMPLICIT_KOREAN_CORRECTION,
        response: {
          schemaVersion: 1,
          captureClass: "correction_of_agent_behavior",
          durableInstruction: canonicalRule(
            "Keep both hosts available",
            "Keep both hosts available when they conflict.",
          ),
          decision: null,
          reasonIds: [],
        },
      },
    ]);
    await f.enqueue({
      ownerTurn: IMPLICIT_KOREAN_CORRECTION,
      precedingAgentTurn: PRECEDING_AGENT_TURN,
    });
    const directory = resolve(f.root, INSTRUCTION_CAPTURE_QUEUE_ROOT);
    const [name] = await readdir(directory);
    expect((await stat(resolve(directory, name!))).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    await f.cycle();
    const serialized = JSON.stringify(f.events.list({ limit: 1_000 }));
    expect(serialized).not.toContain(IMPLICIT_KOREAN_CORRECTION);
    expect(serialized).not.toContain("disabling the WSL worker");
    expect(serialized).toContain(digest(IMPLICIT_KOREAN_CORRECTION));
    expect(await readdir(directory)).toEqual([]);
    const state = await readFile(
      resolve(f.root, ".lervo/state/knowledge/instruction-capture/state.json"),
      "utf8",
    );
    expect(state).not.toContain(IMPLICIT_KOREAN_CORRECTION);
  });

  it("holds conversation decisions for the owner and records the ADR-0457 conversation event", async () => {
    const f = await captureFixture();
    const decisionTurn = "Let's keep the knowledge worker on the Mac until the writer lease ships.";
    const conversationEventId = `cve_${"a".repeat(64)}`;
    await f.plan([
      {
        ownerTurn: decisionTurn,
        response: {
          schemaVersion: 1,
          captureClass: "decision",
          durableInstruction: none,
          decision: {
            title: "Keep the knowledge worker on the Mac until the writer lease ships",
            statement:
              "The Mac host runs the knowledge worker until the repository writer lease is available.",
            subjectKey: "knowledge.worker.host",
          },
          reasonIds: [],
        },
      },
    ]);
    await f.enqueue({ ownerTurn: decisionTurn, source: "conversation", conversationEventId });
    expect(await f.cycle()).toMatchObject({ decisionCount: 1, instructionCandidateCount: 0 });
    const state = await readInstructionCaptureState(f.root);
    expect(state.held).toEqual([
      expect.objectContaining({
        kind: "decision",
        source: "conversation",
        subjectKey: "knowledge.worker.host",
      }),
    ]);
    const [recorded] = f.eventsOf("conversation.knowledge_candidate.recorded");
    expect(recorded?.payload).toMatchObject({
      conversationEventId,
      kind: "decision",
      subjectKeyDigest: digest("knowledge.worker.host"),
      summaryHash: state.held[0]!.summaryHash,
    });
    expect(JSON.stringify(recorded)).not.toContain(decisionTurn);
  });

  it("keeps personal preferences and ordinary requests out of shared knowledge", async () => {
    const f = await captureFixture();
    const preference = "I like to read diffs before lunch.";
    const request = "Can you run the tests again?";
    await f.plan([
      {
        ownerTurn: preference,
        response: {
          schemaVersion: 1,
          captureClass: "preference_personal",
          durableInstruction: none,
          decision: null,
          reasonIds: [],
        },
      },
      {
        ownerTurn: request,
        response: {
          schemaVersion: 1,
          captureClass: "none",
          durableInstruction: none,
          decision: null,
          reasonIds: [],
        },
      },
    ]);
    await f.enqueue({ ownerTurn: preference });
    await f.enqueue({ ownerTurn: request });
    expect(await f.cycle()).toMatchObject({ assessedCount: 2, instructionCandidateCount: 0 });
    expect(await listDurableInstructionCandidates(f.root)).toEqual([]);
    expect((await readInstructionCaptureState(f.root)).held).toEqual([]);
    expect(f.eventsOf("knowledge.instruction_capture.cycle.completed")[0]?.payload).toMatchObject({
      personalPreferenceCount: 1,
      ignoredCount: 1,
    });
  });

  it("holds an owner rule whose scope the gate cannot accept instead of dropping it", async () => {
    const f = await captureFixture();
    const ownerTurn = "Only one of them should ever write.";
    await f.plan([
      {
        ownerTurn,
        response: {
          schemaVersion: 1,
          captureClass: "durable_instruction",
          durableInstruction: {
            ...canonicalRule("Allow a single writer", "Only one host writes."),
            disposition: "pending",
            scope: { kind: "unspecified", paths: [] },
            confidence: "medium",
          },
          decision: null,
          reasonIds: [],
        },
      },
    ]);
    await f.enqueue({ ownerTurn });
    await f.cycle();
    expect(await listDurableInstructionCandidates(f.root)).toEqual([]);
    expect((await readInstructionCaptureState(f.root)).held).toEqual([
      expect.objectContaining({ kind: "rule_needs_clarification", title: "Allow a single writer" }),
    ]);
  });

  it("assesses one turn once, even when several agents queue it", async () => {
    const f = await captureFixture();
    await f.plan([]);
    const first = await f.enqueue({ ownerTurn: "Thanks." });
    expect(await f.enqueue({ ownerTurn: "Thanks." })).toEqual({
      status: "already_queued",
      captureId: first.status === "skipped" ? "" : first.captureId,
    });
    await f.cycle();
    await f.enqueue({ ownerTurn: "Thanks." });
    await f.cycle();
    expect(await f.calls()).toHaveLength(1);
  });

  it("waits without spending or losing turns when background spend is not delegated", async () => {
    const f = await captureFixture(false);
    await f.plan([]);
    await f.enqueue({ ownerTurn: ENGLISH_RULE });
    expect(await f.cycle()).toMatchObject({
      status: "completed",
      assessedCount: 0,
      deferred: "knowledge_authority_unavailable",
    });
    expect(await f.calls()).toEqual([]);
    expect(await listQueuedInstructionCaptures(f.root)).toHaveLength(1);
  });

  it("drops a turn after three failed assessments and expires stale queue records", async () => {
    const f = await captureFixture();
    await f.plan([{ ownerTurn: ENGLISH_RULE, fail: true }]);
    await f.enqueue({ ownerTurn: ENGLISH_RULE });
    await f.cycle();
    await f.cycle();
    expect(await listQueuedInstructionCaptures(f.root)).toHaveLength(1);
    await f.cycle();
    expect(await listQueuedInstructionCaptures(f.root)).toEqual([]);
    expect(
      f
        .eventsOf("knowledge.instruction_capture.cycle.completed")
        .some((event) => (event.payload as { failedCount: number }).failedCount === 1),
    ).toBe(true);

    await f.enqueue({ ownerTurn: KOREAN_RULE });
    expect(await f.cycle(new Date(Date.now() + 25 * 3_600_000))).toMatchObject({
      status: "completed",
      assessedCount: 0,
    });
    expect(await listQueuedInstructionCaptures(f.root)).toEqual([]);
  });

  it("stops assessing at the per-cycle bound and leaves the rest queued", async () => {
    const f = await captureFixture();
    await f.plan([]);
    for (let index = 0; index < 6; index += 1) await f.enqueue({ ownerTurn: `turn ${index}` });
    expect(await f.cycle()).toMatchObject({ assessedCount: 4 });
    expect(await listQueuedInstructionCaptures(f.root)).toHaveLength(2);
    expect(f.eventsOf("knowledge.instruction_capture.cycle.completed")[0]?.payload).toMatchObject({
      skippedForBudget: 2,
    });
  });
});
