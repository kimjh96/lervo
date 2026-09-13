import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";
import { openRepositorySupervisionLeases } from "../src/index.js";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "repository-supervision-leases-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: `prj_${"a".repeat(16)}` }));
  return { root, home: await resolveRepositoryCoordinationHome(root) };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository supervision lease composition", () => {
  it("retains unresolved ownership independently of deletable state and rejects another connection", async () => {
    const { root } = await fixture();
    const first = await openRepositorySupervisionLeases(root);
    try {
      const input = {
        supervisionId: "supervision.fixture",
        ownerAgentId: `agt_${"a".repeat(24)}`,
        nowMs: 1000,
        durationMs: 1000,
      };
      expect(first.acquire(input)).not.toBeNull();
      await rm(resolve(root, ".lervo/state"), { recursive: true, force: true });
      const second = await openRepositorySupervisionLeases(root);
      try {
        expect(second.acquire({ ...input, nowMs: 10_000 })).toBeNull();
      } finally {
        second.close();
      }
    } finally {
      first.close();
    }
  });

  it.each(["", "-wal", "-shm"])(
    "rejects a symlink at the SQLite path or sidecar %s",
    async (suffix) => {
      const { root, home } = await fixture();
      const target = resolve(root, "user-owned.txt");
      await writeFile(target, "user-owned", { mode: 0o600 });
      await symlink(target, resolve(home.workforce, `supervision-leases.sqlite${suffix}`));
      await expect(openRepositorySupervisionLeases(root)).rejects.toThrow();
    },
  );
});
