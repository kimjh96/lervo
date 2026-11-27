import { describe, expect, it } from "vitest";

import { firstRunOf } from "../src/features/start/view/first-run";

const core = ["project.rename", "workspace.list"];
const state = (
  loaded: boolean,
  cached: boolean,
  projects: number,
  advertisedCommands: readonly string[] | null,
) => ({ loaded, cached, repositories: Array.from({ length: projects }), advertisedCommands });

describe("the first run", () => {
  it("is the core's empty list from a core that adds projects, with the sidebar folded", () => {
    expect(firstRunOf(state(true, false, 0, core))).toEqual({
      managed: true,
      active: true,
      known: true,
      folded: true,
    });
    // An older core keeps the start card and its sidebar.
    expect(firstRunOf(state(true, false, 0, ["workspace.list"]))).toMatchObject({
      active: false,
      folded: false,
    });
  });

  it("waits for the core when the kept lists hold no project, with the sidebar already folded", () => {
    expect(firstRunOf(state(false, true, 0, null))).toMatchObject({
      known: false,
      folded: true,
    });
  });

  it("lets kept lists with projects stand in, and shows the sidebar", () => {
    expect(firstRunOf(state(false, true, 9, null))).toMatchObject({
      known: true,
      active: false,
      folded: false,
    });
    expect(firstRunOf(state(false, false, 0, null))).toMatchObject({ known: false });
  });
});
