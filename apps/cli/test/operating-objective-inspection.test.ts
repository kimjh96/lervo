import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";
import { inspectOperatingObjective } from "../src/operating-objective-inspection.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("operating objective inspection", () => {
  it("translates only the verified current workstream snapshot", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-operating-objective-"));
    roots.push(root);
    const quiet = { cwd: root, stdout: () => undefined, stderr: () => undefined };
    expect(await runCli(["init"], quiet)).toBe(0);
    const draft = JSON.stringify({
      schemaVersion: 1,
      status: "active",
      title: "Verified objective",
      objective: "Expose the exact current objective.",
      nextActions: ["Inspect without mutation."],
      blockers: ["Await exact review."],
      notes: [],
      references: [],
      pendingDecisions: [],
      pendingApprovals: [],
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
    const planOutput: string[] = [];
    expect(
      await runCli(["workstream", "start", "--stdin", "--json"], {
        ...quiet,
        stdin: async () => draft,
        stdout: (message) => planOutput.push(message),
      }),
    ).toBe(0);
    const plan = JSON.parse(planOutput.join("")) as { planId: string };
    expect(
      await runCli(["workstream", "start", "--stdin", "--apply", plan.planId], {
        ...quiet,
        stdin: async () => draft,
      }),
    ).toBe(0);

    await expect(
      inspectOperatingObjective({
        repositoryRoot: root,
        observedAt: new Date("2026-09-02T00:01:00.000Z"),
      }),
    ).resolves.toMatchObject({
      workstreamRevision: 1,
      title: "Verified objective",
      objective: "Expose the exact current objective.",
      nextActions: ["Inspect without mutation."],
      blockers: ["Await exact review."],
      observedAt: "2026-09-02T00:01:00.000Z",
    });
  });
});
