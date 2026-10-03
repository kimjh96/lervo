import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as knowledge from "@lervo/repository-knowledge";
import {
  listAgents,
  listAssignments,
  listWorkspaces,
  listWorkspaceIntegrationAttempts,
} from "@lervo/agent-workforce";
import { planWorkspaceCleanup } from "@lervo/orchestrator";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import * as workspace from "../src/canonical-workspace.js";
import { KnowledgeConvergenceRuntimeError } from "../src/failure.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";
import { captureConvergenceSources } from "../src/source-capture.js";
import { hasCanonicalNormalizationLineage } from "../src/canonical-normalization-lineage.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});
function run(f: Awaited<ReturnType<typeof fixture>>) {
  return runAutonomousKnowledgeWorker({
    storage: f.storage,
    provider: "claude",
    workerId: "restart",
    executable: f.executable,
    admissionDirectory: f.admissionDirectory,
  });
}

it(
  "continues canonical integration through exact settled normalization and refuses manual divergence",
  { timeout: 300_000 },
  async () => {
    const f = await fixture(true, true, true);
    fixtures.push(f);
    await writeFile(
      resolve(f.root, "src/runtime.ts"),
      "export const maximumBackgroundCalls = 2; // observed runtime limit\n",
    );
    await writeFile(
      f.executable,
      (await readFile(f.executable, "utf8")).replace(
        "content:document.untrustedSourceData,",
        "content:document.untrustedSourceData.replace('# Runtime\\n', '# Runtime requirements\\n'),",
      ),
    );
    const converge = async () => {
      let result;
      for (let i = 0; i < 8; i++) {
        result = await run(f);
        if (
          result.status === "processed" &&
          result.convergence.state === "idle" &&
          result.convergence.lastVerifiedCurrency
        )
          return result;
      }
      const latest = f.events
        .list({ limit: 1000 })
        .findLast(
          (event) =>
            event.type === "repository.knowledge.stage.recorded" && event.payload.dependencyHash,
        );
      const dependency = latest?.payload.dependencyHash;
      const evidence =
        typeof dependency === "string"
          ? new TextDecoder().decode(
              await f.artifacts.get(`lervo-cas://sha256/${dependency.slice(7)}`),
            )
          : null;
      const failureHash = evidence ? JSON.parse(evidence).evidenceHash : null;
      const failure = failureHash
        ? JSON.parse(
            new TextDecoder().decode(
              await f.artifacts.get(`lervo-cas://sha256/${failureHash.slice(7)}`),
            ),
          )
        : null;
      throw new Error(JSON.stringify({ result, evidence, message: failure?.message }));
    };
    await converge();
    const canonical = execFileSync("git", [
      "-C",
      f.root,
      "show",
      "knowledge-integration:docs/specs/runtime.md",
    ]);
    expect(knowledge.sha256(await readFile(resolve(f.root, "docs/specs/runtime.md")))).not.toBe(
      knowledge.sha256(canonical),
    );
    const agents = (await listAgents(f.root)).map((item) => item.agentId).sort();
    await mkdir(resolve(f.root, "new-source"));
    await writeFile(
      resolve(f.root, "new-source/observation.ts"),
      "export const observed = true;\n",
    );
    await writeFile(
      resolve(f.root, "src/runtime.ts"),
      "export const maximumBackgroundCalls = 3;\n",
    );
    await converge();
    const continuingAgents = new Set((await listAgents(f.root)).map((item) => item.agentId));
    expect(agents.every((agentId) => continuingAgents.has(agentId))).toBe(true);
    expect(
      (await listWorkspaceIntegrationAttempts(f.root)).map((item) => item.targetGeneration).sort(),
    ).toEqual([1, 2]);
    expect(await readFile(resolve(f.root, "docs/specs/runtime.md"), "utf8")).toContain(
      "limited to three",
    );
    expect(
      f.events
        .list({ limit: 1000 })
        .filter(
          (event) =>
            event.type === "knowledge.materialization.applied" &&
            event.payload.operation === "canonicalize",
        ),
    ).toHaveLength(2);
    const stage = f.events
      .list({ limit: 1000 })
      .findLast(
        (event) =>
          event.type === "repository.knowledge.stage.recorded" &&
          event.payload.stage === "normalization_apply" &&
          event.payload.state === "current",
      )!;
    const state = JSON.parse(
      new TextDecoder().decode(
        await f.artifacts.get(
          `lervo-cas://sha256/${(stage.payload.resultArtifactHash as string).slice(7)}`,
        ),
      ),
    ) as knowledge.KnowledgeConvergenceInput;
    const target = knowledge.sha256(
      execFileSync("git", ["-C", f.root, "show", "knowledge-integration:docs/specs/runtime.md"]),
    );
    const path = "docs/specs/runtime.md";
    const source = knowledge.sha256(await readFile(resolve(f.root, path)));
    const context = { storage: f.storage } as Parameters<
      typeof hasCanonicalNormalizationLineage
    >[0];
    expect(await hasCanonicalNormalizationLineage(context, state, path, target, source)).toBe(true);
    await writeFile(
      resolve(f.root, path),
      (await readFile(resolve(f.root, path), "utf8")) + "\nManual owner change.\n",
    );
    const capture = captureConvergenceSources(f.root, state.baseline.policyHash);
    const modified = {
      ...state,
      snapshotHash: capture.snapshotHash,
      stageData: { ...state.stageData, sourceCapture: capture },
    };
    expect(
      await hasCanonicalNormalizationLineage(
        context,
        modified,
        path,
        target,
        knowledge.sha256(await readFile(resolve(f.root, path))),
      ),
    ).toBe(false);
    await writeFile(
      resolve(f.root, "src/runtime.ts"),
      "export const maximumBackgroundCalls = 4;\n",
    );
    const stopped = await run(f);
    expect(stopped).toMatchObject({
      convergence: { state: "waiting_authority", reason: "canonical_target_diverged" },
    });
    expect(await readFile(resolve(f.root, path), "utf8")).toContain("Manual owner change.");
  },
);

it(
  "reuses durable provision and seal plans without a second workspace or commit",
  { timeout: 180_000 },
  async () => {
    const f = await fixture(true, true);
    fixtures.push(f);
    await writeFile(
      resolve(f.root, "src/runtime.ts"),
      "export const maximumBackgroundCalls = 3;\n",
    );
    const seal = workspace.sealCanonicalDrafts;
    vi.spyOn(workspace, "sealCanonicalDrafts").mockImplementation(async (...args) => {
      const first = await seal(...args);
      expect(await seal(...args)).toEqual(first);
      return first;
    });
    let result;
    for (let i = 0; i < 6; i++) {
      result = await run(f);
      if (result.status === "processed" && result.convergence.lastVerifiedCurrency) break;
    }
    expect(result).toMatchObject({
      convergence: { state: "idle", lastVerifiedCurrency: expect.any(Object) },
    });
    const workspaces = await listWorkspaces(f.root);
    expect(workspaces).toHaveLength(2);
    expect(
      workspaces.find((item) => item.executionKind === "worker")!.sealedResult!.commitIds,
    ).toHaveLength(1);
    expect(
      workspaces.every((item) => item.state === "integrated" && item.writerSession === null),
    ).toBe(true);
    const calls = (await readFile(f.log, "utf8")).trim().split("\n").length;
    await run(f);
    const remaining = (await listWorkspaces(f.root)).filter((item) => item.state !== "removed");
    const blocked = await Promise.all(
      remaining.map((item) =>
        planWorkspaceCleanup({
          coordinates: {
            repositoryRoot: f.root,
            workspacePath: item.ownerWorkspacePath!,
            integrationTargetRef: "refs/heads/knowledge-integration",
          },
          workspaceId: item.workspaceId,
          host: new GitWorkspaceHostAdapter(),
        }),
      ),
    );
    expect(remaining, JSON.stringify(blocked.map((item) => item.blockedReasons))).toHaveLength(0);
    expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(calls);
  },
);

it(
  "resumes a verified ref integration before root apply under a new exact lease",
  { timeout: 180_000 },
  async () => {
    const f = await fixture(true, true);
    fixtures.push(f);
    await writeFile(
      resolve(f.root, "src/runtime.ts"),
      "export const maximumBackgroundCalls = 3;\n",
    );
    const apply = knowledge.applyDurableKnowledgeOperations;
    let interrupted = false;
    vi.spyOn(knowledge, "applyDurableKnowledgeOperations").mockImplementation(async (input) => {
      if (
        !interrupted &&
        input.operations.some(
          (item) =>
            "content" in item && item.content?.includes("Background model calls are limited"),
        )
      ) {
        interrupted = true;
        throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
      }
      return apply(input);
    });
    expect(await run(f)).toMatchObject({
      convergence: { state: "recovery_required", reason: "knowledge_effect_uncertain" },
    });
    expect(interrupted).toBe(true);
    expect(await readFile(resolve(f.root, "docs/specs/runtime.md"), "utf8")).not.toContain(
      "limited to two",
    );
    const ref = execFileSync("git", ["-C", f.root, "rev-parse", "knowledge-integration"], {
      encoding: "utf8",
    }).trim();
    const failed = (await listAssignments(f.root)).find(
      (item) => item.taskType === "repository.integration",
    )!;
    expect(failed).toMatchObject({ status: "failed", lease: null, lastLeaseGeneration: 1 });
    const calls = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .filter((line) => JSON.parse(line).request.task?.includes("canonical")).length;
    let result;
    for (let i = 0; i < 6; i++) {
      result = await run(f);
      if (result.status === "processed" && result.convergence.lastVerifiedCurrency) break;
    }
    expect(result).toMatchObject({
      convergence: { state: "idle", outstanding: 0, lastVerifiedCurrency: expect.any(Object) },
    });
    expect(
      execFileSync("git", ["-C", f.root, "rev-parse", "knowledge-integration"], {
        encoding: "utf8",
      }).trim(),
    ).toBe(ref);
    expect(
      (await readFile(f.log, "utf8"))
        .trim()
        .split("\n")
        .filter((line) => JSON.parse(line).request.task?.includes("canonical")),
    ).toHaveLength(calls);
    expect(
      (await listAssignments(f.root)).find((item) => item.assignmentId === failed.assignmentId),
    ).toMatchObject({
      status: "completed",
      lease: null,
      lastLeaseGeneration: 2,
      recovery: { attemptNumber: 2 },
    });
    expect(
      f.events
        .list({ limit: 1000 })
        .filter(
          (event) =>
            event.type === "knowledge.materialization.applied" &&
            event.payload.operation === "canonicalize",
        ),
    ).toHaveLength(1);
  },
);
