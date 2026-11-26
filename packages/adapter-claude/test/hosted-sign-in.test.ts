import { rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { createLoginFixture } from "../../adapter-contract/test/login.fixture.js";
import { claudeSignInState } from "../src/hosted-sign-in.js";
import { claudeStoredLoginEnvironment } from "../src/login-inspection.js";

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

describe("the stored-login environment", () => {
  it("names a configuration directory only when it is not the default", () => {
    // On macOS, an explicit CLAUDE_CONFIG_DIR, even the default path, selects another keychain
    // entry, so Claude Code would report no login while one is stored.
    const atDefault = claudeStoredLoginEnvironment({
      homeDirectory: "/Users/me",
      configurationDirectory: "/Users/me/.claude",
    });
    expect(atDefault).not.toHaveProperty("CLAUDE_CONFIG_DIR");
    expect(
      claudeStoredLoginEnvironment({
        homeDirectory: "/Users/me",
        configurationDirectory: "/Users/me/profiles/work",
      }).CLAUDE_CONFIG_DIR,
    ).toBe("/Users/me/profiles/work");
  });

  it("keeps the account name, which the keychain lookup needs, and no credential", () => {
    const environment = claudeStoredLoginEnvironment({
      homeDirectory: "/Users/me",
      configurationDirectory: "/Users/me/.claude",
    });
    expect(environment.USER).toBeTruthy();
    expect(environment.LOGNAME).toBe(environment.USER);
    expect(environment).not.toHaveProperty("ANTHROPIC_API_KEY");
  });
});
