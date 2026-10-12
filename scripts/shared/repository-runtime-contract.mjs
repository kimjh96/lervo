export const repositoryRuntimePath = "dist/repository-runtime.js";
export const repositoryRuntimeMaximumBytes = 64 * 1024 * 1024;
const reference = "lervo:repository-runtime";

export function repositoryRuntimeComponent(hash, layout = "single_file") {
  if (!["single_file", "inventory"].includes(layout))
    throw new Error("repository_runtime_layout_invalid");
  if (!/^sha256:[a-f0-9]{64}$/u.test(hash)) throw new Error("repository_runtime_hash_invalid");
  return {
    type: "file",
    "bom-ref": reference,
    name: layout === "inventory" ? "dist/repository-runtime.json" : repositoryRuntimePath,
    hashes: [{ alg: "SHA-256", content: hash.slice(7) }],
  };
}

export function validateRepositoryRuntimeSbom(sbom, hash, layout = "single_file") {
  const expected = repositoryRuntimeComponent(hash, layout);
  const components = sbom.components?.filter((entry) => entry["bom-ref"] === reference);
  const dependencies = sbom.dependencies?.filter((entry) => entry.ref === reference);
  const root = sbom.dependencies?.find(
    (entry) => entry.ref === sbom.metadata?.component?.["bom-ref"],
  );
  if (
    JSON.stringify(components) !== JSON.stringify([expected]) ||
    JSON.stringify(dependencies) !== JSON.stringify([{ ref: reference, dependsOn: [] }]) ||
    root?.dependsOn?.filter((entry) => entry === reference).length !== 1
  )
    throw new Error("repository_runtime_sbom_invalid");
}
