import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { locateRepositoryEvent, needsRecursiveWatch } from "../src/repository-change-bases.js";

const root = { logical: join("/", "work", "repository"), real: join("/", "private", "repository") };
const git = { logical: join(root.logical, ".git"), real: join(root.real, ".git") };
const state = { logical: join(root.logical, ".lervo/state"), real: join("/", "outside", "state") };
const bases = [root, git, state];

describe("repository watch bases", () => {
  it("opens a base only when its real path lies outside every watched real path", () => {
    expect(needsRecursiveWatch(git, [root], false)).toBe(false);
    expect(needsRecursiveWatch(state, [root], false)).toBe(true);
    expect(needsRecursiveWatch(state, [root, state], false)).toBe(false);
    const upper = { logical: git.logical, real: join("/", "PRIVATE", "Repository", ".git") };
    expect(needsRecursiveWatch(upper, [root], false)).toBe(true);
    expect(needsRecursiveWatch(upper, [root], true)).toBe(false);
  });

  it("reports events in the logical frame of the most specific base", () => {
    expect(locateRepositoryEvent(root, "source/file.ts", bases, false)).toEqual({
      base: root.logical,
      filename: "source/file.ts",
    });
    expect(locateRepositoryEvent(root, ".git/HEAD", bases, false)).toEqual({
      base: git.logical,
      filename: "HEAD",
    });
    expect(locateRepositoryEvent(state, "repository-replica-request.json", bases, false)).toEqual({
      base: state.logical,
      filename: "repository-replica-request.json",
    });
  });

  it("keeps a missing filename and maps the watched base itself to an empty name", () => {
    expect(locateRepositoryEvent(root, undefined, bases, false)).toEqual({
      base: root.logical,
      filename: undefined,
    });
    expect(locateRepositoryEvent(root, root.real, bases, false)).toEqual({
      base: root.logical,
      filename: "",
    });
  });
});
