import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const MAXIMUM_CONFIG_BYTES = 1024 * 1024;

/** Reads only one exact owner-only Node configuration snapshot. */
export async function readNodeUpgradeConfigSource(configPath) {
  const handle = await open(configPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size < 1 ||
      info.size > MAXIMUM_CONFIG_BYTES ||
      (process.platform !== "win32" &&
        ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
    )
      throw new Error("The Node configuration is unsafe.");
    const serialized = await handle.readFile("utf8");
    const config = JSON.parse(serialized);
    if (config === null || typeof config !== "object" || Array.isArray(config))
      throw new Error("The Node configuration is invalid.");
    if (
      typeof config.repositoryRoot !== "string" ||
      config.repositoryRoot.length < 1 ||
      config.repositoryRoot.includes("\0")
    )
      throw new Error("The Node repository root is invalid.");
    return {
      config,
      repositoryRoot: resolve(dirname(configPath), config.repositoryRoot),
      sourceDigest: `sha256:${createHash("sha256").update(serialized).digest("hex")}`,
    };
  } finally {
    await handle.close();
  }
}
