import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  prepareOwnerOnlyDatabasePath,
  readOwnerOnlyText,
  sameFileIdentityAcrossStatSurfaces,
  sameFileIdentityWithinStatSurface,
} from "@lervo/runtime-security";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(resolve(tmpdir(), "lervo-runtime-security-"));
  roots.push(value);
  return value;
}

describe("shared runtime security files", () => {
  it("reads owner-only UTF-8 and prepares an owner-only SQLite coordinate", async () => {
    const directory = await root();
    const secret = resolve(directory, "token");
    await writeFile(secret, "a".repeat(32), { mode: 0o600 });
    await chmod(secret, 0o600);
    await expect(readOwnerOnlyText(secret, 128)).resolves.toBe("a".repeat(32));
    await expect(
      prepareOwnerOnlyDatabasePath(resolve(directory, "state/events.sqlite")),
    ).resolves.toBe(resolve(directory, "state/events.sqlite"));
  });

  it("rejects a file readable by another OS account", async () => {
    if (process.platform === "win32") return;
    const directory = await root();
    const secret = resolve(directory, "token");
    await writeFile(secret, "a".repeat(32), { mode: 0o644 });
    await chmod(secret, 0o644);
    await expect(readOwnerOnlyText(secret, 128)).rejects.toMatchObject({ code: "unsafe_file" });
  });

  it("does not follow a symbolic link to an otherwise valid secret", async () => {
    if (process.platform === "win32") return;
    const directory = await root();
    const secret = resolve(directory, "token");
    const link = resolve(directory, "token-link");
    await writeFile(secret, "a".repeat(32), { mode: 0o600 });
    await chmod(secret, 0o600);
    await symlink(secret, link);
    await expect(readOwnerOnlyText(link, 128)).rejects.toMatchObject({ code: "unsafe_file" });
  });
});

describe("file identity stat surfaces", () => {
  const pathObservation = { dev: 12, ino: 34 };

  it("compares identity strictly within one stat surface", () => {
    expect(sameFileIdentityWithinStatSurface(pathObservation, pathObservation)).toBe(true);
    expect(sameFileIdentityWithinStatSurface(pathObservation, { dev: 12, ino: 35 })).toBe(false);
  });

  it("does not compare path and handle identities on Windows", () => {
    expect(sameFileIdentityAcrossStatSurfaces(pathObservation, { dev: 0, ino: 0 }, "win32")).toBe(
      true,
    );
  });

  it("compares path and handle identities on POSIX", () => {
    expect(sameFileIdentityAcrossStatSurfaces(pathObservation, pathObservation, "linux")).toBe(
      true,
    );
    expect(sameFileIdentityAcrossStatSurfaces(pathObservation, { dev: 12, ino: 35 }, "linux")).toBe(
      false,
    );
  });
});
