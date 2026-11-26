import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  inspectHostTerminalRuntime,
  materializeHostTerminalRuntime,
  terminalHookRuntimeStorePath,
} from "@lervo/repository-knowledge";

import { newerRuntimePublisher } from "../src/installed-cli-version.js";
import { ensureHostTerminalRuntime } from "../src/terminal-runtime.js";
import { readCliPackageVersion } from "../src/version-command.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A host whose runtime an installed CLI of `version` published, with that CLI's real entry. */
async function hostPublishedBy(version: string, name = "@lervo/cli") {
  const home = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-no-downgrade-")));
  roots.push(home);
  const cli = resolve(home, "installs", version, "node_modules", "@lervo", "cli");
  await mkdir(resolve(cli, "dist"), { recursive: true });
  await writeFile(resolve(cli, "package.json"), JSON.stringify({ name, version }));
  await writeFile(resolve(cli, "dist", "bin.js"), `// CLI ${version}\n`);
  const entry = resolve(cli, "dist", "bin.js");
  const store = terminalHookRuntimeStorePath(
    { LOCALAPPDATA: resolve(home, "local") },
    process.platform,
    home,
  );
  await materializeHostTerminalRuntime({
    store,
    runtimeContent: `#!/usr/bin/env node\n// runtime of ${version}\n`,
    assets: [],
    publisher: entry,
  });
  return { store, entry };
}

const pointer = async (store: string) =>
  JSON.parse(await readFile(resolve(store, "current.json"), "utf8")) as { directory: string };

it("names the active install that published a newer runtime, and nothing else", async () => {
  const newer = await hostPublishedBy("9.0.0");
  expect(await newerRuntimePublisher(newer.store, "0.57.0", newer.entry)).toBe("9.0.0");
  // Not active (rolled back, or another link), the same version, or unknown versions: no guard.
  expect(await newerRuntimePublisher(newer.store, "0.57.0", null)).toBeNull();
  expect(await newerRuntimePublisher(newer.store, "0.57.0", "/elsewhere/dist/bin.js")).toBeNull();
  expect(await newerRuntimePublisher(newer.store, "9.0.0", newer.entry)).toBeNull();
  expect(await newerRuntimePublisher(newer.store, null, newer.entry)).toBeNull();
  const other = await hostPublishedBy("9.0.0", "other");
  expect(await newerRuntimePublisher(other.store, "0.57.0", other.entry)).toBeNull();
  const empty = await mkdtemp(resolve(tmpdir(), "lervo-no-downgrade-empty-"));
  roots.push(empty);
  expect(await newerRuntimePublisher(empty, "0.57.0", "/any/dist/bin.js")).toBeNull();
});

it("leaves the active newer install's runtime alone, launcher included", async () => {
  const newer = await hostPublishedBy("9.0.0");
  const before = await pointer(newer.store);
  for (const authority of ["publish", "repair"] as const)
    expect(
      await ensureHostTerminalRuntime({ store: newer.store, authority, activeEntry: newer.entry }),
    ).toBe("current");
  expect(await pointer(newer.store)).toEqual(before);
});

it("publishes and repairs again once the newer install is no longer active, as after a rollback", async () => {
  const newer = await hostPublishedBy("9.0.0");
  const published = await pointer(newer.store);
  await writeFile(resolve(newer.store, published.directory, "runtime-v2.mjs"), "tampered");
  await writeFile(
    resolve(newer.store, "unavailable.json"),
    JSON.stringify({ schemaVersion: 1, reason: "hook_runtime_unavailable" }),
    { mode: 0o600 },
  );
  expect(await inspectHostTerminalRuntime(newer.store)).toBe("unavailable");
  expect(
    await ensureHostTerminalRuntime({
      store: newer.store,
      authority: "repair",
      verification: "artifact",
      activeEntry: "/rolled-back/older/dist/bin.js",
    }),
  ).toBe("materialized");
  expect(await inspectHostTerminalRuntime(newer.store)).toBe("current");
  expect(readCliPackageVersion()).toMatch(/^\d+\.\d+\.\d+$/u);
});
