import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const MAXIMUM_CONFIG_BYTES = 1024 * 1024;

/** Reads only owner and repository coordinates from one owner-only launch config. */
export async function readSupervisionUpgradeCoordinates(configPath) {
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
      throw new Error("The supervised Node configuration is unsafe.");
    const config = JSON.parse(await handle.readFile("utf8"));
    if (config === null || typeof config !== "object" || Array.isArray(config))
      throw new Error("The supervised Node configuration is invalid.");
    if (config.outcomeSupervision === undefined) return null;
    const supervision = config.outcomeSupervision;
    const standing = supervision?.standing !== undefined;
    const binding = supervision?.standing ?? supervision?.binding;
    if (
      supervision === null ||
      typeof supervision !== "object" ||
      Array.isArray(supervision) ||
      (supervision.standing === undefined) === (supervision.binding === undefined) ||
      binding === null ||
      typeof binding !== "object" ||
      Array.isArray(binding) ||
      typeof config.repositoryRoot !== "string" ||
      config.repositoryRoot.length < 1 ||
      config.repositoryRoot.includes("\0") ||
      !/^[a-z][a-z0-9_.:-]{0,127}$/u.test(binding.supervisionId) ||
      !/^agt_[a-f0-9]{24}$/u.test(binding.ownerAgentId) ||
      !/^wks_[a-f0-9]{24}$/u.test(binding.workstreamId) ||
      !/^sha256:[a-f0-9]{64}$/u.test(binding.mandateHash)
    )
      throw new Error("The supervised Node owner binding is invalid.");
    return {
      repositoryRoot: resolve(dirname(configPath), config.repositoryRoot),
      binding,
      standing,
    };
  } finally {
    await handle.close();
  }
}
