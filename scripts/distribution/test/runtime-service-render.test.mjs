import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  formatRuntimeServiceDefinition,
  renderRuntimeService,
  runtimeServiceTargetPath,
} from "../render-runtime-service.mjs";

const roots = [];
const nodeInstance = "nfi_0123456789abcdef01234567";
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

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
  it("writes a newly rendered service definition with owner-only permissions", async () => {
    if (process.platform === "win32") return;
    const value = await fixture();
    const output = resolve(value.root, "owner-only.service");
    await renderRuntimeService([
      "--manager",
      "systemd",
      "--runtime",
      "hub",
      "--executable",
      value.executable,
      "--config",
      value.config,
      "--output",
      output,
    ]);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
  });

  it("creates a non-overwriting systemd unit with reload and graceful shutdown contracts", async () => {
    const value = await fixture();
    const output = resolve(value.root, "lervo-hub.service");
    await expect(
      renderRuntimeService([
        "--",
        "--manager",
        "systemd",
        "--runtime",
        "hub",
        "--executable",
        value.executable,
        "--config",
        value.config,
        "--output",
        output,
      ]),
    ).resolves.toMatchObject({ manager: "systemd", runtime: "hub", output });
    const content = await readFile(output, "utf8");
    expect(content).toContain("ExecReload=/bin/kill -HUP $MAINPID");
    expect(content).toContain("KillSignal=SIGTERM");
    expect(content).toContain("Restart=on-failure");
    expect(content).toContain('Environment="PATH=');
    expect(content).toContain('ExecStart="');
    await expect(
      renderRuntimeService([
        "--manager",
        "systemd",
        "--runtime",
        "hub",
        "--executable",
        value.executable,
        "--config",
        value.config,
        "--output",
        output,
      ]),
    ).rejects.toThrow();
  });

  it("creates an escaped launchd plist without embedding secret contents", async () => {
    const value = await fixture();
    const output = resolve(value.root, "com.lervo.node.0123456789abcdef01234567.plist");
    await renderRuntimeService([
      "--manager",
      "launchd",
      "--runtime",
      "node",
      "--instance",
      nodeInstance,
      "--executable",
      value.executable,
      "--config",
      value.config,
      "--output",
      output,
    ]);
    const content = await readFile(output, "utf8");
    expect(content).toContain("com.lervo.node.0123456789abcdef01234567");
    expect(content).toContain("runtime &amp; config.json");
    expect(content).toContain("<key>SuccessfulExit</key>");
    expect(content).toContain("<key>EnvironmentVariables</key>");
    expect(content).toContain("<key>PATH</key>");
    expect(content).not.toContain("{}");
  });

  it("rejects executable and config symlinks", async () => {
    if (process.platform === "win32") return;
    const value = await fixture();
    const executableLink = resolve(value.root, "executable-link");
    const configLink = resolve(value.root, "config-link");
    await symlink(value.executable, executableLink);
    await symlink(value.config, configLink);
    await expect(
      renderRuntimeService([
        "--manager",
        "systemd",
        "--runtime",
        "node",
        "--instance",
        nodeInstance,
        "--executable",
        executableLink,
        "--config",
        value.config,
        "--output",
        resolve(value.root, "one.service"),
      ]),
    ).rejects.toThrow();
    await expect(
      renderRuntimeService([
        "--manager",
        "launchd",
        "--runtime",
        "node",
        "--instance",
        nodeInstance,
        "--executable",
        value.executable,
        "--config",
        configLink,
        "--output",
        resolve(value.root, "two.plist"),
      ]),
    ).rejects.toThrow();
  });

  it("rejects an existing output symlink without changing its target", async () => {
    if (process.platform === "win32") return;
    const value = await fixture();
    const target = resolve(value.root, "existing-definition");
    const output = resolve(value.root, "lervo-hub.service");
    const original = "existing service definition\n";
    await writeFile(target, original, { mode: 0o600 });
    await symlink(target, output);

    await expect(
      renderRuntimeService([
        "--manager",
        "systemd",
        "--runtime",
        "hub",
        "--executable",
        value.executable,
        "--config",
        value.config,
        "--output",
        output,
      ]),
    ).rejects.toThrow();
    expect(await readFile(target, "utf8")).toBe(original);
  });

  it("rejects an existing regular output file without changing its bytes", async () => {
    const value = await fixture();
    const output = resolve(value.root, "lervo-hub.service");
    const original = "[Unit]\nDescription=Unrelated existing definition\n";
    await writeFile(output, original, { mode: 0o600 });

    await expect(
      renderRuntimeService([
        "--manager",
        "systemd",
        "--runtime",
        "hub",
        "--executable",
        value.executable,
        "--config",
        value.config,
        "--output",
        output,
      ]),
    ).rejects.toThrow();
    expect((await lstat(output)).isFile()).toBe(true);
    expect(await readFile(output, "utf8")).toBe(original);
  });

  it("rejects a relative output path before creating any service definition", async () => {
    const value = await fixture();
    const relative = "lervo-relative-output.service";

    await expect(
      renderRuntimeService([
        "--manager",
        "systemd",
        "--runtime",
        "hub",
        "--executable",
        value.executable,
        "--config",
        value.config,
        "--output",
        relative,
      ]),
    ).rejects.toThrow();
    await expect(lstat(resolve(relative))).rejects.toThrow();
    await expect(lstat(resolve(value.root, relative))).rejects.toThrow();
  });

  it("requires a bounded Node instance and renders distinct service identities", async () => {
    const value = await fixture();
    await expect(
      renderRuntimeService([
        "--manager",
        "systemd",
        "--runtime",
        "node",
        "--executable",
        value.executable,
        "--config",
        value.config,
        "--output",
        resolve(value.root, "missing.service"),
      ]),
    ).rejects.toThrow();
    const first = resolve(value.root, "first.plist");
    const second = resolve(value.root, "second.plist");
    await renderRuntimeService([
      "--manager",
      "launchd",
      "--runtime",
      "node",
      "--instance",
      nodeInstance,
      "--executable",
      value.executable,
      "--config",
      value.config,
      "--output",
      first,
    ]);
    await renderRuntimeService([
      "--manager",
      "launchd",
      "--runtime",
      "node",
      "--instance",
      "nfi_89abcdef0123456701234567",
      "--executable",
      value.executable,
      "--config",
      value.config,
      "--output",
      second,
    ]);
    expect(await readFile(first, "utf8")).not.toBe(await readFile(second, "utf8"));
  });
});

describe("knowledge host resident service definition", () => {
  const input = {
    runtime: "knowledge-host",
    instance: null,
    nodeExecutable: "/opt/node/bin/node",
    executable: "/opt/lervo/dist/bin.js",
    config: "/home/owner/state/knowledge-host/config.json",
  };

  it("runs the host resident subcommand with its config under one per-user identity", () => {
    const systemd = formatRuntimeServiceDefinition({ ...input, manager: "systemd" });
    expect(systemd).toContain(
      'ExecStart="/opt/node/bin/node" "/opt/lervo/dist/bin.js" knowledge worker --watch --host --config "/home/owner/state/knowledge-host/config.json"',
    );
    expect(systemd).toContain("Description=Lervo host knowledge resident");
    const launchd = formatRuntimeServiceDefinition({ ...input, manager: "launchd" });
    expect(launchd).toContain("<string>com.lervo.knowledge.host</string>");
    expect(launchd).toContain(
      "<string>/opt/lervo/dist/bin.js</string>\n    <string>knowledge</string>\n    <string>worker</string>\n    <string>--watch</string>\n    <string>--host</string>\n    <string>--config</string>",
    );
    expect(runtimeServiceTargetPath({ ...input, manager: "systemd" }, "/home/owner")).toBe(
      "/home/owner/.config/systemd/user/lervo-knowledge-host.service",
    );
    expect(runtimeServiceTargetPath({ ...input, manager: "launchd" }, "/home/owner")).toBe(
      "/home/owner/Library/LaunchAgents/com.lervo.knowledge.host.plist",
    );
  });

  it("routes launchd output to a log file only when one is given, and never for systemd", () => {
    const logFile = "/Users/owner/Library/Logs/Lervo/knowledge-host.log";
    const launchd = formatRuntimeServiceDefinition({ ...input, manager: "launchd", logFile });
    expect(launchd).toContain(
      `<key>StandardOutPath</key>\n  <string>${logFile}</string>\n  <key>StandardErrorPath</key>\n  <string>${logFile}</string>`,
    );
    expect(formatRuntimeServiceDefinition({ ...input, manager: "launchd" })).not.toContain(
      "StandardErrorPath",
    );
    expect(() => formatRuntimeServiceDefinition({ ...input, manager: "systemd", logFile })).toThrow(
      /Only a launchd service takes a log file/u,
    );
  });

  it("renders resolved tool directories into PATH before the system directories", () => {
    const systemd = formatRuntimeServiceDefinition({
      ...input,
      manager: "systemd",
      pathDirectories: ["/opt/homebrew/bin", "/usr/bin", "/opt/homebrew/bin"],
    });
    expect(systemd).toContain(
      'Environment="PATH=/opt/node/bin:/opt/lervo/dist:/opt/homebrew/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
    );
    const node = {
      manager: "launchd",
      runtime: "node",
      instance: nodeInstance,
      executable: "/opt/lervo/launcher",
      config: "/home/owner/node.json",
    };
    // Without tool directories the bytes stay exactly those of earlier releases.
    expect(formatRuntimeServiceDefinition(node)).toBe(
      formatRuntimeServiceDefinition({ ...node, pathDirectories: [] }),
    );
    expect(() =>
      formatRuntimeServiceDefinition({ ...node, pathDirectories: ["relative/bin"] }),
    ).toThrow(/absolute/u);
  });

  it("rejects an instance for the host resident", () => {
    expect(() =>
      formatRuntimeServiceDefinition({ ...input, manager: "systemd", instance: nodeInstance }),
    ).toThrow(/argument|instance/u);
  });
});

describe("repository replica coordinator service definition (ADR-0483)", () => {
  const input = {
    runtime: "repository-replica",
    instance: null,
    nodeExecutable: "/opt/node/bin/node",
    executable: "/home/owner/.local/share/lervo/runtimes/node/current/node-runtime.js",
    config: "/home/owner/state/repository-replica-coordinator.json",
  };

  it("runs the watching coordinator through the current runtime under the existing label", () => {
    const systemd = formatRuntimeServiceDefinition({ ...input, manager: "systemd" });
    expect(systemd).toContain(
      'ExecStart="/opt/node/bin/node" "/home/owner/.local/share/lervo/runtimes/node/current/node-runtime.js" repository-replica reconcile --watch --config "/home/owner/state/repository-replica-coordinator.json"',
    );
    expect(systemd).toContain("Description=Lervo repository replica coordinator");
    const launchd = formatRuntimeServiceDefinition({ ...input, manager: "launchd" });
    expect(launchd).toContain("<string>dev.lervo.repository-replica</string>");
    expect(runtimeServiceTargetPath({ ...input, manager: "systemd" }, "/home/owner")).toBe(
      "/home/owner/.config/systemd/user/lervo-repository-replica.service",
    );
    expect(runtimeServiceTargetPath({ ...input, manager: "launchd" }, "/home/owner")).toBe(
      "/home/owner/Library/LaunchAgents/dev.lervo.repository-replica.plist",
    );
  });
});
