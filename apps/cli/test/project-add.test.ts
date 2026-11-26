import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { listRegisteredRepositories } from "@lervo/repository-registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cloneFolderName, newProjectFolderName } from "../src/project-add.js";
import { runCli } from "../src/main.js";

const roots: string[] = [];
let state: string;
const previous = process.env.LERVO_USER_STATE_DIRECTORY;

beforeEach(async () => {
  state = await mkdtemp(resolve(tmpdir(), "lervo-project-add-state-"));
  roots.push(state);
  // The registry and the projects location live here, never in the host's own state.
  process.env.LERVO_USER_STATE_DIRECTORY = state;
});

afterEach(async () => {
  if (previous === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
  else process.env.LERVO_USER_STATE_DIRECTORY = previous;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-project-add-"));
  roots.push(root);
  return root;
}

async function run(args: string[], cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli([...args, "--json"], {
    cwd,
    stdout: (message: string) => out.push(message),
    stderr: (message: string) => err.push(message),
  });
  return { code, value: JSON.parse((code === 0 ? out : err).join("")) as Record<string, unknown> };
}

const isFile = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe("adding a project", () => {
  it("names new folders from ASCII words and links from their last part", () => {
    expect(newProjectFolderName("Todo App with reminders")).toBe("todo-app-with-reminders");
    expect(newProjectFolderName("할 일 앱", new Date("2026-11-26T00:00:00Z"))).toMatch(
      /^project-20261126-[0-9a-f]{4}$/u,
    );
    expect(cloneFolderName("git@github.com:acme/argo.git")).toBe("argo");
    expect(cloneFolderName("https://github.com/acme/argo/")).toBe("argo");
  });

  it("makes a plain folder a registered project, with Git and Lervo initialized", async () => {
    const root = await workspace();
    const folder = join(root, "plain");
    await mkdir(folder);
    const added = await run(["project", "add", "--folder", folder, "--write"], root);
    expect(added).toMatchObject({
      code: 0,
      value: { source: "folder", gitInitialized: true, lervoInitialized: true },
    });
    expect(await isFile(join(folder, ".git"))).toBe(true);
    expect(await isFile(join(folder, ".lervo/project.yaml"))).toBe(true);
    const registered = await listRegisteredRepositories(join(state, "repositories.json"));
    expect(registered.map((entry) => entry.projectId)).toContain(added.value.projectId);
  });

  it("starts a new project in the projects location, keeping the given name", async () => {
    const root = await workspace();
    const into = join(root, "projects");
    expect(
      (await run(["project", "location", "--set", into, "--write"], root)).value,
    ).toMatchObject({
      path: into,
    });
    const added = await run(["project", "add", "--new", "할 일 앱", "--write"], root);
    expect(added.code).toBe(0);
    expect(added.value.displayName).toBe("할 일 앱");
    expect(String(added.value.root).startsWith(into)).toBe(true);
    const profile = JSON.parse(
      await readFile(join(String(added.value.root), ".lervo/project-profile.json"), "utf8"),
    ) as { displayName: string };
    expect(profile.displayName).toBe("할 일 앱");
  });

  it("clones a link once and leaves nothing behind when cloning fails", async () => {
    const root = await workspace();
    const origin = join(root, "argo.git");
    execFileSync("git", ["init", "--quiet", "--bare", origin]);
    const into = join(root, "projects");
    const cloned = await run(
      ["project", "add", "--clone", origin, "--into", into, "--write"],
      root,
    );
    expect(cloned).toMatchObject({ code: 0, value: { source: "clone", name: "argo" } });
    expect(
      (await run(["project", "add", "--clone", origin, "--into", into, "--write"], root)).value,
    ).toMatchObject({
      error: "project_folder_exists",
    });
    const missing = join(root, "missing.git");
    expect(
      (await run(["project", "add", "--clone", missing, "--into", into, "--write"], root)).value,
    ).toMatchObject({
      error: "project_clone_failed",
    });
    expect(await isFile(join(into, "missing"))).toBe(false);
  });

  it("refuses without --write or with two sources", async () => {
    const root = await workspace();
    expect((await run(["project", "add", "--new", "x"], root)).value).toMatchObject({
      error: "write_required",
    });
    expect(
      (await run(["project", "add", "--new", "x", "--folder", root, "--write"], root)).value,
    ).toMatchObject({ error: "project_argument_missing" });
  });
});
