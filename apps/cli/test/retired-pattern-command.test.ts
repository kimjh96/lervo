import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";
import { knowledgeUsage } from "../src/knowledge-usage.js";
import { roleUsage } from "../src/role-command.js";

const quiet = { cwd: "", stdout: () => undefined, stderr: () => undefined };

describe("retired development-pattern entrypoints", () => {
  beforeAll(async () => {
    quiet.cwd = await mkdtemp(resolve(tmpdir(), "lervo-retired-pattern-"));
    expect(await runCli(["init"], quiet)).toBe(0);
  });
  afterAll(async () => {
    await rm(quiet.cwd, { recursive: true, force: true });
  });
  it.each([
    ["knowledge", "pattern", "propose"],
    ["knowledge", "pattern", "status"],
    ["knowledge", "pattern", "review"],
    ["knowledge", "pattern", "promote"],
    ["knowledge", "pattern", "rollback"],
    ["knowledge", "pattern", "effect", "collect"],
    ["knowledge", "pattern", "effect", "register"],
    ["knowledge", "pattern", "effect", "observe"],
    ["role", "candidate", "propose"],
    ["role", "candidate", "status"],
    ["role", "candidate", "review"],
    ["role", "candidate", "activate"],
    ["role", "candidate", "rollback"],
  ])("rejects %s %s %s", async (...args) => {
    const errors: string[] = [];
    expect(await runCli(args, { ...quiet, stderr: (value) => errors.push(value) })).toBe(1);
    expect(errors.join("")).toContain(
      args[0] === "knowledge"
        ? "Specify a supported knowledge subcommand."
        : "Specify one role action.",
    );
  });

  it("advertises ordinary canonicalization and role commands", () => {
    expect(knowledgeUsage).not.toContain("knowledge pattern");
    // ADR-0561: the background canonical reviewer resolves candidates; reopen undoes a decision.
    expect(knowledgeUsage).not.toContain("knowledge canonicalization promote");
    expect(knowledgeUsage).toContain("knowledge canonicalization reopen");
    expect(knowledgeUsage).toContain("knowledge instruction intake");
    expect(roleUsage).not.toContain("role candidate");
    expect(roleUsage).toContain("role validate");
  });

  it("rejects portable-skill declarations before opening repository storage", async () => {
    const errors: string[] = [];
    expect(
      await runCli(
        [
          "terminal",
          "declare",
          "--provider",
          "codex",
          "--observation",
          "tobs_retired_pattern_01",
          "--stdin",
        ],
        {
          ...quiet,
          stderr: (value) => errors.push(value),
          stdin: async () =>
            JSON.stringify({
              taskMode: "change",
              canonicalizationDisposition: "canonical_sources_current",
              canonicalizationOutcome: {
                schemaVersion: 1,
                kind: "portable_skill_candidate",
                summary: "Retired pattern declaration.",
                sourcePaths: [],
                proposal: {},
              },
              knowledgeDisposition: "current",
              deliberationDisposition: "not_requested",
              deliberationId: null,
            }),
        },
      ),
    ).toBe(1);
    expect(errors.join("")).toContain("The canonicalization outcome is invalid");
  });
});
