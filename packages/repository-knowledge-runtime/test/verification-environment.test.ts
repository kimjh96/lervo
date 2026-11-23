import { expect, it } from "vitest";

import { verificationEnvironment } from "../src/verification-environment.js";

const detected =
  (path: string, failure: "login_shell_failed" | null = null) =>
  async () => ({
    paths: { codex: [], claude: [] },
    environment: { HOME: "/home/owner", SHELL: "/bin/zsh", PATH: path },
    failure,
  });

it("runs verification with the owner's login-shell PATH, so a suite finds pnpm", async () => {
  const environment = await verificationEnvironment(detected("/opt/homebrew/bin:/usr/bin:/bin"));
  expect(environment.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
});

it("keeps the service PATH when the login-shell lookup fails", async () => {
  const environment = await verificationEnvironment(detected("/ignored", "login_shell_failed"));
  expect(environment.PATH).toBe(process.env.PATH);
  const thrown = await verificationEnvironment(async () => {
    throw new Error("no shell");
  });
  expect(thrown.PATH).toBe(process.env.PATH);
});

it("runs every convergence suite through the environment helper", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const { resolve } = await import("node:path");
  const source = resolve(import.meta.dirname, "../src");
  const direct: string[] = [];
  for (const name of await readdir(source)) {
    if (!name.endsWith(".ts") || name === "verification-environment.ts") continue;
    if (/\brunVerificationSuite\s*\(/u.test(await readFile(resolve(source, name), "utf8")))
      direct.push(name);
  }
  // A direct call would run under the service manager's PATH, where `pnpm` is missing.
  expect(direct).toEqual([]);
});
