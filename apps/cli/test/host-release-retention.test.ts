import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { referencedReleaseDirectories } from "../src/host-release-retention.js";
import { hostUpgradeLayout } from "../src/host-upgrade-layout.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("referencedReleaseDirectories", () => {
  it("matches physical link targets when the home is reached through a symbolic link", async () => {
    const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-host-retention-")));
    directories.push(root);
    const physicalHome = resolve(root, "data", "user");
    const linkedHome = resolve(root, "home-user");
    await mkdir(physicalHome, { recursive: true });
    await symlink(physicalHome, linkedHome);
    const layout = hostUpgradeLayout({ homeDirectory: linkedHome, platform: "linux" });
    const install = `9.9.9-${"c".repeat(12)}`;
    await mkdir(resolve(layout.installsDirectory, install), { recursive: true });
    const physicalInstalls = await realpath(layout.installsDirectory);
    const referenced = await referencedReleaseDirectories(layout, [
      resolve(physicalInstalls, install, "node_modules", ".pnpm", "x", "dist", "bin.js"),
      resolve(layout.downloadsDirectory, `v9.9.9-${"c".repeat(12)}`, "lervo-cli-9.9.9.tgz"),
      resolve(root, "elsewhere", "bin.js"),
      resolve(layout.installsDirectory, "..", "escape"),
      null,
    ]);
    expect([...referenced].sort()).toEqual(
      [
        resolve(layout.downloadsDirectory, `v9.9.9-${"c".repeat(12)}`),
        resolve(layout.installsDirectory, install),
      ].sort(),
    );
  });
});
