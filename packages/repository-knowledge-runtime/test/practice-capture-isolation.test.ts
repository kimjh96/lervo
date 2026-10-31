import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listDurableInstructionCandidates } from "@lervo/repository-knowledge";
import { fixture } from "./fixture.js";
import {
  enqueueInstructionCapture,
  listQueuedInstructionCaptures,
} from "../src/instruction-capture-queue.js";
import { runInstructionCaptureCycle } from "../src/instruction-capture-stage.js";
import { practice, now } from "./practice-fixture.js";

const calls = vi.hoisted(() => ({ assess: vi.fn(), complete: vi.fn() }));
vi.mock("../src/instruction-capture-assessment.js", () => ({
  assessInstructionCapture: calls.assess,
}));
vi.mock("../src/practice-capture.js", () => ({
  preparePracticeCapture: async () => ({ data: { outcome: "passed" } }),
  completePracticeCapture: calls.complete,
}));
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

describe("single capture call with isolated practice failure", () => {
  it("captures the original repository rule even when practice persistence fails", async () => {
    const f = await fixture(true);
    fixtures.push(f);
    await enqueueInstructionCapture({
      repositoryRoot: f.root,
      source: "terminal_prompt",
      provider: "claude",
      ownerTurn: "앞으로 사용자가 쓴 내용은 보존해.",
      precedingAgentTurn: "Implemented it.",
      now,
    });
    calls.assess.mockResolvedValue({
      status: "assessed",
      provider: "claude",
      usage: null,
      value: {
        schemaVersion: 1,
        captureClass: "durable_instruction",
        decision: null,
        reasonIds: [],
        practice,
        durableInstruction: {
          disposition: "canonical",
          speechAct: "directive",
          authority: "explicit_user",
          durability: "repository",
          operation: "add",
          scope: { kind: "repository", paths: [] },
          title: "Preserve user-authored content.",
          statement: "Preserve every user-owned region when updating repository documents.",
          exceptions: [],
          risk: "low",
          conflict: "none",
          confidence: "high",
          reasonIds: [],
        },
      },
    });
    calls.complete.mockRejectedValue(new Error("Practice evidence storage failed."));
    const result = await runInstructionCaptureCycle({
      storage: f.storage,
      provider: "claude",
      signal: new AbortController().signal,
      liveWorkPending: async () => false,
      now: () => now,
    });
    expect(calls.assess).toHaveBeenCalledOnce();
    expect(calls.assess.mock.calls[0]![0].request.precedingWork).toEqual({ outcome: "passed" });
    expect(result).toMatchObject({
      status: "completed",
      instructionCandidateCount: 1,
      assessedCount: 1,
    });
    expect(await listDurableInstructionCandidates(f.root)).toHaveLength(1);
    expect(await listQueuedInstructionCaptures(f.root)).toHaveLength(0);
  });
});
