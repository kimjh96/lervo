// End to end, with the real workforce: a convergence writer's claim is refused by another
// agent's live write lease, the owner settles that refusal into its failure record, and the
// runtime host decides from that record whether the stage still waits (Lervo ADE coordination,
// "Conflicts").
import { rm } from "node:fs/promises";

import { afterEach, expect, it } from "vitest";

import {
  cancelAssignment,
  claimAssignment,
  createAssignment,
  createAssignmentCancellationPlan,
  listAssignments,
  registerAgent,
} from "@lervo/agent-workforce";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

import { createConvergenceRuntimeHost } from "../src/host.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it(
  "holds a refused stage only while a holder overlaps its paths, and keeps an older record's broad hold",
  { timeout: 300_000 },
  async () => {
    const f = await fixture(true);
    cleanups.push(async () => {
      await f.storage.close();
      await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    const team = await registerAgent({
      repositoryRoot: f.root,
      roleId: "developer",
      responsibilityPaths: ["*"],
      origin: "team",
    });
    /** Another agent's live write lease on `paths`, as a conversation's or a worker's would be. */
    const lease = async (paths: string[]) => {
      const created = await createAssignment({
        repositoryRoot: f.root,
        taskType: "implementation",
        roleId: "developer",
        acceptanceCriteria: ["The change passes."],
        verificationSuiteIds: ["project.quick"],
        expectedPaths: paths,
      });
      return claimAssignment({
        repositoryRoot: f.root,
        assignmentId: created.assignmentId,
        agentId: team.agentId,
        sessionId: `ses_${sha256(created.assignmentId).slice(7, 31)}`,
        leaseDurationMs: 30 * 60_000,
      });
    };
    // Live work defers the provider stages, so the lease starts once the normalization writer is
    // queued; this fixture's canonical integration claims nothing.
    const stageRecords = () =>
      f.events.list({ limit: 1_000, types: ["repository.knowledge.stage.recorded"] });
    const refused = () =>
      stageRecords().find(
        (event) =>
          event.payload.state === "waiting_authority" &&
          event.payload.failureCode === "assignment_path_conflict",
      );
    let everything: Awaited<ReturnType<typeof lease>> | null = null;
    for (let cycle = 0; cycle < 30 && refused() === undefined; cycle++) {
      const latest = stageRecords().at(-1)?.payload;
      if (
        everything === null &&
        latest?.state === "queued" &&
        latest.stage === "normalization_apply"
      )
        everything = await lease(["*"]);
      await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `hold-${cycle}`,
        provider: "claude",
        executable: f.executable,
        maximumStages: 1,
        admissionDirectory: f.admissionDirectory,
      });
    }
    const settled = refused();
    expect(
      settled,
      JSON.stringify(
        stageRecords().map((event) => [
          event.payload.stage,
          event.payload.state,
          event.payload.failureCode,
        ]),
      ),
    ).toBeDefined();
    const dependencyHash = settled!.payload.dependencyHash as string;
    const record = JSON.parse(
      new TextDecoder().decode(
        await f.artifacts.get(`lervo-cas://sha256/${dependencyHash.slice(7)}`),
      ),
    ) as Record<string, unknown>;
    expect(record).toMatchObject({
      kind: "stage_failure",
      code: "assignment_path_conflict",
      obligationId: settled!.payload.obligationId,
      stage: settled!.payload.stage,
    });
    const stage = (await listAssignments(f.root)).find(
      (item) =>
        item.convergence?.obligationId === record.obligationId &&
        item.convergence?.stage === record.stage,
    )!;
    expect(stage).toMatchObject({ status: "queued", accessMode: "write" });

    const host = createConvergenceRuntimeHost({
      storage: f.storage,
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      signal: new AbortController().signal,
      liveWorkPending: async () => false,
      assertSourceExact: () => {},
      assertSourceCurrent: () => {},
    });
    // The overlapping holder still holds the stage.
    expect(await host.dependencyCurrent(dependencyHash)).toBe(true);

    // The overlapping lease ends; an unrelated live write lease no longer holds the stage.
    const plan = createAssignmentCancellationPlan({
      assignments: await listAssignments(f.root),
      assignmentId: everything!.assignmentId,
      reason: "requested",
      holder: { agentId: team.agentId, leaseId: everything!.lease!.leaseId },
    });
    await cancelAssignment({
      repositoryRoot: f.root,
      assignmentId: everything!.assignmentId,
      reason: "requested",
      expectedPlanId: plan.planId,
      holder: { agentId: team.agentId, leaseId: everything!.lease!.leaseId },
    });
    const unrelated = "unrelated/elsewhere.ts";
    expect(stage.expectedPaths.some((path) => unrelated.startsWith(path))).toBe(false);
    await lease([unrelated]);
    expect(await host.dependencyCurrent(dependencyHash)).toBe(false);
    // A record settled before stages named themselves keeps the broad hold: any live write lease.
    const { obligationId: _obligation, stage: _stage, ...older } = record;
    const olderHash = (await f.artifacts.put(canonicalJson(older))).contentHash;
    expect(await host.dependencyCurrent(olderHash)).toBe(true);

    // A lease that overlaps the stage's paths holds it again.
    await lease([stage.expectedPaths[0]!]);
    expect(await host.dependencyCurrent(dependencyHash)).toBe(true);
  },
);
