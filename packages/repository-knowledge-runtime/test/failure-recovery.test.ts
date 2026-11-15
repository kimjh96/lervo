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
} from "@lervo/repository-knowledge";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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
