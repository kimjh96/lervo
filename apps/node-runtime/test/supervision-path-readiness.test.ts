import { afterEach, describe, expect, it } from "vitest";
import { chmod, rm, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Node filesystem scope readiness", () => {
  it.each(["failed", "unobserved", "not_required"] as const)(
    "does not promote a %s application write-scope check",
    async (status) => {
      const f = await dispatchFixture(roots);
      const read = f.ports.readWorkerReadiness;
      f.ports.readWorkerReadiness = async (plan) => {
        const result = await read(plan);
        const check = result.observation.checks.find((item) => item.kind === "write_scope")!;
        check.status = status;
        check.evidenceHash = null;
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
        expect(f.counts().effects).toBe(0);
      } finally {
        await runtime.close();
      }
    },
  );
  it("rejects a symlink in an otherwise authorized Git workspace", async () => {
    const f = await dispatchFixture(roots);
    await rm(resolve(f.workspacePath, "src/save.ts"));
    await symlink(resolve(f.root, "src/save.ts"), resolve(f.workspacePath, "src/save.ts"));
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
      runtimeReadiness: f.runtimeReadiness,
    });
    try {
      expect((await runtime.runCycle()).disposition).toBe("blocked");
      expect(f.counts().effects).toBe(0);
      expect(f.attention.at(-1)).toContain("readiness_read_scope_unobserved");
    } finally {
      await runtime.close();
    }
  });
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "blocks a permission lost between initial and final preflight",
    async () => {
      const f = await dispatchFixture(roots);
      const read = f.ports.readWorkerReadiness;
      let count = 0;
      f.ports.readWorkerReadiness = async (plan) => {
        if (++count === 2) await chmod(resolve(f.workspacePath, "src/save.ts"), 0o400);
        return read(plan);
      };
      const runtime = await openNodeOutcomeSupervisionRuntime({
        repositoryRoot: f.root,
        binding: f.binding,
        ports: f.ports,
        runtimeReadiness: f.runtimeReadiness,
      });
      try {
        expect((await runtime.runCycle()).disposition).toBe("uncertain");
        expect(f.counts().effects).toBe(0);
        expect(count).toBe(2);
      } finally {
        await runtime.close();
      }
    },
  );
});
