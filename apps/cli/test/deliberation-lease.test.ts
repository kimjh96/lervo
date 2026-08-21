import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireDeliberationLease,
  inspectDeliberationLease,
  releaseDeliberationLease,
} from "../src/deliberation-lease.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("deliberation process lease", () => {
  it("hands over a dead process lease once and blocks a concurrent owner", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-deliberation-lease-"));
    roots.push(root);
    const stateRoot = resolve(root, ".lervo/state");
    const deliberationId = "dlb_lease0001";
    const directory = resolve(stateRoot, "deliberations", deliberationId, "checkpoints");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "active.json"), `${JSON.stringify({
      schemaVersion: 1,
      deliberationId,
      ownerId: "dlw_dead0001",
      processId: 2_147_483_647,
      acquiredAt: "2026-08-21T00:00:00.000Z",
    })}\n`, { mode: 0o600 });

    await acquireDeliberationLease({
      stateRoot,
      deliberationId,
      ownerId: "dlw_live0001",
      acquiredAt: "2026-08-21T00:01:00.000Z",
      recoverStale: true,
    });
    expect(await inspectDeliberationLease({ stateRoot, deliberationId })).toBe("active");
    await expect(acquireDeliberationLease({
      stateRoot,
      deliberationId,
      ownerId: "dlw_racer001",
      acquiredAt: "2026-08-21T00:02:00.000Z",
      recoverStale: true,
    })).rejects.toMatchObject({ code: "deliberation_in_progress" });

    await releaseDeliberationLease({
      stateRoot,
      deliberationId,
      ownerId: "dlw_live0001",
    });
    expect(await inspectDeliberationLease({ stateRoot, deliberationId })).toBe("missing");
  });
});
