import { beforeEach, describe, expect, it } from "vitest";

import {
  type AddDependencies,
  addFolder,
  addFromSource,
  useAddStore,
} from "../src/features/projects/model/add";
import { folderNameFor, linkName, projectSourceOf } from "../src/features/projects/model/sources";
import { useProjectStore } from "../src/features/projects/model/store";
import { shortPath } from "../src/features/projects/view/AddProjectSheet";
import { useWorkspaceStore } from "../src/features/workspaces/model/store";
import { RequestFailure } from "../src/ports";

/** Dependencies whose core answers from `answers`, recording every command it ran. */
function dependencies(answers: Record<string, (arguments_: Record<string, unknown>) => unknown>) {
  const ran: { command: string; arguments_: Record<string, unknown> }[] = [];
  let selected: string | null = null;
  const value: AddDependencies = {
    commands: {
      async run(command, arguments_ = {}) {
        ran.push({ command, arguments_ });
        const answer = answers[command];
        if (answer !== undefined) return (await answer(arguments_)) as never;
        if (command === "workspace.list") return { workspaces: [], commands: [] } as never;
        if (command === "repository.list") return { repositories: [] } as never;
        throw new Error(`unexpected ${command}`);
      },
    },
    lists: { load: () => null, save: () => undefined },
    memory: {
      selected: () => selected,
      select: (projectId) => {
        selected = projectId;
      },
      marks: () => ({}),
      keepMark: () => undefined,
    },
    choosers: { folder: async () => null, image: async () => null },
  };
  return { value, ran };
}

const added = (projectId: string, name: string) => () => ({
  projectId,
  name,
  displayName: name,
  root: `/Users/me/Lervo/${name}`,
  source: "new",
});

beforeEach(() => {
  useAddStore.setState({ location: "/Users/me/Lervo", adding: null, failure: null });
  useProjectStore.setState({ selected: null });
  useWorkspaceStore.setState({ workspaces: [], repositories: [], selected: null });
});

describe("reading where a project comes from", () => {
  it("clones a lone repository link and names it after the repository", () => {
    expect(projectSourceOf("git@github.com:acme/argo.git")).toEqual({
      kind: "clone",
      url: "git@github.com:acme/argo.git",
      name: "argo",
    });
    expect(projectSourceOf("  https://github.com/acme/argo-web  ")).toMatchObject({
      kind: "clone",
      name: "argo-web",
    });
    expect(linkName("https://example.com/")).toBe("example.com");
  });

  it("starts a new project named after the text's first words", () => {
    expect(projectSourceOf("Build a todo app with reminders")).toEqual({
      kind: "new",
      name: "Build a todo app with reminders",
    });
    expect(projectSourceOf("할 일 앱을 만들어 줘\n알림도 있으면 좋겠어")).toEqual({
      kind: "new",
      name: "할 일 앱을 만들어 줘",
    });
    // A link inside a sentence is work about it, not a clone.
    expect(projectSourceOf("Fix the build in https://github.com/acme/argo")?.kind).toBe("new");
    expect(projectSourceOf("   ")).toBeNull();
  });

  it("shows the projects location under the home folder with a tilde, and names a new folder", () => {
    expect(shortPath("/Users/me/Lervo")).toBe("~/Lervo");
    expect(shortPath("/home/me")).toBe("~");
    expect(shortPath("/Volumes/Work/Lervo")).toBe("/Volumes/Work/Lervo");
    // A new project's folder follows its name's ASCII words, as the core names it.
    expect(folderNameFor("Todo app")).toBe("todo-app");
    expect(folderNameFor("할 일 앱")).toBeNull();
  });
});

describe("adding a project", () => {
  it("clones into the location and selects the new project, starting no work", async () => {
    const deps = dependencies({ "project.add": added("prj_argo", "argo") });
    await addFromSource(deps.value, {
      kind: "clone",
      url: "git@host:acme/argo.git",
      name: "argo",
    });
    expect(deps.ran[0]).toEqual({
      command: "project.add",
      arguments_: { source: "clone", url: "git@host:acme/argo.git", into: "/Users/me/Lervo" },
    });
    expect(useProjectStore.getState().selected).toBe("prj_argo");
    expect(deps.ran.some((item) => item.command === "workspace.start")).toBe(false);
  });

  it("creates a project from a name and starts no work", async () => {
    const deps = dependencies({ "project.add": added("prj_todo", "todo") });
    expect(await addFromSource(deps.value, { kind: "new", name: "Todo" })).toEqual({
      projectId: "prj_todo",
      name: "todo",
    });
    expect(deps.ran[0]?.arguments_).toEqual({
      source: "new",
      name: "Todo",
      into: "/Users/me/Lervo",
    });
    expect(deps.ran.some((item) => item.command === "workspace.start")).toBe(false);
  });

  it("records a failed add's code", async () => {
    const deps = dependencies({
      "project.add": () => {
        throw new RequestFailure("project_folder_exists", "exists");
      },
    });
    expect(await addFromSource(deps.value, { kind: "new", name: "Todo" })).toBeNull();
    expect(useAddStore.getState()).toMatchObject({
      failure: "project_folder_exists",
      adding: null,
    });
  });

  it("adds a dropped or chosen folder as a project", async () => {
    const deps = dependencies({ "project.add": added("prj_web", "web") });
    await addFolder(deps.value, "/Users/me/web");
    expect(deps.ran[0]?.arguments_).toEqual({ source: "folder", path: "/Users/me/web" });
    expect(useProjectStore.getState().selected).toBe("prj_web");
  });
});
