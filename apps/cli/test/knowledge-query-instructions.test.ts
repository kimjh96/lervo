import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  applyInitPlan,
  createInitPlan,
  planEventWriterActivation,
  applyEventWriterActivationPlan,
} from "@lervo/project";
import { FileSystemCas } from "@lervo/cas";
import { createEventReaderCapabilities } from "@lervo/event-contract";
import { runKnowledgeQuery } from "../src/knowledge-query-command.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it("exposes full scoped owner clauses independently of ranked matches", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-query-instructions-"));
  roots.push(root);
  await writeFile(resolve(root, "README.md"), "# Local execution\nWorks without a Hub.\n");
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_rulequery" }));
  await mkdir(resolve(root, "docs/instructions/generated"), { recursive: true });
  await writeFile(
    resolve(root, `docs/instructions/generated/rule_${"a".repeat(24)}.md`),
    '---\npaths: ["src/**"]\n---\n# Source constraint\nKeep full clauses.\n## Exceptions\nPreserve quoted code.\n',
  );
  const run = async (path: string) => {
    let output = "";
    let error = "";
    const code = await runKnowledgeQuery(["--json", "--path", path, "unmatchedzzq987"], {
      cwd: root,
      stdout: (message) => {
        output += message;
      },
      stderr: (message) => {
        error += message;
      },
    });
    expect(error).toBe("");
    expect(code).toBe(0);
    return JSON.parse(output);
  };
  const source = await run("src/file.ts");
  expect(source.instructions.report).toMatchObject({
    status: "complete",
    applicableCount: 1,
    preparedCount: 1,
  });
  expect(source.instructions.context).toContain("Preserve quoted code.");
  const other = await run("docs/guide.md");
  expect(other.instructions.report).toMatchObject({
    status: "complete",
    excludedCount: 1,
    preparedCount: 0,
  });
  expect(other.hits).toEqual(source.hits);
});

it("resolves explicit action and artifact scope through the query entrypoint", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-query-action-"));
  roots.push(root);
  await writeFile(resolve(root, "README.md"), "# Scope fixture\nRead the repository.\n");
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_queryaction" }));
  await mkdir(resolve(root, "docs/instructions/generated"), { recursive: true });
  await writeFile(
    resolve(root, `docs/instructions/generated/rule_${"b".repeat(24)}.md`),
    "---\nlervo:\n  contextScope:\n    schemaVersion: 1\n    when:\n      requestedActions: [repository.write]\n    except:\n      - artifactKinds: [quotation]\n---\nPublish English prose.\n",
  );
  let output = "";
  const io = {
    cwd: root,
    stdout: (message: string) => {
      output += message;
    },
    stderr: (message: string) => {
      throw new Error(message);
    },
  };
  expect(
    await runKnowledgeQuery(
      ["--json", "--action", "repository.write", "--artifact", "markdown", "scope"],
      io,
    ),
  ).toBe(0);
  expect(JSON.parse(output).instructions.report.applicableCount).toBe(1);
  expect(JSON.parse(output).quality.plan).not.toBeNull();
  output = "";
  expect(
    await runKnowledgeQuery(
      ["--json", "--action", "repository.write", "--artifact", "quotation", "scope"],
      io,
    ),
  ).toBe(0);
  expect(JSON.parse(output).instructions.report.excludedCount).toBe(1);
});

it("reports unavailable outcome verification and inactive recording without a hidden provider call", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-query-outcome-"));
  roots.push(root);
  const content = "# Result\nThe test passed.\n";
  await writeFile(resolve(root, "README.md"), content);
  await writeFile(resolve(root, "baseline.md"), content);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_queryoutcome" }));
  const run = async (args: string[]) => {
    let output = "";
    let error = "";
    const code = await runKnowledgeQuery(["--json", "outcomefixturezz", ...args], {
      cwd: root,
      stdout: (text) => {
        output += text;
      },
      stderr: (text) => {
        error += text;
      },
    });
    expect(error).toBe("");
    return { code, value: JSON.parse(output) };
  };
  const initial = await run([]);
  const checked = await run([
    "--verify-artifact",
    "README.md",
    "--expected-plan",
    initial.value.quality.plan.planDigest,
    "--baseline",
    "baseline.md",
    "--record",
  ]);
  expect(checked.code).toBe(2);
  expect(checked.value.verification.disposition).toBe("unavailable");
  expect(checked.value.recording.status).toBe("writer_not_active");
  expect(checked.value.verificationRecording.status).toBe("writer_not_active");
});

it("loads a bounded full-task definition without fabricating an evaluator or language authority", async () => {
  const { canonicalHash } = await import("@lervo/search");
  const root = await mkdtemp(resolve(tmpdir(), "lervo-query-task-"));
  roots.push(root);
  await writeFile(resolve(root, "README.md"), "# Result\nThe test passed.\n");
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_querytask" }));
  const task = {
    intent: "uniquetaskzz",
    continuation: "",
    targetPaths: [],
    artifactKinds: [],
    requestedActions: [],
    conversationLocale: null,
    publicationLocale: null,
    retrievalLanguages: ["en"],
  };
  await writeFile(
    resolve(root, "task.json"),
    JSON.stringify({
      definitionId: "task.outcome.v1",
      language: "en",
      preserveProtectedMaterial: false,
      task: {
        definitionId: "task.v1",
        taskDigest: canonicalHash(task),
        checks: [{ checkId: "complete", requirement: "Complete all requested behavior." }],
      },
    }),
  );
  let output = "";
  let error = "";
  const io = {
    cwd: root,
    stdout: (text: string) => {
      output += text;
    },
    stderr: (text: string) => {
      error += text;
    },
  };
  expect(await runKnowledgeQuery(["--json", task.intent], io)).toBe(0);
  const plan = JSON.parse(output).quality.plan.planDigest;
  output = "";
  expect(
    await runKnowledgeQuery(
      [
        "--json",
        task.intent,
        "--verify-artifact",
        "README.md",
        "--expected-plan",
        plan,
        "--verification-definition",
        "task.json",
      ],
      io,
    ),
  ).toBe(2);
  expect(error).toBe("");
  expect(JSON.parse(output).verification).toMatchObject({
    scope: "task_and_artifact",
    disposition: "unavailable",
    taskVerification: { disposition: "unavailable" },
  });
});

it("overlaps artifact observation but emits no result before both durable receipts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-query-drain-"));
  roots.push(root);
  await writeFile(resolve(root, "README.md"), "# Fixture\nKeep evidence current.\n");
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_querydrain" }));
  const evidence = {
    schemaVersion: 1,
    projectId: "prj_querydrain",
    observedAt: new Date().toISOString(),
    readers: [
      {
        readerId: "reader_fixture01",
        readerKind: "local",
        peerIdentityHash: null,
        capabilities: createEventReaderCapabilities(),
      },
    ],
  };
  const activation = await planEventWriterActivation({
    repositoryRoot: root,
    evidence,
    targetEventSchemaVersion: 6,
  });
  await applyEventWriterActivationPlan({
    plan: activation,
    approval: activation.planId,
    currentEvidence: evidence,
  });
  let output = "";
  const io = {
    cwd: root,
    stdout: (text: string) => {
      output += text;
    },
    stderr: (text: string) => {
      throw new Error(text);
    },
  };
  expect(await runKnowledgeQuery(["--json", "fixture"], io)).toBe(0);
  const plan = JSON.parse(output).quality.plan.planDigest;
  output = "";
  let release!: () => void, preparing!: () => void, verifying!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const preparationStarted = new Promise<void>((resolve) => {
    preparing = resolve;
  });
  const verificationStarted = new Promise<void>((resolve) => {
    verifying = resolve;
  });
  const originalPut = FileSystemCas.prototype.put;
  vi.spyOn(FileSystemCas.prototype, "put").mockImplementation(async function (
    this: FileSystemCas,
    content,
  ) {
    const body = JSON.parse(
      typeof content === "string" ? content : Buffer.from(content).toString("utf8"),
    );
    if (body.result?.requestId) {
      preparing();
      await gate;
    }
    if (body.observationDigest) verifying();
    return originalPut.call(this, content);
  });
  const pending = runKnowledgeQuery(
    ["--json", "--verify-artifact", "README.md", "--expected-plan", plan, "fixture"],
    io,
  );
  await Promise.all([preparationStarted, verificationStarted]);
  expect(output).toBe("");
  release();
  expect(await pending).toBe(2);
  const result = JSON.parse(output);
  expect(result.recording.status).toBe("recorded");
  expect(result.verificationRecording.status).toBe("recorded");
});
