import { readNodeUpgradeConfigSource } from "./node-upgrade-config-source.mjs";

/** Reads only owner and repository coordinates from one owner-only launch config. */
export async function readSupervisionUpgradeCoordinates(configPath) {
  const source = await readNodeUpgradeConfigSource(configPath);
  const config = source.config;
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
    !/^[a-z][a-z0-9_.:-]{0,127}$/u.test(binding.supervisionId) ||
    !/^agt_[a-f0-9]{24}$/u.test(binding.ownerAgentId) ||
    !/^wks_[a-f0-9]{24}$/u.test(binding.workstreamId) ||
    !/^sha256:[a-f0-9]{64}$/u.test(binding.mandateHash)
  )
    throw new Error("The supervised Node owner binding is invalid.");
  return {
    repositoryRoot: source.repositoryRoot,
    sourceDigest: source.sourceDigest,
    binding,
    standing,
  };
}
