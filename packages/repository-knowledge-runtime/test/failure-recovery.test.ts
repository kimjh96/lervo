import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  applyDurableKnowledgeOperations,
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
      convergence: { state: "recovery_required", reason: "knowledge_recovery_required" },
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
    for (let cycle = 0; cycle < 5; cycle++) {
      result = await run(f);
      if (result.status === "processed" && result.convergence.state === "attention_required") break;
    }
    expect(result!).toMatchObject({
      convergence: { state: "attention_required", reason: "knowledge_semantic_review_rejected" },
    });
    expect(
      (await inspectConfiguredDocumentNormalization({ repositoryRoot: f.root })).pendingDocuments,
    ).toEqual(["docs/specs/a.md"]);
    expect(await readFile(resolve(f.root, "docs/specs/a.md"), "utf8")).toContain(
      "Retain this exact first family.",
    );
    const calls = (await readFile(f.log, "utf8")).trim().split("\n");
    await run(f);
    expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(calls.length);
  },
);
