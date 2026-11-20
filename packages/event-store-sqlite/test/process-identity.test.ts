import { execFile } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

import { kernelRelation, localBootKey, localHostKey, sameBoot } from "../src/process-identity.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const source = resolve(import.meta.dirname, "../src/process-identity.ts");
const hooks = resolve(import.meta.dirname, "support/register-workspace-source.mjs");

/** The host key a fresh process computes with `LERVO_USER_STATE_DIRECTORY` at `state`. */
async function childHostKey(state: string): Promise<string> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--no-warnings",
      "--import",
      pathToFileURL(hooks).href,
      "--input-type=module",
      "-e",
      `const { localHostKey } = await import(process.argv[1]); console.log(localHostKey());`,
      pathToFileURL(source).href,
    ],
    { env: { ...process.env, LERVO_USER_STATE_DIRECTORY: state } },
  );
  return stdout.trim();
}

it("relates host and boot keys: same kernel, another boot, another host, unknown (ADR-0602)", () => {
  const host = localHostKey();
  const boot = localBootKey();
  expect(kernelRelation(host, boot)).toBe("same_kernel");
  const other = boot.startsWith("b") ? `b${"0".repeat(12)}` : `t${Number(boot.slice(1)) - 86_400}`;
  expect(kernelRelation(host, other)).toBe("other_boot");
  expect(kernelRelation("aaaaaaaaaaaa", other)).toBe("foreign");
  expect(kernelRelation("unknown", "unknown")).toBe("unknown");
  if (boot.startsWith("t")) {
    // A boot time read twice differs by the clock's rounding, never by a boot.
    expect(sameBoot(boot, `t${Number(boot.slice(1)) + 60}`)).toBe(true);
  }
});

it.skipIf(process.platform === "linux" || process.platform === "win32")(
  "caches the host key per host name, only in a private file, never through a planted symlink",
  async () => {
    const state = mkdtempSync(join(tmpdir(), "lervo-host-key-"));
    roots.push(state);
    const target = join(state, "target");
    writeFileSync(target, "planted\n");
    const cacheName = `host-key-${createHash("sha256").update(hostname()).digest("hex").slice(0, 12)}`;
    symlinkSync(target, join(state, cacheName));
    expect(await childHostKey(state)).toBe(localHostKey());
    // The symlink was replaced, not followed: its target is untouched.
    expect(readFileSync(target, "utf8")).toBe("planted\n");
    const cache = lstatSync(join(state, cacheName));
    expect(cache.isSymbolicLink()).toBe(false);
    expect(cache.mode & 0o777).toBe(0o600);
    // A cache another user could write is ignored.
    writeFileSync(join(state, cacheName), "bbbbbbbbbbbb\n");
    chmodSync(join(state, cacheName), 0o644);
    expect(await childHostKey(state)).toBe(localHostKey());
  },
  30_000,
);
