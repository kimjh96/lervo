import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import {
  canonicalJson,
  compileRepositoryKnowledgeCandidate,
  scanConfiguredRepositoryKnowledge,
  sha256,
  listKnowledgeArtifactPaths,
  shardedKnowledgeArtifactPath,
  storeKnowledgeCompilationCandidate,
  structuralConceptDirectory,
} from "@lervo/repository-knowledge";

import { runCli } from "../src/main.js";
import type { ManagedDeliberationOutcome } from "../src/managed-deliberation.js";

const temporaryRoots: string[] = [];

async function temporaryRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("lervo CLI identity", () => {
  it("reports the CLI package version without opening project storage", async () => {
    let output = "";
    let errors = "";
    let storageOpened = false;
    const exitCode = await runCli(
      ["--version"],
      {
        cwd: "/missing/repository/is-not-required",
        stdout: (message) => {
          output += message;
        },
        stderr: (message) => {
          errors += message;
        },
      },
      {
        openProjectStorage: async () => {
          storageOpened = true;
          throw new Error("storage must not open");
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output).toMatch(/^lervo \d+\.\d+\.\d+\n$/);
    expect(errors).toBe("");
    expect(storageOpened).toBe(false);
  });

  it("rejects extra version arguments", async () => {
    let errors = "";
    expect(
      await runCli(["--version", "extra"], {
        cwd: process.cwd(),
        stdout: () => undefined,
        stderr: (message) => {
          errors += message;
        },
      }),
    ).toBe(1);
    expect(errors).toContain("does not accept additional arguments");
  });
});

describe("lervo init CLI", () => {
  it("prints the exact creation plan without mutating on dry-run", async () => {
    const root = await temporaryRepository();
    let output = "";
    const exitCode = await runCli(["init", "--dry-run", "--name", "fixture"], {
      cwd: root,
      stdout: (message) => {
        output += message;
      },
      stderr: () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(output).toContain("create  .lervo/project.yaml");
    expect(output).toContain("+ name: fixture");
    await expect(access(resolve(root, ".lervo"))).rejects.toThrow();
  });

  it("applies init and reports an idempotent second run", async () => {
    const root = await temporaryRepository();
    const messages: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => messages.push(message),
    };

    expect(await runCli(["init"], io)).toBe(0);
    expect(await runCli(["init"], io)).toBe(0);
    expect(messages.join("")).toContain("Initialized the Lervo project.");
    expect(messages.join("")).toContain("The project is already initialized.");
  });

  it("advances safe onboarding stages from init and stops at provider authority", async () => {
    const root = await temporaryRepository();
    const messages: string[] = [];
    expect(
      await runCli(["init", "--onboard"], {
        cwd: root,
        stdout: (message: string) => messages.push(message),
        stderr: (message: string) => messages.push(message),
      }),
    ).toBe(0);
    expect(messages.join("")).toContain("Onboarding: pending_authority");
    expect(messages.join("")).toContain("initial agent: agt_");
    await expect(access(resolve(root, "docs/knowledge/index.md"))).resolves.toBeUndefined();
    await expect(access(resolve(root, "AGENTS.md"))).resolves.toBeUndefined();
  });
});

describe("lervo migrate identity CLI", () => {
  it("keeps a missing previous state read-only and explains the blocker", async () => {
    const root = await temporaryRepository();
    let output = "";
    let errors = "";

    const exitCode = await runCli(["migrate", "identity"], {
      cwd: root,
      stdout: (message) => {
        output += message;
      },
      stderr: (message) => {
        errors += message;
      },
    });

    expect(exitCode).toBe(1);
    expect(output).toContain("Plan status: blocked");
    expect(output).toContain("previous managed path does not exist");
    expect(errors).toBe("");
    await expect(access(resolve(root, ".lervo"))).rejects.toThrow();
  });
});

describe("lervo repository knowledge CLI", () => {
  it("runs dry-run, apply, lint and query with a recorded materialization event", async () => {
    const root = await temporaryRepository();
    await writeFile(resolve(root, "main.ts"), "export const greeting = 'hello';\n");
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);

    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const plan = JSON.parse(messages.join("")) as {
      planId: string;
      operations: Array<{ content?: unknown }>;
    };
    expect(plan.operations.every((operation) => operation.content === undefined)).toBe(true);
    await expect(access(resolve(root, "docs/knowledge/index.md"))).rejects.toThrow();

    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--apply", plan.planId, "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      type: "knowledge.materialization.applied",
    });
    expect(await readFile(resolve(root, "docs/knowledge/index.md"), "utf8")).toContain(
      "Repository knowledge",
    );

    messages.length = 0;
    expect(await runCli(["knowledge", "lint", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ valid: true });

    messages.length = 0;
    expect(await runCli(["knowledge", "query", "--json", "repository"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      semantics: "recommended",
      hits: [expect.objectContaining({ path: "docs/knowledge/index.md" })],
    });

    messages.length = 0;
    expect(await runCli(["knowledge", "impact", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      status: "current",
      lineageComplete: true,
      summary: { current: 0, stale: 0, unknown: 0, affectedConcepts: 0 },
      items: [],
    });

    messages.length = 0;
    expect(await runCli(["knowledge", "refresh-candidate", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      semantics: "review_candidate",
      status: "no_changes",
      automaticPublicationMutation: false,
      items: [],
    });

    const storage = await openProjectStorage(root);
    try {
      expect(
        storage.events.list().some((event) => event.type === "knowledge.materialization.applied"),
      ).toBe(true);
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });

  it("creates an unreviewed semantic candidate without a materialization event", async () => {
    const root = await temporaryRepository();
    const executable = resolve(root, "claude-fixture.mjs");
    await writeFile(resolve(root, "main.ts"), "export const runtime = 'local';\n");
    await writeFile(
      executable,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("claude-fixture 1.0.0"); process.exit(0); }
let input = "";
for await (const chunk of process.stdin) input += chunk;
const envelope = JSON.parse(input).envelope;
const evidence = envelope.sourceUnits[0].unitVersionId;
const response = { schemaVersion: 1, concepts: [{ localKey: "runtime", title: "Runtime", type: "concept", summary: "A source-backed runtime candidate.", claims: [{ localKey: "local", statement: "The repository declares a runtime source.", evidenceUnitVersionIds: [evidence] }] }], relations: [] };
console.log(JSON.stringify({ is_error: false, result: JSON.stringify(response), permission_denials: [], stop_reason: "end_turn", num_turns: 1, usage: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } } }));
`,
      { mode: 0o700 },
    );
    await chmod(executable, 0o700);
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    messages.length = 0;
    expect(
      await runCli(
        ["knowledge", "compile", "--provider", "claude", "--executable", executable, "--json"],
        io,
      ),
    ).toBe(0);
    const output = JSON.parse(messages.join("")) as {
      receipt: { compilationId: string; artifactPath: string; assurance: string };
      coverage: { complete: boolean };
    };
    expect(output).toMatchObject({
      receipt: { assurance: "unreviewed" },
      coverage: { complete: true },
    });
    expect(
      JSON.parse(await readFile(resolve(root, output.receipt.artifactPath), "utf8")),
    ).toMatchObject({ concepts: [{ assurance: "unreviewed" }] });
    messages.length = 0;
    expect(
      await runCli(["knowledge", "reconcile", "--json", output.receipt.compilationId], io),
    ).toBe(0);
    const reconciliation = JSON.parse(messages.join("")) as {
      reconciliationPlanId: string;
      status: string;
      dispositions: Array<{ action: string; review: string }>;
    };
    expect(reconciliation).toMatchObject({
      status: "ready",
      dispositions: [{ action: "create_generated", review: "not_required" }],
    });
    const storage = await openProjectStorage(root);
    try {
      expect(
        storage.events
          .list()
          .some(
            (event) =>
              event.type === "knowledge.candidate.created" ||
              event.type === "knowledge.materialization.applied",
          ),
      ).toBe(false);
    } finally {
      await storage.close();
    }
    messages.length = 0;
    expect(
      await runCli(
        ["knowledge", "review-policy", "--reviewer", "human.fixture", "--write", "--json"],
        io,
      ),
    ).toBe(0);
    const policyPath = (JSON.parse(messages.join("")) as { path: string }).path;
    messages.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "review",
          output.receipt.compilationId,
          "--plan",
          reconciliation.reconciliationPlanId,
          "--policy",
          policyPath,
          "--reviewer",
          "human.fixture",
          "--accept-all-safe",
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    const review = JSON.parse(messages.join("")) as {
      review: { reviewId: string };
      eventId: string;
    };
    messages.length = 0;
    expect(await runCli(["knowledge", "materialize", review.review.reviewId, "--json"], io)).toBe(
      0,
    );
    const semanticPlan = JSON.parse(messages.join("")) as {
      planId: string;
      createdConceptIds: string[];
    };
    messages.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "materialize",
          review.review.reviewId,
          "--apply",
          semanticPlan.planId,
          "--json",
        ],
        io,
      ),
      messages.join(""),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      operation: "semantic",
      type: "knowledge.materialization.applied",
    });
    expect(
      await readFile(
        resolve(root, `docs/knowledge/semantic/${semanticPlan.createdConceptIds[0]}.md`),
        "utf8",
      ),
    ).toContain("Human-reviewed semantic publication");
    const finalStorage = await openProjectStorage(root);
    try {
      const reviewEvent = finalStorage.events
        .list()
        .find((event) => event.type === "knowledge.reconciliation.reviewed");
      expect(reviewEvent?.payload).not.toHaveProperty("reviewerId");
      expect(
        finalStorage.events
          .list()
          .some(
            (event) =>
              event.type === "knowledge.materialization.applied" &&
              event.payload.operation === "semantic",
          ),
      ).toBe(true);
    } finally {
      await finalStorage.close();
    }
    expect(errors).toEqual([]);
  });

  it("links reviewed claims to an existing user publication without changing its bytes", async () => {
    const root = await temporaryRepository();
    const readme = "# Existing Runtime\n\nThis user-owned document stays byte-identical.\n";
    await writeFile(resolve(root, "README.md"), readme);
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const structuralPlan = JSON.parse(messages.join("")) as { planId: string };
    messages.length = 0;
    expect(
      await runCli(["migrate", "knowledge", "--apply", structuralPlan.planId, "--json"], io),
    ).toBe(0);

    const { policy, scan } = await scanConfiguredRepositoryKnowledge(root);
    const evidence = scan.units.find(
      (unit) => unit.path === "README.md" && unit.unitKind === "markdown_section",
    )!;
    const candidate = await compileRepositoryKnowledgeCandidate({
      scan,
      policyHash: sha256(canonicalJson(policy)),
      compiler: {
        descriptor: {
          compilerId: "claude.semantic.fixture",
          compilerVersion: "1",
          compilerBuildId: `sha256:${"a".repeat(64)}`,
          provider: "claude",
          isolation: "external_no_capabilities",
        },
        compile: async () => ({
          schemaVersion: 1,
          concepts: [
            {
              localKey: "existing",
              title: "Existing Runtime",
              type: "concept",
              summary: "Reviewed existing publication.",
              claims: [
                {
                  localKey: "linked",
                  statement: "Quasar linkage is reviewed.",
                  evidenceUnitVersionIds: [evidence.unitVersionId],
                },
              ],
            },
          ],
          relations: [],
          telemetry: {
            filesystemReads: 0,
            filesystemWrites: 0,
            shellProcesses: 0,
            networkRequests: 0,
            externalActions: 0,
            toolCalls: 0,
            complete: true,
          },
        }),
      },
      signal: new AbortController().signal,
    });
    await storeKnowledgeCompilationCandidate({ repositoryRoot: root, candidate });
    messages.length = 0;
    expect(await runCli(["knowledge", "reconcile", "--json", candidate.compilationId], io)).toBe(0);
    const reconciliation = JSON.parse(messages.join("")) as {
      reconciliationPlanId: string;
      dispositions: Array<{ action: string }>;
    };
    expect(reconciliation.dispositions).toEqual([
      expect.objectContaining({ action: "register_existing" }),
    ]);
    messages.length = 0;
    expect(
      await runCli(
        ["knowledge", "review-policy", "--reviewer", "human.owner", "--write", "--json"],
        io,
      ),
    ).toBe(0);
    const policyPath = (JSON.parse(messages.join("")) as { path: string }).path;
    messages.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "review",
          candidate.compilationId,
          "--plan",
          reconciliation.reconciliationPlanId,
          "--policy",
          policyPath,
          "--reviewer",
          "human.owner",
          "--accept-all-safe",
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    const reviewId = (JSON.parse(messages.join("")) as { review: { reviewId: string } }).review
      .reviewId;
    messages.length = 0;
    expect(await runCli(["knowledge", "materialize", reviewId, "--json"], io)).toBe(0);
    const planId = (JSON.parse(messages.join("")) as { planId: string }).planId;
    messages.length = 0;
    expect(
      await runCli(["knowledge", "materialize", reviewId, "--apply", planId, "--json"], io),
    ).toBe(0);
    expect(await readFile(resolve(root, "README.md"), "utf8")).toBe(readme);
    const claimFiles = await listKnowledgeArtifactPaths({
      root,
      directory: ".lervo/knowledge/claims",
      extension: "yaml",
      maximumFiles: 20_000,
    });
    expect(await readFile(resolve(root, claimFiles[0]!), "utf8")).toContain(
      `evidenceUnitIds:\n  - ${evidence.unitId}`,
    );
    messages.length = 0;
    expect(await runCli(["knowledge", "query", "--json", "quasar"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      hits: [expect.objectContaining({ path: "README.md", assurance: "human_reviewed" })],
    });
    expect(errors).toEqual([]);
  });

  it("materializes only an exact policy-authorized duplicate and contradiction resolution", async () => {
    const root = await temporaryRepository();
    await writeFile(resolve(root, "main.ts"), "export const local = true;\n");
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    const { policy, scan } = await scanConfiguredRepositoryKnowledge(root);
    const candidate = await compileRepositoryKnowledgeCandidate({
      scan,
      policyHash: sha256(canonicalJson(policy)),
      compiler: {
        descriptor: {
          compilerId: "claude.semantic.fixture",
          compilerVersion: "1",
          compilerBuildId: `sha256:${"c".repeat(64)}`,
          provider: "claude",
          isolation: "external_no_capabilities",
        },
        compile: async (envelope) => {
          const evidenceUnitVersionId = envelope.sourceUnits[0]!.unitVersionId;
          return {
            schemaVersion: 1,
            concepts: [
              {
                localKey: "duplicate_left",
                title: "Duplicate left",
                type: "concept",
                summary: "First duplicate.",
                claims: [
                  {
                    localKey: "same_left",
                    statement: "The same bounded claim.",
                    evidenceUnitVersionIds: [evidenceUnitVersionId],
                  },
                ],
              },
              {
                localKey: "duplicate_right",
                title: "Duplicate right",
                type: "concept",
                summary: "Second duplicate.",
                claims: [
                  {
                    localKey: "same_right",
                    statement: "The same bounded claim.",
                    evidenceUnitVersionIds: [evidenceUnitVersionId],
                  },
                ],
              },
              {
                localKey: "mode_a",
                title: "Mode A",
                type: "concept",
                summary: "First contradictory view.",
                claims: [
                  {
                    localKey: "a",
                    statement: "The mode is A.",
                    evidenceUnitVersionIds: [evidenceUnitVersionId],
                  },
                ],
              },
              {
                localKey: "mode_b",
                title: "Mode B",
                type: "concept",
                summary: "Second contradictory view.",
                claims: [
                  {
                    localKey: "b",
                    statement: "The mode is B.",
                    evidenceUnitVersionIds: [evidenceUnitVersionId],
                  },
                ],
              },
            ],
            relations: [
              {
                fromConceptKey: "mode_a",
                toConceptKey: "mode_b",
                type: "contradicts",
                evidenceUnitVersionIds: [evidenceUnitVersionId],
              },
            ],
            telemetry: {
              filesystemReads: 0,
              filesystemWrites: 0,
              shellProcesses: 0,
              networkRequests: 0,
              externalActions: 0,
              toolCalls: 0,
              complete: true,
            },
          };
        },
      },
      signal: new AbortController().signal,
    });
    await storeKnowledgeCompilationCandidate({ repositoryRoot: root, candidate });
    messages.length = 0;
    expect(await runCli(["knowledge", "reconcile", "--json", candidate.compilationId], io)).toBe(0);
    const reconciliation = JSON.parse(messages.join("")) as {
      reconciliationPlanId: string;
      dispositions: Array<{
        dispositionId: string;
        subjectId: string;
        action: string;
        resolutionOptions: Array<{ resolutionHash: string }>;
      }>;
    };
    const bySubject = new Map(reconciliation.dispositions.map((item) => [item.subjectId, item]));
    const selectedSubjects = [
      candidate.concepts[0]!.conceptId,
      candidate.concepts[2]!.conceptId,
      candidate.concepts[3]!.conceptId,
      candidate.relations[0]!.relationId,
    ];
    const selections = selectedSubjects.map((subjectId) => {
      const disposition = bySubject.get(subjectId)!;
      return `${disposition.dispositionId}=${disposition.resolutionOptions[0]!.resolutionHash}`;
    });

    messages.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "review-policy",
          "--reviewer",
          "human.resolver",
          "--policy-id",
          "knowledge_conflict.skip",
          "--write",
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    const skipPolicyPath = (JSON.parse(messages.join("")) as { path: string }).path;
    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "review",
          candidate.compilationId,
          "--plan",
          reconciliation.reconciliationPlanId,
          "--policy",
          skipPolicyPath,
          "--reviewer",
          "human.resolver",
          "--resolve-item",
          selections[0]!,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(errors.join("")).toContain("policy authorization");

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "review-policy",
          "--reviewer",
          "human.resolver",
          "--policy-id",
          "knowledge_conflict.resolve",
          "--allow-conflict-resolution",
          "--write",
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    const resolutionPolicyPath = (JSON.parse(messages.join("")) as { path: string }).path;
    const duplicateRight = bySubject.get(candidate.concepts[1]!.conceptId)!;
    const duplicateRightSelection = `${duplicateRight.dispositionId}=${duplicateRight.resolutionOptions[0]!.resolutionHash}`;
    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "review",
          candidate.compilationId,
          "--plan",
          reconciliation.reconciliationPlanId,
          "--policy",
          resolutionPolicyPath,
          "--reviewer",
          "human.resolver",
          "--resolve-item",
          selections[0]!,
          "--resolve-item",
          duplicateRightSelection,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(errors.join("")).toContain("Only one concept");
    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "review",
          candidate.compilationId,
          "--plan",
          reconciliation.reconciliationPlanId,
          "--policy",
          resolutionPolicyPath,
          "--reviewer",
          "human.resolver",
          "--resolve-item",
          selections[3]!,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(errors.join("")).toContain("endpoint");
    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "review",
          candidate.compilationId,
          "--plan",
          reconciliation.reconciliationPlanId,
          "--policy",
          resolutionPolicyPath,
          "--reviewer",
          "human.resolver",
          ...selections.flatMap((selection) => ["--resolve-item", selection]),
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    const review = JSON.parse(messages.join("")) as {
      review: { reviewId: string; itemApprovals: Array<{ action: string }> };
    };
    expect(review.review.itemApprovals).toHaveLength(4);
    expect(review.review.itemApprovals.every((item) => item.action === "resolve_conflict")).toBe(
      true,
    );
    messages.length = 0;
    expect(await runCli(["knowledge", "materialize", review.review.reviewId, "--json"], io)).toBe(
      0,
    );
    const materialization = JSON.parse(messages.join("")) as {
      planId: string;
      createdConceptIds: string[];
      relationIds: string[];
    };
    expect(materialization.createdConceptIds).toHaveLength(3);
    expect(materialization.relationIds).toHaveLength(1);
    messages.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "materialize",
          review.review.reviewId,
          "--apply",
          materialization.planId,
          "--json",
        ],
        io,
      ),
      errors.join(""),
    ).toBe(0);
    expect(errors).toEqual([]);
  });

  it("deletes an exact registered user document and deprecates its concept atomically", async () => {
    const root = await temporaryRepository();
    const documentPath = "docs/research/retired.md";
    await writeFile(resolve(root, "seed.txt"), "seed\n");
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    await mkdir(resolve(root, "docs/research"), { recursive: true });
    await writeFile(resolve(root, documentPath), "# Retired note\n\nExact user bytes to remove.\n");
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const migrationPlanId = (JSON.parse(messages.join("")) as { planId: string }).planId;
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--apply", migrationPlanId, "--json"], io)).toBe(
      0,
    );

    messages.length = 0;
    expect(await runCli(["knowledge", "structure", "delete", documentPath, "--json"], io)).toBe(0);
    const plan = JSON.parse(messages.join("")) as {
      planId: string;
      operationId: string;
      approvalHash: string;
      deprecatedConceptIds: string[];
      operations: Array<{ path: string; action: string; content?: string }>;
    };
    expect(plan.deprecatedConceptIds).toHaveLength(1);
    expect(plan.operations).toContainEqual(
      expect.objectContaining({ path: documentPath, action: "delete" }),
    );
    expect(plan.operations.every((operation) => operation.content === undefined)).toBe(true);
    expect(await readFile(resolve(root, documentPath), "utf8")).toContain("Exact user bytes");

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "delete",
          documentPath,
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=sha256:${"0".repeat(64)}`,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(errors.join("")).toContain("exact approval hash");
    expect(await readFile(resolve(root, documentPath), "utf8")).toContain("Exact user bytes");

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "delete",
          documentPath,
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=${plan.approvalHash}`,
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    await expect(access(resolve(root, documentPath))).rejects.toMatchObject({ code: "ENOENT" });
    const conceptBytes = await readFile(
      resolve(
        root,
        shardedKnowledgeArtifactPath(
          structuralConceptDirectory,
          plan.deprecatedConceptIds[0]!,
          "yaml",
        ),
      ),
      "utf8",
    );
    expect(conceptBytes).toContain("publicationStatus: deprecated");
    expect(conceptBytes).toContain("kind: document_deleted");

    messages.length = 0;
    expect(await runCli(["knowledge", "lint", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ valid: true });
    messages.length = 0;
    expect(await runCli(["knowledge", "refresh", "--json"], io)).toBe(0);
    const refreshPlanId = (JSON.parse(messages.join("")) as { planId: string }).planId;
    messages.length = 0;
    expect(await runCli(["knowledge", "refresh", "--apply", refreshPlanId, "--json"], io)).toBe(0);
    messages.length = 0;
    expect(await runCli(["knowledge", "query", "--json", "Retired note"], io)).toBe(0);
    expect(
      (JSON.parse(messages.join("")) as { hits: Array<{ conceptId: string; path: string }> }).hits,
    ).toEqual([]);
    const storage = await openProjectStorage(root);
    try {
      const event = storage.events
        .list()
        .find(
          (item) =>
            item.type === "knowledge.materialization.applied" &&
            item.payload.operation === "document_structure_delete",
        );
      expect(event?.payload).toMatchObject({
        planId: plan.planId,
        deprecatedConceptIds: plan.deprecatedConceptIds,
      });
      expect(JSON.stringify(event?.payload)).not.toContain(documentPath);
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });

  it("moves an exact registered user document while preserving identity and navigation", async () => {
    const root = await temporaryRepository();
    const sourcePath = "docs/research/original.md";
    const destinationPath = "docs/research/current.md";
    await writeFile(resolve(root, "seed.txt"), "seed\n");
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    await mkdir(resolve(root, "docs/research"), { recursive: true });
    await writeFile(
      resolve(root, sourcePath),
      "# Movable guide\n\nExact user bytes remain unchanged.\n",
    );
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const migrationPlanId = (JSON.parse(messages.join("")) as { planId: string }).planId;
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--apply", migrationPlanId, "--json"], io)).toBe(
      0,
    );

    messages.length = 0;
    expect(
      await runCli(["knowledge", "structure", "move", sourcePath, destinationPath, "--json"], io),
    ).toBe(0);
    const plan = JSON.parse(messages.join("")) as {
      planId: string;
      operationId: string;
      approvalHash: string;
      preservedConceptIds: string[];
      operations: Array<{ action: string; content?: string }>;
    };
    expect(plan.preservedConceptIds).toHaveLength(1);
    expect(plan.operations.some((item) => item.action === "move")).toBe(true);
    expect(plan.operations.every((item) => item.content === undefined)).toBe(true);

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "move",
          sourcePath,
          destinationPath,
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=sha256:${"0".repeat(64)}`,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(await readFile(resolve(root, sourcePath), "utf8")).toContain("Exact user bytes");

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "move",
          sourcePath,
          destinationPath,
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=${plan.approvalHash}`,
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    await expect(access(resolve(root, sourcePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(resolve(root, destinationPath), "utf8")).toContain("Exact user bytes");
    messages.length = 0;
    expect(await runCli(["knowledge", "lint", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ valid: true });
    messages.length = 0;
    expect(await runCli(["knowledge", "query", "--json", "Movable guide"], io)).toBe(0);
    expect(
      (JSON.parse(messages.join("")) as { hits: Array<{ conceptId: string; path: string }> })
        .hits[0],
    ).toMatchObject({ conceptId: plan.preservedConceptIds[0], path: destinationPath });
    messages.length = 0;
    expect(await runCli(["knowledge", "refresh", "--json"], io)).toBe(0);
    expect(
      (JSON.parse(messages.join("")) as { operations: Array<{ action: string }> }).operations.every(
        (item) => item.action === "unchanged",
      ),
    ).toBe(true);
    const storage = await openProjectStorage(root);
    try {
      const event = storage.events
        .list()
        .find(
          (item) =>
            item.type === "knowledge.materialization.applied" &&
            item.payload.operation === "document_structure_move",
        );
      expect(event?.payload).toMatchObject({
        planId: plan.planId,
        updatedConceptIds: plan.preservedConceptIds,
      });
      expect(JSON.stringify(event?.payload)).not.toContain(sourcePath);
      expect(JSON.stringify(event?.payload)).not.toContain(destinationPath);
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });

  it("splits one exact CommonMark heading subtree into a new registered document", async () => {
    const root = await temporaryRepository();
    const sourcePath = "docs/research/guide.md";
    const destinationPath = "docs/research/extracted.md";
    const original =
      "# Guide\n\nIntro.\n\n## Keep\n\nKeep this.\n\n## Extract\n\nMove this.\n\n### Nested\n\nMove nested too.\n\n## Tail\n\nKeep tail.\n";
    const remainder = "# Guide\n\nIntro.\n\n## Keep\n\nKeep this.\n\n## Tail\n\nKeep tail.\n";
    const extracted = "## Extract\n\nMove this.\n\n### Nested\n\nMove nested too.\n\n";
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    await mkdir(resolve(root, "docs/research"), { recursive: true });
    await writeFile(resolve(root, sourcePath), original);
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const migrationPlanId = (JSON.parse(messages.join("")) as { planId: string }).planId;
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--apply", migrationPlanId, "--json"], io)).toBe(
      0,
    );

    messages.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "split",
          sourcePath,
          destinationPath,
          "--at-heading",
          "heading:Guide > Extract",
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    const plan = JSON.parse(messages.join("")) as {
      planId: string;
      operationId: string;
      approvalHash: string;
      createdConceptIds: string[];
      operations: Array<{ ownership: string; content?: string }>;
    };
    expect(plan.createdConceptIds).toHaveLength(1);
    expect(plan.operations.some((item) => item.ownership === "user")).toBe(true);
    expect(plan.operations.every((item) => item.content === undefined)).toBe(true);

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "split",
          sourcePath,
          destinationPath,
          "--at-heading",
          "heading:Guide > Extract",
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=sha256:${"0".repeat(64)}`,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(await readFile(resolve(root, sourcePath), "utf8")).toBe(original);
    await expect(access(resolve(root, destinationPath))).rejects.toMatchObject({ code: "ENOENT" });

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "split",
          sourcePath,
          destinationPath,
          "--at-heading",
          "heading:Guide > Extract",
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=${plan.approvalHash}`,
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    expect(await readFile(resolve(root, sourcePath), "utf8")).toBe(remainder);
    expect(await readFile(resolve(root, destinationPath), "utf8")).toBe(extracted);
    messages.length = 0;
    expect(await runCli(["knowledge", "lint", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ valid: true });
    messages.length = 0;
    expect(await runCli(["knowledge", "query", "--json", "Extract"], io)).toBe(0);
    expect(
      (JSON.parse(messages.join("")) as { hits: Array<{ conceptId: string; path: string }> })
        .hits[0],
    ).toMatchObject({ conceptId: plan.createdConceptIds[0], path: destinationPath });
    messages.length = 0;
    expect(await runCli(["knowledge", "refresh", "--json"], io)).toBe(0);
    expect(
      (JSON.parse(messages.join("")) as { operations: Array<{ action: string }> }).operations.every(
        (item) => item.action === "unchanged",
      ),
    ).toBe(true);
    const storage = await openProjectStorage(root);
    try {
      const event = storage.events
        .list()
        .find(
          (item) =>
            item.type === "knowledge.materialization.applied" &&
            item.payload.operation === "document_structure_split",
        );
      expect(event?.payload).toMatchObject({
        planId: plan.planId,
        createdConceptIds: plan.createdConceptIds,
      });
      expect(JSON.stringify(event?.payload)).not.toContain(sourcePath);
      expect(JSON.stringify(event?.payload)).not.toContain(destinationPath);
      expect(JSON.stringify(event?.payload)).not.toContain("Move this");
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });

  it("merges one registered source into a registered destination with exact approval", async () => {
    const root = await temporaryRepository();
    const sourcePath = "docs/research/source.md";
    const destinationPath = "docs/research/destination.md";
    const source = "# Source\n\nSource-only body.\n";
    const destination = "# Destination\n\nDestination body.\n\n";
    await mkdir(resolve(root, "docs/research"), { recursive: true });
    await writeFile(resolve(root, sourcePath), source);
    await writeFile(resolve(root, destinationPath), destination);
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const migrationPlanId = (JSON.parse(messages.join("")) as { planId: string }).planId;
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--apply", migrationPlanId, "--json"], io)).toBe(
      0,
    );

    messages.length = 0;
    expect(
      await runCli(["knowledge", "structure", "merge", sourcePath, destinationPath, "--json"], io),
    ).toBe(0);
    const plan = JSON.parse(messages.join("")) as {
      planId: string;
      operationId: string;
      approvalHash: string;
      preservedConceptIds: string[];
      deprecatedConceptIds: string[];
      operations: Array<{ action: string; ownership?: string; content?: string }>;
    };
    expect(plan.preservedConceptIds).toHaveLength(1);
    expect(plan.deprecatedConceptIds).toHaveLength(1);
    expect(plan.operations.some((item) => item.action === "delete")).toBe(true);
    expect(plan.operations.every((item) => item.content === undefined)).toBe(true);

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "merge",
          sourcePath,
          destinationPath,
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=sha256:${"0".repeat(64)}`,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(await readFile(resolve(root, sourcePath), "utf8")).toBe(source);
    expect(await readFile(resolve(root, destinationPath), "utf8")).toBe(destination);

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "structure",
          "merge",
          sourcePath,
          destinationPath,
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=${plan.approvalHash}`,
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    await expect(access(resolve(root, sourcePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(resolve(root, destinationPath), "utf8")).toBe(destination + source);
    messages.length = 0;
    expect(await runCli(["knowledge", "lint", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ valid: true });
    messages.length = 0;
    expect(await runCli(["knowledge", "query", "--json", "Source-only body"], io)).toBe(0);
    expect(
      (JSON.parse(messages.join("")) as { hits: Array<{ conceptId: string; path: string }> })
        .hits[0],
    ).toMatchObject({ conceptId: plan.preservedConceptIds[0], path: destinationPath });
    messages.length = 0;
    expect(await runCli(["knowledge", "refresh", "--json"], io)).toBe(0);
    expect(
      (JSON.parse(messages.join("")) as { operations: Array<{ action: string }> }).operations.every(
        (item) => item.action === "unchanged",
      ),
    ).toBe(true);
    const storage = await openProjectStorage(root);
    try {
      const event = storage.events
        .list()
        .find(
          (item) =>
            item.type === "knowledge.materialization.applied" &&
            item.payload.operation === "document_structure_merge",
        );
      expect(event?.payload).toMatchObject({
        planId: plan.planId,
        deprecatedConceptIds: plan.deprecatedConceptIds,
      });
      expect(JSON.stringify(event?.payload)).not.toContain(sourcePath);
      expect(JSON.stringify(event?.payload)).not.toContain(destinationPath);
      expect(JSON.stringify(event?.payload)).not.toContain("Source-only body");
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });

  it("creates and records a privacy-bounded Claude instruction bridge", async () => {
    const root = await temporaryRepository();
    await writeFile(
      resolve(root, "AGENTS.md"),
      "# Canonical agent policy\n\nRepository instructions.\n",
    );
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);

    messages.length = 0;
    expect(
      await runCli(["knowledge", "instruction", "bridge", "--provider", "claude", "--json"], io),
    ).toBe(0);
    const plan = JSON.parse(messages.join("")) as {
      planId: string;
      operationId: string;
      approvalHash: string;
      target: { action: string };
      operations: Array<{ content?: string }>;
    };
    expect(plan.target.action).toBe("create");
    expect(plan.operations.every((item) => item.content === undefined)).toBe(true);
    await expect(access(resolve(root, "CLAUDE.md"))).rejects.toMatchObject({ code: "ENOENT" });

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "instruction",
          "bridge",
          "--provider",
          "claude",
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=sha256:${"0".repeat(64)}`,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(errors.join("")).toContain("exact approval hash");
    await expect(access(resolve(root, "CLAUDE.md"))).rejects.toMatchObject({ code: "ENOENT" });

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "instruction",
          "bridge",
          "--provider",
          "claude",
          "--apply",
          plan.planId,
          "--approve-item",
          `${plan.operationId}=${plan.approvalHash}`,
          "--json",
        ],
        io,
      ),
      errors.join(""),
    ).toBe(0);
    expect(await readFile(resolve(root, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md\n");
    const receipt = JSON.parse(messages.join("")) as {
      canonicalPathDigest: string;
      targetPathDigest: string;
    };
    expect(receipt.canonicalPathDigest).toMatch(/^sha256:/);
    expect(receipt.targetPathDigest).toMatch(/^sha256:/);

    const storage = await openProjectStorage(root);
    try {
      const event = storage.events
        .list()
        .find(
          (item) =>
            item.type === "knowledge.materialization.applied" &&
            item.payload.operation === "instruction_bridge_update",
        );
      expect(event?.payload).toMatchObject({
        planId: plan.planId,
        compilerId: "lervo.instruction-bridge",
      });
      expect(JSON.stringify(event?.payload)).not.toContain("AGENTS.md");
      expect(JSON.stringify(event?.payload)).not.toContain("CLAUDE.md");
      expect(JSON.stringify(event?.payload)).not.toContain("Repository instructions");
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });

  it("updates only an explicit managed block after an exact output-hash item approval", async () => {
    const root = await temporaryRepository();
    const startMarker = "<!-- lervo:begin block=repository-knowledge schema=1 -->";
    const endMarker = "<!-- lervo:end block=repository-knowledge -->";
    const readme = `# Existing Runtime\n\nUser prefix stays byte-identical.\n${startMarker}\nOld generated summary.\n${endMarker}\nUser suffix stays byte-identical.\n`;
    await writeFile(resolve(root, "README.md"), readme);
    const messages: string[] = [];
    const errors: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], io)).toBe(0);
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], io)).toBe(0);
    const structuralPlan = JSON.parse(messages.join("")) as { planId: string };
    messages.length = 0;
    expect(
      await runCli(["migrate", "knowledge", "--apply", structuralPlan.planId, "--json"], io),
    ).toBe(0);

    const { policy, scan } = await scanConfiguredRepositoryKnowledge(root);
    const evidence = scan.units.find(
      (unit) => unit.path === "README.md" && unit.unitKind === "markdown_section",
    )!;
    const candidate = await compileRepositoryKnowledgeCandidate({
      scan,
      policyHash: sha256(canonicalJson(policy)),
      compiler: {
        descriptor: {
          compilerId: "claude.semantic.fixture",
          compilerVersion: "1",
          compilerBuildId: `sha256:${"b".repeat(64)}`,
          provider: "claude",
          isolation: "external_no_capabilities",
        },
        compile: async () => ({
          schemaVersion: 1,
          concepts: [
            {
              localKey: "existing",
              title: "Existing Runtime",
              type: "concept",
              summary: "Reviewed managed summary.",
              claims: [
                {
                  localKey: "linked",
                  statement: "Managed block replacement is reviewed.",
                  evidenceUnitVersionIds: [evidence.unitVersionId],
                },
              ],
            },
          ],
          relations: [],
          telemetry: {
            filesystemReads: 0,
            filesystemWrites: 0,
            shellProcesses: 0,
            networkRequests: 0,
            externalActions: 0,
            toolCalls: 0,
            complete: true,
          },
        }),
      },
      signal: new AbortController().signal,
    });
    await storeKnowledgeCompilationCandidate({ repositoryRoot: root, candidate });
    messages.length = 0;
    expect(await runCli(["knowledge", "reconcile", "--json", candidate.compilationId], io)).toBe(0);
    const reconciliation = JSON.parse(messages.join("")) as {
      reconciliationPlanId: string;
      status: string;
      dispositions: Array<{
        dispositionId: string;
        action: string;
        patch: null | { outputHash: string };
      }>;
    };
    expect(reconciliation.status).toBe("review_required");
    expect(reconciliation.dispositions.map((item) => item.action).sort()).toEqual([
      "propose_user_patch",
      "register_existing",
    ]);
    const patch = reconciliation.dispositions.find((item) => item.action === "propose_user_patch")!;

    messages.length = 0;
    expect(
      await runCli(
        ["knowledge", "review-policy", "--reviewer", "human.owner", "--write", "--json"],
        io,
      ),
    ).toBe(0);
    const policyPath = (JSON.parse(messages.join("")) as { path: string }).path;
    messages.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "review",
          candidate.compilationId,
          "--plan",
          reconciliation.reconciliationPlanId,
          "--policy",
          policyPath,
          "--reviewer",
          "human.owner",
          "--accept-all-safe",
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    const safeOnly = JSON.parse(messages.join("")) as {
      review: { itemApprovals: unknown[]; skippedDispositionIds: string[] };
    };
    expect(safeOnly.review.itemApprovals).toEqual([]);
    expect(safeOnly.review.skippedDispositionIds).toContain(patch.dispositionId);
    expect(await readFile(resolve(root, "README.md"), "utf8")).toBe(readme);

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "review",
          candidate.compilationId,
          "--plan",
          reconciliation.reconciliationPlanId,
          "--policy",
          policyPath,
          "--reviewer",
          "human.owner",
          "--accept-all-safe",
          "--approve-item",
          `${patch.dispositionId}=sha256:${"0".repeat(64)}`,
          "--json",
        ],
        io,
      ),
    ).toBe(1);
    expect(errors.join("")).toContain("exact output hash");
    expect(await readFile(resolve(root, "README.md"), "utf8")).toBe(readme);

    messages.length = 0;
    errors.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "review",
          candidate.compilationId,
          "--plan",
          reconciliation.reconciliationPlanId,
          "--policy",
          policyPath,
          "--reviewer",
          "human.owner",
          "--accept-all-safe",
          "--approve-item",
          `${patch.dispositionId}=${patch.patch!.outputHash}`,
          "--json",
        ],
        io,
      ),
    ).toBe(0);
    const reviewed = JSON.parse(messages.join("")) as {
      review: {
        reviewId: string;
        itemApprovals: Array<{ dispositionId: string; outputHash: string }>;
      };
    };
    expect(reviewed.review.itemApprovals).toEqual([
      {
        dispositionId: patch.dispositionId,
        action: "apply_managed_block_patch",
        outputHash: patch.patch!.outputHash,
      },
    ]);
    messages.length = 0;
    expect(await runCli(["knowledge", "materialize", reviewed.review.reviewId, "--json"], io)).toBe(
      0,
    );
    const semanticPlan = JSON.parse(messages.join("")) as {
      planId: string;
      userPatchCount: number;
      operations: Array<{ path: string; ownership: string }>;
    };
    expect(semanticPlan.userPatchCount).toBe(1);
    expect(semanticPlan.operations).toContainEqual(
      expect.objectContaining({ path: "README.md", ownership: "managed_blocks" }),
    );
    messages.length = 0;
    expect(
      await runCli(
        [
          "knowledge",
          "materialize",
          reviewed.review.reviewId,
          "--apply",
          semanticPlan.planId,
          "--json",
        ],
        io,
      ),
    ).toBe(0);

    const after = await readFile(resolve(root, "README.md"), "utf8");
    const prefixEnd = readme.indexOf(startMarker) + startMarker.length;
    const suffixStart = readme.indexOf(endMarker);
    expect(after.slice(0, prefixEnd)).toBe(readme.slice(0, prefixEnd));
    expect(after.slice(after.indexOf(endMarker))).toBe(readme.slice(suffixStart));
    expect(after).toContain("Reviewed managed summary.");
    expect(after).toContain("Managed block replacement is reviewed.");
    const storage = await openProjectStorage(root);
    try {
      const reviewEvent = storage.events
        .list()
        .filter((event) => event.type === "knowledge.reconciliation.reviewed")
        .at(-1)!;
      expect(reviewEvent.payload).toHaveProperty("itemApprovalDigest");
      expect(reviewEvent.payload).not.toHaveProperty("reviewerId");
      expect(JSON.stringify(reviewEvent.payload)).not.toContain("README.md");
      expect(JSON.stringify(reviewEvent.payload)).not.toContain("Managed block replacement");
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });

  it("exchanges an OKF bundle with another Lervo using a read-only same-ID import plan", async () => {
    const source = await temporaryRepository();
    const target = await temporaryRepository();
    const exchangeParent = await temporaryRepository();
    const messages: string[] = [];
    const errors: string[] = [];
    const sourceIo = {
      cwd: source,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    expect(await runCli(["init"], sourceIo)).toBe(0);
    await writeFile(
      resolve(source, "README.md"),
      "# Exchange fixture\n\nPortable quasar knowledge.\n",
    );
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge", "--json"], sourceIo)).toBe(0);
    const migrationPlanId = (JSON.parse(messages.join("")) as { planId: string }).planId;
    messages.length = 0;
    expect(
      await runCli(["migrate", "knowledge", "--apply", migrationPlanId, "--json"], sourceIo),
    ).toBe(0);
    messages.length = 0;
    const bundle = resolve(exchangeParent, "bundle");
    expect(
      await runCli(["knowledge", "export", "okf", "--output", bundle, "--json"], sourceIo),
    ).toBe(0);
    const exported = JSON.parse(messages.join("")) as { bundleDigest: string };

    const targetIo = {
      cwd: target,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => errors.push(message),
    };
    messages.length = 0;
    expect(await runCli(["init"], targetIo)).toBe(0);
    messages.length = 0;
    expect(await runCli(["knowledge", "import", "okf", bundle, "--json"], targetIo)).toBe(0);
    const importPlan = JSON.parse(messages.join("")) as {
      planId: string;
      candidateId: string;
      targetPath: string;
      bundleDigest: string;
    };
    expect(importPlan.bundleDigest).toBe(exported.bundleDigest);
    await expect(access(resolve(target, importPlan.targetPath))).rejects.toThrow();
    messages.length = 0;
    expect(
      await runCli(
        ["knowledge", "import", "okf", bundle, "--apply", importPlan.planId, "--json"],
        targetIo,
      ),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      candidateId: importPlan.candidateId,
      created: true,
      localAssurance: "unreviewed",
    });

    messages.length = 0;
    expect(await runCli(["knowledge", "okf", "query", bundle, "quasar", "--json"], targetIo)).toBe(
      0,
    );
    expect(JSON.parse(messages.join(""))).toMatchObject({
      semantics: "recommended",
      hits: [expect.objectContaining({ localAssurance: "unreviewed" })],
    });
    const roundtrip = resolve(exchangeParent, "roundtrip");
    messages.length = 0;
    expect(
      await runCli(
        ["knowledge", "okf", "re-export", importPlan.candidateId, "--output", roundtrip, "--json"],
        targetIo,
      ),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({ bundleDigest: exported.bundleDigest });
    expect(await readFile(resolve(roundtrip, "index.md"), "utf8")).toBe(
      await readFile(resolve(bundle, "index.md"), "utf8"),
    );
    const storage = await openProjectStorage(target);
    try {
      expect(storage.events.list()).toEqual([]);
    } finally {
      await storage.close();
    }
    expect(errors).toEqual([]);
  });
});

describe("lervo run CLI arguments", () => {
  it("rejects an incomplete run command before opening a managed run", async () => {
    const root = await temporaryRepository();
    let called = false;
    let errorOutput = "";
    const exitCode = await runCli(
      ["run", "--provider", "codex", "task"],
      {
        cwd: root,
        stdout: () => undefined,
        stderr: (message) => {
          errorOutput += message;
        },
      },
      {
        executeManagedRun: async () => {
          called = true;
          throw new Error("must not run");
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    expect(errorOutput).toContain(
      "A provider, path, verification suite, and task request are required",
    );
  });
});

describe("lervo deliberate CLI", () => {
  it("reports a missing automatic verification suite as an actionable preflight state", async () => {
    const root = await temporaryRepository();
    let called = false;
    let errors = "";
    const exitCode = await runCli(
      ["deliberate", "--auto", "--caller", "codex", "Review this change."],
      {
        cwd: root,
        stdout: () => undefined,
        stderr: (message) => {
          errors += message;
        },
      },
      {
        executeManagedDeliberation: async () => {
          called = true;
          throw new Error("must not run");
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    expect(errors).toContain("deliberation_verification_unconfigured");
    expect(errors).toContain("provider execution has not started");
  });

  it("resolves a natural terminal request to the repository default cross-provider workflow", async () => {
    const root = await temporaryRepository();
    await mkdir(resolve(root, ".lervo/verifications"), { recursive: true });
    await writeFile(resolve(root, ".lervo/verifications/repository.default.yaml"), "fixture\n");
    let request: unknown;
    const exitCode = await runCli(
      ["deliberate", "--auto", "--caller", "claude", "Review the proposed UX writing change."],
      { cwd: root, stdout: () => undefined, stderr: () => undefined },
      {
        executeManagedDeliberation: async (input) => {
          request = input;
          throw Object.assign(new Error("stop after parse"), { code: "fixture_stop" });
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(request).toEqual({
      repositoryRoot: root,
      proposerProvider: "claude",
      reviewerProvider: "codex",
      verificationSuiteIds: ["repository.default"],
      topic: "Review the proposed UX writing change.",
    });
  });

  it("requires two different providers before starting a deliberation", async () => {
    let called = false;
    let errors = "";
    const exitCode = await runCli(
      [
        "deliberate",
        "--proposer",
        "codex",
        "--reviewer",
        "codex",
        "--verification",
        "project.default",
        "topic",
      ],
      {
        cwd: process.cwd(),
        stdout: () => undefined,
        stderr: (message) => {
          errors += message;
        },
      },
      {
        executeManagedDeliberation: async () => {
          called = true;
          throw new Error("must not run");
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    expect(errors).toContain("Provide one resume ID");
  });

  it("accepts a stored policy without inline role arguments", async () => {
    let request: unknown;
    const exitCode = await runCli(
      ["deliberate", "--policy", "deliberation_product-review", "review topic"],
      {
        cwd: "/work/repository",
        stdout: () => undefined,
        stderr: () => undefined,
      },
      {
        executeManagedDeliberation: async (input) => {
          request = input;
          throw Object.assign(new Error("stop after parse"), { code: "fixture_stop" });
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(request).toEqual({
      repositoryRoot: "/work/repository",
      policyId: "deliberation_product-review",
      topic: "review topic",
    });
  });

  it("does not mix a stored policy with inline providers", async () => {
    let called = false;
    const exitCode = await runCli(
      [
        "deliberate",
        "--policy",
        "deliberation_product-review",
        "--proposer",
        "codex",
        "review topic",
      ],
      { cwd: process.cwd(), stdout: () => undefined, stderr: () => undefined },
      {
        executeManagedDeliberation: async () => {
          called = true;
          throw new Error("must not run");
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(called).toBe(false);
  });

  it("accepts a resume ID without a topic or role arguments", async () => {
    let request: unknown;
    const exitCode = await runCli(
      ["deliberate", "--resume", "dlb_12345678"],
      { cwd: "/work/repository", stdout: () => undefined, stderr: () => undefined },
      {
        executeManagedDeliberation: async (input) => {
          request = input;
          throw Object.assign(new Error("stop after parse"), { code: "fixture_stop" });
        },
      },
    );
    expect(exitCode).toBe(1);
    expect(request).toEqual({
      repositoryRoot: "/work/repository",
      resumeDeliberationId: "dlb_12345678",
    });
  });

  it("prints a converged result without exposing evidence digests", async () => {
    let output = "";
    const outcome: ManagedDeliberationOutcome = {
      deliberationId: "dlb_cli_result_0001",
      status: "converged",
      artifactCount: 4,
      finalContent: "A conclusion reached through independent review and actual verification.",
      providers: { proposer: "codex", reviewer: "claude" },
      participants: [
        {
          roleId: "deliberation-proposer",
          name: "Proposal and decision role",
          provider: "codex",
          responsibilities: ["proposer", "decision_owner"],
        },
        {
          roleId: "deliberation-reviewer",
          name: "Independent review and verification role",
          provider: "claude",
          responsibilities: ["reviewer", "verifier"],
        },
      ],
      outcome: {
        schemaVersion: 1,
        outcomeId: "dlo_0000000000000001",
        deliberationId: "dlb_cli_result_0001",
        projectId: "prj_cli_result_0001",
        policyId: "deliberation_cli.two-provider-v1",
        policyHash: `sha256:${"1".repeat(64)}`,
        status: "converged",
        lastRound: 1,
        artifactIds: ["dla_0000000000000001"],
        lastConfirmedArtifactId: "dla_0000000000000001",
        decisionArtifactId: "dla_0000000000000001",
        passedVerificationArtifactIds: ["dla_0000000000000002"],
        unresolvedBlockingObjectionIds: [],
        noConsensusReason: null,
        failure: null,
        completedAt: "2026-08-21T00:00:00.000Z",
      },
    };
    const exitCode = await runCli(
      [
        "deliberate",
        "--proposer",
        "codex",
        "--reviewer",
        "claude",
        "--verification",
        "project.default",
        "topic to review",
      ],
      {
        cwd: process.cwd(),
        stdout: (message) => {
          output += message;
        },
        stderr: () => undefined,
      },
      { executeManagedDeliberation: async () => outcome },
    );
    expect(exitCode).toBe(0);
    expect(output).toContain("Deliberation reached a decision");
    expect(output).toContain(outcome.finalContent);
    expect(output).not.toContain("sha256:");
    expect(output).not.toContain("dlb_cli_result_0001");
  });
});

describe("lervo trace CLI", () => {
  it("reports machine-readable capabilities without opening project storage", async () => {
    let output = "";
    let errors = "";
    let storageOpened = false;
    const exitCode = await runCli(
      ["trace", "--capabilities"],
      {
        cwd: "/missing/repository/is-not-required",
        stdout: (message) => {
          output += message;
        },
        stderr: (message) => {
          errors += message;
        },
      },
      {
        openProjectStorage: async () => {
          storageOpened = true;
          throw new Error("storage must not open");
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(storageOpened).toBe(false);
    expect(errors).toBe("");
    expect(JSON.parse(output)).toMatchObject({
      schemaVersion: 1,
      capability: "trace",
      eventReader: {
        schemaVersion: 1,
        capability: "event_reader",
        readableEventSchemaVersions: [1, 2],
      },
      defaultMode: "page",
      limits: {
        defaultPageSize: 50,
        maximumPageSize: 100,
        maximumFullEventCount: 1000,
        maximumCursorBytes: 2048,
      },
      deprecations: [],
    });

    let explicitJsonOutput = "";
    expect(
      await runCli(
        ["trace", "--capabilities", "--json"],
        {
          cwd: "/missing/repository/is-not-required",
          stdout: (message) => {
            explicitJsonOutput += message;
          },
          stderr: (message) => {
            errors += message;
          },
        },
        {
          openProjectStorage: async () => {
            storageOpened = true;
            throw new Error("storage must not open");
          },
        },
      ),
    ).toBe(0);
    expect(JSON.parse(explicitJsonOutput)).toEqual(JSON.parse(output));
    expect(storageOpened).toBe(false);
    expect(errors).toBe("");
  });

  it("traces the latest run from append-only local events", async () => {
    const root = await temporaryRepository();
    expect(
      await runCli(["init"], {
        cwd: root,
        stdout: () => undefined,
        stderr: () => undefined,
      }),
    ).toBe(0);
    const storage = await openProjectStorage(root);
    const common = {
      projectId: storage.manifest.projectId,
      runId: "run_cli_trace_0001",
      sessionId: "ses_cli_trace_0001",
      actor: { kind: "system" as const },
      schemaVersion: 1 as const,
      policyVersion: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    storage.events.append({
      ...common,
      eventId: "evt_cli_trace_start",
      type: "run.requested",
      occurredAt: "2026-08-19T00:00:00Z",
      payload: {
        requestDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        role: "developer",
        risk: "low",
      },
    });
    storage.events.append({
      ...common,
      eventId: "evt_cli_trace_done",
      type: "run.completed",
      occurredAt: "2026-08-19T00:00:01Z",
      payload: {
        resultDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        artifactIds: ["art_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"],
        verificationStatus: "not_run",
      },
    });
    await storage.close();

    let output = "";
    let defaultErrors = "";
    const code = await runCli(["trace", "last"], {
      cwd: root,
      stdout: (message) => {
        output += message;
      },
      stderr: (message) => {
        defaultErrors += message;
      },
    });

    expect(code).toBe(0);
    expect(output).toContain("Run trace page: run_cli_trace_0001");
    expect(output).toContain("run.requested");
    expect(output).toContain("run.completed");
    expect(output).not.toContain("source claim");
    expect(defaultErrors).toBe("");

    let jsonOutput = "";
    let jsonErrors = "";
    expect(
      await runCli(["trace", "last", "--json"], {
        cwd: root,
        stdout: (message) => {
          jsonOutput += message;
        },
        stderr: (message) => {
          jsonErrors += message;
        },
      }),
    ).toBe(0);
    expect(JSON.parse(jsonOutput)).toMatchObject({
      schemaVersion: 1,
      runId: "run_cli_trace_0001",
      page: { returnedCount: 2, hasMore: false },
    });
    expect(JSON.parse(jsonOutput)).not.toHaveProperty("status");
    expect(jsonErrors).toBe("");

    let explicitFullOutput = "";
    let explicitFullErrors = "";
    expect(
      await runCli(["trace", "last", "--full", "--json"], {
        cwd: root,
        stdout: (message) => {
          explicitFullOutput += message;
        },
        stderr: (message) => {
          explicitFullErrors += message;
        },
      }),
    ).toBe(0);
    expect(JSON.parse(explicitFullOutput)).toMatchObject({
      schemaVersion: 1,
      runId: "run_cli_trace_0001",
      status: "completed",
    });
    expect(JSON.parse(explicitFullOutput).events).toEqual(JSON.parse(jsonOutput).events);
    expect(explicitFullErrors).toBe("");

    let firstPageOutput = "";
    let firstPageErrors = "";
    expect(
      await runCli(["trace", "last", "--page-size", "1", "--json"], {
        cwd: root,
        stdout: (message) => {
          firstPageOutput += message;
        },
        stderr: (message) => {
          firstPageErrors += message;
        },
      }),
    ).toBe(0);
    const firstPage = JSON.parse(firstPageOutput);
    expect(firstPage.events.map((event: { seq: number }) => event.seq)).toEqual([1]);
    expect(firstPage.page.hasMore).toBe(true);
    expect(firstPageErrors).toBe("");

    let secondPageOutput = "";
    expect(
      await runCli(["trace", "--cursor", firstPage.page.nextCursor, "--json"], {
        cwd: root,
        stdout: (message) => {
          secondPageOutput += message;
        },
        stderr: () => undefined,
      }),
    ).toBe(0);
    const secondPage = JSON.parse(secondPageOutput);
    expect(secondPage.events.map((event: { seq: number }) => event.seq)).toEqual([2]);
    expect(secondPage.page.hasMore).toBe(false);

    let filteredOutput = "";
    expect(
      await runCli(["trace", "last", "--event-type", "run.completed", "--json"], {
        cwd: root,
        stdout: (message) => {
          filteredOutput += message;
        },
        stderr: () => undefined,
      }),
    ).toBe(0);
    const filtered = JSON.parse(filteredOutput);
    expect(filtered.filter).toEqual({ eventTypes: ["run.completed"] });
    expect(filtered.events.map((event: { seq: number }) => event.seq)).toEqual([2]);
  });
});
