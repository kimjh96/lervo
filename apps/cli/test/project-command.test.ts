import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { registerRepository } from "@lervo/repository-registry";

import { runCli } from "../src/main.js";

function io(cwd: string, stdout: string[], stderr: string[]) {
  return {
    cwd,
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

async function registeredProject() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-project-"));
  const repository = resolve(root, "repository");
  const registry = resolve(root, "state/repositories.json");
  await mkdir(repository);
  expect(
    await runCli(["init", "--minimal", "--root", repository, "--name", "argo"], io(root, [], [])),
  ).toBe(0);
  // Registered through the package, so the test touches no host continuity state.
  const { registration } = await registerRepository({
    registryPath: registry,
    repositoryRoot: repository,
  });
  const projectId = registration.projectId;
  return { root, repository, registry, projectId };
}

async function json(args: string[], cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli([...args, "--json"], io(cwd, out, err));
  return { code, value: JSON.parse((code === 0 ? out : err).join("")) as Record<string, unknown> };
}

describe("project command", () => {
  it("renames and marks a project without staling its registry entry", async () => {
    const { root, repository, registry, projectId } = await registeredProject();
    const manifest = await readFile(resolve(repository, ".lervo/project.yaml"), "utf8");
    const base = ["--project", projectId, "--registry", registry];

    expect((await json(["project", "show", ...base], root)).value).toMatchObject({
      displayName: "argo",
      mark: null,
      profile: "absent",
    });
    const renamed = await json(
      ["project", "rename", ...base, "--name", "Argo Web", "--write"],
      root,
    );
    expect(renamed).toMatchObject({ code: 0, value: { displayName: "Argo Web", name: "argo" } });

    const image = resolve(root, "logo.png");
    await writeFile(image, png(64, 64));
    const marked = await json(
      ["project", "mark", "set", ...base, "--image", image, "--write"],
      root,
    );
    expect(marked.code).toBe(0);
    expect((marked.value.mark as { mediaType: string }).mediaType).toBe("image/png");

    // The manifest is untouched, so the registry still resolves the project.
    expect(await readFile(resolve(repository, ".lervo/project.yaml"), "utf8")).toBe(manifest);
    expect(
      (await json(["repository", "resolve", "--project", projectId, "--registry", registry], root))
        .code,
    ).toBe(0);

    const cleared = await json(["project", "mark", "clear", ...base, "--write"], root);
    expect(cleared.value).toMatchObject({ displayName: "Argo Web", mark: null });
  });

  it("refuses invalid input and changes without --write", async () => {
    const { root, registry, projectId } = await registeredProject();
    const base = ["--project", projectId, "--registry", registry];
    expect((await json(["project", "rename", ...base, "--name", "x"], root)).value).toMatchObject({
      error: "write_required",
    });
    expect(
      (await json(["project", "rename", ...base, "--name", "a\nb", "--write"], root)).value,
    ).toMatchObject({
      error: "project_name_invalid",
    });
    const svg = resolve(root, "logo.svg");
    await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(
      (await json(["project", "mark", "set", ...base, "--image", svg, "--write"], root)).value,
    ).toMatchObject({ error: "project_mark_invalid" });
    expect(
      (
        await json(
          ["project", "show", "--project", "prj_0000000000000000", "--registry", registry],
          root,
        )
      ).value,
    ).toMatchObject({ error: "repository_not_registered" });
  });
});
