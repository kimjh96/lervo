import { NodeRuntimeDistributionError } from "./node-runtime-distribution-contract.mjs";
import { nativeFileSyncSbomComponents } from "../../shared/native-file-sync-contract.mjs";

function packageIdentity(coordinate) {
  const separator = coordinate.lastIndexOf("@");
  const fullName = coordinate.slice(0, separator);
  const version = coordinate.slice(separator + 1);
  if (!fullName || !version)
    throw new NodeRuntimeDistributionError(
      "node_distribution_dependency_invalid",
      "The dependency coordinates are invalid.",
    );
  const [group, name] = fullName.startsWith("@") ? fullName.split("/") : [undefined, fullName];
  const purl =
    group === undefined
      ? `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`
      : `pkg:npm/${encodeURIComponent(group)}/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
  return { fullName, version, ...(group === undefined ? {} : { group }), name, purl };
}

export function createNodeDistributionSbom(version, coordinates, bundleSha256, artifact) {
  const native = nativeFileSyncSbomComponents(artifact);
  const rootRef = `pkg:generic/lervo-node@${version}`;
  return {
    $schema: "https://cyclonedx.org/schema/bom-1.7.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": rootRef,
        name: "lervo-node",
        version,
        hashes: [{ alg: "SHA-256", content: bundleSha256.slice("sha256:".length) }],
      },
    },
    components: [
      ...native,
      ...coordinates.map((coordinate) => {
        const identity = packageIdentity(coordinate);
        return {
          type: "library",
          "bom-ref": identity.purl,
          ...(identity.group === undefined ? {} : { group: identity.group }),
          name: identity.name,
          version: identity.version,
          purl: identity.purl,
        };
      }),
    ],
    dependencies: [
      {
        ref: rootRef,
        dependsOn: [
          ...native.map((component) => component["bom-ref"]),
          ...coordinates.map((coordinate) => packageIdentity(coordinate).purl),
        ],
      },
      ...native.map((component) => ({ ref: component["bom-ref"], dependsOn: [] })),
      ...coordinates.map((coordinate) => ({
        ref: packageIdentity(coordinate).purl,
        dependsOn: [],
      })),
    ],
  };
}

export function createHubDistributionSbom(version, bundleSha256, artifact) {
  const native = nativeFileSyncSbomComponents(artifact);
  const rootRef = `pkg:generic/lervo-hub@${version}`;
  return {
    $schema: "https://cyclonedx.org/schema/bom-1.7.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": rootRef,
        name: "lervo-hub",
        version,
        hashes: [{ alg: "SHA-256", content: bundleSha256.slice("sha256:".length) }],
      },
    },
    components: native,
    dependencies: [
      { ref: rootRef, dependsOn: native.map((component) => component["bom-ref"]) },
      ...native.map((component) => ({ ref: component["bom-ref"], dependsOn: [] })),
    ],
  };
}
