import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import * as knowledge from "@lervo/repository-knowledge";
import { listAgents, listWorkspaceIntegrationAttempts } from "@lervo/agent-workforce";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { inspectAutonomousKnowledgeStatus } from "../src/status.js";
import { fixture } from "./fixture.js";
import { captureConvergenceSources } from "../src/source-capture.js";
import { hasCanonicalNormalizationLineage } from "../src/canonical-normalization-lineage.js";

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
    provider: "claude",
    workerId: "restart",
    executable: f.executable,
    admissionDirectory: f.admissionDirectory,
  });
}

it(
  "continues canonical integration through exact settled normalization and parks manual divergence",
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
    // ADR-0554: newer events of other types never hide a settled normalization.
    const head = f.events.latest()!;
    const noisy = {
      storage: {
        ...f.storage,
        events: {
          latest: () => ({ ...head, seq: head.seq + 20_000 }),
          list: (options: Parameters<typeof f.events.list>[0]) => {
            if (options?.types === undefined) throw new Error("The reader walked the history.");
            return f.events.list(options);
          },
        },
      },
    } as unknown as typeof context;
    expect(await hasCanonicalNormalizationLineage(noisy, state, path, target, source)).toBe(true);
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
    // ADR-0530: the manual divergence parks its source instead of holding the obligation.
    let stopped: Awaited<ReturnType<typeof run>>;
    for (let cycle = 0; cycle < 12; cycle++) {
      stopped = await run(f);
      if (stopped.status === "processed" && stopped.convergence.state === "attention_required")
        break;
    }
    expect(stopped!).toMatchObject({
      convergence: { state: "attention_required", reason: "knowledge_sources_parked" },
    });
    expect((await inspectAutonomousKnowledgeStatus(f.storage)).parked?.sources).toEqual([
      expect.objectContaining({ path: "src/runtime.ts", reason: "target_diverged" }),
    ]);
    expect(await readFile(resolve(f.root, path), "utf8")).toContain("Manual owner change.");
  },
);
