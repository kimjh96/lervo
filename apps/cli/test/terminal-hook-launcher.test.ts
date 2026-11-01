import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  materializeHostTerminalRuntime,
  hostTerminalRuntimeNeedsMaterialization,
  inspectHostTerminalRuntime,
  sha256,
  terminalHookRuntimeStorePath,
  type TerminalRuntimeAsset,
} from "@lervo/repository-knowledge";

import { ensureHostTerminalRuntime } from "../src/terminal-runtime.js";

const roots: string[] = [];
const source = fileURLToPath(new URL("../src/terminal-hook-launcher.mjs", import.meta.url));
async function fixture() {
  // macOS links /var to /private/var; the launcher reports real paths.
  const home = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-launcher-")));
  roots.push(home);
  const cwd = resolve(home, "repository/nested");
  await mkdir(cwd, { recursive: true });
  const environment = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: resolve(home, "local"),
  };
  const store = terminalHookRuntimeStorePath(environment, process.platform, home);
  return { home, cwd, environment, store };
}
function launch(f: Awaited<ReturnType<typeof fixture>>, args: string[] = [], preload?: string) {
  const child = spawn(
    process.execPath,
    [...(preload ? ["--import", preload] : []), source, ...args],
    {
      cwd: f.cwd,
      env: f.environment,
      stdio: "pipe",
    },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.stdin.on("error", () => undefined);
  const result = new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (done, reject) => {
      child.once("error", reject);
      child.once("close", (code) => done({ code, stdout, stderr }));
    },
  );
  return { child, result };
}
function assets(): TerminalRuntimeAsset[] {
  return (["cas-io", "file-sync"] as const).flatMap((name) => {
    const binary = Buffer.from(`${name} fixture`);
    return [
      { path: `native/${name}-darwin.node`, content: binary },
      {
        path: `native/${name}.json`,
        content: Buffer.from(
          JSON.stringify({
            schemaVersion: 1,
            apiVersion: 1,
            napiVersion: 8,
            platform: "darwin",
            architectures: ["arm64", "x64"],
            sourceHash: sha256("fixture"),
            contentHash: sha256(binary),
          }),
        ),
      },
    ] as TerminalRuntimeAsset[];
  });
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("ships a dependency-free version-independent launcher within 16 KiB", async () => {
  const content = await readFile(source, "utf8");
  expect(Buffer.byteLength(content)).toBeLessThanOrEqual(16 * 1024);
  expect(content.startsWith("#!/usr/bin/env node\n")).toBe(true);
  const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  expect(content).not.toContain(metadata.version);
  expect(content).not.toMatch(/from ["'](?!node:)/u);
});
it("streams stdin and preserves arguments, cwd, host runtime identity and exit code", async () => {
  const f = await fixture();
  const runtimeContent =
    '#!/usr/bin/env node\nprocess.stdin.on("data", c => process.stdout.write(c)); process.stdin.on("end", () => { process.stderr.write(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),runtime:process.env.LERVO_TERMINAL_HOOK_RUNTIME})); process.exitCode=7; });\n';
  await materializeHostTerminalRuntime({ store: f.store, runtimeContent, assets: [] });
  const { child, result } = launch(f, ["--provider", "codex", "--contract", "2", "two words"]);
  const streamed = new Promise<void>((done) => child.stdout.once("data", () => done()));
  child.stdin.write("first chunk");
  await streamed;
  child.stdin.end(" second chunk");
  const output = await result;
  expect(output.code).toBe(7);
  expect(output.stdout).toBe("first chunk second chunk");
  expect(JSON.parse(output.stderr)).toEqual({
    args: ["--provider", "codex", "--contract", "2", "two words"],
    cwd: f.cwd,
    runtime: resolve(f.store, sha256(runtimeContent).slice(7, 23), "runtime-v2.mjs"),
  });
});
it.each(["store", "pointer", "directory"])(
  "runs unmanaged without output when the %s is missing",
  async (missing) => {
    const f = await fixture();
    if (missing !== "store") {
      await mkdir(f.store, { recursive: true, mode: 0o700 });
      if (missing === "directory")
        await writeFile(
          resolve(f.store, "current.json"),
          JSON.stringify({
            schemaVersion: 1,
            directory: "a".repeat(16),
            contentHash: `sha256:${"a".repeat(64)}`,
            predecessor: null,
            publisher: process.execPath,
          }),
        );
    }
    const { child, result } = launch(f);
    // Keep input open: unavailability must not wait for, consume or print it.
    expect(await result).toEqual({ code: 0, stdout: "", stderr: "" });
    child.stdin.destroy();
    expect(JSON.parse(await readFile(resolve(f.store, "unavailable.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      code: "hook_runtime_unavailable",
    });
  },
);
it.each([
  "runtime-v2.mjs",
  "native/cas-io-darwin.node",
  "native/file-sync.json",
  "runtime-v2.json",
])("fails closed before input when %s is tampered", async (path) => {
  const f = await fixture();
  await materializeHostTerminalRuntime({
    store: f.store,
    runtimeContent: '#!/usr/bin/env node\nprocess.stdout.write("executed");\n',
    assets: assets(),
  });
  const pointer = JSON.parse(await readFile(resolve(f.store, "current.json"), "utf8"));
  await writeFile(resolve(f.store, pointer.directory, path), "tampered");
  const { child, result } = launch(f);
  expect(await result).toEqual({
    code: 2,
    stdout: "",
    stderr: "Lervo terminal hook runtime integrity verification failed.\n",
  });
  child.stdin.destroy();
  expect(JSON.parse(await readFile(resolve(f.store, "repair.json"), "utf8"))).toEqual({
    schemaVersion: 1,
    code: "hook_runtime_repair",
  });
  // Default startup path must observe the marker without explicit artifact verification.
  expect(await hostTerminalRuntimeNeedsMaterialization(f.store, pointer.contentHash)).toBe(true);
  await materializeHostTerminalRuntime({
    store: f.store,
    runtimeContent: '#!/usr/bin/env node\nprocess.stdout.write("executed");\n',
    assets: assets(),
  });
  expect(await inspectHostTerminalRuntime(f.store)).toBe("current");
  const repaired = launch(f);
  repaired.child.stdin.end();
  expect(await repaired.result).toEqual({ code: 0, stdout: "executed", stderr: "" });
});
it("rejects pointer traversal and linked or undeclared native assets", async () => {
  const f = await fixture();
  await mkdir(f.store, { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(f.store, "current.json"),
    JSON.stringify({
      schemaVersion: 1,
      contentHash: `sha256:${"a".repeat(64)}`,
      directory: "../repository",
    }),
  );
  let child = launch(f);
  expect((await child.result).code).toBe(2);
  child.child.stdin.destroy();
  await materializeHostTerminalRuntime({
    store: f.store,
    runtimeContent: "#!/usr/bin/env node\n",
    assets: assets(),
  });
  const pointer = JSON.parse(await readFile(resolve(f.store, "current.json"), "utf8"));
  const native = resolve(f.store, pointer.directory, "native");
  await writeFile(resolve(native, "extra.node"), "extra");
  child = launch(f);
  expect((await child.result).code).toBe(2);
  child.child.stdin.destroy();
  await rm(resolve(native, "extra.node"));
  await rm(resolve(native, "cas-io-darwin.node"));
  await symlink(resolve(native, "file-sync-darwin.node"), resolve(native, "cas-io-darwin.node"));
  child = launch(f);
  expect((await child.result).code).toBe(2);
  child.child.stdin.destroy();
});

it.each(["runtime-v2.json", "runtime-v2.mjs", "native/cas-io-darwin.node", "native", "."])(
  "retries a missing %s once and runs unmanaged without consuming input",
  async (path) => {
    const f = await fixture();
    await materializeHostTerminalRuntime({
      store: f.store,
      runtimeContent: "#!/usr/bin/env node\n",
      assets: assets(),
    });
    const pointer = JSON.parse(await readFile(resolve(f.store, "current.json"), "utf8"));
    await rm(resolve(f.store, pointer.directory, path), { recursive: true });
    const count = resolve(f.home, "pointer-reads");
    const preload = resolve(f.home, "count.mjs");
    await writeFile(
      preload,
      `
      import fs from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      const original = fs.lstat;
      let count = 0;
      fs.lstat = async (path, ...args) => {
        if (String(path) === ${JSON.stringify(resolve(f.store, "current.json"))})
          await fs.writeFile(${JSON.stringify(count)}, String(++count));
        return original(path, ...args);
      };
      syncBuiltinESMExports();
    `,
    );
    const run = launch(f, [], preload);
    expect(await run.result).toEqual({ code: 0, stdout: "", stderr: "" });
    run.child.stdin.destroy();
    expect(await readFile(count, "utf8")).toBe("2");
    expect(await readFile(resolve(f.store, "unavailable.json"), "utf8")).toContain(
      "hook_runtime_unavailable",
    );
  },
);

it.skipIf(process.platform === "win32").each([
  ["store", 0o720],
  ["store", 0o702],
  ["runtime", 0o720],
  ["runtime", 0o702],
  ["pointer", 0o620],
  ["pointer", 0o602],
] as const)("rejects writable %s with mode %s before input", async (target, mode) => {
  const f = await fixture();
  await materializeHostTerminalRuntime({
    store: f.store,
    runtimeContent: "#!/usr/bin/env node\n",
    assets: [],
  });
  const pointer = JSON.parse(await readFile(resolve(f.store, "current.json"), "utf8"));
  const path =
    target === "store"
      ? f.store
      : resolve(f.store, target === "runtime" ? pointer.directory : "current.json");
  await chmod(path, mode);
  const run = launch(f);
  expect((await run.result).code).toBe(2);
  run.child.stdin.destroy();
  expect(await readFile(resolve(f.store, "repair.json"), "utf8")).toContain("hook_runtime_repair");
});

it.skipIf(process.platform === "win32")("rejects a parent symlink outside home", async () => {
  const f = await fixture();
  const outside = await mkdtemp(resolve(tmpdir(), "lervo-untrusted-parent-"));
  roots.push(outside);
  await symlink(outside, resolve(f.home, ".lervo"));
  await materializeHostTerminalRuntime({
    store: f.store,
    runtimeContent: "#!/usr/bin/env node\n",
    assets: [],
  });
  const run = launch(f);
  expect((await run.result).code).toBe(2);
  run.child.stdin.destroy();
});

it.each([true, false])(
  "retries import-time deletion (pointer switch: %s)",
  async (switchPointer) => {
    const f = await fixture();
    const runtimeA = "#!/usr/bin/env node\nprocess.stdout.write('A');\n";
    const runtimeB = "#!/usr/bin/env node\nprocess.stdout.write('B');\n";
    await materializeHostTerminalRuntime({ store: f.store, runtimeContent: runtimeA, assets: [] });
    const pointerA = await readFile(resolve(f.store, "current.json"), "utf8");
    await materializeHostTerminalRuntime({ store: f.store, runtimeContent: runtimeB, assets: [] });
    const pointerB = await readFile(resolve(f.store, "current.json"), "utf8");
    await writeFile(resolve(f.store, "current.json"), pointerA, { mode: 0o600 });
    const loader = resolve(f.home, "race-loader.mjs");
    const entry = resolve(f.store, JSON.parse(pointerA).directory, "runtime-v2.mjs");
    const race = `
      if (specifier === ${JSON.stringify(pathToFileURL(entry).href)}) {
        rmSync(${JSON.stringify(entry)});
        writeFileSync(${JSON.stringify(resolve(f.store, "current.json"))}, ${JSON.stringify(switchPointer ? pointerB : pointerA)});
      }`;
    await writeFile(
      loader,
      `import { rmSync, writeFileSync } from "node:fs";
    export async function resolve(specifier, context, next) {${race}
      return next(specifier, context);
    }`,
    );
    // A hook intercepts import after verification, with no test hook in the launcher. Newer Node
    // deprecates the off-thread register(), so the in-thread hook is used where it exists.
    const preload = resolve(f.home, "register.mjs");
    await writeFile(
      preload,
      `import * as module from "node:module";
    import { rmSync, writeFileSync } from "node:fs";
    if (typeof module.registerHooks === "function")
      module.registerHooks({ resolve(specifier, context, next) {${race}
        return next(specifier, context);
      } });
    else module.register(${JSON.stringify(pathToFileURL(loader).href)});`,
    );
    const run = launch(f, [], preload);
    run.child.stdin.end();
    expect(await run.result).toEqual({ code: 0, stdout: switchPointer ? "B" : "", stderr: "" });
    if (!switchPointer)
      expect(await readFile(resolve(f.store, "unavailable.json"), "utf8")).toContain(
        "hook_runtime_unavailable",
      );
  },
);

it.each(["publish", "repair"] as const)(
  "repairs an integrity failure through the default %s CLI path",
  async (authority) => {
    const f = await fixture();
    await ensureHostTerminalRuntime({ store: f.store });
    const pointer = JSON.parse(await readFile(resolve(f.store, "current.json"), "utf8"));
    await writeFile(resolve(f.store, pointer.directory, "runtime-v2.mjs"), "tampered");
    const run = launch(f);
    expect((await run.result).code).toBe(2);
    run.child.stdin.destroy();
    // No verification option: the marker selects artifact verification automatically.
    expect(await ensureHostTerminalRuntime({ store: f.store, authority })).toBe("materialized");
    expect(await inspectHostTerminalRuntime(f.store)).toBe("current");
    expect(await ensureHostTerminalRuntime({ store: f.store, authority })).toBe("current");
  },
);

it.skipIf(process.platform === "win32").each(["store", "runtime", "pointer"])(
  "rejects a %s owned by another uid",
  async (target) => {
    const f = await fixture();
    await materializeHostTerminalRuntime({
      store: f.store,
      runtimeContent: "#!/usr/bin/env node\n",
      assets: [],
    });
    const pointer = JSON.parse(await readFile(resolve(f.store, "current.json"), "utf8"));
    const path =
      target === "store"
        ? f.store
        : resolve(f.store, target === "runtime" ? pointer.directory : "current.json");
    const preload = resolve(f.home, "uid.mjs");
    await writeFile(
      preload,
      `
      import fs from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      const original = fs.lstat;
      fs.lstat = async (path, ...args) => {
        const stat = await original(path, ...args);
        if (String(path) === ${JSON.stringify(path)}) stat.uid = process.getuid() + 1;
        return stat;
      };
      syncBuiltinESMExports();
    `,
    );
    const run = launch(f, [], preload);
    expect((await run.result).code).toBe(2);
    run.child.stdin.destroy();
  },
);
