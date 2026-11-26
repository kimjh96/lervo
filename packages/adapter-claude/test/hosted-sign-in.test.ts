import { rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { createLoginFixture } from "../../adapter-contract/test/login.fixture.js";
import { claudeSignInState } from "../src/hosted-sign-in.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Claude Code sign-in state", () => {
  it.each([
    ["present", true],
    ["absent", false],
    ["malformed", null],
  ] as const)("reports %s as %s", async (state, expected) => {
    const fixture = await createLoginFixture(roots);
    await writeFile(fixture.statePath, state);
    const environment = {
      HOME: fixture.context.homeDirectory,
      CLAUDE_CONFIG_DIR: fixture.context.configurationDirectory,
    };
    expect(await claudeSignInState(fixture.executable, environment)).toBe(expected);
  });

  it("cannot tell for a missing executable", async () => {
    expect(await claudeSignInState("/nonexistent/claude", { HOME: "/nonexistent" })).toBeNull();
  });
});
