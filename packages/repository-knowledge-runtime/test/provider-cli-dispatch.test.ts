import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { identifyProviderCli, providerCliIdentityCurrent } from "../src/provider-cli-identity.js";
import { runProviderCliCommand } from "../src/provider-cli-command.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it.each([".volta/bin", ".asdf/shims", ".local/share/mise/shims", ".nvm/bin", "intermediate"])(
  "rechecks version output for native dispatch through %s",
  async (location) => {
    const home = await mkdtemp(resolve(tmpdir(), "lervo-native-shim-"));
    roots.push(home);
    const executable = resolve(
      home,
      location === "intermediate" ? "bin/codex" : `${location}/codex`,
    );
    await mkdir(dirname(executable), { recursive: true });
    if (location === "intermediate") {
      const hop = resolve(home, ".volta/bin/codex");
      await mkdir(dirname(hop), { recursive: true });
      await symlink(process.execPath, hop);
      await symlink(hop, executable);
    } else await symlink(process.execPath, executable);
    const command = vi.fn(async () => ({ status: "completed" as const, stdout: "codex 1.2.3\n" }));
    const ports = { home, shell: "/bin/sh", command };
    const environment = { HOME: home, SHELL: "/bin/sh", PATH: "/usr/bin:/bin" };
    const first = (await identifyProviderCli("codex", executable, ports, environment))!;
    expect(first.versionOutputHash).toMatch(/^sha256:/u);
    const unchanged = await identifyProviderCli("codex", executable, ports, environment, first);
    expect(unchanged?.identityHash).toBe(first.identityHash);
    expect(command).toHaveBeenCalledTimes(2);
    // The semantic version can stay the same while the dispatch output changes.
    command.mockResolvedValue({ status: "completed", stdout: "codex 1.2.3 (new dispatch)\n" });
    const changed = (await identifyProviderCli("codex", executable, ports, environment, first))!;
    expect(changed.executableHash).toBe(first.executableHash);
    expect(changed.fingerprint).toBe(first.fingerprint);
    expect(changed.identityHash).not.toBe(first.identityHash);
  },
);

it("keeps plain native executables on stat checks without another version command", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "lervo-native-identity-"));
  roots.push(home);
  const executable = resolve(home, "codex");
  await copyFile(process.execPath, executable);
  const command = vi.fn(async () => ({ status: "completed" as const, stdout: "codex 1.2.3\n" }));
  const ports = { home, shell: "/bin/sh", command };
  const environment = { HOME: home, SHELL: "/bin/sh", PATH: "/usr/bin:/bin" };
  const identity = (await identifyProviderCli("codex", executable, ports, environment))!;
  expect(identity.versionOutputHash).toBeNull();
  expect(await providerCliIdentityCurrent(identity)).toBe(true);
  expect(await identifyProviderCli("codex", executable, ports, environment, identity)).toBe(
    identity,
  );
  expect(command).toHaveBeenCalledTimes(1);
});

it("fails closed when an unchanged script stops reporting a version", async () => {
  const home = await mkdtemp(resolve(tmpdir(), "lervo-script-identity-"));
  roots.push(home);
  const executable = resolve(home, "codex");
  const unavailable = resolve(home, "unavailable");
  await writeFile(
    executable,
    `#!${process.execPath}
import {existsSync} from 'node:fs';
if(existsSync('${unavailable}')) process.exit(1);
console.log('1.2.3');
`,
    { mode: 0o700 },
  );
  const ports = { home, shell: "/bin/sh", command: runProviderCliCommand };
  const environment = { HOME: home, SHELL: "/bin/sh", PATH: "/usr/bin:/bin" };
  const identity = (await identifyProviderCli("codex", executable, ports, environment))!;
  expect(await providerCliIdentityCurrent(identity)).toBe(true);
  await writeFile(unavailable, "");
  expect(await providerCliIdentityCurrent(identity)).toBe(false);
  expect(await identifyProviderCli("codex", executable, ports, environment, identity)).toBeNull();
});
