import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  hostTerminalRuntimeDeclares,
  hostTerminalRuntimeNeedsMaterialization,
  inspectHostTerminalRuntime,
  materializeHostTerminalRuntime,
  sha256,
  terminalHookRuntimeStorePath,
} from "../src/index.js";

import { readTerminalRuntimePointer } from "../src/terminal-runtime-store-paths.js";

const roots: string[] = [];
const runtime = (n: number) => `#!/usr/bin/env node\nprocess.exit(${n});\n`;
async function store() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-runtime-store-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("resolves the same private store on Unix hosts and the Windows local app directory", () => {
  expect(terminalHookRuntimeStorePath({}, "darwin", "/host")).toBe(
    resolve("/host/.lervo/terminal-hooks"),
  );
  expect(terminalHookRuntimeStorePath({}, "linux", "/host")).toBe(
    resolve("/host/.lervo/terminal-hooks"),
  );
  expect(terminalHookRuntimeStorePath({ LOCALAPPDATA: "/local" }, "win32", "/host")).toBe(
    resolve("/local/Lervo/terminal-hooks"),
  );
});
it("publishes private verified bytes, preserves current and predecessor, and is idempotent", async () => {
  const root = await store();
  for (const n of [0, 1, 2])
    await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(n), assets: [] });
  const pointer = (await readTerminalRuntimePointer(root))!;
  expect(pointer.contentHash).toBe(sha256(runtime(2)));
  expect(pointer.predecessor?.contentHash).toBe(sha256(runtime(1)));
  expect((await readdir(root)).filter((name) => /^[a-f0-9]{16}$/u.test(name)).sort()).toEqual(
    [pointer.directory, pointer.predecessor!.directory].sort(),
  );
  const before = await lstat(resolve(root, "current.json"));
  expect(await hostTerminalRuntimeNeedsMaterialization(root, pointer.contentHash)).toBe(false);
  expect(
    await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(2), assets: [] }),
  ).toBe("current");
  expect((await lstat(resolve(root, "current.json"))).mtimeMs).toBe(before.mtimeMs);
  expect(await inspectHostTerminalRuntime(root)).toBe("current");
  if (process.platform !== "win32") {
    expect((await lstat(root)).mode & 0o777).toBe(0o700);
    expect((await lstat(resolve(root, pointer.directory))).mode & 0o777).toBe(0o700);
    for (const path of [
      "current.json",
      `${pointer.directory}/runtime-v2.mjs`,
      `${pointer.directory}/runtime-v2.json`,
    ])
      expect((await lstat(resolve(root, path))).mode & 0o777).toBe(0o600);
  }
});
it.each(["staged", "published"] as const)(
  "leaves the old pointer intact after a failure at %s",
  async (checkpoint) => {
    const root = await store();
    await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(0), assets: [] });
    const previous = await readFile(resolve(root, "current.json"));
    await expect(
      materializeHostTerminalRuntime({
        store: root,
        runtimeContent: runtime(1),
        assets: [],
        failureInjector: (at) => {
          if (at === checkpoint) throw new Error("interrupted");
        },
      }),
    ).rejects.toThrow("interrupted");
    expect(await readFile(resolve(root, "current.json"))).toEqual(previous);
    expect(await inspectHostTerminalRuntime(root)).toBe("current");
    await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(1), assets: [] });
    expect((await readdir(root)).filter((name) => name.startsWith(".stage-"))).toEqual([]);
  },
);
it("serializes publication and retention under one host lock", async () => {
  const root = await store();
  let resume!: () => void;
  let staged!: () => void;
  const ready = new Promise<void>((done) => {
    staged = done;
  });
  const held = new Promise<void>((done) => {
    resume = done;
  });
  const first = materializeHostTerminalRuntime({
    store: root,
    runtimeContent: runtime(0),
    assets: [],
    failureInjector: async (at) => {
      if (at === "staged") {
        staged();
        await held;
      }
    },
  });
  await ready;
  expect(
    await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(1), assets: [] }),
  ).toBe("busy");
  expect(await readTerminalRuntimePointer(root)).toBeNull();
  resume();
  await first;
  expect(await inspectHostTerminalRuntime(root)).toBe("current");
});
it("repairs missing, stale and corrupt pointers and acknowledges the unavailable marker", async () => {
  const root = await store();
  for (const value of [
    null,
    '{"schemaVersion":1}',
    JSON.stringify({
      schemaVersion: 1,
      directory: "a".repeat(16),
      contentHash: `sha256:${"a".repeat(64)}`,
      predecessor: null,
    }),
  ]) {
    if (value === null) await rm(resolve(root, "current.json"), { force: true });
    else await writeFile(resolve(root, "current.json"), value);
    await writeFile(
      resolve(root, "unavailable.json"),
      '{"schemaVersion":1,"code":"hook_runtime_unavailable"}',
    );
    expect(
      await hostTerminalRuntimeNeedsMaterialization(root, sha256(runtime(0)), "artifact"),
    ).toBe(true);
    await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(0), assets: [] });
    expect(await inspectHostTerminalRuntime(root)).toBe("current");
  }
  const pointer = (await readTerminalRuntimePointer(root))!;
  await rm(resolve(root, pointer.directory), { recursive: true });
  expect(await hostTerminalRuntimeNeedsMaterialization(root, pointer.contentHash)).toBe(true);
  await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(0), assets: [] });
  expect(await inspectHostTerminalRuntime(root)).toBe("current");
});

it("finishes retention after interruption following pointer publication", async () => {
  const root = await store();
  for (const n of [0, 1])
    await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(n), assets: [] });
  await expect(
    materializeHostTerminalRuntime({
      store: root,
      runtimeContent: runtime(2),
      assets: [],
      failureInjector: (at) => {
        if (at === "pointed") throw new Error("interrupted");
      },
    }),
  ).rejects.toThrow("interrupted");
  expect(await hostTerminalRuntimeNeedsMaterialization(root, sha256(runtime(2)))).toBe(true);
  await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(2), assets: [] });
  expect((await readdir(root)).filter((name) => /^[a-f0-9]{16}$/u.test(name))).toHaveLength(2);
  expect(await hostTerminalRuntimeNeedsMaterialization(root, sha256(runtime(2)))).toBe(false);
});
it("restores tampered bytes through a fresh directory and preserves the old directory until switching", async () => {
  const root = await store();
  await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(0), assets: [] });
  const pointer = (await readTerminalRuntimePointer(root))!;
  await writeFile(resolve(root, pointer.directory, "runtime-v2.mjs"), "tampered");
  expect(await inspectHostTerminalRuntime(root)).toBe("unavailable");
  await writeFile(
    resolve(root, "repair.json"),
    '{"schemaVersion":1,"code":"hook_runtime_repair"}',
    { mode: 0o600 },
  );
  expect(await hostTerminalRuntimeNeedsMaterialization(root, pointer.contentHash)).toBe(true);
  await materializeHostTerminalRuntime({
    store: root,
    runtimeContent: runtime(0),
    assets: [],
    failureInjector: async (at) => {
      if (at === "published") {
        expect(await readTerminalRuntimePointer(root)).toEqual(pointer);
        expect((await lstat(resolve(root, pointer.directory))).isDirectory()).toBe(true);
      }
    },
  });
  expect(await inspectHostTerminalRuntime(root)).toBe("current");
  const repaired = (await readTerminalRuntimePointer(root))!;
  expect(repaired.contentHash).toBe(pointer.contentHash);
  expect(repaired.directory).not.toBe(pointer.directory);
  expect(repaired.predecessor?.directory).toBe(pointer.directory);
  expect(await hostTerminalRuntimeNeedsMaterialization(root, pointer.contentHash)).toBe(false);
});

it("recovers the host lock when its holding process dies", async () => {
  const root = await store();
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      // The timer keeps `db` reachable: a garbage collection would close it and release the lock.
      'import {DatabaseSync} from "node:sqlite"; const db=new DatabaseSync(process.argv[1]); db.exec("BEGIN IMMEDIATE"); process.stdout.write("locked"); setInterval(()=>db,1000);',
      resolve(root, ".materialize-lock.sqlite"),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  await new Promise<void>((done, reject) => {
    child.stdout.once("data", () => done());
    child.once("error", reject);
  });
  expect(
    await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(0), assets: [] }),
  ).toBe("busy");
  const closed = new Promise<void>((done) => child.once("close", () => done()));
  child.kill("SIGKILL");
  await closed;
  expect(
    await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(0), assets: [] }),
  ).toBe("materialized");
});

it("keeps CLI B published when resident A rescans, including a stale pre-lock decision", async () => {
  const root = await store();
  const publisherA = resolve(root, "cli-A.js"),
    publisherB = resolve(root, "cli-B.js");
  await writeFile(publisherA, "installed A");
  await writeFile(publisherB, "installed B");
  const publishA = { store: root, runtimeContent: runtime(0), assets: [], publisher: publisherA };
  await materializeHostTerminalRuntime(publishA);
  const publishB = { store: root, runtimeContent: runtime(1), assets: [], publisher: publisherB };
  await materializeHostTerminalRuntime(publishB);
  const pointerB = await readFile(resolve(root, "current.json"), "utf8");
  expect(JSON.parse(pointerB).publisher).toBe(await realpath(publisherB));
  expect(
    await hostTerminalRuntimeNeedsMaterialization(root, sha256(runtime(0)), "pointer", "repair"),
  ).toBe(false);
  // ADR-0470 reader preflight accepts a verified runtime from another live publisher.
  expect(
    await hostTerminalRuntimeNeedsMaterialization(root, sha256(runtime(0)), "artifact", "repair"),
  ).toBe(false);
  expect(await materializeHostTerminalRuntime({ ...publishA, authority: "repair" })).toBe(
    "current",
  );
  expect(await readFile(resolve(root, "current.json"), "utf8")).toBe(pointerB);
  // Interactive startup retains publication authority.
  expect(await hostTerminalRuntimeNeedsMaterialization(root, sha256(runtime(0)))).toBe(true);
  // A removed publishing installation grants the resident repair authority.
  await rm(publisherB);
  expect(
    await hostTerminalRuntimeNeedsMaterialization(root, sha256(runtime(0)), "pointer", "repair"),
  ).toBe(true);
  await materializeHostTerminalRuntime({ ...publishA, authority: "repair" });
  expect((await readTerminalRuntimePointer(root))!.contentHash).toBe(sha256(runtime(0)));
});

it.skipIf(process.platform === "win32")(
  "repairs unsafe pointer permissions by replacing the pointer",
  async () => {
    const root = await store();
    await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(0), assets: [] });
    const before = await lstat(resolve(root, "current.json"));
    await chmod(resolve(root, "current.json"), 0o666);
    expect(await hostTerminalRuntimeNeedsMaterialization(root, sha256(runtime(0)))).toBe(true);
    await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(0), assets: [] });
    const after = await lstat(resolve(root, "current.json"));
    expect(after.mode & 0o777).toBe(0o600);
    expect(after.ino).not.toBe(before.ino);
    expect(await inspectHostTerminalRuntime(root)).toBe("current");
  },
);
it("declares the runtime's capabilities in its pointer and republishes a pointer that lost them", async () => {
  const root = await store();
  const capabilities = ["conversation-workspace-v1"];
  const hash = sha256(runtime(0));
  expect(await hostTerminalRuntimeDeclares(root, "conversation-workspace-v1")).toBe(false);
  await materializeHostTerminalRuntime({
    store: root,
    runtimeContent: runtime(0),
    assets: [],
    capabilities,
  });
  expect((await readTerminalRuntimePointer(root))!.capabilities).toEqual(capabilities);
  expect(await hostTerminalRuntimeDeclares(root, "conversation-workspace-v1")).toBe(true);
  expect(await hostTerminalRuntimeDeclares(root, "conversation-workspace-v2")).toBe(false);
  expect(
    await hostTerminalRuntimeNeedsMaterialization(root, hash, "pointer", "publish", capabilities),
  ).toBe(false);

  // An older publisher of the same bytes writes a pointer that declares nothing.
  await materializeHostTerminalRuntime({ store: root, runtimeContent: runtime(0), assets: [] });
  expect((await readTerminalRuntimePointer(root))!.capabilities).toBeUndefined();
  expect(await hostTerminalRuntimeDeclares(root, "conversation-workspace-v1")).toBe(false);
  expect(
    await hostTerminalRuntimeNeedsMaterialization(root, hash, "pointer", "publish", capabilities),
  ).toBe(true);
  // A caller that names no capabilities keeps the earlier judgment.
  expect(await hostTerminalRuntimeNeedsMaterialization(root, hash)).toBe(false);
  await materializeHostTerminalRuntime({
    store: root,
    runtimeContent: runtime(0),
    assets: [],
    capabilities,
    authority: "repair",
  });
  expect(await hostTerminalRuntimeDeclares(root, "conversation-workspace-v1")).toBe(true);

  await expect(
    materializeHostTerminalRuntime({
      store: root,
      runtimeContent: runtime(0),
      assets: [],
      capabilities: ["Not A Capability"],
    }),
  ).rejects.toThrow("Invalid host terminal runtime capabilities.");
  // A pointer whose capabilities are malformed is invalid, and declares nothing.
  const pointer = JSON.parse(await readFile(resolve(root, "current.json"), "utf8"));
  await writeFile(
    resolve(root, "current.json"),
    `${JSON.stringify({ ...pointer, capabilities: "conversation-workspace-v1" })}\n`,
    { mode: 0o600 },
  );
  await expect(readTerminalRuntimePointer(root)).rejects.toThrow();
  expect(await hostTerminalRuntimeDeclares(root, "conversation-workspace-v1")).toBe(false);
});
