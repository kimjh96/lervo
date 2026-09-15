import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  LocalRepositoryReplicaPeer,
  RepositoryReplicaCoordinator,
} from "../src/repository-replica-coordinator.js";

const execute = promisify(execFile);
const roots: string[] = [];

async function git(root: string, ...args: string[]): Promise<void> {
  await execute("git", ["-C", root, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
    },
  });
}

async function repositories(): Promise<{ local: string; peer: string; stateFile: string }> {
  const local = await mkdtemp(join(tmpdir(), "lervo-replica-coordinator-"));
  roots.push(local);
  await git(local, "init", "-b", "main");
  await writeFile(join(local, "source.ts"), "const initial = true;\n");
  await writeFile(join(local, ".gitignore"), ".lervo/\n");
  await git(local, "add", ".");
  await git(local, "commit", "-m", "fixture");
  const peer = await mkdtemp(join(tmpdir(), "lervo-replica-peer-"));
  await rm(peer, { recursive: true, force: true });
  roots.push(peer);
  await execute("git", ["clone", "--quiet", local, peer]);
  const state = await mkdtemp(join(tmpdir(), "lervo-replica-state-"));
  roots.push(state);
  return { local, peer, stateFile: join(state, "replicas.json") };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository replica coordinator", () => {
  it("preserves every replica entry when independent reconciliations complete concurrently", async () => {
    const first = await repositories();
    const second = await repositories();
    const coordinator = new RepositoryReplicaCoordinator({
      stateFile: first.stateFile,
      local: new LocalRepositoryReplicaPeer(),
      peer: new LocalRepositoryReplicaPeer(),
      now: () => new Date("2026-09-16T00:00:00.000Z"),
    });

    await Promise.all([
      coordinator.reconcile({
        replicaId: "first",
        localRoot: first.local,
        peerRoot: first.peer,
      }),
      coordinator.reconcile({
        replicaId: "second",
        localRoot: second.local,
        peerRoot: second.peer,
      }),
    ]);

    const state = JSON.parse(await readFile(first.stateFile, "utf8")) as {
      replicas: Record<string, unknown>;
    };
    expect(Object.keys(state.replicas).sort()).toEqual(["first", "second"]);
  });

  it("continues exact uncommitted bytes in both directions and blocks dual divergence", async () => {
    const fixture = await repositories();
    const coordinator = new RepositoryReplicaCoordinator({
      stateFile: fixture.stateFile,
      local: new LocalRepositoryReplicaPeer(),
      peer: new LocalRepositoryReplicaPeer(),
      now: () => new Date("2026-09-10T09:00:00.000Z"),
    });
    const coordinates = {
      replicaId: "project",
      localRoot: fixture.local,
      peerRoot: fixture.peer,
    };
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({
      status: "current",
    });

    await writeFile(join(fixture.local, "source.ts"), "const a =");
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({ status: "pushed" });
    expect(await readFile(join(fixture.peer, "source.ts"), "utf8")).toBe("const a =");

    await writeFile(join(fixture.peer, "source.ts"), "const a = 1;");
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({ status: "pulled" });
    expect(await readFile(join(fixture.local, "source.ts"), "utf8")).toBe("const a = 1;");

    await git(fixture.local, "switch", "-c", "feature");
    await writeFile(join(fixture.local, "source.ts"), "const a = 2;");
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({ status: "pushed" });
    expect(
      (
        await execute("git", ["-C", fixture.peer, "branch", "--show-current"], {
          encoding: "utf8",
        })
      ).stdout.trim(),
    ).toBe("feature");
    expect(await readFile(join(fixture.peer, "source.ts"), "utf8")).toBe("const a = 2;");

    await writeFile(join(fixture.local, "source.ts"), "local\n");
    await writeFile(join(fixture.peer, "source.ts"), "peer\n");
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({
      status: "divergent",
      conflict: { reason: "conflicting_paths", paths: ["source.ts"], pathCount: 1 },
    });
    expect(await readFile(join(fixture.local, "source.ts"), "utf8")).toBe("local\n");
    expect(await readFile(join(fixture.peer, "source.ts"), "utf8")).toBe("peer\n");
  }, 15_000);

  it("merges non-conflicting changes from both sides and keeps uncommitted work uncommitted", async () => {
    const fixture = await repositories();
    const coordinator = new RepositoryReplicaCoordinator({
      stateFile: fixture.stateFile,
      local: new LocalRepositoryReplicaPeer(),
      peer: new LocalRepositoryReplicaPeer(),
      now: () => new Date("2026-09-15T00:00:00.000Z"),
    });
    const coordinates = { replicaId: "project", localRoot: fixture.local, peerRoot: fixture.peer };
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({ status: "current" });

    await writeFile(join(fixture.local, "local-committed.ts"), "export const local = 1;\n");
    await git(fixture.local, "add", "local-committed.ts");
    await git(fixture.local, "commit", "-m", "local work");
    await writeFile(join(fixture.local, "local-draft.ts"), "const draft =");
    await writeFile(join(fixture.peer, "peer-committed.ts"), "export const peer = 1;\n");
    await git(fixture.peer, "add", "peer-committed.ts");
    await git(fixture.peer, "commit", "-m", "peer work");
    await writeFile(join(fixture.peer, "source.ts"), "const initial = false;\n");

    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({ status: "merged" });
    for (const root of [fixture.local, fixture.peer]) {
      expect(await readFile(join(root, "local-committed.ts"), "utf8")).toBe(
        "export const local = 1;\n",
      );
      expect(await readFile(join(root, "peer-committed.ts"), "utf8")).toBe(
        "export const peer = 1;\n",
      );
      expect(await readFile(join(root, "local-draft.ts"), "utf8")).toBe("const draft =");
      expect(await readFile(join(root, "source.ts"), "utf8")).toBe("const initial = false;\n");
      const status = (
        await execute("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" })
      ).stdout;
      expect(status).toContain("?? local-draft.ts");
      expect(status).toContain(" M source.ts");
      const parents = (
        await execute("git", ["-C", root, "show", "-s", "--format=%P", "HEAD"], {
          encoding: "utf8",
        })
      ).stdout
        .trim()
        .split(" ");
      expect(parents).toHaveLength(2);
    }
    const localReceipt = JSON.parse(
      await readFile(join(fixture.local, ".lervo/state/repository-replica.json"), "utf8"),
    ) as { status: string };
    const peerReceipt = JSON.parse(
      await readFile(join(fixture.peer, ".lervo/state/repository-replica.json"), "utf8"),
    ) as { status: string };
    expect(localReceipt.status).toBe("merged");
    expect(peerReceipt.status).toBe("pushed");
    await expect(coordinator.reconcile(coordinates)).resolves.toMatchObject({ status: "current" });
  }, 20_000);

  it("resolves generated knowledge conflicts locally and honours a prefer_local policy elsewhere", async () => {
    const fixture = await repositories();
    const coordinator = new RepositoryReplicaCoordinator({
      stateFile: fixture.stateFile,
      local: new LocalRepositoryReplicaPeer(),
      peer: new LocalRepositoryReplicaPeer(),
      now: () => new Date("2026-09-15T00:00:00.000Z"),
    });
    const hold = { replicaId: "project", localRoot: fixture.local, peerRoot: fixture.peer };
    await expect(coordinator.reconcile(hold)).resolves.toMatchObject({ status: "current" });
    await mkdir(join(fixture.local, ".lervo/knowledge"), { recursive: true });
    await writeFile(join(fixture.local, ".gitignore"), ".lervo/state/\n");
    await writeFile(join(fixture.local, ".lervo/knowledge/index.yaml"), "seed: 0\n");
    await git(fixture.local, "add", ".");
    await git(fixture.local, "commit", "-m", "knowledge seed");
    await expect(coordinator.reconcile(hold)).resolves.toMatchObject({ status: "pushed" });

    await writeFile(join(fixture.local, ".lervo/knowledge/index.yaml"), "seed: 1\n");
    await writeFile(join(fixture.peer, ".lervo/knowledge/index.yaml"), "seed: 2\n");
    await expect(coordinator.reconcile(hold)).resolves.toMatchObject({ status: "merged" });
    expect(await readFile(join(fixture.peer, ".lervo/knowledge/index.yaml"), "utf8")).toBe(
      "seed: 1\n",
    );

    await writeFile(join(fixture.local, "source.ts"), "local wins\n");
    await writeFile(join(fixture.peer, "source.ts"), "peer loses\n");
    await expect(coordinator.reconcile(hold)).resolves.toMatchObject({
      status: "divergent",
      conflict: { paths: ["source.ts"] },
    });
    await expect(
      coordinator.reconcile({ ...hold, conflictPolicy: "prefer_local" }),
    ).resolves.toMatchObject({ status: "merged" });
    expect(await readFile(join(fixture.peer, "source.ts"), "utf8")).toBe("local wins\n");
  }, 20_000);
});
