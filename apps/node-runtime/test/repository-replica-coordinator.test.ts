import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    });
    expect(await readFile(join(fixture.local, "source.ts"), "utf8")).toBe("local\n");
    expect(await readFile(join(fixture.peer, "source.ts"), "utf8")).toBe("peer\n");
  }, 15_000);
});
