import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { operatingContractHash, planMandateInstallation } from "@lervo/work-controller";
import { afterEach, describe, expect, it } from "vitest";
import {
  SupervisionMandateJournal,
  SupervisionResponsibilityReader,
  SQLiteSupervisionOwnerLeaseStore,
} from "../src/index.js";
import { responsibility } from "../../work-controller/test/operating-supervision.fixture.js";
import { hash, mandate, now, plan as actionPlan } from "./supervision.fixture.js";

const roots: string[] = [];
const stores: (SQLiteEventStore | SQLiteSupervisionOwnerLeaseStore)[] = [];
async function fixture(writer: 1 | 2 | 3 = 3) {
  const root = await mkdtemp(resolve(tmpdir(), "mandate-journal-"));
  roots.push(root);
  const action = actionPlan();
  const events = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId: action.projectId,
    writableEventSchemaVersion: writer,
  });
  stores.push(events);
  events.append({
    eventId: action.causationEventIds[0]!,
    projectId: action.projectId,
    runId: "run_cause_fixture",
    sessionId: "ses_cause_fixture",
    type: "run.requested",
    schemaVersion: 1,
    occurredAt: now,
    policyVersion: hash(),
    actor: { kind: "user" },
    payload: {},
  });
  const artifacts = await FileSystemCas.open(resolve(root, "cas"));
  const leases = SQLiteSupervisionOwnerLeaseStore.open(resolve(root, "leases.sqlite"));
  stores.push(leases);
  const lease = leases.acquire({
    supervisionId: action.supervisionId,
    ownerAgentId: action.ownerAgentId,
    nowMs: Date.parse(now),
    durationMs: 300000,
  })!;
  const coordinates = {
    ...action,
    workstreamRevision: 1,
    sessionId: "ses_mandate_fixture",
    policyVersion: hash(),
  };
  const journal = new SupervisionMandateJournal(events, artifacts, coordinates, () => now, {
    store: leases,
    lease,
  });
  const plan = planMandateInstallation({
    supervisionId: action.supervisionId,
    mandate: mandate(),
    source: {
      projectId: action.projectId,
      teamId: action.teamId,
      workstreamId: action.workstreamId,
      workstreamRevision: 1,
      sourceRevisionDigest: hash(),
      causationEventIds: action.causationEventIds,
      ownerAgentId: action.ownerAgentId,
      eligible: true,
      reasonCodes: [],
    },
    previous: null,
    reviewerId: mandate().appointingAuthorityId,
    now,
  });
  return { root, events, artifacts, leases, lease, coordinates, journal, plan };
}
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("mandate journal evidence fencing", () => {
  it.each(["valid", "late_binding", "unknown_mandate", "stale_reader"])(
    "preserves responsibility bytes only through exact reviewed succession (%s)",
    async (change) => {
      const f = await fixture();
      const first = await f.journal.install(f.plan, f.plan.approvalHash, async () => undefined);
      const task = responsibility();
      const artifact = await f.artifacts.put(JSON.stringify(task));
      const bind = () =>
        f.events.append({
          eventId: `evt_${"b".repeat(32)}`,
          projectId: f.coordinates.projectId,
          runId: `run_${operatingContractHash({ supervisionId: f.coordinates.supervisionId }).slice(7, 39)}`,
          sessionId: f.coordinates.sessionId,
          schemaVersion: 3,
          type: "work.responsibility.bound",
          occurredAt: now,
          actor: { kind: "system" },
          policyVersion: hash(),
          payload: {
            ...f.coordinates,
            mandateHash: change === "unknown_mandate" ? hash("f") : first.mandateHash,
            assignmentId: task.assignmentId,
            assignmentRevision: task.assignmentRevision,
            executorAgentId: task.executorAgentId,
            reviewerAgentId: task.reviewerAgentId,
            roleId: task.roleId,
            roleVersion: task.roleVersion,
            roleContractHash: task.roleContractHash,
            responsibilityArtifactHash: artifact.contentHash,
            predecessorBindingHash: null,
          },
        }).event;
      if (change !== "late_binding") bind();
      const plan = planMandateInstallation({
        supervisionId: f.plan.supervisionId,
        mandate: { ...f.plan.mandate, version: 2 },
        source: f.plan.source,
        previous: first,
        reviewerId: f.plan.mandate.appointingAuthorityId,
        now,
      });
      const second = await f.journal.install(plan, plan.approvalHash, async () => undefined);
      if (change === "late_binding") bind();
      const head = f.events.latest()!.eventHash;
      const reader = new SupervisionResponsibilityReader(
        f.events,
        f.artifacts,
        {
          ...f.coordinates,
          mandateHash: change === "stale_reader" ? hash("e") : second.mandateHash,
        },
        () => now,
      );
      if (change === "valid") {
        expect(await reader.current(task.assignmentId)).toMatchObject({
          responsibility: task,
          responsibilityArtifactHash: artifact.contentHash,
        });
        expect(f.events.latest()!.eventHash).toBe(head);
        expect(await f.artifacts.get(artifact.uri)).toEqual(Buffer.from(JSON.stringify(task)));
      } else await expect(reader.current(task.assignmentId)).rejects.toThrow("mandate succession");
    },
  );

  it("prevents another connection from resetting workstream ancestry under a new supervision ID", async () => {
    const f = await fixture();
    const events = await SQLiteEventStore.open({
      path: resolve(f.root, "events.sqlite"),
      projectId: f.coordinates.projectId,
      writableEventSchemaVersion: 3,
    });
    stores.push(events);
    const supervisionId = "second-supervision";
    const lease = f.leases.acquire({
      supervisionId,
      ownerAgentId: f.coordinates.ownerAgentId,
      nowMs: Date.parse(now),
      durationMs: 300000,
    })!;
    const second = new SupervisionMandateJournal(
      events,
      f.artifacts,
      { ...f.coordinates, supervisionId },
      () => now,
      { store: f.leases, lease },
    );
    const plan = planMandateInstallation({
      supervisionId,
      mandate: f.plan.mandate,
      source: f.plan.source,
      previous: null,
      reviewerId: f.plan.mandate.appointingAuthorityId,
      now,
    });
    const results = await Promise.allSettled([
      f.journal.install(f.plan, f.plan.approvalHash, async () => undefined),
      second.install(plan, plan.approvalHash, async () => undefined),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { message: "The workstream already belongs to another supervision identity." },
    });
    const winner = results[0]!.status === "fulfilled" ? f.journal : second;
    const installed = (await winner.current())!;
    await winner.revoke({
      mandateHash: installed.mandateHash,
      installationEventId: installed.eventId,
      reviewerId: installed.mandate.appointingAuthorityId,
    });
    const loser = winner === f.journal ? second : f.journal;
    const losingPlan = winner === f.journal ? plan : f.plan;
    await expect(
      loser.install(losingPlan, losingPlan.approvalHash, async () => undefined),
    ).rejects.toThrow("another supervision identity");
    expect(events.verifyIntegrity().valid).toBe(true);
  });

  it("retains reviewed input bytes and verifies them through read-only recovery", async () => {
    const f = await fixture();
    const original = structuredClone(f.plan);
    const pending = f.journal.install(f.plan, f.plan.approvalHash, async () => undefined);
    f.plan.mandate.maximumWorkers = 100;
    const installed = await pending;
    expect(installed.mandate).toEqual(original.mandate);
    const reader = new SupervisionMandateJournal(
      f.events,
      f.artifacts,
      f.coordinates,
      () => now,
      null,
    );
    expect(await reader.current()).toEqual(installed);
    await expect(
      reader.revoke({
        mandateHash: installed.mandateHash,
        installationEventId: installed.eventId,
        reviewerId: installed.mandate.appointingAuthorityId,
      }),
    ).rejects.toThrow("read-only");
  });

  it("rejects lost ownership and failed fresh authority checks after CAS persistence", async () => {
    const f = await fixture();
    await expect(
      f.journal.install(f.plan, f.plan.approvalHash, async () => {
        throw new Error("source_changed");
      }),
    ).rejects.toThrow("source_changed");
    expect(await f.journal.current()).toBeNull();
    await expect(
      f.journal.install(f.plan, f.plan.approvalHash, async () => {
        f.leases.release(f.lease);
      }),
    ).rejects.toMatchObject({ code: "lease_lost" });
    expect(f.events.latest()!.seq).toBe(1);
  });

  it.each([1, 2] as const)("does not install through writer version %i", async (version) => {
    const f = await fixture(version);
    await expect(
      f.journal.install(f.plan, f.plan.approvalHash, async () => undefined),
    ).rejects.toMatchObject({ code: "event_schema_unsupported" });
    expect(await f.journal.current()).toBeNull();
  });

  it("serializes conflicting plans even when callers incorrectly share one lease", async () => {
    const f = await fixture();
    const second = planMandateInstallation({
      supervisionId: f.plan.supervisionId,
      mandate: { ...f.plan.mandate, maximumWorkers: 5 },
      source: f.plan.source,
      previous: null,
      reviewerId: f.plan.mandate.appointingAuthorityId,
      now,
    });
    const results = await Promise.allSettled([
      f.journal.install(f.plan, f.plan.approvalHash, async () => undefined),
      f.journal.install(second, second.approvalHash, async () => undefined),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(f.events.latest()!.seq).toBe(2);
    expect(f.events.verifyIntegrity().valid).toBe(true);
  });
});
