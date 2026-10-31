import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reservePracticeBudget, settlePracticeBudget } from "../src/practice-budget.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function directory() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-practice-budget-"));
  roots.push(root);
  return root;
}
const now = new Date("2026-10-31T12:00:00Z");

describe("host skill-learning budget", () => {
  it("holds unobserved usage reservations across repositories and restarts", async () => {
    const path = await directory();
    const first = await reservePracticeBudget({
      projectId: "a",
      kind: "assessment",
      inputBytes: 70_000,
      outputTokens: 10_000,
      now,
      directory: path,
    });
    await settlePracticeBudget(first!, null);
    expect(
      await reservePracticeBudget({
        projectId: "b",
        kind: "assessment",
        inputBytes: 40_001,
        outputTokens: 0,
        now,
        directory: path,
      }),
    ).toBeNull();
    await settlePracticeBudget(first!, 1000);
    expect(
      await reservePracticeBudget({
        projectId: "b",
        kind: "assessment",
        inputBytes: 40_001,
        outputTokens: 0,
        now,
        directory: path,
      }),
    ).not.toBeNull();
  });
  it.each(["draft", "review"] as const)(
    "allows at most three %s attempts per repository and day",
    async (kind) => {
      const path = await directory();
      const args = {
        projectId: "a",
        kind,
        inputBytes: 100,
        outputTokens: 100,
        now,
        directory: path,
      };
      for (let i = 0; i < 3; i++) expect(await reservePracticeBudget(args)).not.toBeNull();
      expect(await reservePracticeBudget(args)).toBeNull();
      expect(await reservePracticeBudget({ ...args, projectId: "b" })).not.toBeNull();
      expect(
        await reservePracticeBudget({ ...args, now: new Date(now.getTime() + 86_400_000) }),
      ).not.toBeNull();
    },
  );
});
