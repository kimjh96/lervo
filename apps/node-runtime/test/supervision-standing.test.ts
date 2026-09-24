import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { OperatingMandateV3 } from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { collectProjectEventsBounded } from "@lervo/storage-contract";
import { afterEach, expect, it, vi } from "vitest";

import {
  createRepositoryMandatePlan,
  installRepositoryMandate,
} from "../../cli/src/mandate-installation.js";
import { runCli } from "../../cli/src/main.js";
import { installationFixture } from "../../cli/test/mandate-installation.fixture.js";
import { createLoginFixture } from "../../../packages/adapter-contract/test/login.fixture.js";
import type { NodeRuntimeComponentHealth } from "../src/health-contract.js";
import { observeSupervisionHostIdentity } from "../src/supervision-execution-host.js";
import { admitStandingSupervisionRequest } from "../src/supervision-request-intake.js";
import { readInstalledNodeMandate } from "../src/supervision-authority.js";
import { resolveStandingSupervisionBinding } from "../src/supervision-standing.js";
import {
  recordUnselectedStandingSuccessor,
  standingSuccessorMarker,
} from "../src/supervision-standing-bound-successor.js";
import { openNodeSupervisionService } from "../src/supervision-startup.js";
import { readBoundWorkstreamState } from "../src/supervision-workstream-state.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function completeCurrentGoal(root: string): Promise<void> {
  const state = (await readCurrentWorkstreamState(root))!;
  const draft = JSON.stringify({
    ...state.snapshot,
    revision: state.snapshot.revision + 1,
    status: "completed",
    blockers: [],
    pendingDecisions: [],
    pendingApprovals: [],
    updatedAt: new Date().toISOString(),
  });
  const output: string[] = [];
  const errors: string[] = [];
  const io = {
    cwd: root,
    stdout: (text: string) => output.push(text),
    stderr: (text: string) => errors.push(text),
    stdin: async () => draft,
  };
  if ((await runCli(["workstream", "update", "--stdin", "--actor", "user", "--json"], io)) !== 0)
    throw new Error(errors.join(""));
  const plan = JSON.parse(output.join("")) as { planId: string };
  output.length = 0;
  if (
    (await runCli(
      ["workstream", "update", "--stdin", "--actor", "user", "--apply", plan.planId, "--json"],
      io,
    )) !== 0
  )
    throw new Error(errors.join(""));
}

async function installStandingRoot(maximumSuccessors: number) {
  const f = await installationFixture(roots);
  const storage = await openProjectStorage(f.root);
  const anchor = collectProjectEventsBounded({
    events: storage.events,
    maximumEvents: 1000,
  }).findLast((event) => event.type === "workstream.snapshot.recorded")!;
  const rootMandate: OperatingMandateV3 = {
    ...f.mandate,
    schemaVersion: 3,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    executionAuthority: {
      schemaVersion: 1,
      mode: "designated_host",
      hostIdentityHash: (await observeSupervisionHostIdentity()).hostIdentityHash,
    },
    workScope: {
      schemaVersion: 1,
      workstreamId: String(anchor.payload.workstreamId),
      snapshotEventId: anchor.eventId,
      snapshotEventHash: anchor.eventHash,
      excludedAssignments: [],
    },
    successorAuthority: { schemaVersion: 1, maximumSuccessors },
  };
  const plan = await createRepositoryMandatePlan({
    root: f.root,
    supervisionId: "supervision.standing",
    mandate: rootMandate,
    reviewerId: rootMandate.appointingAuthorityId,
  });
  const installed = await installRepositoryMandate({
    root: f.root,
    plan,
    approval: plan.approvalHash,
    reviewerId: rootMandate.appointingAuthorityId,
  });
  const root = {
    supervisionId: "supervision.standing",
    workstreamId: rootMandate.workScope.workstreamId,
    ownerAgentId: f.owner.agentId,
    mandateHash: installed.mandateHash,
  };
  const request = (text: string, sourceId: string) => ({
    source: "local" as const,
    sourceId,
    requesterId: "operator",
    request: text,
    contentHash: hash(text),
  });
  return { f, storage, root, rootMandate, request };
}

it("follows a reviewed root mandate revision while keeping the configured ancestor pinned", async () => {
  const { f, storage, root, rootMandate } = await installStandingRoot(1);
  const revised: OperatingMandateV3 = {
    ...rootMandate,
    version: rootMandate.version + 1,
    maximumAttemptsPerAssignment: 3,
  };
  const plan = await createRepositoryMandatePlan({
    root: f.root,
    supervisionId: root.supervisionId,
    mandate: revised,
    reviewerId: revised.appointingAuthorityId,
  });
  const installed = await installRepositoryMandate({
    root: f.root,
    plan,
    approval: plan.approvalHash,
    reviewerId: revised.appointingAuthorityId,
  });
  const resolved = await resolveStandingSupervisionBinding(storage, root, () =>
    new Date().toISOString(),
  );
  expect(resolved.index).toBe(0);
  expect(resolved.binding).toEqual({ ...root, mandateHash: installed.mandateHash });
  expect(resolved.installation.mandate.maximumAttemptsPerAssignment).toBe(3);
  await expect(
    resolveStandingSupervisionBinding(
      storage,
      { ...root, mandateHash: hash("unrelated root") },
      () => new Date().toISOString(),
    ),
  ).rejects.toMatchObject({ code: "supervision_binding_invalid" });
  await storage.close();
});

it("starts Elio's successor without replacing a separately selected deployment review", async () => {
  const { f, storage, root, request } = await installStandingRoot(1);
  await completeCurrentGoal(f.root);
  const parent = (await readCurrentWorkstreamState(f.root))!;
  const review = {
    ...parent.snapshot,
    workstreamId: `wks_${"d".repeat(24)}`,
    revision: 1,
    status: "active" as const,
    title: "Installed conversation review",
    objective: "Verify deployment evidence before releasing approval.",
    origin: {
      kind: "successor" as const,
      predecessorWorkstreamId: parent.snapshot.workstreamId,
      predecessorSnapshotContentHash: parent.contentHash,
      sourceArtifactId: null,
      sourceContentHash: null,
      sourcePathDigest: null,
    },
    pendingApprovals: [
      {
        approvalId: `wapr_${"d".repeat(16)}`,
        kind: "deployment" as const,
        summary: "Hold installed conversation approval until exact evidence is reviewed.",
        bindingHash: hash("held-review"),
        blocking: true,
      },
    ],
  };
  const reviewContent = `${canonicalJson(review)}\n`;
  const artifact = await storage.artifacts.put(reviewContent);
  storage.events.append({
    eventId: `evt_${"d".repeat(32)}`,
    projectId: storage.manifest.projectId,
    runId: `run_${"d".repeat(32)}`,
    sessionId: `ses_${"d".repeat(32)}`,
    type: "workstream.snapshot.recorded",
    schemaVersion: 1,
    occurredAt: review.updatedAt,
    actor: { kind: "agent", provider: "codex" },
    policyVersion: artifact.contentHash,
    payload: {
      workstreamId: review.workstreamId,
      revision: 1,
      status: "active",
      changeKind: "agent_start",
      snapshotArtifactId: `art_${artifact.contentHash.slice(7)}`,
      snapshotContentHash: artifact.contentHash,
      previousSnapshotContentHash: parent.contentHash,
      sourceArtifactId: null,
      sourceContentHash: null,
      recordedAt: review.updatedAt,
    },
  });
  await writeFile(resolve(f.root, ".lervo/state/workstreams/current.json"), reviewContent);

  const next = await admitStandingSupervisionRequest({
    repositoryRoot: f.root,
    root,
    request: request("Continue the owner goal while review remains selected.", "parallel-1"),
    provider: "codex",
  });
  expect(next.rebound).toBe(true);
  expect(next.binding.ownerAgentId).toBe(root.ownerAgentId);
  expect(next.binding.workstreamId).not.toBe(review.workstreamId);
  expect((await readCurrentWorkstreamState(f.root))?.contentHash).toBe(artifact.contentHash);
  expect(
    (await readBoundWorkstreamState(storage, review.workstreamId))?.snapshot.pendingApprovals,
  ).toEqual(review.pendingApprovals);
  expect(
    (await readBoundWorkstreamState(storage, next.binding.workstreamId))?.snapshot.status,
  ).toBe("active");
  await storage.close();
});

it("recovers a prepared unselected successor after a restart without recording another goal", async () => {
  const { f, storage, root } = await installStandingRoot(1);
  await completeCurrentGoal(f.root);
  const predecessor = (await readBoundWorkstreamState(storage, root.workstreamId))!;
  const requestContentHash = hash("Restarted request");
  const draft = (updatedAt: string) => ({
    schemaVersion: 1,
    status: "active",
    title: "Restarted request",
    objective: "Restarted request",
    nextActions: ["Finish the request."],
    blockers: [],
    notes: [standingSuccessorMarker(1, requestContentHash)],
    references: [],
    updatedAt,
  });
  const first = await recordUnselectedStandingSuccessor({
    storage,
    predecessor,
    draft: draft("2026-09-19T00:00:00.000Z"),
    provider: "codex",
    supervisionId: "supervision.standing.s1",
    successorIndex: 1,
    requestContentHash,
    now: () => "2026-09-19T00:00:00.000Z",
  });
  const restarted = await recordUnselectedStandingSuccessor({
    storage,
    predecessor,
    draft: draft("2026-09-19T00:01:00.000Z"),
    provider: "codex",
    supervisionId: "supervision.standing.s1",
    successorIndex: 1,
    requestContentHash,
    now: () => "2026-09-19T00:01:00.000Z",
  });
  expect(restarted).toEqual(first);
  expect(
    collectProjectEventsBounded({ events: storage.events, maximumEvents: 4000 }).filter(
      (event) =>
        event.type === "workstream.snapshot.recorded" &&
        event.payload.workstreamId === first.workstreamId,
    ),
  ).toHaveLength(1);
  const prepared = (await readBoundWorkstreamState(storage, first.workstreamId))!;
  const changed = {
    ...prepared.snapshot,
    revision: 2,
    notes: [...prepared.snapshot.notes, "Changed after preparation."],
    updatedAt: "2026-09-19T00:02:00.000Z",
  };
  const changedArtifact = await storage.artifacts.put(`${canonicalJson(changed)}\n`);
  storage.events.append({
    eventId: `evt_${"e".repeat(32)}`,
    projectId: storage.manifest.projectId,
    runId: `run_${"e".repeat(32)}`,
    sessionId: `ses_${"e".repeat(32)}`,
    type: "workstream.snapshot.recorded",
    schemaVersion: 1,
    occurredAt: changed.updatedAt,
    actor: { kind: "agent", provider: "codex" },
    policyVersion: changedArtifact.contentHash,
    payload: {
      workstreamId: first.workstreamId,
      revision: 2,
      status: "active",
      changeKind: "agent_update",
      snapshotArtifactId: `art_${changedArtifact.contentHash.slice(7)}`,
      snapshotContentHash: changedArtifact.contentHash,
      previousSnapshotContentHash: prepared.contentHash,
      sourceArtifactId: null,
      sourceContentHash: null,
      recordedAt: changed.updatedAt,
    },
  });
  await expect(
    recordUnselectedStandingSuccessor({
      storage,
      predecessor,
      draft: draft("2026-09-19T00:03:00.000Z"),
      provider: "codex",
      supervisionId: "supervision.standing.s1",
      successorIndex: 1,
      requestContentHash,
      now: () => "2026-09-19T00:03:00.000Z",
    }),
  ).rejects.toThrow("prepared successor changed");
  await storage.close();
});

it("starts successor goals under a standing grant and follows the lineage binding", async () => {
  const { f, storage, root, rootMandate, request } = await installStandingRoot(2);
  expect(
    await resolveStandingSupervisionBinding(storage, root, () => new Date().toISOString()),
  ).toMatchObject({
    index: 0,
    binding: root,
  });
  const first = await admitStandingSupervisionRequest({
    repositoryRoot: f.root,
    root,
    request: request("Summarize the vision document.", "request-1"),
    provider: "codex",
  });
  expect(first).toMatchObject({ rebound: false, duplicate: false, binding: root });

  await completeCurrentGoal(f.root);
  const second = await admitStandingSupervisionRequest({
    repositoryRoot: f.root,
    root,
    request: request("List every invariant in the architecture document.", "request-2"),
    provider: "codex",
  });
  expect(second.rebound).toBe(true);
  expect(second.binding.supervisionId).toBe("supervision.standing.s1");
  expect(second.binding.workstreamId).not.toBe(root.workstreamId);
  expect(second.binding.ownerAgentId).toBe(root.ownerAgentId);
  const state = (await readCurrentWorkstreamState(f.root))!;
  expect(state.snapshot.workstreamId).toBe(second.binding.workstreamId);
  expect(state.snapshot.status).toBe("active");
  expect(state.snapshot.origin.kind).toBe("successor");
  expect(state.snapshot.objective).toBe("List every invariant in the architecture document.");
  const successor = await readInstalledNodeMandate(storage, second.binding, () =>
    new Date().toISOString(),
  );
  expect(successor.mandate.schemaVersion).toBe(3);
  expect((successor.mandate as OperatingMandateV3).successorAuthority).toEqual({
    schemaVersion: 1,
    maximumSuccessors: 1,
  });
  expect(successor.mandate.mandateId).toBe(`${rootMandate.mandateId}.s1`);
  expect(
    await resolveStandingSupervisionBinding(storage, root, () => new Date().toISOString()),
  ).toMatchObject({
    index: 1,
    binding: second.binding,
  });
  expect(
    collectProjectEventsBounded({ events: storage.events, maximumEvents: 4000 }).filter(
      (event) =>
        event.type === "work.supervision.bound" &&
        event.payload.workstreamId === second.binding.workstreamId,
    ),
  ).toHaveLength(1);
  await expect(
    admitStandingSupervisionRequest({
      repositoryRoot: f.root,
      root,
      request: request("Another request on the active successor.", "request-3"),
      provider: "codex",
    }),
  ).rejects.toMatchObject({ code: "origin_conflict" });

  await completeCurrentGoal(f.root);
  const third = await admitStandingSupervisionRequest({
    repositoryRoot: f.root,
    root,
    request: request("Third request.", "request-4"),
    provider: "codex",
  });
  expect(third.binding.supervisionId).toBe("supervision.standing.s2");
  await completeCurrentGoal(f.root);
  await expect(
    admitStandingSupervisionRequest({
      repositoryRoot: f.root,
      root,
      request: request("Fourth request beyond the grant.", "request-5"),
      provider: "codex",
    }),
  ).rejects.toMatchObject({ code: "workstream_inactive" });
  await storage.close();
}, 60_000);

it("makes a running standing service follow reviewed root and successor revisions", async () => {
  const { f, storage, root, rootMandate, request } = await installStandingRoot(1);
  const login = await createLoginFixture(roots);
  const health: NodeRuntimeComponentHealth[] = [];
  const logs: string[] = [];
  const service = await openNodeSupervisionService({
    repositoryRoot: f.root,
    configuration: {
      binding: root,
      standing: true,
      runtimeReadiness: {
        providerExecutables: { codex: login.executable },
        providerLoginContexts: { codex: login.context },
        verificationTools: {},
        workerWorkspace: {
          parentDirectory: resolve(f.root, "workers"),
          baseCommit: "a".repeat(40),
          integrationTargetDigest: `sha256:${"b".repeat(64)}`,
        },
      },
      ownerReasoning: { provider: "codex", reservedTokens: 100 },
      managedExecution: {
        nodeExecutable: process.execPath,
        cliBundle: resolve("apps/cli/dist/bin.js"),
      },
    },
    observeHealth: async (observation) => {
      health.push(observation);
    },
    log: (line) => logs.push(line),
  });
  try {
    expect(service.currentBinding()).toEqual(root);
    service.start();
    await vi.waitFor(() => expect(health.length).toBeGreaterThan(0), { timeout: 10_000 });
    const rootRevision: OperatingMandateV3 = {
      ...rootMandate,
      version: rootMandate.version + 1,
      maximumAttemptsPerAssignment: 3,
    };
    const rootPlan = await createRepositoryMandatePlan({
      root: f.root,
      supervisionId: root.supervisionId,
      mandate: rootRevision,
      reviewerId: rootRevision.appointingAuthorityId,
    });
    let rootInstall: Awaited<ReturnType<typeof installRepositoryMandate>> | null = null;
    for (let attempt = 0; attempt < 60 && rootInstall === null; attempt += 1)
      try {
        rootInstall = await installRepositoryMandate({
          root: f.root,
          plan: rootPlan,
          approval: rootPlan.approvalHash,
          reviewerId: rootRevision.appointingAuthorityId,
        });
      } catch (error) {
        if (!/requires reconciliation before installation/u.test(String(error))) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    expect(rootInstall).not.toBeNull();
    await vi.waitFor(
      () => expect(service.currentBinding().mandateHash).toBe(rootInstall!.mandateHash),
      { timeout: 90_000 },
    );
    expect(service.currentBinding().supervisionId).toBe(root.supervisionId);
    await completeCurrentGoal(f.root);
    const admitted = await admitStandingSupervisionRequest({
      repositoryRoot: f.root,
      root,
      request: request("Started outside the running service.", "request-external"),
      provider: "codex",
    });
    expect(admitted.rebound).toBe(true);
    await vi.waitFor(
      () => expect(service.currentBinding().supervisionId).toBe("supervision.standing.s1"),
      { timeout: 90_000 },
    );
    // The old owner's cycles may fail while the successor is installed; the lineage walk may not.
    expect(logs.filter((line) => /lineage/u.test(line))).toEqual([]);
    expect(service.currentBinding()).toEqual(admitted.binding);
    // A reviewed later version of the goal the service is already running must be followed live,
    // or every cycle fails closed against the binding it pinned when it opened.
    const installed = await readInstalledNodeMandate(storage, admitted.binding, () =>
      new Date().toISOString(),
    );
    const raised = {
      ...(installed.mandate as OperatingMandateV3),
      version: installed.mandate.version + 1,
      maximumAttemptsPerAssignment: 4,
    };
    const raisedPlan = await createRepositoryMandatePlan({
      root: f.root,
      supervisionId: admitted.binding.supervisionId,
      mandate: raised,
      reviewerId: raised.appointingAuthorityId,
    });
    // The running owner holds the exclusive fence during a cycle, exactly as in production, so
    // the reviewed installation waits for it rather than assuming it lands between cycles.
    let raisedInstall: Awaited<ReturnType<typeof installRepositoryMandate>> | null = null;
    for (let attempt = 0; attempt < 60 && raisedInstall === null; attempt += 1)
      try {
        raisedInstall = await installRepositoryMandate({
          root: f.root,
          plan: raisedPlan,
          approval: raisedPlan.approvalHash,
          reviewerId: raised.appointingAuthorityId,
        });
      } catch (error) {
        if (!/requires reconciliation before installation/u.test(String(error))) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    expect(raisedInstall).not.toBeNull();
    await vi.waitFor(
      () => expect(service.currentBinding().mandateHash).toBe(raisedInstall!.mandateHash),
      { timeout: 90_000 },
    );
    expect(service.currentBinding().supervisionId).toBe(admitted.binding.supervisionId);
  } finally {
    await service.close();
    await storage.close();
  }
}, 120_000);

it("keeps the lineage resolvable after a later reviewed version of a successor mandate", async () => {
  const { f, storage, root, request } = await installStandingRoot(1);
  const clock = () => new Date().toISOString();
  await completeCurrentGoal(f.root);
  const admitted = await admitStandingSupervisionRequest({
    repositoryRoot: f.root,
    root,
    request: request("Work that needs a wider attempt ceiling.", "request-version"),
    provider: "codex",
  });
  expect(admitted.binding.supervisionId).toBe("supervision.standing.s1");
  const installed = await readInstalledNodeMandate(storage, admitted.binding, clock);
  // A reviewed later version of the successor's own mandate is an ordinary succession, not a
  // second derivation, so the lineage walk must follow it instead of failing closed.
  const raised = {
    ...(installed.mandate as OperatingMandateV3),
    version: installed.mandate.version + 1,
    // Four attempts is the contract ceiling for one assignment.
    maximumAttemptsPerAssignment: 4,
  };
  const plan = await createRepositoryMandatePlan({
    root: f.root,
    supervisionId: admitted.binding.supervisionId,
    mandate: raised,
    reviewerId: raised.appointingAuthorityId,
  });
  const next = await installRepositoryMandate({
    root: f.root,
    plan,
    approval: plan.approvalHash,
    reviewerId: raised.appointingAuthorityId,
  });
  const resolved = await resolveStandingSupervisionBinding(storage, root, clock);
  expect(resolved.index).toBe(1);
  expect(resolved.binding.workstreamId).toBe(admitted.binding.workstreamId);
  expect(resolved.binding.mandateHash).toBe(next.mandateHash);
  expect(resolved.installation.mandate.maximumAttemptsPerAssignment).toBe(4);
  expect(resolved.binding.mandateHash).not.toBe(installed.mandateHash);
  await storage.close();
}, 60_000);
