import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";

import { ghRunner } from "../src/knowledge-publication-github-cli.js";
import {
  rememberedToolEnvironment,
  TOOL_ENVIRONMENT_RETRY_MS,
  toolEnvironment,
} from "../src/tool-environment.js";

const detected =
  (path: string, failure: "login_shell_failed" | null = null) =>
  async () => ({
    paths: { codex: [], claude: [] },
    environment: { HOME: "/home/owner", SHELL: "/bin/zsh", PATH: path },
    failure,
  });

it("uses the login-shell PATH and reports whether the lookup succeeded", async () => {
  expect(await toolEnvironment(detected("/opt/homebrew/bin:/usr/bin"))).toMatchObject({
    environment: { PATH: "/opt/homebrew/bin:/usr/bin" },
    detected: true,
  });
  expect(await toolEnvironment(detected("/ignored", "login_shell_failed"))).toEqual({
    environment: process.env,
    detected: false,
  });
});

it("keeps a found environment and looks again a pause after a failed lookup", async () => {
  const answers = [
    detected("/ignored", "login_shell_failed"),
    detected("/opt/homebrew/bin"),
    detected("/never"),
  ];
  let calls = 0;
  let clock = 0;
  const environment = rememberedToolEnvironment(
    () => answers[calls++]!(),
    () => clock,
  );
  expect((await environment()).PATH).toBe(process.env.PATH);
  // Within the pause the service PATH stands without another lookup.
  clock += TOOL_ENVIRONMENT_RETRY_MS - 1;
  expect((await environment()).PATH).toBe(process.env.PATH);
  expect(calls).toBe(1);
  clock += 1;
  expect((await environment()).PATH).toBe("/opt/homebrew/bin");
  expect((await environment()).PATH).toBe("/opt/homebrew/bin");
  expect(calls).toBe(2);
});

it("finds gh on the login-shell PATH that the service PATH lacks", async () => {
  const bin = await mkdtemp(resolve(tmpdir(), "lervo-gh-path-"));
  try {
    await writeFile(
      resolve(bin, "lervo-test-gh"),
      '#!/bin/sh\nprintf "%s:%s" "$GH_PROMPT_DISABLED" "$1"\n',
      { mode: 0o755 },
    );
    const run = ghRunner(bin, "lervo-test-gh", async () => ({ ...process.env, PATH: bin }));
    expect(await run(["api"])).toBe("1:api");
    // Under the service PATH alone the same program is missing.
    await expect(
      ghRunner(bin, "lervo-test-gh", async () => process.env)(["api"]),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(bin, { recursive: true, force: true });
  }
});

it("runs every gh call of knowledge publication with the tool environment", async () => {
  const source = resolve(import.meta.dirname, "../src");
  const bare: string[] = [];
  for (const name of await readdir(source)) {
    if (!name.endsWith(".ts")) continue;
    const text = await readFile(resolve(source, name), "utf8");
    // GH_PROMPT_DISABLED marks a gh call; under the service PATH alone, gh is missing.
    if (text.includes("GH_PROMPT_DISABLED") && !text.includes('from "./tool-environment.js"'))
      bare.push(name);
  }
  expect(bare).toEqual([]);
});
