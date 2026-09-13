import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import {
  parseNodeServiceCoordinates,
  readNodeServiceCoordinates,
} from "../src/node-service-coordinates.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["systemd", "launchd"] as const)(
  "reads the actual %s renderer's explicit Node invocation and preserves exact hashes",
  async (manager) => {
    const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-node-service-parser-")));
    roots.push(root);
    const executable = resolve(root, "runtime & percent% entry.js");
    const config = resolve(root, "config & percent%.json");
    const output = resolve(root, "service");
    const nodeExecutable = await realpath(process.execPath);
    await writeFile(executable, "// runtime fixture\n", { mode: 0o600 });
    await writeFile(config, "{}\n", { mode: 0o600 });
    await promisify(execFile)(nodeExecutable, [
      resolve("scripts/distribution/render-runtime-service.mjs"),
      "--manager",
      manager,
      "--runtime",
      "node",
      "--instance",
      "nfi_" + "a".repeat(24),
      "--node-executable",
      nodeExecutable,
      "--executable",
      executable,
      "--config",
      config,
      "--output",
      output,
    ]);
    const content = await readFile(output, "utf8");
    const contentHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    expect(
      await readNodeServiceCoordinates({ manager, path: output, expectedContentHash: contentHash }),
    ).toEqual({ executable, nodeExecutable, config, contentHash });
    await expect(
      readNodeServiceCoordinates({
        manager,
        path: output,
        expectedContentHash: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toThrow(/changed/u);
    if (process.platform !== "win32") {
      await chmod(output, 0o644);
      await expect(readNodeServiceCoordinates({ manager, path: output })).rejects.toThrow(
        /unsafe/u,
      );
    }
  },
  30000,
);

it("rejects extra arguments, relative interpreters, and ambiguous service invocations", () => {
  const command = 'ExecStart="/runtime/node" "/runtime/bin.js" --config "/runtime/config.json"';
  for (const content of [
    command + " --unsafe",
    command.replace('"/runtime/node"', '"node"'),
    command + "\n" + command,
    command + '\nExecStart="/other" --config "/other/config"',
    'ExecStart="/bin/sh" "-c" --config "/runtime/config.json"',
  ])
    expect(parseNodeServiceCoordinates("systemd", content)).toBeNull();
  const argumentsXml =
    "<key>ProgramArguments</key><array><string>/runtime/node</string><string>/runtime/bin.js</string><string>--config</string><string>/runtime/config.json</string></array>";
  expect(parseNodeServiceCoordinates("launchd", argumentsXml + argumentsXml)).toBeNull();
  expect(
    parseNodeServiceCoordinates(
      "launchd",
      argumentsXml.replace("</array>", "<string>--unsafe</string></array>"),
    ),
  ).toBeNull();
});
