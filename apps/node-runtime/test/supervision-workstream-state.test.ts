import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import { readBoundWorkstreamState } from "../src/supervision-workstream-state.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { observeNodeSupervisionAuthority } from "../src/supervision-authority.js";
import { supervisionFixture } from "./supervision.fixture.js";

const roots: string[] = [];
afterEach(async () => {
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
