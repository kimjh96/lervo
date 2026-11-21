import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  listDurableInstructionCandidates,
  queryRepositoryKnowledge,
  type GroundedDurableInstruction,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";
import { listQueuedInstructionCaptures } from "@lervo/repository-knowledge-runtime";
import { afterEach, describe, expect, it } from "vitest";

import { DURABLE_INSTRUCTION_GROUNDING_TIMEOUT_MS } from "../src/durable-instruction-grounding.js";
import { runCli } from "../src/main.js";
import { GroundProductionRequestError } from "../src/semantic-grounding.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-instruction-intake-"));
  roots.push(root);
  const messages: string[] = [];
  expect(
    await runCli(["init"], {
      cwd: root,
      stdout: (message) => messages.push(message),
      stderr: (message) => messages.push(message),
    }),
  ).toBe(0);
  return root;
}

const canonicalInstruction: GroundedDurableInstruction = {
  disposition: "canonical",
  speechAct: "directive",
  authority: "explicit_user",
  durability: "repository",
  operation: "add",
  scope: { kind: "repository", paths: [] },
  title: "Conventional commit messages",
  statement: "Use Conventional Commits for every repository commit.",
  exceptions: [],
  risk: "low",
  conflict: "none",
  confidence: "high",
  reasonIds: ["explicit_repository_rule"],
};

function grounding(instruction: GroundedDurableInstruction = canonicalInstruction) {
  return async (input: { request: string; provider: "codex" | "claude" }) => ({
    proposal: {
      schemaVersion: 1,
      requestDigest: `sha256:${"a".repeat(64)}`,
      resolver: {
        kind: "provider_adapter",
        providerId: input.provider,
        resultDigest: `sha256:${"b".repeat(64)}`,
      },
      ambiguityReasons: [],
      durableInstruction: instruction,
    } as never,
    decision: {
      schemaVersion: 1,
      status: "ready",
      workflowId: "knowledge.instruction.intake",
      effectIds: ["repository.change"],
      capabilityIds: [],
      providerIds: [input.provider],
      authority: "repository_write",
      sourceClasses: ["repository_state"],
      subjectIds: [],
      retrievalQueries: [],
      reasons: [],
    } as never,
  });
}

async function intake(
  root: string,
  request: string,
  instruction: GroundedDurableInstruction = canonicalInstruction,
  crossCheck: (input: { ownerText: string }) => Promise<{
    verdict: "agree" | "disagree";
    reasonIds: string[];
  }> = async () => ({ verdict: "agree", reasonIds: [] }),
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const checks: string[] = [];
  const exitCode = await runCli(
    ["knowledge", "instruction", "intake", "--provider", "codex", "--stdin", "--json"],
    {
      cwd: root,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      stdin: async () => JSON.stringify({ schemaVersion: 1, request }),
    },
    {
      groundProductionRequest: grounding(instruction),
      crossCheckDurableInstruction: async (input) => {
        checks.push(input.ownerText);
        return crossCheck(input);
      },
    },
  );
  return {
    exitCode,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    checks,
    result: (stdout.length === 0 ? null : JSON.parse(stdout.join(""))) as {
      status: string;
      reasonIds: string[];
      ruleId: string | null;
      targetPath: string | null;
      replacedPaths: string[];
      fidelity: string | null;
      captureId: string | null;
      candidate: unknown;
    } | null,
  };
}

/** The two explicit owner rules the former intake gate dropped on 2026-11-02. */
const STRENGTHEN_THE_CORE =
  "Strengthen the core before widening it; remove unused or unnecessary parts.";
const DECIDE_WITHOUT_THE_OWNER =
  "Lervo decides and proceeds on its own; the owner is never a review or approval step; replace every owner approval gate with an independent cross-check, a reversible or backed-up effect, and a notice after the fact.";

describe("explicit durable-instruction intake (ADR-0561)", () => {
  it("stores and applies the two owner rules the former gate dropped", async () => {
    const root = await repository();
    const broad = await intake(root, STRENGTHEN_THE_CORE, {
      ...canonicalInstruction,
      disposition: "pending",
      operation: "remove",
      scope: { kind: "unspecified", paths: [] },
      title: "Strengthen the core before widening it",
      statement: STRENGTHEN_THE_CORE,
      risk: "high",
      conflict: "unknown",
      confidence: "medium",
      reasonIds: ["broad.product.policy"],
    });
    expect(broad.exitCode, broad.stderr).toBe(0);
    expect(broad.result).toMatchObject({ status: "applied", fidelity: "owner_wording" });
    const authority = await intake(root, DECIDE_WITHOUT_THE_OWNER, {
      ...canonicalInstruction,
      operation: "replace",
      title: "Decide without the owner",
      statement: DECIDE_WITHOUT_THE_OWNER,
      risk: "high",
      conflict: "possible",
      confidence: "high",
      reasonIds: ["authority.change", "broad.product.policy"],
    });
    expect(authority.result).toMatchObject({ status: "applied", fidelity: "owner_wording" });
    // The owner's own wording needs no model check.
    expect([...broad.checks, ...authority.checks]).toEqual([]);
    for (const [stored, statement] of [
      [broad, STRENGTHEN_THE_CORE],
      [authority, DECIDE_WITHOUT_THE_OWNER],
    ] as const) {
      expect(JSON.stringify(stored.result)).not.toContain("automatic_gate_not_satisfied");
      expect(await readFile(resolve(root, stored.result!.targetPath!), "utf8")).toContain(
        statement,
      );
    }
    expect(await listDurableInstructionCandidates(root)).toEqual([]);
    const storage = await openProjectStorage(root);
    try {
      expect(
        storage.events
          .list()
          .filter(
            (event) =>
              event.type === "knowledge.materialization.applied" &&
              event.payload.operation === "durable_instruction_intake",
          ),
      ).toHaveLength(2);
    } finally {
      await storage.close();
    }

    const migration = await createKnowledgeMigrationPlan({
      repositoryRoot: root,
      mode: "migrate",
    });
    await applyKnowledgeMigrationPlan(migration, new Date(), () => undefined);
    const query = await queryRepositoryKnowledge({
      repositoryRoot: root,
      query: "owner approval gate cross-check",
    });
    expect(query.hits.some((hit) => hit.path === authority.result!.targetPath)).toBe(true);
  });

  it("never returns pending for any classification of an explicit owner rule", async () => {
    const root = await repository();
    const statuses: string[] = [];
    for (const [index, variant] of [
      { risk: "unknown", confidence: "low", conflict: "unknown" },
      { authority: "inferred", speechAct: "other", durability: "unspecified" },
      { scope: { kind: "unspecified", paths: [] }, disposition: "pending" },
    ].entries()) {
      const request = `Rule ${index}: use Conventional Commits for every repository commit.`;
      const stored = await intake(root, request, {
        ...canonicalInstruction,
        statement: request,
        ...(variant as Partial<GroundedDurableInstruction>),
      });
      statuses.push(stored.result!.status);
      expect(stored.result!.reasonIds).not.toContain("automatic_gate_not_satisfied");
    }
    expect(statuses).toEqual(["applied", "applied", "applied"]);
  });

  it("cross-checks a restated rule, and queues it for background retry on disagreement", async () => {
    const root = await repository();
    const request =
      "Keep this private preface out of storage. From now on, use Conventional Commits for every repository commit.";
    const restated = { ...canonicalInstruction, statement: "Use Conventional Commits always." };
    const agreed = await intake(root, request, restated);
    expect(agreed.checks).toEqual([request]);
    expect(agreed.result).toMatchObject({ status: "applied", fidelity: "cross_checked" });
    const content = await readFile(resolve(root, agreed.result!.targetPath!), "utf8");
    expect(content).toContain("Use Conventional Commits always.");
    expect(content).not.toContain("private preface");

    const other = await repository();
    const disagreed = await intake(other, request, restated, async () => ({
      verdict: "disagree",
      reasonIds: ["obligation_changed"],
    }));
    expect(disagreed.exitCode).toBe(0);
    expect(disagreed.result).toMatchObject({
      status: "queued",
      reasonIds: expect.arrayContaining(["cross_check_disagreed"]),
    });
    expect(await listQueuedInstructionCaptures(other)).toEqual([
      expect.objectContaining({ captureId: disagreed.result!.captureId, retained: true }),
    ]);
    // ADR-0606: the queue appends no event, so the command asks the resident to look.
    await expect(
      readFile(resolve(other, ".lervo/state/knowledge-resident-request.json"), "utf8"),
    ).resolves.toContain('"schemaVersion":1');
    await expect(access(resolve(other, "docs/instructions/generated"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("replaces a conflicting older rule, and retire undoes the newer one", async () => {
    const root = await repository();
    const older = await intake(root, "Use Conventional Commits for every repository commit.", {
      ...canonicalInstruction,
      statement: "Use Conventional Commits for every repository commit.",
    });
    const newerRequest = "Use Conventional Commits with a package scope for every commit.";
    const newer = await intake(root, newerRequest, {
      ...canonicalInstruction,
      title: "Scoped conventional commits",
      statement: newerRequest,
      conflict: "possible",
      replaces: [older.result!.targetPath!],
    });
    expect(newer.result).toMatchObject({
      status: "applied",
      replacedPaths: [older.result!.targetPath],
    });
    await expect(access(resolve(root, older.result!.targetPath!))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(resolve(root, newer.result!.targetPath!), "utf8")).toContain(
      `    replaces:\n      - ${older.result!.ruleId}`,
    );

    const stdout: string[] = [];
    const stderr: string[] = [];
    expect(
      await runCli(["knowledge", "instruction", "retire", newer.result!.ruleId!, "--json"], {
        cwd: root,
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      }),
      stderr.join(""),
    ).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      status: "retired",
      ruleId: newer.result!.ruleId,
    });
    await expect(access(resolve(root, newer.result!.targetPath!))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("removes the owner review command", async () => {
    const root = await repository();
    const stderr: string[] = [];
    expect(
      await runCli(
        ["knowledge", "instruction", "review", "kinstruction_x", "--decision", "apply"],
        { cwd: root, stdout: () => undefined, stderr: (message) => stderr.push(message) },
      ),
    ).toBe(1);
    expect(stderr.join("")).toContain("intake, status, retire, capture, and bridge");
  });

  it("queues the request for background retry when semantic resolution fails", async () => {
    const root = await repository();
    let observedTimeout: number | undefined;
    const stdout: string[] = [];
    expect(
      await runCli(
        ["knowledge", "instruction", "intake", "--provider", "claude", "--stdin", "--json"],
        {
          cwd: root,
          stdout: (message) => stdout.push(message),
          stderr: () => undefined,
          stdin: async () =>
            JSON.stringify({ schemaVersion: 1, request: "Never restrict work to one host." }),
        },
        {
          groundProductionRequest: async (input) => {
            observedTimeout = input.timeoutMs;
            throw new GroundProductionRequestError(
              Object.assign(new Error("The provider JSON runner did not complete (timed_out)."), {
                code: "knowledge_compile_failed",
                processStatus: "timed_out",
              }),
            );
          },
        },
      ),
    ).toBe(0);
    expect(observedTimeout).toBe(DURABLE_INSTRUCTION_GROUNDING_TIMEOUT_MS);
    expect(DURABLE_INSTRUCTION_GROUNDING_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      status: "queued",
      reasonIds: ["semantic_resolution_failed", "semantic_resolution_provider_timed_out"],
      candidate: null,
    });
    expect(await listQueuedInstructionCaptures(root)).toEqual([
      expect.objectContaining({ retained: true, ownerTurn: "Never restrict work to one host." }),
    ]);
  });
});
