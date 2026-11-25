import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { captureRepositorySnapshot } from "@lervo/orchestrator";
import { afterEach, expect, it } from "vitest";

import { rememberLifecycleRepositorySnapshot } from "../src/terminal-lifecycle-inspection.js";
import { writePreparedRepositorySnapshot } from "../src/terminal-prepared-snapshot.js";
import { plannedTerminalRepositoryChange } from "../src/terminal-repository-change.js";
import type { TerminalLifecycleInspection } from "../src/terminal-hook-contract.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const observationId = "tobs_changeSource01";
const storage = (version: 1 | 2 | 3) => ({
  writableEventSchemaVersion: version,
  artifacts: {
    put: async (content: string) => ({
      contentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    }),
  } as never,
});

async function changedTurn() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-terminal-change-"));
  roots.push(root);
  await mkdir(resolve(root, "src"));
  await writeFile(resolve(root, "src/a.ts"), "export const a = 1;\n");
  const before = await captureRepositorySnapshot(root);
  await writePreparedRepositorySnapshot(root, { schemaVersion: 1, observationId, ...before });
  await writeFile(resolve(root, "src/a.ts"), "export const a = 2;\n");
  await writeFile(resolve(root, "src/b.ts"), "export const b = 1;\n");
  const after = await captureRepositorySnapshot(root);
  const lifecycle = {
    repositoryChange: {
      beforeRevision: before.revision,
      afterRevision: after.revision,
      changed: true,
    },
  } as TerminalLifecycleInspection;
  return { root, lifecycle, after };
}

it("plans one background knowledge job for a changed terminal turn with a v3 writer", async () => {
  const { root, lifecycle } = await changedTurn();
  const planned = await plannedTerminalRepositoryChange({
    root,
    storage: storage(3),
    contextPayload: { observationId },
    lifecycle,
    turnEventId: "evt_0123456789abcdef0123456789abcdef",
    occurredAt: "2026-09-25T09:00:00.000Z",
  });
  expect(planned?.payload).toMatchObject({
    sourceKind: "terminal_turn",
    sourceEventId: "evt_0123456789abcdef0123456789abcdef",
    changedPathCount: 2,
    changedPaths: ["src/a.ts", "src/b.ts"],
  });
});

it("plans nothing without a v3 writer, a matching prepared snapshot, or a change", async () => {
  const { root, lifecycle } = await changedTurn();
  const base = {
    root,
    contextPayload: { observationId },
    turnEventId: "evt_0123456789abcdef0123456789abcdef",
    occurredAt: "2026-09-25T09:00:00.000Z",
  };
  expect(
    await plannedTerminalRepositoryChange({ ...base, storage: storage(2), lifecycle }),
  ).toBeNull();
  expect(
    await plannedTerminalRepositoryChange({
      ...base,
      storage: storage(3),
      contextPayload: { observationId: "tobs_missingSnapshot" },
      lifecycle,
    }),
  ).toBeNull();
  expect(
    await plannedTerminalRepositoryChange({
      ...base,
      storage: storage(3),
      lifecycle: {
        repositoryChange: { ...lifecycle.repositoryChange, changed: false },
      } as TerminalLifecycleInspection,
    }),
  ).toBeNull();
});

it("records the change from the snapshot lifecycle inspection captured, without walking again", async () => {
  const { root, lifecycle, after } = await changedTurn();
  rememberLifecycleRepositorySnapshot(lifecycle, root, after);
  // A later edit would fail a fresh walk's revision check; the inspected snapshot is used instead.
  await writeFile(resolve(root, "src/c.ts"), "export const c = 1;\n");
  const planned = await plannedTerminalRepositoryChange({
    root,
    storage: storage(3),
    contextPayload: { observationId },
    lifecycle,
    turnEventId: "evt_0123456789abcdef0123456789abcdef",
    occurredAt: "2026-09-25T09:00:00.000Z",
  });
  expect(planned?.payload.changedPaths).toEqual(["src/a.ts", "src/b.ts"]);
  // A snapshot of another root is never used.
  const other = { ...lifecycle } as TerminalLifecycleInspection;
  rememberLifecycleRepositorySnapshot(other, `${root}-elsewhere`, after);
  expect(
    await plannedTerminalRepositoryChange({
      root,
      storage: storage(3),
      contextPayload: { observationId },
      lifecycle: other,
      turnEventId: "evt_0123456789abcdef0123456789abcdef",
      occurredAt: "2026-09-25T09:00:00.000Z",
    }),
  ).toBeNull();
});
