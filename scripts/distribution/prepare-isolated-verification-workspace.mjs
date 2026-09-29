import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";

const gitMetadata = lstatSync(".git");
if (gitMetadata.isFile()) {
  for (const [label, args, timeout] of [
    ["install", ["install", "--frozen-lockfile", "--offline"], 300_000],
    ["build", ["build"], 1_200_000],
  ]) {
    const result = spawnSync("pnpm", args, { stdio: "inherit", timeout });
    if (result.error)
      throw new Error(`Isolated verification ${label} failed: ${result.error.message}`);
    if (result.status !== 0) {
      throw new Error(
        `Isolated verification ${label} exited ${result.status ?? "without a status"}.`,
      );
    }
  }
}
