import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  listDurableInstructionCandidates,
  removeDurableInstructionCandidate,
} from "@lervo/repository-knowledge";
import {
  mergeKnowledgeInstructionCandidateRecord,
  type KnowledgeInstructionCandidateRecord,
} from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import type { ConvergenceOwnerVerdict } from "../src/convergence-owner-verdict.js";
import {
  enqueueInstructionCapture,
  listQueuedInstructionCaptures,
  INSTRUCTION_CAPTURE_QUEUE_ROOT,
} from "../src/instruction-capture-queue.js";
import { runInstructionCaptureCycle } from "../src/instruction-capture-stage.js";
import { readInstructionCaptureState } from "../src/instruction-capture-state.js";
import { writeConvergenceOwnerFence } from "../src/convergence-owner-fence.js";
import { CONVERGENCE_OWNER_HOST_PATH } from "../src/convergence-owner-host.js";
import {
  exchangeInstructionCandidates,
  type InstructionCandidateExchangeTransport,
} from "../src/instruction-candidate-exchange.js";
import { recordInstructionCandidateResolution } from "../src/instruction-candidate-exchange-state.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
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

describe("owner-turn instruction capture stage (ADR-0467)", () => {
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
    // One attention record instead of silent holding.
    expect((await readInstructionCaptureState(f.root)).authorityBlocked).toMatchObject({
      queuedCount: 1,
    });
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

/** An in-memory Hub that applies the real merge rule, standing in for the SQLite route. */
function fakeHub() {
  const records = new Map<string, KnowledgeInstructionCandidateRecord>();
  const transport: InstructionCandidateExchangeTransport = async () => ({
    async publish(record) {
      const { next, status } = mergeKnowledgeInstructionCandidateRecord({
        current: records.get(record.proposedContentHash) ?? null,
        incoming: record,
      });
      records.set(record.proposedContentHash, next);
      return status;
    },
    async list() {
      return [...records.values()];
    },
  });
  return { records, transport };
}

async function configureHubHost(
  root: string,
  input: { hostId: string; label: string; role: ConvergenceOwnerVerdict["role"] },
) {
  await mkdir(resolve(root, ".lervo/state/knowledge"), { recursive: true });
  await writeFile(
    resolve(root, CONVERGENCE_OWNER_HOST_PATH),
    JSON.stringify({
      schemaVersion: 1,
      hostId: input.hostId,
      hostLabel: input.label,
      coordination: {
        mode: "hub",
        hub: {
          baseUrl: "https://hub.lervo.invalid",
          bearerTokenFile: "/nonexistent/lervo-hub-token",
          destinationId: "hub-main",
          hubIdentityHash: `sha256:${"9".repeat(64)}`,
        },
      },
    }),
  );
  await writeConvergenceOwnerFence(root, {
    schemaVersion: 1,
    recordedHolderKey: null,
    verdict: ownerVerdict(input.role, input.label),
  });
}

function ownerVerdict(
  role: ConvergenceOwnerVerdict["role"],
  label = "mac",
): ConvergenceOwnerVerdict {
  return {
    role,
    reason: role === "owner" ? "lease_granted" : "convergence_owner_elsewhere",
    mode: "hub",
    hostHash: `sha256:${"1".repeat(64)}`,
    hostLabel: label,
    holder:
      role === "owner"
        ? null
        : { hostHash: `sha256:${"2".repeat(64)}`, label: "wsl", generation: 3, expiresAt: null },
    validUntil: role === "owner" ? new Date(Date.now() + 600_000).toISOString() : null,
    wakeAt: null,
    grantedAt: null,
    yieldUntil: null,
    observedAt: new Date().toISOString(),
  } as ConvergenceOwnerVerdict;
}

describe("owner-turn capture across hosts (ADR-0467)", () => {
  const rule = {
    schemaVersion: 1,
    captureClass: "durable_instruction",
    durableInstruction: canonicalRule(
      "Keep both hosts available",
      "Resolve Mac and WSL conflicts without restricting work to one host.",
    ),
    decision: null,
    reasonIds: [],
  };

  it(
    "assesses a Mac turn on the Mac although WSL owns convergence, and one rule is one Hub record",
    { timeout: 120_000 },
    async () => {
      const hub = fakeHub();
      const mac = await captureFixture();
      const wsl = await captureFixture();
      await configureHubHost(mac.root, {
        hostId: `hst_${"a".repeat(32)}`,
        label: "mac",
        role: "waiting_owner",
      });
      await configureHubHost(wsl.root, {
        hostId: `hst_${"b".repeat(32)}`,
        label: "wsl",
        role: "owner",
      });
      await mac.plan([{ ownerTurn: ENGLISH_RULE, response: rule }]);
      await mac.enqueue({ ownerTurn: ENGLISH_RULE, precedingAgentTurn: PRECEDING_AGENT_TURN });

      const macCycle = await runAutonomousKnowledgeWorker({
        storage: mac.storage,
        workerId: "mac-capture",
        provider: "claude",
        executable: mac.executable,
        admissionDirectory: mac.admissionDirectory,
        liveWorkPending: async () => false,
        owner: async () => ownerVerdict("waiting_owner"),
        instructionCandidateTransport: hub.transport,
      });
      expect(macCycle).toMatchObject({
        status: "waiting_owner",
        ownerTurns: {
          instructionCapture: {
            status: "completed",
            assessedCount: 1,
            instructionCandidateCount: 1,
          },
          candidateExchange: { status: "exchanged", published: 1 },
        },
      });
      expect(await mac.calls()).toHaveLength(1);
      expect(hub.records.size).toBe(1);
      const [record] = [...hub.records.values()];
      expect(record).toMatchObject({ resolution: "open" });
      // Neither the Hub record nor any event carries the owner or agent turn.
      for (const serialized of [
        JSON.stringify(record),
        JSON.stringify(mac.events.list({ limit: 1_000 })),
      ]) {
        expect(serialized).not.toContain(ENGLISH_RULE);
        expect(serialized).not.toContain(PRECEDING_AGENT_TURN);
      }
      expect(mac.eventsOf("knowledge.instruction_candidate.exchanged")[0]?.payload).toMatchObject({
        direction: "published",
        resolution: "open",
        proposedContentHash: record!.proposedContentHash,
      });

      // The same rule assessed on WSL too: one Hub record, one candidate per host.
      await wsl.plan([{ ownerTurn: ENGLISH_RULE, response: rule }]);
      await wsl.enqueue({ ownerTurn: ENGLISH_RULE });
      await wsl.cycle();
      const imported = await exchangeInstructionCandidates({
        storage: wsl.storage,
        transport: hub.transport,
        now: () => new Date(),
      });
      expect(imported).toMatchObject({ status: "exchanged", published: 0, imported: 0 });
      expect(hub.records.size).toBe(1);
      const wslCandidates = await listDurableInstructionCandidates(wsl.root);
      expect(wslCandidates.map((candidate) => candidate.proposedContentHash)).toEqual([
        record!.proposedContentHash,
      ]);
    },
  );

  it(
    "imports a candidate on the owner and removes it everywhere once the owner applies it",
    { timeout: 120_000 },
    async () => {
      const hub = fakeHub();
      const mac = await captureFixture();
      const wsl = await captureFixture();
      await configureHubHost(mac.root, {
        hostId: `hst_${"a".repeat(32)}`,
        label: "mac",
        role: "waiting_owner",
      });
      await configureHubHost(wsl.root, {
        hostId: `hst_${"b".repeat(32)}`,
        label: "wsl",
        role: "owner",
      });
      await mac.plan([{ ownerTurn: KOREAN_RULE, response: rule }]);
      await mac.enqueue({ ownerTurn: KOREAN_RULE });
      await mac.cycle();
      const exchange = (storage: typeof mac.storage) =>
        exchangeInstructionCandidates({ storage, transport: hub.transport, now: () => new Date() });
      expect(await exchange(mac.storage)).toMatchObject({ published: 1 });
      expect(await exchange(wsl.storage)).toMatchObject({ imported: 1 });
      const [owned] = await listDurableInstructionCandidates(wsl.root);
      expect(owned).toMatchObject({ captureSource: "terminal_prompt" });
      expect(wsl.eventsOf("knowledge.instruction_candidate.exchanged")[0]?.payload).toMatchObject({
        direction: "imported",
      });

      // The owner's review path records the resolution, then removes its candidate.
      const { candidateHash: _hash, artifactPath: _path, ...candidate } = owned!;
      await recordInstructionCandidateResolution({
        repositoryRoot: wsl.root,
        candidate,
        resolution: "applied",
        resolvedAt: new Date(),
      });
      await removeDurableInstructionCandidate({
        repositoryRoot: wsl.root,
        candidateId: owned!.candidateId,
        expectedCandidateHash: owned!.candidateHash,
      });
      await exchange(wsl.storage);
      expect([...hub.records.values()][0]).toMatchObject({ resolution: "applied" });
      expect(await exchange(mac.storage)).toMatchObject({ resolved: 1 });
      expect(await listDurableInstructionCandidates(mac.root)).toEqual([]);
      // A later open publish never reopens the applied rule.
      expect(await exchange(wsl.storage)).toMatchObject({ imported: 0 });
      expect(await listDurableInstructionCandidates(wsl.root)).toEqual([]);
    },
  );

  it("keeps candidates host-local without a Hub", async () => {
    const f = await captureFixture();
    expect(
      await exchangeInstructionCandidates({ storage: f.storage, now: () => new Date() }),
    ).toEqual({ status: "standalone" });
  });
});
