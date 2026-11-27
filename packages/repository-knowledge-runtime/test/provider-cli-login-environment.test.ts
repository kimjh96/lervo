import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from "node:fs/promises";
import { noCapabilityJsonInvocationStrategy } from "../src/no-capability-json-strategy.js";
import { tmpdir, userInfo } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createNoCapabilityProviderJsonRunner,
  probeProviderCli,
} from "@lervo/repository-knowledge-compiler";
import {
  defaultProviderCliDetectionPorts,
  detectProviderCliPaths,
  identifyProviderCli,
} from "../src/provider-cli-detection.js";
import { runProviderCliCommand } from "../src/provider-cli-command.js";
import { providerOutputSchema } from "@lervo/schemas";

const roots: string[] = [];
vi.mock("node:os", async (original) => {
  const os = await original<typeof import("node:os")>();
  return { ...os, userInfo: vi.fn(os.userInfo) };
});
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it.each(["login", "fallback"])(
  "detects and executes with empty HOME and SHELL through %s discovery",
  async (mode) => {
    const home = await mkdtemp(resolve(tmpdir(), "lervo-empty-environment-"));
    roots.push(home);
    const bin = resolve(home, ".local/bin");
    await mkdir(bin, { recursive: true });
    const shell = resolve(home, mode === "login" ? "login-shell" : "missing-shell");
    if (mode === "login")
      await writeFile(
        shell,
        `#!/bin/sh\nPATH='${bin}:/usr/bin:/bin'\nexport PATH\nscript=$2\nshift 3\neval "$script"\n`,
        { mode: 0o700 },
      );
    vi.mocked(userInfo).mockReturnValue({
      uid: 1,
      gid: 1,
      username: "owner",
      homedir: home,
      shell,
    });
    vi.stubEnv("HOME", "");
    vi.stubEnv("SHELL", "");
    vi.stubEnv("PATH", "/missing-service-path");
    const executable = resolve(bin, "claude");
    await writeFile(
      executable,
      `#!${process.execPath}
if (process.env.HOME !== '${home}' || process.env.SHELL !== '${shell}') process.exit(1);
if (process.argv.includes('--version')) { console.log('2.1.308'); process.exit(0); }
const structured = process.argv.includes('--json-schema');
console.log(JSON.stringify({is_error:false,result:'{"ok":true}',...(structured ? {structured_output:{ok:true}} : {}),stop_reason:structured ? 'tool_use' : 'end_turn',num_turns:structured ? 2 : 1,permission_denials:[],usage:{server_tool_use:{web_search_requests:0,web_fetch_requests:0}}}));
`,
      { mode: 0o700 },
    );
    const ports = { ...defaultProviderCliDetectionPorts(), prefixes: [] };
    const detected = await detectProviderCliPaths(ports);
    expect(detected.failure).toBe(mode === "login" ? null : "login_shell_failed");
    expect(detected.paths.claude).toContain(executable);
    const identity = (await identifyProviderCli(
      "claude",
      executable,
      ports,
      detected.environment,
    ))!;
    expect(identity.environment).toMatchObject({ HOME: home, SHELL: shell });
    expect(
      (
        await probeProviderCli({
          ...identity,
          strategy: noCapabilityJsonInvocationStrategy(identity.provider),
        })
      ).admitted,
    ).toBe(true);
    const runner = await createNoCapabilityProviderJsonRunner({
      ...identity,
      strategy: noCapabilityJsonInvocationStrategy(identity.provider),
    });
    expect(
      await runner.resolve({
        task: "background",
        responseContract: {
          schema: providerOutputSchema({
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
          }),
        },
      }),
    ).toEqual({ ok: true });
    expect(process.env.HOME).toBe("");
    expect(process.env.SHELL).toBe("");
  },
);

it("uses the login Node for version, admission and execution of an env-node CLI, keeping its shim name", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "lervo-login-path-"));
  roots.push(home);
  const bin = resolve(home, "login-bin");
  const service = resolve(home, "service-bin");
  await mkdir(bin);
  await mkdir(service);
  const log = resolve(home, "node-log");
  await writeFile(
    resolve(bin, "node"),
    `#!/bin/sh\nprintf 'login\\n' >> '${log}'\nexec '${process.execPath}' "$@"\n`,
    { mode: 0o700 },
  );
  await writeFile(
    resolve(service, "node"),
    `#!/bin/sh\nprintf 'service\\n' >> '${log}'\nexit 1\n`,
    { mode: 0o700 },
  );
  const target = resolve(home, "cli.mjs");
  await writeFile(
    target,
    `#!/usr/bin/env node
if (process.argv[1].split('/').at(-1) !== 'claude') process.exit(1);
if (process.argv.includes('--version')) { console.log('2.1.308'); process.exit(0); }
const structured = process.argv.includes('--json-schema');
console.log(JSON.stringify({ is_error: false, result: '{"ok":true}', ...(structured ? { structured_output: {ok: true} } : {}), stop_reason: structured ? 'tool_use' : 'end_turn', num_turns: structured ? 2 : 1, permission_denials: [], usage: { server_tool_use: {web_search_requests:0,web_fetch_requests:0} } }));
`,
    { mode: 0o700 },
  );
  const executable = resolve(bin, "claude");
  await symlink(target, executable);
  const shell = resolve(home, "login-shell");
  await writeFile(
    shell,
    `#!/bin/sh\nPATH='${bin}:/usr/bin:/bin'\nexport PATH\nscript=$2\nshift 3\neval "$script"\n`,
    { mode: 0o700 },
  );
  vi.stubEnv("PATH", service);
  const ports = { home, shell, command: runProviderCliCommand, prefixes: [] };
  const detection = await detectProviderCliPaths(ports);
  const identity = await identifyProviderCli("claude", executable, ports, detection.environment);
  expect(identity).not.toBeNull();
  expect(identity?.executable).toBe(executable);
  expect(identity?.realPath).toBe(await realpath(target));
  expect(identity?.environment.PATH).toBe(`${dirname(executable)}:${bin}:/usr/bin:/bin`);
  expect(
    (
      await probeProviderCli({
        ...identity!,
        strategy: noCapabilityJsonInvocationStrategy(identity!.provider),
      })
    ).admitted,
  ).toBe(true);
  const runner = await createNoCapabilityProviderJsonRunner({
    ...identity!,
    strategy: noCapabilityJsonInvocationStrategy(identity!.provider),
  });
  expect(
    await runner.resolve({
      task: "background",
      responseContract: {
        schema: providerOutputSchema({
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
        }),
      },
    }),
  ).toEqual({ ok: true });
  const calls = (await readFile(log, "utf8")).trim().split("\n");
  expect(calls.length).toBeGreaterThanOrEqual(4);
  expect(calls.every((line) => line === "login")).toBe(true);
});
