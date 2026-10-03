import { execFileSync } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  inspectConfiguredDocumentNormalization,
  processKnowledgeConvergence,
} from "@lervo/repository-knowledge";
import { createConvergenceRuntimeHost } from "../src/host.js";
import { waitingConvergenceStage } from "../src/stage-receipt.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it.each([false, true])(
  "normalizes independent debt while retaining canonical rejection; legacy upgrade=%s",
  { timeout: 300_000 },
  async (legacy) => {
    const f = await fixture(true, true);
    fixtures.push(f);
    const script = await readFile(f.executable, "utf8");
    const marker =
      "if(request.task==='independent_canonical_review')response={assessmentHash:data.assessmentHash,decision:'approve'";
    expect(script).toContain(marker);
    await writeFile(f.executable, script.replace(marker, marker.replace("'approve'", "'reject'")));
    const ref = () =>
      execFileSync("git", ["-C", f.root, "rev-parse", "refs/heads/knowledge-integration"], {
        encoding: "utf8",
      }).trim();
    const beforeRef = ref();
    const target = resolve(f.root, "docs/specs/runtime.md");
    const before = await readFile(target, "utf8");
    const run = () =>
      runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: "rejection",
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        maximumStages: 1,
      });
    if (legacy) {
      const context = {
        storage: f.storage,
        provider: "claude" as const,
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        signal: new AbortController().signal,
        liveWorkPending: async () => false,
        assertSource: () => {},
      };
      const host = createConvergenceRuntimeHost(context);
      for (let i = 0; i < 8; i++) {
        const status = await processKnowledgeConvergence({
          events: f.events,
          artifacts: f.artifacts,
          workerId: "legacy",
          writableEventSchemaVersion: 4,
          maximumStages: 1,
          host: {
            ...host,
            runStage: async (stage, state, assertLease) => {
              const result = await host.runStage(stage, state, assertLease);
              if (stage !== "canonical_review" || !result.input.stageData.canonicalRejection)
                return result;
              const rejection = result.input.stageData.canonicalRejection as {
                artifactHash: string;
              };
              const retained = JSON.parse(
                Buffer.from(
                  await f.artifacts.get(`lervo-cas://sha256/${rejection.artifactHash.slice(7)}`),
                ).toString("utf8"),
              );
              return waitingConvergenceStage({
                artifacts: f.artifacts,
                state,
                kind: "attention_required",
                reason: "knowledge_semantic_review_rejected",
                dependency: {
                  kind: "canonical_rejection",
                  snapshotHash: state.snapshotHash,
                  assessmentHash: retained.assessmentHash,
                  result: retained.rejection.result,
                },
              });
            },
          },
        });
        if (status.reason === "knowledge_semantic_review_rejected") break;
      }
      expect(
        f.events
          .list({ limit: 1000 })
          .some(
            (e) =>
              e.type === "repository.knowledge.stage.recorded" &&
              e.payload.stage === "canonical_review" &&
              e.payload.state === "attention_required",
          ),
      ).toBe(true);
    }
    let result: Awaited<ReturnType<typeof run>> | undefined;
    for (let i = 0; i < 24; i++) {
      result = await run();
      if (
        result.status === "processed" &&
        result.convergence.reason === "knowledge_semantic_review_rejected"
      )
        break;
    }
    expect(result).toMatchObject({
      status: "processed",
      convergence: {
        state: "attention_required",
        reason: "knowledge_semantic_review_rejected",
        lastVerifiedCurrency: null,
      },
    });
    expect(
      (await inspectConfiguredDocumentNormalization({ repositoryRoot: f.root })).pendingDocuments,
    ).toEqual([]);
    expect(await readFile(target, "utf8")).toBe(before);
    expect(ref()).toBe(beforeRef);
    const events = f.events.list({ limit: 1000 });
    expect(
      events.some(
        (e) =>
          e.type === "knowledge.materialization.applied" && e.payload.operation === "canonicalize",
      ),
    ).toBe(false);
    expect(
      events.some(
        (e) =>
          e.type === "repository.knowledge.convergence.recorded" &&
          e.payload.terminalState === "current",
      ),
    ).toBe(false);
    const calls = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.filter((c) => c.request.task === "independent_canonical_review")).toHaveLength(1);
    expect(calls.some((c) => c.request.envelope)).toBe(true);
    const head = f.events.latest()!.eventHash;
    const logBeforeRestart = await readFile(f.log, "utf8");
    await run();
    expect(f.events.latest()!.eventHash).toBe(head);
    expect(await readFile(f.log, "utf8")).toBe(logBeforeRestart);
  },
);

it(
  "passes semantic rejection feedback to one bounded re-assessment",
  { timeout: 180_000 },
  async () => {
    const f = await fixture(true, false);
    fixtures.push(f);
    const policyPath = resolve(f.root, ".lervo/knowledge/policy.yaml");
    const policy = JSON.parse(await readFile(policyPath, "utf8"));
    policy.normalization.exclude.push("docs/specs/runtime.md");
    await writeFile(policyPath, JSON.stringify(policy));
    const readme = resolve(f.root, "README.md");
    await writeFile(readme, `${await readFile(readme, "utf8")}\nThe runtime starts locally.\n`);
    const script = await readFile(f.executable, "utf8");
    const marker =
      "if(request.task==='independent_canonical_review')response={assessmentHash:data.assessmentHash,decision:'approve'";
    expect(script).toContain(marker);
    await writeFile(f.executable, script.replace(marker, marker.replace("'approve'", "'reject'")));
    let result: Awaited<ReturnType<typeof runAutonomousKnowledgeWorker>> | undefined;
    for (let i = 0; i < 16; i++) {
      result = await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: "bounded-review-retry",
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        maximumStages: 1,
      });
      if (
        result.status === "processed" &&
        result.convergence.reason === "knowledge_semantic_review_rejected"
      )
        break;
    }
    expect(result).toMatchObject({
      status: "processed",
      convergence: { state: "attention_required", reason: "knowledge_semantic_review_rejected" },
    });
    const calls = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.filter((c) => c.request.task === "independent_canonical_review")).toHaveLength(2);
    expect(
      calls.filter(
        (c) =>
          c.request.task === "canonical_baseline_assessment" &&
          typeof c.request.untrustedSourceData.independentReviewFeedback === "string",
      ),
    ).toHaveLength(1);
  },
);
