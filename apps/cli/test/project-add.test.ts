import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

const git = (cwd: string, ...arguments_: string[]) =>
  execFileSync("git", ["-C", cwd, ...arguments_], { encoding: "utf8" }).trim();

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
    // The owner's folder is never committed for them.
    expect(git(folder, "rev-list", "-n", "1", "--all")).toBe("");
  });

  it("packages a cloned Lervo project's skills, as lervo init would", async () => {
    const root = await workspace();
    const origin = join(root, "origin");
    await mkdir(join(origin, ".agents/skills/notes"), { recursive: true });
    await writeFile(
      join(origin, ".agents/skills/notes/SKILL.md"),
      "---\nname: notes\ndescription: Keeps notes.\n---\n\n# Notes\n",
    );
    expect((await run(["project", "add", "--folder", origin, "--write"], root)).code).toBe(0);
    git(origin, "add", ".agents", ".lervo/project.yaml");
    git(
      origin,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@localhost",
      "commit",
      "-qm",
      "Start",
    );
    const clone = join(root, "clone");
    git(root, "clone", "--quiet", origin, clone);
    expect(await isFile(join(clone, ".lervo/capabilities"))).toBe(false);
    // Another registry, as when the owner adds the clone after unregistering the first checkout.
    process.env.LERVO_USER_STATE_DIRECTORY = await workspace();
    const added = await run(["project", "add", "--folder", clone, "--write"], root);
    expect(added).toMatchObject({ code: 0, value: { lervoInitialized: false } });
    expect(await readdir(join(clone, ".lervo/capabilities/packages"))).toEqual([
      expect.stringContaining("notes"),
    ]);
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
    // A new project starts with a commit, which holds the profile, so work can start at once.
    const created = String(added.value.root);
    expect(git(created, "log", "--format=%s")).toBe("Start the project with Lervo");
    expect(git(created, "ls-files")).toContain(".lervo/project-profile.json");
    expect(git(created, "status", "--porcelain")).toBe("");
  });

  it("removes a new project's folder when adding it fails", async () => {
    const root = await workspace();
    const into = join(root, "projects");
    expect((await run(["project", "location", "--set", into, "--write"], root)).code).toBe(0);
    // A user state directory others can read makes the registry refuse the project.
    await chmod(state, 0o755);
    const added = await run(["project", "add", "--new", "Broken start", "--write"], root);
    expect(added.code).toBe(1);
    expect(await isFile(join(into, "broken-start"))).toBe(false);
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

  it("refuses a projects location inside a Git work tree", async () => {
    const root = await workspace();
    // A checkout at ~/lervo is also ~/Lervo on a case-insensitive Mac.
    const checkout = join(root, "lervo");
    await mkdir(checkout);
    git(checkout, "init", "--quiet");
    const inside = join(checkout, "projects");
    expect(
      (await run(["project", "location", "--set", inside, "--write"], root)).value,
    ).toMatchObject({ error: "projects_location_invalid" });
    expect(
      (await run(["project", "add", "--new", "Todo app", "--into", checkout, "--write"], root))
        .value,
    ).toMatchObject({ error: "projects_location_invalid" });
    expect(await isFile(join(checkout, "todo-app"))).toBe(false);
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
