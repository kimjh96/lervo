import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  openRepositorySupervisionLeases,
  readWorkspace,
  SupervisionDecisionJournal,
} from "@lervo/agent-workforce";
import {
  managedExecutionIdentity,
  operatingContractHash,
  operatingDecisionId,
  supervisedManagedExecutionFields,
} from "@lervo/work-controller";
import type {
  OperatingActionPlanV1,
  SupervisedManagedExecutionV1,
} from "@lervo/application-contract";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { SupervisionManagedEffects } from "../src/supervision-managed-effects.js";
import { admitSupervisedManagedInvocation } from "../src/supervision-managed-admission.js";
import {
  observeNodeSupervisionAuthority,
  supervisionJournalCoordinates,
} from "../src/supervision-authority.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { observeSupervisionTaskResources } from "../src/supervision-task-resources.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";
import { recordPreparedWorkspaceFixture } from "./supervision-prepared-workspace.fixture.js";
import { observeUnstartedSupervisionWorkspace } from "../src/supervision-unstarted-workspace.js";
import { currentSupervisionWorkspaces } from "../src/supervision-workspace-generations.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(
  [
    "absent",
    "reserved",
    "partial",
    "reserved_requested",
    "bad_reservation",
    "fence_lost",
    "reserved_fence_lost",
  ].flatMap((change) => [false, true].map((sharedReader) => ({ change, sharedReader }))),
)(
  "recovers exact fenced absence ($change, shared reader: $sharedReader)",
  async ({ change, sharedReader }) => {
    const recoverable = change === "absent" || change === "reserved";
    const fenceLost = change.endsWith("fence_lost");
    const partial = ["partial", "reserved_requested", "bad_reservation"].includes(change);
    const f = await dispatchFixture(roots, true, undefined, "developer", [
      "dispatch",
      "execute_as_owner",
    ]);
    await recordPreparedWorkspaceFixture(f);
    const storage = await openProjectStorage(f.root);
    const effect: SupervisedManagedExecutionV1 = {
      schemaVersion: 1,
      kind: "work.managed_execution",
      responsibility: f.task,
      leaseId: f.assignment.lease!.leaseId,
      provider: "codex",
      instructions: "Read src/save.ts and verify its saved value.",
      risk: "low",
      reservedTokens: 100,
    };
    await storage.artifacts.put(canonicalJson(effect));
    const propose = f.ports.propose;
    let plan: OperatingActionPlanV1 | null = null;
    f.ports.propose = async (report) =>
      (plan = { ...(await propose(report))!, ...supervisedManagedExecutionFields(effect) });
    const admission = f.ports.readAdmission;
    f.ports.readAdmission = async (action) => ({
      ...(await admission(action)),
      effectMappings: [{ actionKind: "dispatch", contract: "work.managed_execution.v1" }],
    });
    const readiness = f.ports.readWorkerReadiness;
    f.ports.readWorkerReadiness = async (action) => {
      const result = await readiness(action);
      result.observation.checks.find((c) => c.kind === "knowledge")!.status = "unobserved";
      return result;
    };
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
    expect(plan).not.toBeNull();
    const action = plan! as OperatingActionPlanV1;
    const now = () => new Date(Date.parse(action.deadline) + 1).toISOString();
    const leases = await openRepositorySupervisionLeases(f.root);
    const lease = leases.acquire({
      supervisionId: f.binding.supervisionId,
      ownerAgentId: f.binding.ownerAgentId,
      nowMs: Date.parse(now()),
      durationMs: 300000,
    })!;
    const adapter = new SupervisionManagedEffects(
      f.root,
      { nodeExecutable: process.execPath, cliBundle: process.execPath },
      f.runtimeReadiness,
      now,
    );
    try {
      if (change.startsWith("reserved") || change === "bad_reservation") {
        const identity = managedExecutionIdentity(action.projectId, operatingContractHash(action));
        storage.events.append({
          eventId: `evt_${operatingContractHash({ kind: "managed.execution.reserved", ...identity }).slice(7, 39)}`,
          projectId: action.projectId,
          ...identity,
          ...(change === "bad_reservation" ? { sessionId: "ses_wrong_reservation" } : {}),
          schemaVersion: 3,
          type: "managed.execution.reserved",
          occurredAt: now(),
          actor: { kind: "system" },
          policyVersion: action.mandateHash,
          payload: {
            executionKey: operatingContractHash(action),
            requestHash: operatingContractHash("request"),
          },
        });
      }
      if (change === "partial" || change === "reserved_requested")
        storage.events.append({
          eventId: "evt_partial_managed",
          projectId: storage.manifest.projectId,
          runId: managedExecutionIdentity(action.projectId, operatingContractHash(action)).runId,
          sessionId: "ses_partial_managed",
          schemaVersion: 1,
          type: "run.requested",
          occurredAt: now(),
          actor: { kind: "system" },
          policyVersion: action.mandateHash,
          payload: {},
        });
      expect((await adapter.inspect(action)).status).toBe(partial ? "uncertain" : "not_started");
      const tasks = new SupervisionTaskSource(storage, f.binding, now);
      const source = await tasks.read();
      const authority = await observeNodeSupervisionAuthority(storage, f.binding, now);
      const digest = operatingContractHash({
        authorityDigest: authority.source.sourceRevisionDigest,
        taskDigest: source.sourceRevisionDigest,
      });
      const journal = new SupervisionDecisionJournal(
        storage.events,
        storage.artifacts,
        supervisionJournalCoordinates(storage, f.binding, source.workstream.revision),
        now,
        { store: leases, lease },
      );
      const commit = <T>(callback: () => T): T => {
        if (fenceLost) throw new Error("lost test owner fence");
        return leases.commit(lease, Date.parse(now()), callback);
      };
      const recovery = adapter.supersede(action, digest, { commit }, f.binding);
      if (fenceLost) await expect(recovery).rejects.toThrow("lost test owner fence");
      else expect(await recovery).toBe(recoverable);
      expect(journal.findDecision(operatingDecisionId(action))?.status).toBe(
        recoverable ? "superseded" : "recorded",
      );
      if (recoverable) {
        expect(await journal.findPendingPlan()).toBeNull();
        await expect(
          admitSupervisedManagedInvocation({
            storage,
            invocation: {
              plan: action,
              effect,
              ownerLease: lease,
              authorityDigest: authority.source.sourceRevisionDigest,
            },
            now,
            commit: () => {
              throw new Error("late worker committed");
            },
          }),
        ).rejects.toThrow("no current recorded decision");
      }
      const resources = await observeSupervisionTaskResources({
        source: await tasks.read(),
        artifacts: storage.artifacts,
        events: storage.events,
        plan: { ...action, rationaleArtifactHash: operatingContractHash("next owner decision") },
      });
      expect(resources).toMatchObject(
        recoverable
          ? {
              observedAggregateTokens: 0,
              reservedAggregateTokens: 0,
              activeAttempts: 0,
              resourceAdmission: "within",
            }
          : { observedAggregateTokens: null, activeAttempts: 1, resourceAdmission: "unobserved" },
      );
      expect(f.counts().effects).toBe(0);
      const workspace = (await readWorkspace(f.root, f.provision.workspace.workspaceId))!.workspace;
      const input = {
        repositoryRoot: f.root,
        binding: f.binding,
        assignment: f.assignment,
        workspace,
        now,
        ...(sharedReader ? { storage } : {}),
      };
      const retained = await observeUnstartedSupervisionWorkspace(input);
      if (recoverable) {
        expect(retained).toMatchObject({
          workspaceId: workspace.workspaceId,
          assignmentId: f.assignment.assignmentId,
        });
        expect(await observeUnstartedSupervisionWorkspace(input)).toEqual(retained);
        const successor = {
          ...f.assignment,
          lease: { ...f.assignment.lease!, generation: f.assignment.lease!.generation + 1 },
        };
        expect(
          await currentSupervisionWorkspaces(
            f.root,
            successor,
            f.binding,
            sharedReader ? storage : undefined,
          ),
        ).toEqual([]);
        const changed = resolve(workspace.ownerWorkspacePath!, "unexpected.txt");
        await writeFile(changed, "preserve user changes\n");
        expect(await observeUnstartedSupervisionWorkspace(input)).toBeNull();
        await expect(
          currentSupervisionWorkspaces(
            f.root,
            successor,
            f.binding,
            sharedReader ? storage : undefined,
          ),
        ).rejects.toThrow("unresolved execution authority");
        expect((await readWorkspace(f.root, workspace.workspaceId))!.workspace).toEqual(workspace);
        storage.events.append({
          eventId: "evt_late_managed_request",
          projectId: action.projectId,
          ...managedExecutionIdentity(action.projectId, operatingContractHash(action)),
          schemaVersion: 1,
          type: "run.requested",
          occurredAt: now(),
          actor: { kind: "system" },
          policyVersion: action.mandateHash,
          payload: {},
        });
        await expect(journal.findPendingPlan()).rejects.toThrow("inspection is inconsistent");
        await expect(
          observeSupervisionTaskResources({
            source: await tasks.read(),
            artifacts: storage.artifacts,
            events: storage.events,
            plan: action,
          }),
        ).rejects.toThrow("inconsistent absence evidence");
      } else expect(retained).toBeNull();
      expect(storage.events.latest()).not.toBeNull();
    } finally {
      leases.release(lease);
      leases.close();
      await storage.close();
    }
  },
  30000,
);
