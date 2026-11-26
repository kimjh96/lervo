import { beforeEach, describe, expect, it } from "vitest";

import { chooseMark, removeProject, renameProject } from "../src/features/projects/model/changes";
import {
  closeProjectSheet,
  openProjectSheet,
  type ProjectDependencies,
  refreshMarks,
  restoreProjects,
  selectProject,
} from "../src/features/projects/model/controller";
import {
  currentProject,
  managesProjects,
  projectName,
  projectsNeedingYou,
  shortcutProject,
} from "../src/features/projects/model/decisions";
import { useProjectStore } from "../src/features/projects/model/store";
import { useWorkspaceStore } from "../src/features/workspaces/model/store";
import type { Repository, Workspace } from "../src/features/workspaces/model/types";
import { markSquare } from "../src/platform/images/plan";
import { localProjects } from "../src/platform/storage";
import { RequestFailure } from "../src/ports";
import { markColor, markLetter, MARK_COLORS } from "../src/ui/Mark";

const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);

const project = (projectId: string, name: string, extra: Partial<Repository> = {}): Repository => ({
  projectId,
  name,
  ...extra,
});

function workspace(id: string, projectId: string): Workspace {
  return {
    workspaceId: id,
    projectId,
    repositoryName: projectId,
    branch: `lervo/${id}`,
    title: id,
    provider: "claude",
    conversationMode: "native",
    sessionId: `session-${id}`,
    preparedAt: "2026-11-26T00:00:00Z",
  };
}

/** An in-memory `Storage`. */
function storage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

const ALL_COMMANDS = ["project.rename", "project.mark.read", "project.add"];

/** Dependencies whose core answers from `answers`, recording every command it ran. */
function dependencies(
  answers: Record<string, (arguments_: Record<string, unknown>) => unknown>,
  options: { folder?: string | null; image?: string | null } = {},
) {
  const ran: { command: string; arguments_: Record<string, unknown> }[] = [];
  const kept: Record<string, string> = {};
  let selected: string | null = null;
  const value: ProjectDependencies = {
    commands: {
      async run(command, arguments_ = {}) {
        ran.push({ command, arguments_ });
        const answer = answers[command];
        if (answer !== undefined) return (await answer(arguments_)) as never;
        if (command === "workspace.list")
          return { workspaces: [], commands: ALL_COMMANDS } as never;
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
      marks: () => kept,
      keepMark: (sha256, url) => {
        kept[sha256] = url;
      },
    },
    images: {
      prepare: async () => {
        throw new Error("unused");
      },
      prepareMark: async () => btoa("prepared"),
      thumbnail: async (file) => `data:image/png;base64,${btoa(await file.text())}`,
    },
    files: {
      pasted: async () => [],
      describe: async () => [],
      readImage: async (path) => new Blob([`image at ${path}`]),
      reveal: () => undefined,
      watchDrags: () => () => undefined,
    },
    choosers: {
      folder: async () => options.folder ?? null,
      image: async () => options.image ?? null,
    },
  };
  return { value, ran, kept, selected: () => selected };
}

beforeEach(() => {
  useWorkspaceStore.setState({
    repositories: [],
    workspaces: [],
    statuses: {},
    selected: null,
    advertisedCommands: ALL_COMMANDS,
  });
  useProjectStore.setState({
    selected: null,
    marks: {},
    expanded: false,
    renaming: null,
    failure: null,
    sheet: null,
  });
});

describe("project decisions", () => {
  const listed = [project("prj_a", "argo"), project("prj_b", "lervo", { displayName: "Lervo" })];

  it("falls back to the first listed project when the selection is not listed", () => {
    expect(currentProject(listed, "prj_b")?.projectId).toBe("prj_b");
    expect(currentProject(listed, "prj_gone")?.projectId).toBe("prj_a");
    expect(currentProject(listed, null)?.projectId).toBe("prj_a");
    expect(currentProject([], "prj_a")).toBeNull();
  });

  it("shows the display name, or the manifest's name from an older core", () => {
    expect(listed.map(projectName)).toEqual(["argo", "Lervo"]);
  });

  it("dots only projects with a workspace that needs the owner", () => {
    const needing = projectsNeedingYou(
      [workspace("w1", "prj_a"), workspace("w2", "prj_b"), workspace("w3", "prj_b")],
      { "session-w1": "working", "session-w2": "idle", "session-w3": "needs_user" },
    );
    expect([...needing]).toEqual(["prj_b"]);
  });

  it("maps ⌘1 to ⌘9 to the projects in list order", () => {
    expect(shortcutProject(listed, "2")?.projectId).toBe("prj_b");
    expect(shortcutProject(listed, "3")).toBeUndefined();
    expect(shortcutProject(listed, "0")).toBeUndefined();
    expect(shortcutProject(listed, "n")).toBeUndefined();
  });

  it("offers project changes only when the core names the project commands", () => {
    expect(managesProjects(ALL_COMMANDS)).toBe(true);
    expect(managesProjects(["workspace.list"])).toBe(false);
    expect(managesProjects(null)).toBe(false);
  });
});

describe("project actions", () => {
  it("restores the kept selection and marks, and keeps a new selection", () => {
    const deps = dependencies({});
    deps.value.memory.select("prj_b");
    deps.value.memory.keepMark(SHA, "data:image/png;base64,AA==");
    restoreProjects(deps.value.memory);
    expect(useProjectStore.getState()).toMatchObject({
      selected: "prj_b",
      marks: { [SHA]: "data:image/png;base64,AA==" },
    });
  });

  it("shows the start screen when the open workspace belongs to another project", () => {
    const deps = dependencies({});
    useWorkspaceStore.setState({
      workspaces: [workspace("w1", "prj_a"), workspace("w2", "prj_b")],
      selected: "w1",
    });
    useProjectStore.setState({ expanded: true });
    selectProject(deps.value.memory, "prj_a");
    expect(useWorkspaceStore.getState().selected).toBe("w1");
    selectProject(deps.value.memory, "prj_b");
    expect(useWorkspaceStore.getState().selected).toBeNull();
    expect(useProjectStore.getState()).toMatchObject({ selected: "prj_b", expanded: false });
    expect(deps.selected()).toBe("prj_b");
  });

  it("reads each mark it has not kept once, and keeps its thumbnail", async () => {
    const deps = dependencies({
      "project.mark.read": ({ projectId }) => ({
        projectId,
        image: { sha256: OTHER_SHA, mediaType: "image/png", data: btoa("logo") },
      }),
    });
    useProjectStore.setState({ marks: { [SHA]: "data:image/png;base64,kept" } });
    useWorkspaceStore.setState({
      repositories: [
        project("prj_a", "argo", { mark: { sha256: SHA, mediaType: "image/png" } }),
        project("prj_b", "lervo", { mark: { sha256: OTHER_SHA, mediaType: "image/png" } }),
        project("prj_c", "plain", { mark: null }),
      ],
    });
    await refreshMarks(deps.value);
    expect(deps.ran.map((item) => item.arguments_.projectId)).toEqual(["prj_b"]);
    expect(useProjectStore.getState().marks[OTHER_SHA]).toBe(
      `data:image/png;base64,${btoa("logo")}`,
    );
    expect(deps.kept[OTHER_SHA]).toBeDefined();
  });

  it("reads no mark from a core that does not name the command", async () => {
    const deps = dependencies({});
    useWorkspaceStore.setState({
      advertisedCommands: ["workspace.list"],
      repositories: [project("prj_a", "argo", { mark: { sha256: SHA, mediaType: "image/png" } })],
    });
    await refreshMarks(deps.value);
    expect(deps.ran).toEqual([]);
  });

  it("renames, then reloads the lists", async () => {
    const deps = dependencies({
      "project.rename": ({ projectId, name }) => ({ projectId, displayName: name }),
    });
    useProjectStore.setState({ renaming: "prj_a" });
    await renameProject(deps.value, "prj_a", "Argo");
    expect(deps.ran.map((item) => item.command)).toEqual([
      "project.rename",
      "workspace.list",
      "repository.list",
    ]);
    expect(useProjectStore.getState()).toMatchObject({ renaming: null, failure: null });
  });

  it("sends the prepared mark and shows it without reading it back", async () => {
    const deps = dependencies(
      {
        "project.mark.set": ({ projectId }) => ({
          projectId,
          mark: { sha256: SHA, mediaType: "image/png" },
        }),
      },
      { image: "/Users/me/logo.png" },
    );
    await chooseMark(deps.value, "prj_a", "Choose a logo");
    expect(deps.ran[0]).toEqual({
      command: "project.mark.set",
      arguments_: { projectId: "prj_a", data: btoa("prepared") },
    });
    expect(useProjectStore.getState().marks[SHA]).toBe(`data:image/png;base64,${btoa("prepared")}`);
    expect(deps.ran.some((item) => item.command === "project.mark.read")).toBe(false);
  });

  it("changes nothing when the person cancels the image panel", async () => {
    const deps = dependencies({});
    await chooseMark(deps.value, "prj_a", "Choose a logo");
    expect(deps.ran).toEqual([]);
  });

  it("records a failed change's code and keeps the lists", async () => {
    const deps = dependencies({
      "project.unregister": () => {
        throw new RequestFailure("repository_not_registered", "gone");
      },
    });
    await removeProject(deps.value, "prj_a");
    expect(useProjectStore.getState().failure).toBe("repository_not_registered");
    expect(deps.ran.map((item) => item.command)).toEqual(["project.unregister"]);
  });
});

describe("project memory", () => {
  it("keeps the selection and at most 64 valid thumbnails, oldest forgotten first", () => {
    const memory = localProjects(storage());
    expect(memory.selected()).toBeNull();
    memory.select("prj_a");
    expect(memory.selected()).toBe("prj_a");
    for (let index = 0; index < 70; index += 1)
      memory.keepMark(index.toString(16).padStart(64, "0"), `data:image/png;base64,${index}`);
    const marks = memory.marks();
    expect(Object.keys(marks)).toHaveLength(64);
    expect(marks["0".repeat(64)]).toBeUndefined();
    memory.keepMark("not-a-hash", "data:image/png;base64,AA==");
    memory.keepMark(SHA, "https://example.com/logo.png");
    memory.keepMark(OTHER_SHA, `data:image/png;base64,${"A".repeat(70_000)}`);
    expect(Object.keys(memory.marks())).toHaveLength(64);
  });

  it("reads unreadable stored marks as none", () => {
    const kept = storage();
    kept.setItem("lervo.marks", "{not json");
    expect(localProjects(kept).marks()).toEqual({});
  });
});

describe("marks", () => {
  it("draws the center square within 16 to 512 pixels", () => {
    expect(markSquare(1200, 800)).toEqual({ x: 200, y: 0, side: 800, drawn: 512 });
    expect(markSquare(100, 300)).toEqual({ x: 0, y: 100, side: 100, drawn: 100 });
    expect(markSquare(8, 8)).toEqual({ x: 0, y: 0, side: 8, drawn: 16 });
  });

  it("picks the same color for an ID everywhere, within the defined colors", () => {
    expect(markColor("prj_a")).toBe(markColor("prj_a"));
    const colors = new Set(Array.from({ length: 200 }, (_, index) => markColor(`prj_${index}`)));
    expect([...colors].every((color) => color >= 1 && color <= MARK_COLORS)).toBe(true);
    expect(colors.size).toBe(MARK_COLORS);
  });

  it("shows a name's first grapheme, upper-cased when it has case", () => {
    expect(markLetter("argo")).toBe("A");
    expect(markLetter("  할 일 앱")).toBe("할");
    expect(markLetter("👩‍💻 team")).toBe("👩‍💻");
    expect(markLetter("")).toBe("?");
  });
});

describe("adding a project from the switcher", () => {
  it("opens the Clone Repository or New Project window without leaving the screen", () => {
    useWorkspaceStore.setState({ selected: "wsp_1" });
    useProjectStore.setState({ expanded: true });
    openProjectSheet("clone");
    // The open workspace stays: adding a project starts no work.
    expect(useWorkspaceStore.getState().selected).toBe("wsp_1");
    expect(useProjectStore.getState()).toMatchObject({ sheet: "clone", expanded: false });
    closeProjectSheet();
    expect(useProjectStore.getState().sheet).toBeNull();
    openProjectSheet("new");
    selectProject(dependencies({}).value.memory, "prj_a");
    expect(useProjectStore.getState().sheet).toBeNull();
  });
});
