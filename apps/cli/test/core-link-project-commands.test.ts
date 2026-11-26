import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CommandFailure } from "../src/command-error-output.js";
import { runCoreLinkProjectCommand } from "../src/core-link-project-commands.js";
import { listRepositories } from "../src/workspace-list-service.js";

const roots: string[] = [];
const previous = process.env.LERVO_USER_STATE_DIRECTORY;

beforeEach(async () => {
  const state = await mkdtemp(resolve(tmpdir(), "lervo-core-link-projects-state-"));
  roots.push(state);
  // The registry and the projects location live here, never in the host's own state.
  process.env.LERVO_USER_STATE_DIRECTORY = state;
});

afterEach(async () => {
  if (previous === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
  else process.env.LERVO_USER_STATE_DIRECTORY = previous;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function pngBase64(side: number): string {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, side);
  new DataView(bytes.buffer).setUint32(20, side);
  return Buffer.from(bytes).toString("base64");
}

describe("the core link's project commands", () => {
  it("adds, names, marks, lists, and unregisters a project", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-core-link-projects-"));
    roots.push(root);
    const into = join(root, "projects");
    expect(await runCoreLinkProjectCommand("projects.location", { path: into })).toEqual({
      path: into,
    });
    expect(await runCoreLinkProjectCommand("projects.location", {})).toEqual({ path: into });

    const added = (await runCoreLinkProjectCommand("project.add", {
      source: "new",
      name: "Todo App",
    })) as {
      projectId: string;
      root: string;
    };
    expect(added).toMatchObject({ source: "new", displayName: "Todo App", name: "todo-app" });
    const { projectId } = added;

    expect(
      await runCoreLinkProjectCommand("project.rename", { projectId, name: "할 일 앱" }),
    ).toEqual({
      projectId,
      displayName: "할 일 앱",
    });
    const marked = (await runCoreLinkProjectCommand("project.mark.set", {
      projectId,
      data: pngBase64(64),
    })) as {
      mark: { sha256: string; mediaType: string };
    };
    expect(marked.mark.mediaType).toBe("image/png");
    const read = (await runCoreLinkProjectCommand("project.mark.read", { projectId })) as {
      image: { sha256: string; data: string } | null;
    };
    expect(read.image?.sha256).toBe(marked.mark.sha256);
    expect(read.image?.data).toBe(pngBase64(64));

    expect((await listRepositories()).repositories).toContainEqual({
      projectId,
      name: "todo-app",
      displayName: "할 일 앱",
      mark: marked.mark,
      root: added.root,
    });

    expect(await runCoreLinkProjectCommand("project.mark.clear", { projectId })).toEqual({
      projectId,
    });
    expect(await runCoreLinkProjectCommand("project.mark.read", { projectId })).toEqual({
      projectId,
      image: null,
    });
    expect(await runCoreLinkProjectCommand("project.unregister", { projectId })).toEqual({
      projectId,
    });
    expect((await listRepositories()).repositories).toEqual([]);
  });

  it("answers failures with their stable codes", async () => {
    const failure = (command: string, arguments_: Record<string, unknown>) =>
      runCoreLinkProjectCommand(command, arguments_).then(
        () => "answered",
        (error: unknown) => (error instanceof CommandFailure ? error.code : "other"),
      );
    expect(await failure("project.rename", { projectId: "prj_0000000000000000", name: "x" })).toBe(
      "repository_not_registered",
    );
    expect(await failure("project.add", { source: "upload" })).toBe("project_argument_missing");
    expect(await failure("project.add", { source: "folder", path: "relative/path" })).toBe(
      "project_root_invalid",
    );
    expect(await failure("projects.location", { path: "relative" })).toBe(
      "projects_location_invalid",
    );
  });
});
