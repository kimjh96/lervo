import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  materializeHostTerminalRuntime,
  terminalHookRuntimeStorePath,
} from "@lervo/repository-knowledge";

const source = fileURLToPath(new URL("../src/terminal-hook-launcher.mjs", import.meta.url));
// The fixture runtime echoes its input, so whichever launcher loads it, the output shows the input.
const runtimeContent =
  '#!/usr/bin/env node\nprocess.stdin.on("data", c => process.stdout.write(c));\n';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixture() {
  const home = await realpath(await mkdtemp(resolve(tmpdir(), "lvd-")));
  const cwd = resolve(home, "repository");
  await mkdir(cwd, { recursive: true });
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete environment.LERVO_TERMINAL_HOOK_DELEGATION;
  const store = terminalHookRuntimeStorePath(environment, process.platform, home);
  await materializeHostTerminalRuntime({ store, runtimeContent, assets: [] });
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  return { home, cwd, environment, store, host: resolve(store, "launcher.mjs") };
}

function launch(
  f: Awaited<ReturnType<typeof fixture>>,
  launcher: string,
  input: string,
  extra: NodeJS.ProcessEnv = {},
) {
  const child = spawn(process.execPath, [launcher, "--provider", "claude", "--contract", "2"], {
    cwd: f.cwd,
    env: { ...f.environment, ...extra },
    stdio: "pipe",
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  child.stdin.end(input);
  return new Promise<{ code: number | null; stdout: string }>((done) =>
    child.once("close", (code) => done({ code, stdout })),
  );
}

const start = JSON.stringify({ hook_event_name: "SessionStart", session_id: "s" });
/** The version this launcher has; a host launcher must be at least this new to take over. */
const current = Number(
  /\nconst launcherVersion = (\d+);\n/u.exec(readFileSync(source, "utf8"))![1],
);
const hostLauncher = (version: number) =>
  `#!/usr/bin/env node\nconst launcherVersion = ${version};\nprocess.stdout.write("host launcher ran");\n`;

it("hands the hook to the host's launcher when it is this user's, owner-only, and as new", async () => {
  const f = await fixture();
  await writeFile(f.host, hostLauncher(current), { mode: 0o600 });
  expect(await launch(f, source, start)).toEqual({ code: 0, stdout: "host launcher ran" });
  // A newer host launcher is used too.
  await writeFile(f.host, hostLauncher(current + 6), { mode: 0o600 });
  expect((await launch(f, source, start)).stdout).toBe("host launcher ran");
});

it("runs itself, exactly as before, when the host's launcher is older, open to others, absent, or switched off", async () => {
  const f = await fixture();
  expect(await launch(f, source, start)).toEqual({ code: 0, stdout: start });
  await writeFile(f.host, hostLauncher(current - 1), { mode: 0o600 });
  expect((await launch(f, source, start)).stdout).toBe(start);
  await writeFile(f.host, hostLauncher(current), { mode: 0o600 });
  await chmod(f.host, 0o640);
  expect((await launch(f, source, start)).stdout).toBe(start);
  await chmod(f.host, 0o600);
  expect((await launch(f, source, start, { LERVO_TERMINAL_HOOK_DELEGATION: "0" })).stdout).toBe(
    start,
  );
});

it("runs the real host launcher with the same input, and the host launcher never hands off again", async () => {
  const f = await fixture();
  await copyFile(source, f.host);
  await chmod(f.host, 0o600);
  expect(await launch(f, source, start)).toEqual({ code: 0, stdout: start });
  expect(await launch(f, f.host, start)).toEqual({ code: 0, stdout: start });
  expect(await readFile(f.host, "utf8")).toContain("\nconst launcherVersion = ");
});
