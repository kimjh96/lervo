import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import { settlePracticeAssessment } from "../src/practice-assessment.js";
import {
  compactPracticeState,
  readPracticeState,
  writePracticeState,
  PRACTICE_ROOT,
} from "../src/practice-store.js";
import { practiceShapeSupport } from "../src/practice-state.js";
import { extractPracticeSteps } from "../src/practice-transcript.js";
import { now, practice, practiceContext, work } from "./practice-fixture.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-practice-"));
  roots.push(root);
  return { root, state: await readPracticeState(root), context: practiceContext(root) };
}

describe("resident practice evidence", () => {
  it("ranks repeated shapes without creating candidates or requiring repetition", async () => {
    const { context, state } = await setup();
    state.shapes.push(
      {
        workDigest: work.workDigest,
        digest: sha256("shape"),
        steps: ["Bash:pnpm"],
        observedAt: work.observedAt,
      },
      {
        workDigest: sha256("independent shape observation"),
        digest: sha256("shape"),
        steps: ["Bash:pnpm"],
        observedAt: work.observedAt,
      },
    );
    expect(practiceShapeSupport(state, [work.workDigest])).toBe(2);
    expect(state.candidates).toHaveLength(0);
    await settlePracticeAssessment({ context, state, work, value: practice, readRoots: ["*"] });
    expect(state.candidates).toHaveLength(1);
  });

  it("creates a candidate from one observed ordinary directive turn without teaching or a declaration", async () => {
    const { context, state } = await setup();
    state.works.push(work);
    await settlePracticeAssessment({ context, state, work, value: practice, readRoots: ["*"] });
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0]!.state).toBe("assessed");
    expect(state.evidence[0]!.work.workDigest).toBe(work.workDigest);
    expect(state.funnel[0]!.counts.assessed_with_practice).toBe(1);
    await settlePracticeAssessment({ context, state, work, value: practice, readRoots: ["*"] });
    expect(state.candidates).toHaveLength(1);
  });

  it.each(["one_off", "failed", "incomplete"])(
    "does not promote %s work and records its funnel drop",
    async (kind) => {
      const { context, state } = await setup();
      const observed = {
        ...work,
        ...(kind === "failed" ? { outcome: "verification_unavailable" as const } : {}),
        complete: kind !== "incomplete",
      };
      await settlePracticeAssessment({
        context,
        state,
        work: observed,
        value: kind === "one_off" ? null : practice,
        readRoots: ["*"],
      });
      expect(state.candidates).toHaveLength(0);
      expect(Object.keys(state.funnel[0]!.drops)).toEqual([
        `assessed:${kind === "one_off" ? "not_reusable" : kind === "failed" ? "verification_unavailable" : "source_incomplete"}`,
      ]);
    },
  );

  it("keeps same-practice observations under one candidate even when their names differ", async () => {
    const { context, state } = await setup();
    await settlePracticeAssessment({ context, state, work, value: practice, readRoots: ["*"] });
    await settlePracticeAssessment({
      context,
      state,
      work: { ...work, workDigest: sha256("second host-shaped observation") },
      value: { ...practice, name: "another-name" },
      readRoots: ["*"],
    });
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0]!.workDigests).toHaveLength(2);
  });

  it.each(["not_reusable", "duplicate", "incomplete", "ungrounded"])(
    "reopens %s only once and only with new evidence",
    async (reason) => {
      const { context, state } = await setup();
      await settlePracticeAssessment({ context, state, work, value: practice, readRoots: ["*"] });
      Object.assign(state.candidates[0]!, { state: "reviewed_rejected", reason });
      await settlePracticeAssessment({
        context,
        state,
        work: { ...work, workDigest: sha256("new evidence") },
        value: practice,
        readRoots: ["*"],
      });
      expect(state.candidates[0]!.state).toBe(
        ["incomplete", "ungrounded"].includes(reason) ? "assessed" : "reviewed_rejected",
      );
      Object.assign(state.candidates[0]!, { state: "reviewed_rejected", reason });
      await settlePracticeAssessment({
        context,
        state,
        work: { ...work, workDigest: sha256("third evidence") },
        value: practice,
        readRoots: ["*"],
      });
      expect(state.candidates[0]!.state).toBe("reviewed_rejected");
    },
  );

  it("expires unresolved evidence after seven days and bounds shapes independently at thirty days", async () => {
    const { context, state } = await setup();
    state.works.push(work);
    await settlePracticeAssessment({ context, state, work, value: practice, readRoots: ["*"] });
    state.shapes.push({
      workDigest: work.workDigest,
      digest: sha256("shape"),
      steps: ["Bash:pnpm"],
      observedAt: work.observedAt,
    });
    compactPracticeState(state, new Date(now.getTime() + 8 * 86_400_000));
    expect(state.candidates[0]!.reason).toBe("assessment_expired");
    expect(state.evidence).toHaveLength(0);
    expect(state.works).toHaveLength(0);
    expect(state.shapes).toHaveLength(1);
    compactPracticeState(state, new Date(now.getTime() + 31 * 86_400_000));
    expect(state.shapes).toHaveLength(0);
  });

  it("uses private file and directory permissions on macOS and Linux", async () => {
    const { root, context, state } = await setup();
    await settlePracticeAssessment({ context, state, work, value: practice, readRoots: ["*"] });
    await writePracticeState(root, state, now);
    expect((await stat(resolve(root, PRACTICE_ROOT))).mode & 0o777).toBe(0o700);
    expect((await stat(resolve(root, PRACTICE_ROOT, "state.json"))).mode & 0o777).toBe(0o600);
    expect(await readFile(resolve(root, PRACTICE_ROOT, "state.json"), "utf8")).not.toContain(
      "API_TOKEN",
    );
  });

  it("normalizes tool steps without arguments and requires recorded outcomes", () => {
    const extracted = extractPracticeSteps(
      [
        {
          uuid: "1",
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                id: "call",
                name: "Bash",
                input: { command: "/usr/bin/pnpm typecheck --secret private-value" },
              },
            ],
          },
        },
        {
          uuid: "2",
          type: "user",
          message: { content: [{ type: "tool_result", tool_use_id: "call", is_error: false }] },
        },
        {
          uuid: "3",
          type: "assistant",
          message: {
            content: [
              {
                type: "text",
                text: "Done.\nAPI_TOKEN=sk-xxxxxxxxxxxxxxxxxxxxxxxx\nVerification passed.",
              },
            ],
          },
        },
      ],
      "/repo",
    );
    expect(extracted.steps[0]).toMatchObject({
      kind: "Bash",
      executable: "pnpm",
      outcome: "passed",
      verification: true,
    });
    expect(JSON.stringify(extracted)).not.toContain("private-value");
    expect(extracted.reply).not.toContain("API_TOKEN");
  });
});
