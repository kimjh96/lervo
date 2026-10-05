import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runCli(
    ["knowledge", "instruction", "intake", "--provider", "codex", "--stdin", "--json"],
    {
      cwd: root,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
      stdin: async () => JSON.stringify({ schemaVersion: 1, request }),
    },
    { groundProductionRequest: grounding(instruction) },
  );
  return { exitCode, stdout: stdout.join(""), stderr: stderr.join("") };
}

describe("explicit durable-instruction intake", () => {
  it("creates an exact review candidate and applies only its approved hash", async () => {
    const root = await repository();
    const request =
      "Keep this private preface out of storage. From now on, use Conventional Commits for every repository commit.";
    const created = await intake(root, request);
    expect(created.exitCode, created.stderr).toBe(0);
    const result = JSON.parse(created.stdout) as {
      status: string;
      candidate: {
        candidateId: string;
        candidateHash: string;
        artifactPath: string;
        targetPath: string;
        proposedMarkdown: string;
      };
    };
    expect(result.status).toBe("review_required");
    expect(result.candidate.proposedMarkdown).toContain(canonicalInstruction.statement);
    expect(result.candidate.proposedMarkdown).not.toContain("private preface");
    expect(await readFile(resolve(root, result.candidate.artifactPath), "utf8")).not.toContain(
      request,
    );
    await expect(access(resolve(root, result.candidate.targetPath))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const rejectedOutput: string[] = [];
    expect(
      await runCli(
        [
          "knowledge",
          "instruction",
          "review",
          result.candidate.candidateId,
          "--decision",
          "apply",
          "--reviewer",
          "repository-owner",
          "--approval",
          `sha256:${"0".repeat(64)}`,
        ],
        {
          cwd: root,
          stdout: () => undefined,
          stderr: (message) => rejectedOutput.push(message),
        },
      ),
    ).toBe(1);
    expect(rejectedOutput.join("")).toContain("reviewed candidate hash does not match");
    await expect(access(resolve(root, result.candidate.targetPath))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const appliedOutput: string[] = [];
    const appliedErrors: string[] = [];
    expect(
      await runCli(
        [
          "knowledge",
          "instruction",
          "review",
          result.candidate.candidateId,
          "--decision",
          "apply",
          "--reviewer",
          "repository-owner",
          "--approval",
          result.candidate.candidateHash,
          "--json",
        ],
        {
          cwd: root,
          stdout: (message) => appliedOutput.push(message),
          stderr: (message) => appliedErrors.push(message),
        },
      ),
      appliedErrors.join(""),
    ).toBe(0);
    expect(JSON.parse(appliedOutput.join(""))).toMatchObject({
      operation: "durable_instruction_intake",
      targetPath: result.candidate.targetPath,
    });
    expect(await readFile(resolve(root, result.candidate.targetPath), "utf8")).toBe(
      result.candidate.proposedMarkdown,
    );
    expect(await listDurableInstructionCandidates(root)).toEqual([]);

    const storage = await openProjectStorage(root);
    try {
      expect(
        storage.events
          .list()
          .some(
            (event) =>
              event.type === "knowledge.materialization.applied" &&
              event.payload.operation === "durable_instruction_intake" &&
              event.payload.approvalDigest !== null,
          ),
      ).toBe(true);
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
      query: "required commit message format",
    });
    expect(query.hits.some((hit) => hit.path === result.candidate.targetPath)).toBe(true);
  });

  it("rejects and removes a candidate without changing repository instruction bytes", async () => {
    const root = await repository();
    const created = await intake(root, "Always use Conventional Commits in this repository.");
    const candidate = (JSON.parse(created.stdout) as { candidate: NonNullable<unknown> })
      .candidate as {
      candidateId: string;
      candidateHash: string;
      targetPath: string;
    };
    const errors: string[] = [];
    expect(
      await runCli(
        [
          "knowledge",
          "instruction",
          "review",
          candidate.candidateId,
          "--decision",
          "reject",
          "--reviewer",
          "repository-owner",
          "--approval",
          candidate.candidateHash,
        ],
        { cwd: root, stdout: () => undefined, stderr: (message) => errors.push(message) },
      ),
      errors.join(""),
    ).toBe(0);
    expect(await listDurableInstructionCandidates(root)).toEqual([]);
    await expect(access(resolve(root, candidate.targetPath))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not create a candidate when the semantic gate is pending", async () => {
    const root = await repository();
    const pending = await intake(root, "Could we perhaps use a commit convention?", {
      ...canonicalInstruction,
      disposition: "pending",
      speechAct: "question",
      authority: "inferred",
      conflict: "unknown",
      confidence: "low",
      reasonIds: ["question_is_not_authority"],
    });
    expect(pending.exitCode).toBe(1);
    expect(JSON.parse(pending.stdout)).toMatchObject({ status: "pending", candidate: null });
    expect(await listDurableInstructionCandidates(root)).toEqual([]);
  });

  it("blocks apply when canonical instruction sources change after intake", async () => {
    const root = await repository();
    const created = await intake(root, "Always use Conventional Commits in this repository.");
    const candidate = (
      JSON.parse(created.stdout) as {
        candidate: { candidateId: string; candidateHash: string; targetPath: string };
      }
    ).candidate;
    await writeFile(resolve(root, "AGENTS.md"), "# Changed instruction authority\n");
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
        { cwd: root, stdout: () => undefined, stderr: (message) => errors.push(message) },
      ),
    ).toBe(1);
    expect(errors.join("")).toContain("catalog changed after candidate review began");
    await expect(access(resolve(root, candidate.targetPath))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await listDurableInstructionCandidates(root)).toHaveLength(1);
  });

  it("applies a candidate after unrelated sources change, bound to its instruction catalog", async () => {
    const root = await repository();
    const created = await intake(root, "Always use Conventional Commits in this repository.");
    const candidate = (
      JSON.parse(created.stdout) as {
        candidate: {
          candidateId: string;
          candidateHash: string;
          targetPath: string;
          instructionCatalogDigest?: string;
        };
      }
    ).candidate;
    expect(candidate.instructionCatalogDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    await writeFile(resolve(root, "README.md"), "# A later, unrelated change\n");
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
        { cwd: root, stdout: () => undefined, stderr: (message) => errors.push(message) },
      ),
      errors.join(""),
    ).toBe(0);
    await expect(access(resolve(root, candidate.targetPath))).resolves.toBeUndefined();
  });

  it("reports why semantic resolution failed instead of a bare failure", async () => {
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
    ).toBe(1);
    expect(observedTimeout).toBe(DURABLE_INSTRUCTION_GROUNDING_TIMEOUT_MS);
    expect(DURABLE_INSTRUCTION_GROUNDING_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      status: "ignored",
      reasonIds: ["semantic_resolution_failed", "semantic_resolution_provider_timed_out"],
      candidate: null,
    });
  });
});
