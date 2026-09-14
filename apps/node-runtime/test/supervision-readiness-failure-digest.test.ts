import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import {
  openRepositorySupervisionLeases,
  SupervisionDecisionJournal,
} from "@lervo/agent-workforce";
import { operatingContractHash, workerReadinessKinds } from "@lervo/work-controller";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { supervisionJournalCoordinates } from "../src/supervision-authority.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { canonicalOwnerReasoningFacts } from "../src/supervision-reasoning-context.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("keeps the task source digest and pending decision stable across recorded readiness failures", async () => {
  const f = await dispatchFixture(roots);
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-readiness-digest-"));
  roots.push(directory);
  const tool = resolve(directory, "tool");
  const original = Object.values(f.runtimeReadiness.verificationTools)[0]![0]!.executable;
  await writeFile(tool, `#!/bin/sh\nexec "${original}" "$@"\n`, { mode: 0o000 });
  Object.values(f.runtimeReadiness.verificationTools)[0]![0]!.executable = tool;
  const runtime = await openNodeOutcomeSupervisionRuntime({
    repositoryRoot: f.root,
    binding: f.binding,
    ports: f.ports,
    runtimeReadiness: f.runtimeReadiness,
  });
  try {
    expect((await runtime.runCycle()).disposition).toBe("blocked");
  } finally {
    await runtime.close();
  }
  const storage = await openProjectStorage(f.root);
  const leases = await openRepositorySupervisionLeases(f.root);
  try {
    const now = () => new Date().toISOString();
    const tasks = new SupervisionTaskSource(storage, f.binding, now);
    const decisions = storage.events
      .list()
      .filter((event) => event.type === "work.supervision.decision.recorded");
    expect(decisions).toHaveLength(1);
    const decisionId = String(decisions[0]!.payload.decisionId);
    const before = await tasks.readSnapshot(decisionId);
    const lease = leases.acquire({
      supervisionId: f.binding.supervisionId,
      ownerAgentId: f.binding.ownerAgentId,
      nowMs: Date.now(),
      durationMs: 300_000,
    })!;
    const journal = new SupervisionDecisionJournal(
      storage.events,
      storage.artifacts,
      supervisionJournalCoordinates(storage, f.binding, before.workstreamRevision),
      now,
      { store: leases, lease },
    );
    expect(journal.findReadinessFailures(decisionId)).toHaveLength(1);
    const receipt = journal.findDecision(decisionId)!;
    expect(receipt.status).toBe("recorded");
    const observation = {
      schemaVersion: 1 as const,
      sourceRevisionDigest: before.sourceRevisionDigest,
      responsibilityArtifactHash: operatingContractHash(f.task),
      agentId: f.task.executorAgentId,
      roleId: f.task.roleId,
      roleVersion: f.task.roleVersion,
      roleContractHash: f.task.roleContractHash,
      observedAt: now(),
      validUntil: now(),
      checks: workerReadinessKinds.map((kind) => ({
        kind,
        status: kind === "provider" ? ("failed" as const) : ("passed" as const),
        evidenceHash: operatingContractHash(kind),
      })),
    };
    await journal.recordReadinessFailure(receipt, {
      responsibility: f.task,
      observation,
      reasonCodes: ["readiness_provider_failed"],
    });
    expect(journal.findReadinessFailures(decisionId)).toHaveLength(2);
    const after = await tasks.readSnapshot(decisionId);
    expect(after.sourceRevisionDigest).toBe(before.sourceRevisionDigest);
    expect(after.pendingDecision).toBe(true);
    expect(journal.findDecision(decisionId)!.status).toBe("recorded");
    const { facts } = await canonicalOwnerReasoningFacts(
      storage,
      f.binding,
      await tasks.read(),
      now,
    );
    expect(facts.recoveryObservations.readinessFailures).toHaveLength(2);
    expect(facts.recoveryObservations.readinessFailures[0]).toMatchObject({
      assignmentId: f.task.assignmentId,
      executorAgentId: f.task.executorAgentId,
      decisionId,
      reasonCode: "readiness_tools_failed",
    });
    expect(facts.recoveryObservations.leaseRenewals).toEqual([]);
    await chmod(tool, 0o700);
  } finally {
    leases.close();
    await storage.close();
  }
});
