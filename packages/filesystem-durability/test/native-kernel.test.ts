import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it.runIf(process.platform === "darwin")(
  "checks syscall ordering, eligibility, interruptions and cleanup through the native owner",
  async () => {
    const run = promisify(execFile),
      root = await mkdtemp(resolve(tmpdir(), "lervo-native-kernel-"));
    try {
      const executable = resolve(root, "kernel-check");
      await run("xcrun", [
        "clang",
        "-std=c11",
        "-Wall",
        "-Wextra",
        "-Werror",
        fileURLToPath(new URL("./native-kernel.c", import.meta.url)),
        "-o",
        executable,
      ]);
      const result = await run(executable, [], { timeout: 5000 });
      expect(result.stdout.trim()).toBe("18 kernel boundary scenarios passed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
