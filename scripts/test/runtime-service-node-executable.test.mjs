import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { manageRuntimeService } from "../manage-runtime-service.mjs";
import { renderRuntimeService } from "../render-runtime-service.mjs";

const roots = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-service-node-executable-"));
  roots.push(root);
  const executable = resolve(root, "hub entry.js");
  const nodeExecutable = resolve(root, "node runtime");
  const config = resolve(root, "hub config.json");
  await writeFile(executable, "export {};\n", { mode: 0o600 });
  await writeFile(nodeExecutable, "#!/bin/sh\n", { mode: 0o700 });
  await chmod(nodeExecutable, 0o700);
  await writeFile(config, "{}", { mode: 0o600 });
  return { root, executable, nodeExecutable, config };
}

describe("runtime service Node executable composition", () => {
  it("renders an exact Node executable before a non-executable systemd entry point", async () => {
    const value = await fixture();
    const output = resolve(value.root, "lervo-hub.service");
    await renderRuntimeService([
      "--manager",
      "systemd",
      "--runtime",
      "hub",
      "--executable",
      value.executable,
      "--node-executable",
      value.nodeExecutable,
      "--config",
      value.config,
      "--output",
      output,
    ]);
    expect(await readFile(output, "utf8")).toContain(
      `ExecStart="${value.nodeExecutable}" "${value.executable}" --config "${value.config}"`,
    );
  });

  it("retains the exact launchd Node instance label while prepending Node.js", async () => {
    const value = await fixture();
    const instance = "nfi_0123456789abcdef01234567";
    const output = resolve(value.root, "com.lervo.node.0123456789abcdef01234567.plist");
    await renderRuntimeService([
      "--manager",
      "launchd",
      "--runtime",
      "node",
      "--instance",
      instance,
      "--executable",
      value.executable,
      "--node-executable",
      value.nodeExecutable,
      "--config",
      value.config,
      "--output",
      output,
    ]);
    expect(await readFile(output, "utf8")).toContain(
      `  <key>Label</key>\n  <string>com.lervo.node.0123456789abcdef01234567</string>\n  <key>ProgramArguments</key>\n  <array>\n    <string>${value.nodeExecutable}</string>\n    <string>${value.executable}</string>`,
    );
  });

  it("rejects duplicate Node executable arguments before creating a service definition", async () => {
    const value = await fixture();
    const output = resolve(value.root, "duplicate-node-executable.service");
    await expect(
      renderRuntimeService([
        "--manager",
        "systemd",
        "--runtime",
        "hub",
        "--executable",
        value.executable,
        "--node-executable",
        value.nodeExecutable,
        "--node-executable",
        value.nodeExecutable,
        "--config",
        value.config,
        "--output",
        output,
      ]),
    ).rejects.toThrow();
    await expect(readFile(output, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a relative Node executable path before creating a service definition", async () => {
    const value = await fixture();
    const output = resolve(value.root, "relative-node-executable.service");
    await expect(
      renderRuntimeService([
        "--manager",
        "systemd",
        "--runtime",
        "hub",
        "--executable",
        value.executable,
        "--node-executable",
        "node runtime",
        "--config",
        value.config,
        "--output",
        output,
      ]),
    ).rejects.toThrow("Node executable path must be absolute and contain no line breaks.");
    await expect(readFile(output, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a non-executable Node executable", async () => {
    if (process.platform === "win32") return;
    const value = await fixture();
    await chmod(value.nodeExecutable, 0o600);
    await expect(
      renderRuntimeService([
        "--manager",
        "systemd",
        "--runtime",
        "hub",
        "--executable",
        value.executable,
        "--node-executable",
        value.nodeExecutable,
        "--config",
        value.config,
        "--output",
        resolve(value.root, "non-executable-node.service"),
      ]),
    ).rejects.toThrow();
  });

  it("rejects a non-executable runtime entry point without a Node executable", async () => {
    if (process.platform === "win32") return;
    const value = await fixture();
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
        resolve(value.root, "non-executable-runtime.service"),
      ]),
    ).rejects.toThrow();
  });

  it("systemd-escapes the exact Node executable before the runtime entry point", async () => {
    const value = await fixture();
    const nodeExecutable = resolve(value.root, `node %runtime\\ "quoted"`);
    await writeFile(nodeExecutable, "#!/bin/sh\n", { mode: 0o700 });
    await chmod(nodeExecutable, 0o700);
    const output = resolve(value.root, "lervo-hub-escaped.service");
    await renderRuntimeService([
      "--manager",
      "systemd",
      "--runtime",
      "hub",
      "--executable",
      value.executable,
      "--node-executable",
      nodeExecutable,
      "--config",
      value.config,
      "--output",
      output,
    ]);
    const escapedNodeExecutable = nodeExecutable.replace(
      `node %runtime\\ "quoted"`,
      `node %%runtime\\\\ \\"quoted\\"`,
    );
    expect(await readFile(output, "utf8")).toContain(
      `ExecStart="${escapedNodeExecutable}" "${value.executable}" --config "${value.config}"`,
    );
  });

  it("XML-escapes the exact Node executable before the launchd runtime entry point", async () => {
    const value = await fixture();
    const nodeExecutable = resolve(value.root, `node & <runtime> "'`);
    await writeFile(nodeExecutable, "#!/bin/sh\n", { mode: 0o700 });
    await chmod(nodeExecutable, 0o700);
    const output = resolve(value.root, "com.lervo.hub.plist");
    await renderRuntimeService([
      "--manager",
      "launchd",
      "--runtime",
      "hub",
      "--executable",
      value.executable,
      "--node-executable",
      nodeExecutable,
      "--config",
      value.config,
      "--output",
      output,
    ]);
    const content = await readFile(output, "utf8");
    const escapedNodeExecutable = nodeExecutable.replace(
      `node & <runtime> "'`,
      "node &amp; &lt;runtime&gt; &quot;&apos;",
    );
    expect(content).toContain(
      `  <array>\n    <string>${escapedNodeExecutable}</string>\n    <string>${value.executable}</string>`,
    );
    expect(content).not.toContain(`<string>${nodeExecutable}</string>`);
  });

  it("binds service management to the same canonical Node executable", async () => {
    const value = await fixture();
    const definition = resolve(value.root, "definition.service");
    await renderRuntimeService([
      "--manager",
      "systemd",
      "--runtime",
      "hub",
      "--executable",
      value.executable,
      "--node-executable",
      value.nodeExecutable,
      "--config",
      value.config,
      "--output",
      definition,
    ]);
    const enabled = new Set();
    const active = new Set();
    const runCommand = async (command, args) => {
      if (command !== "systemctl") return { exitCode: null };
      if (args[1] === "daemon-reload") return { exitCode: 0 };
      if (args[1] === "is-enabled") return { exitCode: enabled.has(args[2]) ? 0 : 1 };
      if (args[1] === "is-active") return { exitCode: active.has(args[2]) ? 0 : 3 };
      if (args[1] === "enable") {
        enabled.add(args[3]);
        active.add(args[3]);
        return { exitCode: 0 };
      }
      return { exitCode: 1 };
    };
    await expect(
      manageRuntimeService(
        [
          "--action",
          "install",
          "--manager",
          "systemd",
          "--runtime",
          "hub",
          "--definition",
          definition,
          "--executable",
          value.executable,
          "--node-executable",
          value.nodeExecutable,
          "--config",
          value.config,
          "--write",
        ],
        {
          platform: "linux",
          homeDirectory: value.root,
          runCommand,
          wait: async () => {},
        },
      ),
    ).resolves.toMatchObject({ change: "installed", active: true });
  });

  it("rejects service management with a different exact Node executable", async () => {
    const value = await fixture();
    const definition = resolve(value.root, "definition.service");
    const differentNodeExecutable = resolve(value.root, "different node runtime");
    await writeFile(differentNodeExecutable, "#!/bin/sh\n", { mode: 0o700 });
    await chmod(differentNodeExecutable, 0o700);
    await renderRuntimeService([
      "--manager",
      "systemd",
      "--runtime",
      "hub",
      "--executable",
      value.executable,
      "--node-executable",
      value.nodeExecutable,
      "--config",
      value.config,
      "--output",
      definition,
    ]);
    const managerCalls = [];
    const runCommand = async (command, args) => {
      managerCalls.push({ command, args });
      return { exitCode: 0 };
    };
    await expect(
      manageRuntimeService(
        [
          "--action",
          "install",
          "--manager",
          "systemd",
          "--runtime",
          "hub",
          "--definition",
          definition,
          "--executable",
          value.executable,
          "--node-executable",
          differentNodeExecutable,
          "--config",
          value.config,
          "--write",
        ],
        {
          platform: "linux",
          homeDirectory: value.root,
          runCommand,
        },
      ),
    ).rejects.toMatchObject({ code: "service_definition_mismatch" });
    expect(managerCalls).toHaveLength(0);
  });

  it("rejects a directory Node executable before creating a service definition", async () => {
    const value = await fixture();
    const nodeDirectory = await mkdtemp(resolve(value.root, "node-directory-"));
    const output = resolve(value.root, "directory-node-executable.service");
    await expect(
      renderRuntimeService([
        "--manager",
        "systemd",
        "--runtime",
        "hub",
        "--executable",
        value.executable,
        "--node-executable",
        nodeDirectory,
        "--config",
        value.config,
        "--output",
        output,
      ]),
    ).rejects.toThrow(
      "The executable, optional Node executable, and config must be real regular files, not symbolic links.",
    );
    await expect(readFile(output, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlinked Node executable", async () => {
    if (process.platform === "win32") return;
    const value = await fixture();
    const nodeLink = resolve(value.root, "node-link");
    await symlink(value.nodeExecutable, nodeLink);
    await expect(
      renderRuntimeService([
        "--manager",
        "systemd",
        "--runtime",
        "hub",
        "--executable",
        value.executable,
        "--node-executable",
        nodeLink,
        "--config",
        value.config,
        "--output",
        resolve(value.root, "unsafe.service"),
      ]),
    ).rejects.toThrow();
  });
});
