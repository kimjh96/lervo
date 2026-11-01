import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { afterEach, expect, it, vi } from "vitest";

import { readBoundWorkstreamState } from "../src/supervision-workstream-state.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { observeNodeSupervisionAuthority } from "../src/supervision-authority.js";
import { rejectWholeHistoryReads } from "../../../packages/storage-contract/test/whole-history-reads.fixture.js";
import { supervisionFixture } from "./supervision.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("reads an exact bound goal while a different reviewed goal is selected", async () => {
  const fixture = await supervisionFixture(roots);
  const storage = await openProjectStorage(fixture.root);
  try {
    const original = (await readCurrentWorkstreamState(fixture.root))!;
    const selected = {
      ...original.snapshot,
      workstreamId: `wks_${"b".repeat(24)}`,
      revision: 1,
      title: "Independent deployment review",
      objective: "Review the installed conversation acceptance evidence.",
    };
    const selectedContent = `${canonicalJson(selected)}\n`;
    const artifact = await storage.artifacts.put(selectedContent);
    storage.events.append({
      eventId: `evt_${"f".repeat(32)}`,
      projectId: storage.manifest.projectId,
      runId: `run_${"f".repeat(32)}`,
      sessionId: `ses_${"f".repeat(32)}`,
      type: "workstream.snapshot.recorded",
      schemaVersion: 1,
      occurredAt: selected.updatedAt,
      actor: { kind: "agent", provider: "codex" },
      policyVersion: artifact.contentHash,
      payload: {
        workstreamId: selected.workstreamId,
        revision: selected.revision,
        status: selected.status,
        changeKind: "agent_start",
        snapshotArtifactId: `art_${artifact.contentHash.slice(7)}`,
        snapshotContentHash: artifact.contentHash,
        previousSnapshotContentHash: null,
        sourceArtifactId: null,
        sourceContentHash: null,
        recordedAt: selected.updatedAt,
      },
    });
    await writeFile(
      resolve(fixture.root, ".lervo/state/workstreams/current.json"),
      selectedContent,
    );

    const bound = await readBoundWorkstreamState(storage, fixture.binding.workstreamId);
    expect(bound?.snapshot.workstreamId).toBe(fixture.binding.workstreamId);
    expect(bound?.contentHash).toBe(original.contentHash);
    expect((await readCurrentWorkstreamState(fixture.root))?.snapshot.workstreamId).toBe(
      selected.workstreamId,
    );
    expect((await readBoundWorkstreamState(storage, selected.workstreamId))?.contentHash).toBe(
      artifact.contentHash,
    );
    const ownerSource = new SupervisionTaskSource(storage, fixture.binding, () =>
      new Date().toISOString(),
    );
    expect((await ownerSource.read()).workstreamHash).toBe(original.contentHash);
    expect(
      (
        await observeNodeSupervisionAuthority(storage, fixture.binding, () =>
          new Date().toISOString(),
        )
      ).source.workstreamId,
    ).toBe(fixture.binding.workstreamId);
  } finally {
    await storage.close();
  }
});

it("reads the bound goal from snapshot events alone, whatever the history length", async () => {
  const fixture = await supervisionFixture(roots);
  const storage = await openProjectStorage(fixture.root);
  try {
    const expected = (await readCurrentWorkstreamState(fixture.root))!;
    const list = rejectWholeHistoryReads(storage.events);
    const state = await readBoundWorkstreamState(storage, fixture.binding.workstreamId);
    expect(state?.contentHash).toBe(expected.contentHash);
    expect(list.mock.calls.every(([options]) => options?.types !== undefined)).toBe(true);
  } finally {
    await storage.close();
  }
});

it("rejects a selected projection that disagrees with its canonical event", async () => {
  const fixture = await supervisionFixture(roots);
  const storage = await openProjectStorage(fixture.root);
  try {
    const original = (await readCurrentWorkstreamState(fixture.root))!;
    const changed = { ...original.snapshot, title: "Unrecorded title" };
    await writeFile(
      resolve(fixture.root, ".lervo/state/workstreams/current.json"),
      `${canonicalJson(changed)}\n`,
    );
    await expect(readBoundWorkstreamState(storage, fixture.binding.workstreamId)).rejects.toThrow(
      /projection differs/u,
    );
  } finally {
    await storage.close();
  }
});

it("accepts a verified sparse Hub checkpoint and its contiguous local successor", async () => {
  const fixture = await supervisionFixture(roots);
  const storage = await openProjectStorage(fixture.root);
  try {
    const original = (await readCurrentWorkstreamState(fixture.root))!;
    let previousHash = `sha256:${"a".repeat(64)}`;
    for (const [revision, changeKind] of [
      [4, "hub_replication_import"],
      [5, "agent_update"],
    ] as const) {
      const snapshot = {
        ...original.snapshot,
        revision,
        title: `Replicated revision ${revision}`,
      };
      const content = `${canonicalJson(snapshot)}\n`;
      const artifact = await storage.artifacts.put(content);
      storage.events.append({
        eventId: `evt_${revision.toString(16).padStart(32, "0")}`,
        projectId: storage.manifest.projectId,
        runId: `run_${revision.toString(16).padStart(32, "0")}`,
        sessionId: `ses_${revision.toString(16).padStart(32, "0")}`,
        type: "workstream.snapshot.recorded",
        schemaVersion: 1,
        occurredAt: snapshot.updatedAt,
        actor: {
          kind: changeKind === "hub_replication_import" ? "system" : "agent",
          ...(changeKind === "agent_update" ? { provider: "codex" as const } : {}),
        },
        policyVersion: artifact.contentHash,
        payload: {
          workstreamId: snapshot.workstreamId,
          revision,
          status: snapshot.status,
          changeKind,
          snapshotArtifactId: `art_${artifact.contentHash.slice(7)}`,
          snapshotContentHash: artifact.contentHash,
          previousSnapshotContentHash: previousHash,
          sourceArtifactId: null,
          sourceContentHash: null,
          recordedAt: snapshot.updatedAt,
        },
      });
      await writeFile(resolve(fixture.root, ".lervo/state/workstreams/current.json"), content);
      previousHash = artifact.contentHash;
    }
    expect(
      (await readBoundWorkstreamState(storage, fixture.binding.workstreamId))?.snapshot.revision,
    ).toBe(5);
    const importedOnly = {
      ...original.snapshot,
      workstreamId: `wks_${"c".repeat(24)}`,
      revision: 8,
    };
    const importedOnlyArtifact = await storage.artifacts.put(`${canonicalJson(importedOnly)}\n`);
    storage.events.append({
      eventId: `evt_${"c".repeat(32)}`,
      projectId: storage.manifest.projectId,
      runId: `run_${"c".repeat(32)}`,
      sessionId: `ses_${"c".repeat(32)}`,
      type: "workstream.snapshot.recorded",
      schemaVersion: 1,
      occurredAt: importedOnly.updatedAt,
      actor: { kind: "system" },
      policyVersion: importedOnlyArtifact.contentHash,
      payload: {
        workstreamId: importedOnly.workstreamId,
        revision: importedOnly.revision,
        status: importedOnly.status,
        changeKind: "hub_replication_import",
        snapshotArtifactId: `art_${importedOnlyArtifact.contentHash.slice(7)}`,
        snapshotContentHash: importedOnlyArtifact.contentHash,
        previousSnapshotContentHash: `sha256:${"b".repeat(64)}`,
        sourceArtifactId: null,
        sourceContentHash: null,
        recordedAt: importedOnly.updatedAt,
      },
    });
    expect(
      (await readBoundWorkstreamState(storage, importedOnly.workstreamId))?.snapshot.revision,
    ).toBe(8);
  } finally {
    await storage.close();
  }
});

it("rejects an unexplained gap in a bound workstream", async () => {
  const fixture = await supervisionFixture(roots);
  const storage = await openProjectStorage(fixture.root);
  try {
    const original = (await readCurrentWorkstreamState(fixture.root))!;
    const snapshot = { ...original.snapshot, revision: 4 };
    const content = `${canonicalJson(snapshot)}\n`;
    const artifact = await storage.artifacts.put(content);
    storage.events.append({
      eventId: `evt_${"d".repeat(32)}`,
      projectId: storage.manifest.projectId,
      runId: `run_${"d".repeat(32)}`,
      sessionId: `ses_${"d".repeat(32)}`,
      type: "workstream.snapshot.recorded",
      schemaVersion: 1,
      occurredAt: snapshot.updatedAt,
      actor: { kind: "agent", provider: "codex" },
      policyVersion: artifact.contentHash,
      payload: {
        workstreamId: snapshot.workstreamId,
        revision: 4,
        status: snapshot.status,
        changeKind: "agent_update",
        snapshotArtifactId: `art_${artifact.contentHash.slice(7)}`,
        snapshotContentHash: artifact.contentHash,
        previousSnapshotContentHash: `sha256:${"a".repeat(64)}`,
        sourceArtifactId: null,
        sourceContentHash: null,
        recordedAt: snapshot.updatedAt,
      },
    });
    rejectWholeHistoryReads(storage.events);
    await expect(readBoundWorkstreamState(storage, fixture.binding.workstreamId)).rejects.toThrow(
      /forked or incomplete/u,
    );
  } finally {
    await storage.close();
  }
});
