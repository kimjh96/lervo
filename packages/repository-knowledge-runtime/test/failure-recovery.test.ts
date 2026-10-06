import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  applyDurableKnowledgeOperations,
  canonicalJson,
  recoverKnowledgeMaterialization,
  sha256,
  assessCanonicalization,
  listCanonicalizationCandidates,
  inspectConfiguredDocumentNormalization,
} from "@lervo/repository-knowledge";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});
function run(f: Awaited<ReturnType<typeof fixture>>) {
  return runAutonomousKnowledgeWorker({
    storage: f.storage,
    workerId: "recovery",
    provider: "claude",
    executable: f.executable,
    admissionDirectory: f.admissionDirectory,
  });
}

it(
  "retries an invalid canonical assessment without accepting its source hash",
  { timeout: 90_000 },
  async () => {
    const f = await fixture(true, false, false, 1);
    fixtures.push(f);
    let result: Awaited<ReturnType<typeof run>>;
    for (let cycle = 0; cycle < 8; cycle++) {
      result = await run(f);
      if (result.status === "busy") continue;
      if (result.convergence.lastVerifiedCurrency) break;
    }
    const calls = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { request: { task: string } });
    expect(
      calls.filter((call) => call.request.task === "canonical_baseline_assessment"),
    ).toHaveLength(2);
    expect(result!.status).toBe("processed");
    if (result!.status !== "processed") throw new Error("Convergence remained busy.");
    expect(result!.convergence).toMatchObject({ state: "idle", lastVerifiedCurrency: {} });
    expect(
      f.events
        .list({ afterSeq: 0, limit: 1_000 })
        .some(
          (event) =>
            event.type === "repository.knowledge.stage.recorded" &&
            event.payload.stage === "assessment" &&
            event.payload.state === "current",
        ),
    ).toBe(true);
  },
);

it("keeps repeated invalid canonical assessments in attention", { timeout: 60_000 }, async () => {
  const f = await fixture(true, false, false, 2);
  fixtures.push(f);
  let result: Awaited<ReturnType<typeof run>>;
  for (let cycle = 0; cycle < 4; cycle++) {
    result = await run(f);
    if (result.status === "busy") continue;
    if (result.convergence.state === "attention_required") break;
  }
  expect(result!.status).toBe("processed");
  if (result!.status !== "processed") throw new Error("Convergence remained busy.");
  expect(result!.convergence).toMatchObject({
    state: "attention_required",
    reason: "knowledge_semantic_review_invalid",
  });
  const calls = (await readFile(f.log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { request: { task: string } });
  expect(
    calls.filter((call) => call.request.task === "canonical_baseline_assessment"),
  ).toHaveLength(2);
  const assessmentStages = f.events
    .list({ afterSeq: 0, limit: 1_000 })
    .filter(
      (event) =>
        event.type === "repository.knowledge.stage.recorded" &&
        event.payload.stage === "assessment",
    );
  expect(assessmentStages.at(-1)).toMatchObject({
    type: "repository.knowledge.stage.recorded",
    payload: { stage: "assessment", state: "attention_required" },
  });
});

it(
  "retains an interrupted journal as owned recovery and resumes only after verified rollback",
  { timeout: 60_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    const content = '{"fixture":"interrupted"}\n';
    await expect(
      applyDurableKnowledgeOperations({
        repositoryRoot: f.root,
        projectId: f.storage.manifest.projectId,
        planId: "kstruct_0123456789abcdef01234567",
        operations: [
          {
            path: ".lervo/knowledge/interrupted.json",
            ownership: "user",
            mediaType: "application/json",
            action: "create",
            content,
            desiredHash: sha256(content),
          },
        ],
        receipt: {},
        recordApplied: () => {},
        failureInjector: (phase) => (phase === "published:0" ? "interrupt" : undefined),
      }),
    ).rejects.toThrow();
    expect(await run(f)).toMatchObject({
      convergence: {
        state: "recovery_required",
        reason: "knowledge_recovery_required",
        recoveryCommand: "lervo knowledge materialize --recover",
      },
    });
    await expect(readFile(f.log)).rejects.toMatchObject({ code: "ENOENT" });
    const head = f.events.latest()?.eventHash ?? null;
    await run(f);
    expect(f.events.latest()?.eventHash ?? null).toBe(head);
    expect(
      await recoverKnowledgeMaterialization({ repositoryRoot: f.root, eventRecorded: () => false }),
    ).toMatchObject({ disposition: "rolled_back" });
    let result: Awaited<ReturnType<typeof run>>;
    for (let cycle = 0; cycle < 5; cycle++) {
      result = await run(f);
      if (result.status === "processed" && result.convergence.lastVerifiedCurrency) break;
    }
    expect(result!).toMatchObject({
      convergence: { state: "idle", lastVerifiedCurrency: expect.any(Object) },
    });
  },
);

it(
  "yields to a materialization journal that a live process still owns",
  { timeout: 60_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    const content = '{"fixture":"concurrent"}\n';
    await expect(
      applyDurableKnowledgeOperations({
        repositoryRoot: f.root,
        projectId: f.storage.manifest.projectId,
        planId: "kstruct_fedcba9876543210fedcba98",
        operations: [
          {
            path: ".lervo/knowledge/concurrent.json",
            ownership: "user",
            mediaType: "application/json",
            action: "create",
            content,
            desiredHash: sha256(content),
          },
        ],
        receipt: {},
        recordApplied: () => {},
        failureInjector: (phase) => (phase === "published:0" ? "interrupt" : undefined),
      }),
    ).rejects.toThrow();
    // Rebind the journal to another running process, as a terminal compile would own it.
    const owner = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"]);
    try {
      const journalPath = resolve(
        f.root,
        ".lervo/state/knowledge/materialization-transaction/journal.json",
      );
      const journal = JSON.parse(await readFile(journalPath, "utf8")) as { ownerPid: number };
      await writeFile(journalPath, `${canonicalJson({ ...journal, ownerPid: owner.pid })}\n`);
      const before = f.events.latest()?.eventHash ?? null;
      expect(await run(f)).toEqual({ status: "busy" });
      expect(f.events.latest()?.eventHash ?? null).toBe(before);
    } finally {
      owner.kill("SIGKILL");
      await once(owner, "exit");
    }
    // Once the owner is gone the journal is interrupted and needs the explicit owner command.
    expect(await run(f)).toMatchObject({
      convergence: {
        state: "recovery_required",
        recoveryCommand: "lervo knowledge materialize --recover",
      },
    });
  },
);

it(
  "independently closes an old exact candidate and records no duplicate transition after restart",
  { timeout: 60_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    await writeFile(resolve(f.root, "src.ts"), "export const localRuntime = true;\n");
    const assessment = await assessCanonicalization({
      repositoryRoot: f.root,
      beforeRevision: sha256("before"),
      afterRevision: sha256("after"),
      beforeFiles: {},
      afterFiles: { "src.ts": sha256("export const localRuntime = true;\n") },
      disposition: "canonical_sources_current",
      now: new Date(),
    });
    expect(assessment.candidate).not.toBeNull();
    let result: Awaited<ReturnType<typeof run>>;
    for (let cycle = 0; cycle < 5; cycle++) {
      result = await run(f);
      if (result.status === "processed" && result.convergence.lastVerifiedCurrency) break;
    }
    expect(result!).toMatchObject({
      convergence: { state: "idle", debtCounts: { canonicalization: 0 } },
    });
    expect(await listCanonicalizationCandidates(f.root)).toMatchObject([{ state: "rejected" }]);
    const calls = (await readFile(f.log, "utf8")).trim().split("\n");
    expect(
      calls.filter((line) => JSON.parse(line).request.task === "canonical_candidate_resolution"),
    ).toHaveLength(1);
    await run(f);
    expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(calls.length);
  },
);

it(
  "reviews old candidates with separate source-specific contexts",
  { timeout: 90_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    for (const [index, path] of ["first.ts", "second.ts"].entries()) {
      const content = `export const candidate${index} = true;\n`;
      await writeFile(resolve(f.root, path), content);
      await assessCanonicalization({
        repositoryRoot: f.root,
        beforeRevision: sha256(`before-${index}`),
        afterRevision: sha256(`after-${index}`),
        beforeFiles: {},
        afterFiles: { [path]: sha256(content) },
        disposition: "canonical_sources_current",
        now: new Date(),
      });
    }
    expect(await listCanonicalizationCandidates(f.root)).toHaveLength(2);
    let result: Awaited<ReturnType<typeof run>>;
    for (let cycle = 0; cycle < 12; cycle++) {
      result = await run(f);
      if (result.status === "processed" && result.convergence.lastVerifiedCurrency) break;
    }
    expect(result!).toMatchObject({
      convergence: { state: "idle", debtCounts: { canonicalization: 0 } },
    });
    const calls = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            request: { task: string; untrustedSourceData?: { candidates?: unknown[] } };
          },
      )
      .filter((call) => call.request.task === "canonical_candidate_resolution");
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.request.untrustedSourceData?.candidates)).toEqual([
      [expect.objectContaining({ candidateId: expect.any(String) })],
      [expect.objectContaining({ candidateId: expect.any(String) })],
    ]);
  },
);

it(
  "isolates a rejected leading family while applying another exact accepted family",
  { timeout: 60_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    await writeFile(
      resolve(f.root, "docs/specs/a.md"),
      "# Leading family\n\nRetain this exact first family.\n",
    );
    const script = await readFile(f.executable, "utf8");
    await writeFile(
      f.executable,
      script.replace(
        "console.log(JSON.stringify({is_error:false",
        "if(request.task==='independent_normalization_review'){const decision=response.decisions.find(item=>data.candidate.items.find(source=>source.operationId===item.operationId)?.sourcePath==='docs/specs/a.md');if(decision){decision.decision='reject';decision.checks.meaning=false;}}\nconsole.log(JSON.stringify({is_error:false",
      ),
    );
    let result: Awaited<ReturnType<typeof run>>;
    for (let cycle = 0; cycle < 8; cycle++) {
      result = await run(f);
      if (result.status === "processed" && result.convergence.state === "attention_required") break;
    }
    // ADR-0479: bounded regeneration, then only the rejected family is parked at the very end.
    expect(result!).toMatchObject({
      convergence: { state: "attention_required", reason: "knowledge_sources_parked" },
    });
    expect(
      (await inspectConfiguredDocumentNormalization({ repositoryRoot: f.root })).pendingDocuments,
    ).toEqual(["docs/specs/a.md"]);
    const reviews = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).request)
      .filter((request) => request.task === "independent_normalization_review")
      .filter((request) =>
        request.untrustedSourceData.candidate.items.some(
          (item: { sourcePath: string }) => item.sourcePath === "docs/specs/a.md",
        ),
      );
    expect(reviews).toHaveLength(3);
    expect(await readFile(resolve(f.root, "docs/specs/a.md"), "utf8")).toContain(
      "Retain this exact first family.",
    );
    const calls = (await readFile(f.log, "utf8")).trim().split("\n");
    await run(f);
    expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(calls.length);
  },
);

it(
  "retries an invalid independent review within the batch budget before applying source bytes",
  { timeout: 60_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    const script = await readFile(f.executable, "utf8");
    await writeFile(
      f.executable,
      script
        .replace("import {appendFileSync}", "import {appendFileSync,readFileSync}")
        .replace(
          "console.log(JSON.stringify({is_error:false",
          `if(request.task==='independent_normalization_review'&&readFileSync(${JSON.stringify(f.log)},'utf8').split('\\n').filter(line=>line.includes('independent_normalization_review')).length===1){response.decisions[0].unitReviews[0].outputHashes.push('sha256:${"0".repeat(64)}');}\nconsole.log(JSON.stringify({is_error:false`,
        ),
    );
    let result: Awaited<ReturnType<typeof run>>;
    for (let cycle = 0; cycle < 8; cycle++) {
      result = await run(f);
      if (result.status === "processed" && result.convergence.lastVerifiedCurrency) break;
    }
    expect(result!).toMatchObject({
      convergence: { state: "idle", lastVerifiedCurrency: expect.any(Object) },
    });
    const calls = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).request);
    expect(
      calls.filter((request) => request.task === "independent_normalization_review"),
    ).toHaveLength(2);
    expect(await readFile(resolve(f.root, "docs/specs/runtime.md"), "utf8")).toContain(
      "locally without a Hub",
    );
  },
);
