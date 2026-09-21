import { rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { changeAgentStatus } from "@lervo/agent-workforce";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage, resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { supervisionFixture } from "./supervision.fixture.js";
import { SupervisionPeerSource } from "../src/supervision-peer-source.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("observes a pinned peer without changing workforce state and rejects revoked owner authority", async () => {
  const f = await supervisionFixture(roots);
  const home = await resolveRepositoryCoordinationHome(f.root);
  const marker = resolve(home.root, "repository.json");
  const registry = resolve(home.workforce, "agents.json");
  const before = await Promise.all([marker, registry, home.root].map((path) => stat(path)));
  const configuration = {
    repositoryRoot: f.root,
    repositoryInstanceId: home.repositoryInstanceId,
    projectId: f.owner.projectId,
    teamId: f.mandate.teamIds[0]!,
    binding: f.binding,
  };
  const peer = await SupervisionPeerSource.open(configuration, f.ports.now);
  try {
    expect(await peer.read()).toMatchObject({
      party: { projectId: f.owner.projectId, ownerAgentId: f.owner.agentId },
      repositoryInstanceId: home.repositoryInstanceId,
    });
    expect(
      (await Promise.all([marker, registry, home.root].map((path) => stat(path)))).map(
        (info) => info.mtimeMs,
      ),
    ).toEqual(before.map((info) => info.mtimeMs));
    await expect(peer.storage.artifacts.put("not owned by observer")).rejects.toMatchObject({
      code: "read_only",
    });
    await changeAgentStatus({
      repositoryRoot: f.root,
      agentId: f.owner.agentId,
      expectedRevision: f.owner.revision,
      status: "suspended",
    });
    await expect(peer.read()).rejects.toThrow(/owner|authority/iu);
  } finally {
    await peer.close();
  }
  await expect(
    SupervisionPeerSource.open(
      { ...configuration, repositoryInstanceId: "rpi_" + "0".repeat(24) },
      f.ports.now,
    ),
  ).rejects.toThrow(/exact repository instance/iu);
});

it("observes the peer's bound goal while another review stays selected with its approval held", async () => {
  const f = await supervisionFixture(roots);
  const bound = (await readCurrentWorkstreamState(f.root))!;
  const reviewId = `wks_${"e".repeat(24)}`;
  const reviewedAt = new Date().toISOString();
  const review = {
    ...bound.snapshot,
    workstreamId: reviewId,
    revision: 1,
    title: "Independent deployment review",
    objective: "Keep operational approval held while the bound peer continues.",
    updatedAt: reviewedAt,
    pendingApprovals: [
      {
        approvalId: `wapr_${"e".repeat(16)}`,
        kind: "deployment" as const,
        summary: "Await installed acceptance evidence.",
        bindingHash: `sha256:${"f".repeat(64)}`,
        blocking: true,
      },
    ],
  };
  const content = `${canonicalJson(review)}\n`;
  const storage = await openProjectStorage(f.root);
  let reviewHash: string;
  try {
    const artifact = await storage.artifacts.put(content);
    reviewHash = artifact.contentHash;
    storage.events.append({
      eventId: `evt_${"e".repeat(32)}`,
      projectId: f.owner.projectId,
      runId: `run_${"e".repeat(32)}`,
      sessionId: `ses_${"e".repeat(32)}`,
      type: "workstream.snapshot.recorded",
      schemaVersion: 1,
      occurredAt: reviewedAt,
      actor: { kind: "agent", provider: "codex" },
      policyVersion: reviewHash,
      payload: {
        workstreamId: reviewId,
        revision: 1,
        status: "active",
        changeKind: "agent_start",
        snapshotArtifactId: `art_${reviewHash.slice(7)}`,
        snapshotContentHash: reviewHash,
        previousSnapshotContentHash: null,
        sourceArtifactId: null,
        sourceContentHash: null,
        recordedAt: reviewedAt,
      },
    });
  } finally {
    await storage.close();
  }
  await writeFile(resolve(f.root, ".lervo/state/workstreams/current.json"), content);
  const home = await resolveRepositoryCoordinationHome(f.root);
  const peer = await SupervisionPeerSource.open(
    {
      repositoryRoot: f.root,
      repositoryInstanceId: home.repositoryInstanceId,
      projectId: f.owner.projectId,
      teamId: f.mandate.teamIds[0]!,
      binding: f.binding,
    },
    f.ports.now,
  );
  try {
    expect(await peer.read()).toMatchObject({
      party: { workstreamId: f.binding.workstreamId },
      workstreamSnapshotHash: bound.contentHash,
      objective: bound.snapshot.objective,
    });
    expect(await readCurrentWorkstreamState(f.root)).toMatchObject({
      contentHash: reviewHash!,
      snapshot: { workstreamId: reviewId, pendingApprovals: review.pendingApprovals },
    });
  } finally {
    await peer.close();
  }
});
