import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import type { OperatingMandateV3 } from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { collectProjectEventsBounded } from "@lervo/storage-contract";
import { afterEach, expect, it } from "vitest";

import {
  createRepositoryMandatePlan,
  installRepositoryMandate,
} from "../../cli/src/mandate-installation.js";
import { runCli } from "../../cli/src/main.js";
import { installationFixture } from "../../cli/test/mandate-installation.fixture.js";
import { observeSupervisionHostIdentity } from "../src/supervision-execution-host.js";
import { admitStandingSupervisionRequest } from "../src/supervision-request-intake.js";
import { readInstalledNodeMandate } from "../src/supervision-authority.js";
import { resolveStandingSupervisionBinding } from "../src/supervision-standing.js";

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

it("starts successor goals under a standing grant and follows the lineage binding", async () => {
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
    successorAuthority: { schemaVersion: 1, maximumSuccessors: 2 },
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
