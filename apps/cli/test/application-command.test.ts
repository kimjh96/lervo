import { describe, expect, it } from "vitest";

import { runApplicationCommand } from "../src/application-command.js";

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    value: {
      cwd: "/repository",
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
  };
}

describe("application command", () => {
  it("renders the injected read-only attention report", async () => {
    const output = io();
    const report = {
      schemaVersion: 1 as const,
      kind: "operating_attention.report" as const,
      projectId: "prj_0123456789abcdef",
      workstream: null,
      observedAt: "2026-09-04T00:00:00.000Z",
      reportDigest: `sha256:${"a".repeat(64)}`,
      status: "current" as const,
      coverage: {
        workstream: "missing" as const,
        canonicalization: "complete" as const,
        knowledgeLifecycle: "complete" as const,
      },
      summary: {
        totalCount: 0,
        truncatedCount: 0,
        blockingCount: 0,
        userActionCount: 0,
        staleCount: 0,
      },
      items: [],
      limitations: ["Projection only."],
    };

    expect(
      await runApplicationCommand(["attention", "--json"], output.value, {
        inspectOperatingAttention: async () => report,
      }),
    ).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toEqual(report);
    expect(output.stderr).toEqual([]);
  });

  it("rejects unknown application actions", async () => {
    const output = io();

    expect(await runApplicationCommand(["unknown"], output.value)).toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr.join("")).toContain("The application action is invalid.");
    expect(output.stderr.join("")).toContain("lervo application attention");
  });

  it("rejects the removed product-host actions", async () => {
    for (const action of [
      "capabilities",
      "activity",
      "search",
      "observability",
      "deliberation",
      "liveness",
    ]) {
      const output = io();

      expect(await runApplicationCommand([action, "--json"], output.value)).toBe(1);
      expect(output.stderr.join("")).toContain("The application action is invalid.");
    }
  });
});
