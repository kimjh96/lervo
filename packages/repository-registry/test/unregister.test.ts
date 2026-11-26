import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  listRegisteredRepositories,
  registerRepository,
  RepositoryRegistryError,
  unregisterRepository,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function project(root: string, name: string, projectId: string): Promise<string> {
  const repository = resolve(root, name);
  await mkdir(resolve(repository, ".lervo"), { recursive: true });
  await writeFile(
    resolve(repository, ".lervo/project.yaml"),
    `schemaVersion: 1\nprojectId: ${projectId}\nname: ${name}\nroot: .\ncreatedAt: 2026-11-26T00:00:00.000Z\ndataPolicy:\n  eventMetadataRetentionDays: 90\n  artifactRetentionDays: 30\n  persistRawPrompts: false\n  persistDocumentBodiesInEvents: false\n  hubSyncEnabled: false\n  eventPayloadMode: allowlist\n`,
  );
  return repository;
}

describe("unregistering a repository", () => {
  it("removes only this host's entry and leaves the project's files", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-unregister-"));
    roots.push(root);
    const registryPath = resolve(root, "state/repositories.json");
    const argo = await project(root, "argo", "prj_00000000000000a1");
    const lervo = await project(root, "lervo", "prj_00000000000000b2");
    await registerRepository({ registryPath, repositoryRoot: argo });
    await registerRepository({ registryPath, repositoryRoot: lervo });
    const manifest = await readFile(resolve(argo, ".lervo/project.yaml"), "utf8");

    const result = await unregisterRepository({ registryPath, projectId: "prj_00000000000000a1" });
    expect(result.change).toBe("unregistered");
    expect((await listRegisteredRepositories(registryPath)).map((entry) => entry.name)).toEqual([
      "lervo",
    ]);
    expect(await readFile(resolve(argo, ".lervo/project.yaml"), "utf8")).toBe(manifest);

    // Registering it again brings it back.
    await registerRepository({ registryPath, repositoryRoot: argo });
    expect((await listRegisteredRepositories(registryPath)).length).toBe(2);
  });

  it("fails for a project this host does not list", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-unregister-"));
    roots.push(root);
    const registryPath = resolve(root, "state/repositories.json");
    await expect(
      unregisterRepository({ registryPath, projectId: "prj_00000000000000c3" }),
    ).rejects.toMatchObject({ code: "repository_not_registered" });
    await expect(unregisterRepository({ registryPath, projectId: "nope" })).rejects.toBeInstanceOf(
      RepositoryRegistryError,
    );
  });
});
