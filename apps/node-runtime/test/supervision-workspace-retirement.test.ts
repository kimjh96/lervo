import { lstat, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readWorkspace } from "@lervo/agent-workforce";
import { retireUnstartedSupervisionWorkspace } from "../src/supervision-workspace-retirement.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";
import { recordPreparedWorkspaceFixture } from "./supervision-prepared-workspace.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["unused", "changed_checkout", "live_lease"] as const)(
  "retires only a proven never-used checkout without force: %s",
  async (condition) => {
    const f = await dispatchFixture(roots, true, undefined, "developer", [
      "dispatch",
      "execute_as_owner",
    ]);
    await recordPreparedWorkspaceFixture(f);
    const workspaceId = f.provision.workspace.workspaceId;
    const before = (await readWorkspace(f.root, workspaceId))!.workspace;
    const path = before.ownerWorkspacePath!;
    const now =
      condition === "live_lease"
        ? f.ports.now
        : () => new Date(Date.parse(f.assignment.lease!.expiresAt) + 1).toISOString();
    if (condition === "changed_checkout")
      await writeFile(resolve(path, "user-owned.txt"), "retain me\n");
    const retire = () =>
      retireUnstartedSupervisionWorkspace({
        repositoryRoot: f.root,
        binding: f.binding,
        workspaceId,
        now,
      });
    if (condition !== "unused") {
      // Without a fresh never-used proof nothing changes, including user-owned files.
      await expect(retire()).rejects.toThrow(/never used/u);
      expect((await readWorkspace(f.root, workspaceId))!.workspace).toEqual(before);
      expect((await lstat(path)).isDirectory()).toBe(true);
      return;
    }
    expect(await retire()).toEqual({ workspaceId, status: "removed" });
    const after = (await readWorkspace(f.root, workspaceId))!.workspace;
    expect(after).toMatchObject({ state: "removed", recoveryReason: "unstarted_retirement" });
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await retire()).toEqual({ workspaceId, status: "already_removed" });
  },
  30000,
);
