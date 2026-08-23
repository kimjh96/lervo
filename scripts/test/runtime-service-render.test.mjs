import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { renderRuntimeService } from "../render-runtime-service.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-service-render-"));
  roots.push(root);
  const executable = resolve(root, "lervo runtime");
  const config = resolve(root, "runtime & config.json");
  await writeFile(executable, "#!/bin/sh\n", { mode: 0o700 });
  await chmod(executable, 0o700);
  await writeFile(config, "{}", { mode: 0o600 });
  return { root, executable, config };
}

describe("runtime service definition renderer", () => {
  it("creates a non-overwriting systemd unit with reload and graceful shutdown contracts", async () => {
    const value = await fixture();
    const output = resolve(value.root, "lervo-hub.service");
    await expect(renderRuntimeService([
      "--",
      "--manager", "systemd", "--runtime", "hub", "--executable", value.executable,
      "--config", value.config, "--output", output,
    ])).resolves.toMatchObject({ manager: "systemd", runtime: "hub", output });
    const content = await readFile(output, "utf8");
    expect(content).toContain("ExecReload=/bin/kill -HUP $MAINPID");
    expect(content).toContain("KillSignal=SIGTERM");
    expect(content).toContain("Restart=on-failure");
    expect(content).toContain('ExecStart="');
    await expect(renderRuntimeService([
      "--manager", "systemd", "--runtime", "hub", "--executable", value.executable,
      "--config", value.config, "--output", output,
    ])).rejects.toThrow();
  });

  it("creates an escaped launchd plist without embedding secret contents", async () => {
    const value = await fixture();
    const output = resolve(value.root, "com.lervo.node.plist");
    await renderRuntimeService([
      "--manager", "launchd", "--runtime", "node", "--executable", value.executable,
      "--config", value.config, "--output", output,
    ]);
    const content = await readFile(output, "utf8");
    expect(content).toContain("com.lervo.node");
    expect(content).toContain("runtime &amp; config.json");
    expect(content).toContain("<key>SuccessfulExit</key>");
    expect(content).not.toContain("{}");
  });

  it("rejects executable and config symlinks", async () => {
    if (process.platform === "win32") return;
    const value = await fixture();
    const executableLink = resolve(value.root, "executable-link");
    const configLink = resolve(value.root, "config-link");
    await symlink(value.executable, executableLink);
    await symlink(value.config, configLink);
    await expect(renderRuntimeService([
      "--manager", "systemd", "--runtime", "node", "--executable", executableLink,
      "--config", value.config, "--output", resolve(value.root, "one.service"),
    ])).rejects.toThrow();
    await expect(renderRuntimeService([
      "--manager", "launchd", "--runtime", "node", "--executable", value.executable,
      "--config", configLink, "--output", resolve(value.root, "two.plist"),
    ])).rejects.toThrow();
  });
});
