import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { describeRuntimeDependencies } from "../src/runtime-dependency-closure.js";
import {
  inspectRuntimeDependencies,
  materializeRuntimeDependencies,
} from "../src/runtime-dependency-materialization.js";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-runtime-dependencies-"));
  roots.push(root);
  const source = resolve(root, "source");
  const runtime = resolve(root, "runtime");
  await mkdir(source);
  await mkdir(runtime);
  const consumer = resolve(source, "consumer.mjs");
  await writeFile(consumer, "");
  const packageAt = async (
    path: string,
    name: string,
    version: string,
    body: string,
    fields = {},
  ) => {
    await mkdir(path, { recursive: true });
    await writeFile(
      resolve(path, "package.json"),
      JSON.stringify({ name, version, type: "module", main: "index.js", ...fields }),
    );
    await writeFile(resolve(path, "index.js"), body);
  };
  const sdk = resolve(source, "node_modules/fixture-sdk");
  await packageAt(
    sdk,
    "fixture-sdk",
    "1.0.0",
    "import {value} from 'shared'; import {peer} from 'peer'; export const result = value + peer;",
    {
      dependencies: { shared: "1" },
      peerDependencies: { peer: "1" },
      optionalDependencies: { unavailable: "1" },
    },
  );
  await packageAt(
    resolve(source, "node_modules/shared"),
    "shared",
    "1.0.0",
    "export const value = 'one';",
  );
  await packageAt(
    resolve(source, "node_modules/peer"),
    "peer",
    "1.0.0",
    "import {value} from 'shared'; export const peer = value;",
    { dependencies: { shared: "2" } },
  );
  await packageAt(
    resolve(source, "node_modules/peer/node_modules/shared"),
    "shared",
    "2.0.0",
    "export const value = 'two';",
  );
  await writeFile(
    resolve(runtime, "probe.mjs"),
    "import {result} from 'fixture-sdk'; console.log(result);",
  );
  return { root, source, runtime, consumer, sdk };
}

describe("installed runtime dependency closure", () => {
  it("copies peer and nested dependency versions and loads after the source installation is removed", async () => {
    const f = await fixture();
    const closure = await describeRuntimeDependencies(f.consumer, "fixture-sdk");
    expect(closure.packages.map((entry) => `${entry.name}@${entry.version}`)).toContain(
      "shared@2.0.0",
    );
    expect(await inspectRuntimeDependencies(f.runtime, closure)).toBe("missing");
    await materializeRuntimeDependencies(f.runtime, closure);
    expect(await inspectRuntimeDependencies(f.runtime, closure)).toBe("current");
    await rm(f.source, { recursive: true });
    expect(
      (await exec(process.execPath, [resolve(f.runtime, "probe.mjs")], { cwd: f.root, env: {} }))
        .stdout,
    ).toBe("onetwo\n");
  });

  it("resolves pnpm style package links and keeps closure identity independent of the source path", async () => {
    const f = await fixture();
    const other = await fixture();
    const packageRoot = resolve(f.source, "store/fixture-sdk");
    await mkdir(dirname(packageRoot), { recursive: true });
    const { rename } = await import("node:fs/promises");
    await rename(f.sdk, packageRoot);
    await symlink(packageRoot, f.sdk, "dir");
    // pnpm places the package's resolved dependency links next to the real package.
    await mkdir(resolve(packageRoot, "node_modules"));
    for (const name of ["shared", "peer"])
      await symlink(
        resolve(f.source, "node_modules", name),
        resolve(packageRoot, "node_modules", name),
        "dir",
      );
    const closure = await describeRuntimeDependencies(f.consumer, "fixture-sdk");
    expect(closure.hash).toBe(
      (await describeRuntimeDependencies(other.consumer, "fixture-sdk")).hash,
    );
    await materializeRuntimeDependencies(f.runtime, closure);
    await rm(f.source, { recursive: true });
    expect((await exec(process.execPath, [resolve(f.runtime, "probe.mjs")])).stdout).toBe(
      "onetwo\n",
    );
  });

  it("repairs missing managed files but refuses changed bytes and preserves them", async () => {
    const f = await fixture();
    const closure = await describeRuntimeDependencies(f.consumer, "fixture-sdk");
    await materializeRuntimeDependencies(f.runtime, closure);
    const file = resolve(f.runtime, "node_modules/.lervo-packages/0/index.js");
    await rm(file);
    expect(await inspectRuntimeDependencies(f.runtime, closure)).toBe("missing");
    await materializeRuntimeDependencies(f.runtime, closure);
    expect(await inspectRuntimeDependencies(f.runtime, closure)).toBe("current");
    await writeFile(file, "tampered");
    expect(await inspectRuntimeDependencies(f.runtime, closure)).toBe("conflict");
    await expect(materializeRuntimeDependencies(f.runtime, closure)).rejects.toMatchObject({
      code: "node_fleet_executable_invalid",
    });
    expect(await readFile(file, "utf8")).toBe("tampered");
  });

  it("changes closure identity when dependency content changes and refuses stale source bytes", async () => {
    const f = await fixture();
    const original = await describeRuntimeDependencies(f.consumer, "fixture-sdk");
    await writeFile(resolve(f.sdk, "index.js"), "export const result = 'changed';");
    const changed = await describeRuntimeDependencies(f.consumer, "fixture-sdk");
    expect(original.hash).not.toBe(changed.hash);
    await expect(materializeRuntimeDependencies(f.runtime, original)).rejects.toMatchObject({
      code: "node_fleet_executable_invalid",
    });
  });

  it("fails before installation when a required dependency is absent", async () => {
    const f = await fixture();
    await rm(resolve(f.source, "node_modules/peer"), { recursive: true });
    await expect(describeRuntimeDependencies(f.consumer, "fixture-sdk")).rejects.toMatchObject({
      code: "node_fleet_executable_invalid",
    });
  });

  it("rejects dependency names that could escape the managed installation", async () => {
    const f = await fixture();
    await writeFile(
      resolve(f.sdk, "package.json"),
      JSON.stringify({ name: "fixture-sdk", version: "1", dependencies: { "..": "1" } }),
    );
    await expect(describeRuntimeDependencies(f.consumer, "fixture-sdk")).rejects.toMatchObject({
      code: "node_fleet_executable_invalid",
    });
  });

  it("requires the host native SDK package even though its manifest dependency is optional", async () => {
    const f = await fixture();
    const sdk = resolve(f.source, "node_modules/@anthropic-ai/claude-agent-sdk");
    await mkdir(sdk, { recursive: true });
    await writeFile(
      resolve(sdk, "package.json"),
      JSON.stringify({ name: "@anthropic-ai/claude-agent-sdk", version: "0.3.226" }),
    );
    await expect(describeRuntimeDependencies(f.consumer)).rejects.toMatchObject({
      code: "node_fleet_executable_invalid",
    });
  });

  it("refuses added executable content and symlinked package directories", async () => {
    const f = await fixture();
    const closure = await describeRuntimeDependencies(f.consumer, "fixture-sdk");
    await materializeRuntimeDependencies(f.runtime, closure);
    const root = resolve(f.runtime, "node_modules/.lervo-packages/0");
    await writeFile(resolve(root, "unexpected.js"), "export const value = true;");
    expect(await inspectRuntimeDependencies(f.runtime, closure)).toBe("conflict");
    await rm(root, { recursive: true });
    await symlink(f.sdk, root, "dir");
    expect(await inspectRuntimeDependencies(f.runtime, closure)).toBe("conflict");
  });

  it("preserves native executable permissions and rejects redirected package links", async () => {
    const f = await fixture();
    await writeFile(resolve(f.sdk, "native"), "#!/bin/sh\nexit 0\n");
    await chmod(resolve(f.sdk, "native"), 0o700);
    const closure = await describeRuntimeDependencies(f.consumer, "fixture-sdk");
    await materializeRuntimeDependencies(f.runtime, closure);
    expect((await exec(resolve(f.runtime, "node_modules/.lervo-packages/0/native"))).stderr).toBe(
      "",
    );
    const link = resolve(f.runtime, "node_modules/fixture-sdk");
    await rm(link);
    await symlink(f.sdk, link, "dir");
    expect(await inspectRuntimeDependencies(f.runtime, closure)).toBe("conflict");
  });
});
