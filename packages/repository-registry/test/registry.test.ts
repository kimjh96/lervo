import { mkdir, mkdtemp, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { describe, expect, it } from "vitest";

import {
  listRegisteredRepositories,
  registerRepository,
  resolveRegisteredRepository,
} from "../src/index.js";

async function initializedRepository(
  parent: string,
  name: string,
  projectId?: string,
): Promise<string> {
  const root = resolve(parent, name);
  await mkdir(root);
  await applyInitPlan(
    await createInitPlan({ root, name, ...(projectId === undefined ? {} : { projectId }) }),
  );
  return root;
}

describe("user-local repository registry", () => {
  it("registers, lists, and revalidates one canonical Lervo project", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-repository-registry-"));
    const repository = await initializedRepository(root, "alpha");
    const registry = resolve(root, "state/repositories.json");
    const registered = await registerRepository({
      registryPath: registry,
      repositoryRoot: repository,
      now: new Date("2026-08-22T00:00:00.000Z"),
    });
    expect(registered.change).toBe("registered");
    expect(registered.registration.repositoryRoot).toBe(await realpath(repository));
    expect((await listRegisteredRepositories(registry)).map((entry) => entry.projectId)).toEqual([
      registered.registration.projectId,
    ]);
    expect(
      await resolveRegisteredRepository({
        registryPath: registry,
        projectId: registered.registration.projectId,
      }),
    ).toEqual(registered.registration);
    expect((await stat(resolve(root, "state"))).mode & 0o077).toBe(0);
    expect((await stat(registry)).mode & 0o077).toBe(0);
    expect(
      await registerRepository({ registryPath: registry, repositoryRoot: repository }),
    ).toMatchObject({ change: "unchanged" });
  });

  it("requires refresh after manifest bytes change and rejects project/root conflicts", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-repository-registry-"));
    const repository = await initializedRepository(root, "alpha", "prj_abcdefgh12345678");
    const registry = resolve(root, "state/repositories.json");
    await registerRepository({ registryPath: registry, repositoryRoot: repository });
    const manifestPath = resolve(repository, ".lervo/project.yaml");
    const manifest = await readFile(manifestPath, "utf8");
    await writeFile(manifestPath, manifest.replace("name: alpha", "name: renamed"));
    await expect(
      resolveRegisteredRepository({ registryPath: registry, projectId: "prj_abcdefgh12345678" }),
    ).rejects.toMatchObject({ code: "repository_registration_stale" });
    await expect(
      registerRepository({ registryPath: registry, repositoryRoot: repository }),
    ).resolves.toMatchObject({ change: "refreshed" });

    const duplicate = await initializedRepository(root, "duplicate", "prj_abcdefgh12345678");
    await expect(
      registerRepository({ registryPath: registry, repositoryRoot: duplicate }),
    ).rejects.toMatchObject({ code: "repository_project_conflict" });
  });

  it("rejects a symlink root without following it", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-repository-registry-"));
    const repository = await initializedRepository(root, "alpha");
    const link = resolve(root, "linked");
    await symlink(repository, link);
    await expect(
      registerRepository({
        registryPath: resolve(root, "state/repositories.json"),
        repositoryRoot: link,
      }),
    ).rejects.toMatchObject({ code: "repository_root_invalid" });
  });

  it("rejects relative repository and registry paths", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-repository-registry-"));
    const repository = await initializedRepository(root, "alpha");
    await expect(
      registerRepository({ registryPath: "state/repositories.json", repositoryRoot: repository }),
    ).rejects.toMatchObject({ code: "repository_registry_path_invalid" });
    await expect(
      registerRepository({
        registryPath: resolve(root, "state/repositories.json"),
        repositoryRoot: "alpha",
      }),
    ).rejects.toMatchObject({ code: "repository_root_invalid" });
  });
});
