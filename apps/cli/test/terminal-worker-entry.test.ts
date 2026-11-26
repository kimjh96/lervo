import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import { rememberTerminalWorkerEntry, terminalWorkerEntry } from "../src/terminal-worker-entry.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-worker-entry-"));
  roots.push(root);
  const entry = resolve(root, "bin.js");
  await writeFile(entry, "installed CLI", { mode: 0o644 });
  const record = resolve(root, ".lervo/state/terminal-integration/worker-entry.json");
  return { root, entry: await realpath(entry), record };
}

it("binds the real installed entry and its SHA-256 in private state and rebinds on every install", async () => {
  const f = await fixture();
  expect(await terminalWorkerEntry(f.root)).toBeNull();
  const link = resolve(f.root, "link.js");
  await symlink(f.entry, link);
  await rememberTerminalWorkerEntry(f.root, link);
  expect((await stat(f.record)).mode & 0o777).toBe(0o600);
  expect(await terminalWorkerEntry(f.root)).toBe(f.entry);
  expect(JSON.parse(await readFile(f.record, "utf8"))).toEqual({
    entry: f.entry,
    contentHash: sha256("installed CLI"),
  });
  await writeFile(f.entry, "upgraded CLI");
  expect(await terminalWorkerEntry(f.root)).toBeNull();
  await rememberTerminalWorkerEntry(f.root, link);
  expect(await terminalWorkerEntry(f.root)).toBe(f.entry);
  await rememberTerminalWorkerEntry(f.root, undefined);
  expect(await terminalWorkerEntry(f.root)).toBeNull();
});

it.each([
  "missing",
  "directory",
  "symlink",
  "changed",
  "group_writable",
  "other_writable",
  "wrong_owner",
])("refuses a changed or unsafe installed entry: %s", async (attack) => {
  const f = await fixture();
  await rememberTerminalWorkerEntry(f.root, f.entry);
  if (["missing", "directory", "symlink"].includes(attack)) await rm(f.entry);
  if (attack === "directory") await mkdir(f.entry);
  if (attack === "symlink") {
    const other = resolve(f.root, "other.js");
    await writeFile(other, "installed CLI");
    await symlink(other, f.entry);
  }
  if (attack === "changed") await writeFile(f.entry, "malicious CLI");
  if (attack === "group_writable") await chmod(f.entry, 0o664);
  if (attack === "other_writable") await chmod(f.entry, 0o646);
  if (attack === "wrong_owner")
    vi.spyOn(process as { getuid: () => number }, "getuid").mockReturnValue(
      (process.getuid?.() ?? 0) + 1,
    );
  expect(await terminalWorkerEntry(f.root)).toBeNull();
});

it("does not accept a path-only record directing the hook to arbitrary repository code", async () => {
  const f = await fixture();
  await rememberTerminalWorkerEntry(f.root, f.entry);
  await writeFile(f.record, JSON.stringify({ entry: f.entry }));
  expect(await terminalWorkerEntry(f.root)).toBeNull();
});

it("starts no worker from a binding older than the active install that published the host runtime", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-worker-entry-version-"));
  roots.push(root);
  const install = async (version: string) => {
    const cli = resolve(root, `install-${version}`, "node_modules", "@lervo", "cli");
    await mkdir(resolve(cli, "dist"), { recursive: true });
    await writeFile(resolve(cli, "package.json"), JSON.stringify({ name: "@lervo/cli", version }));
    await writeFile(resolve(cli, "dist", "bin.js"), `CLI ${version}`, { mode: 0o644 });
    return realpath(resolve(cli, "dist", "bin.js"));
  };
  const older = await install("0.57.0");
  const newer = await install("0.58.0");
  const store = resolve(root, "terminal-hooks");
  await mkdir(store);
  const publish = (publisher: string) =>
    writeFile(resolve(store, "current.json"), JSON.stringify({ schemaVersion: 1, publisher }));
  await rememberTerminalWorkerEntry(root, older);
  await publish(older);
  expect(await terminalWorkerEntry(root, store, older)).toBe(older);
  // The upgrade reached the host before this repository: the resident does the work instead.
  await publish(newer);
  expect(await terminalWorkerEntry(root, store, newer)).toBeNull();
  // After a rollback the newer install is no longer active, and the older binding runs again.
  expect(await terminalWorkerEntry(root, store, older)).toBe(older);
  await rememberTerminalWorkerEntry(root, newer);
  expect(await terminalWorkerEntry(root, store, newer)).toBe(newer);
});
