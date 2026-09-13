import { afterEach, describe, expect, it } from "vitest";
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { inspectSupervisionPathAccess } from "../src/supervision-path-access.js";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-path-access-"));
  roots.push(root);
  await mkdir(resolve(root, "src"));
  await writeFile(resolve(root, "src/save.ts"), "fixture content\n");
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await chmod(resolve(root, "src"), 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

describe("bounded host filesystem access inspection", () => {
  it("returns only evidence hashes without reading or writing file contents", async () => {
    const root = await fixture();
    const read = await inspectSupervisionPathAccess(root, ["src/save.ts"], "read");
    const write = await inspectSupervisionPathAccess(root, ["src/save.ts"], "write");
    expect(read).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(write).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(read).not.toBe(write);
    expect(await readFile(resolve(root, "src/save.ts"), "utf8")).toBe("fixture content\n");
  });
  it("observes the nearest existing ancestor without creating missing paths", async () => {
    const root = await fixture();
    await expect(inspectSupervisionPathAccess(root, ["src/new/file.ts"], "write")).resolves.toMatch(
      /^sha256:/u,
    );
    await expect(readFile(resolve(root, "src/new/file.ts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it.each([
    "../escape",
    "/absolute",
    "src/../escape",
    "src//file",
    "*",
    "src/**",
    "src\\file",
    "src/./file",
    "src/",
    "src/\0file",
  ])("rejects unsupported scope %s", async (scope) => {
    await expect(inspectSupervisionPathAccess(await fixture(), [scope], "read")).rejects.toThrow();
  });
  it("bounds path count and depth", async () => {
    const root = await fixture();
    for (const paths of [
      [],
      Array.from({ length: 33 }, () => "src"),
      [Array.from({ length: 33 }, () => "a").join("/")],
    ])
      await expect(inspectSupervisionPathAccess(root, paths, "read")).rejects.toThrow();
  });
  it("rejects symlink targets and symlink ancestors even inside the workspace", async () => {
    const root = await fixture();
    await symlink(resolve(root, "src"), resolve(root, "alias"));
    for (const path of ["alias", "alias/save.ts", "alias/new.ts"])
      await expect(inspectSupervisionPathAccess(root, [path], "write")).rejects.toThrow();
  });
  it("rejects a symlink workspace root", async () => {
    const root = await fixture();
    await symlink(resolve(root, "src"), resolve(root, "alias"));
    await expect(
      inspectSupervisionPathAccess(resolve(root, "alias"), ["save.ts"], "read"),
    ).rejects.toThrow();
  });
  it("rejects hard-linked files and nondirectory ancestors", async () => {
    const root = await fixture();
    await link(resolve(root, "src/save.ts"), resolve(root, "src/alias.ts"));
    await expect(inspectSupervisionPathAccess(root, ["src/alias.ts"], "write")).rejects.toThrow();
    await expect(
      inspectSupervisionPathAccess(root, ["src/save.ts/child"], "read"),
    ).rejects.toThrow();
  });
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "distinguishes read access from denied target and parent write access",
    async () => {
      const root = await fixture();
      await chmod(resolve(root, "src/save.ts"), 0o400);
      await expect(inspectSupervisionPathAccess(root, ["src/save.ts"], "read")).resolves.toMatch(
        /^sha256:/u,
      );
      await expect(inspectSupervisionPathAccess(root, ["src/save.ts"], "write")).rejects.toThrow();
      await chmod(resolve(root, "src/save.ts"), 0o600);
      await chmod(resolve(root, "src"), 0o500);
      await expect(inspectSupervisionPathAccess(root, ["src/save.ts"], "write")).rejects.toThrow();
      await expect(inspectSupervisionPathAccess(root, ["src/new.ts"], "write")).rejects.toThrow();
    },
  );
});
