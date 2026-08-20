import { canonicalJson } from "./release-artifact-manifest.mjs";
import {
  createPnpmProductionGraph,
  pnpmPackageSha512,
} from "./pnpm-production-graph.mjs";

const nativeSuffixes = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-arm64-musl",
  "linux-x64",
  "linux-x64-musl",
  "win32-arm64",
  "win32-x64",
];

export class ReleaseSbomError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseSbomError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ReleaseSbomError(code, message);
}

function packageIdentity(coordinate) {
  const separator = coordinate.lastIndexOf("@");
  const fullName = coordinate.slice(0, separator);
  const version = coordinate.slice(separator + 1);
  if (!fullName || !version) fail("release_sbom_component_invalid", "SBOM package 좌표가 올바르지 않습니다.");
  if (fullName.startsWith("@")) {
    const [group, name, ...rest] = fullName.split("/");
    if (!group || !name || rest.length > 0) {
      fail("release_sbom_component_invalid", "SBOM scoped package 좌표가 올바르지 않습니다.");
    }
    const purl = `pkg:npm/${encodeURIComponent(group)}/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
    return { fullName, group, name, purl, version };
  }
  const purl = `pkg:npm/${encodeURIComponent(fullName)}@${encodeURIComponent(version)}`;
  return { fullName, name: fullName, purl, version };
}

function componentFromCoordinate(coordinate, options = {}) {
  const identity = packageIdentity(coordinate);
  const component = {
    type: options.application ? "application" : "library",
    "bom-ref": identity.purl,
    ...(identity.group ? { group: identity.group } : {}),
    name: identity.name,
    version: identity.version,
    purl: identity.purl,
  };
  if (options.scope) component.scope = options.scope;
  if (options.sha512) {
    component.hashes = [{ alg: "SHA-512", content: options.sha512 }];
  }
  const properties = [];
  if (options.bundled) properties.push({ name: "lervo:release:bundled", value: "true" });
  if (options.locked) properties.push({ name: "lervo:release:locked", value: "true" });
  if (properties.length > 0) component.properties = properties;
  return component;
}

function nativeCoordinates(families) {
  if (
    families.length !== 1 ||
    families[0].prefix !== "@anthropic-ai/claude-agent-sdk-"
  ) {
    fail("release_sbom_native_family_invalid", "SBOM native dependency family가 올바르지 않습니다.");
  }
  return nativeSuffixes.map((suffix) =>
    `${families[0].prefix}${suffix}@${families[0].version}`
  ).sort();
}

function assertSourceConsistency(releaseManifest, graph, lockfile) {
  const required = graph.nodes.filter(({ optional }) => !optional).map(({ coordinate }) => coordinate);
  if (canonicalJson(required) !== canonicalJson(releaseManifest.dependencies.portable)) {
    fail("release_sbom_portable_closure_mismatch", "SBOM production closure가 release manifest와 다릅니다.");
  }
  const optional = graph.nodes.filter(({ optional }) => optional).map(({ coordinate }) => coordinate);
  if (canonicalJson(optional) !== canonicalJson(
    nativeCoordinates(releaseManifest.dependencies.platformSpecificFamilies),
  )) {
    fail("release_sbom_optional_closure_mismatch", "SBOM optional closure가 승인된 native family와 다릅니다.");
  }
  if (canonicalJson(graph.roots) !== canonicalJson(releaseManifest.directDependencies)) {
    fail("release_sbom_roots_mismatch", "SBOM 직접 dependency가 release manifest와 다릅니다.");
  }
  const graphCoordinates = new Set(graph.nodes.map(({ coordinate }) => coordinate));
  for (const coordinate of releaseManifest.bundle.externalPackages) {
    if (!graphCoordinates.has(coordinate)) pnpmPackageSha512(lockfile, coordinate);
  }
}

function rootComponent(releaseManifest) {
  const coordinate = `${releaseManifest.artifact.name}@${releaseManifest.artifact.version}`;
  const component = componentFromCoordinate(coordinate, { application: true });
  const bundleFile = releaseManifest.archive.files.find(({ path }) => path === "dist/bin.js");
  if (!bundleFile) fail("release_sbom_bundle_hash_missing", "SBOM bundle hash 원본이 없습니다.");
  return {
    ...component,
    hashes: [{ alg: "SHA-256", content: bundleFile.sha256.slice("sha256:".length) }],
    licenses: [{ license: { name: releaseManifest.artifact.license } }],
    properties: [
      { name: "lervo:release:artifact-digest", value: releaseManifest.artifactDigest },
      { name: "lervo:release:bundle-digest", value: releaseManifest.bundle.bundleDigest },
      {
        name: "lervo:release:portable-dependencies-digest",
        value: releaseManifest.dependencies.portableDigest,
      },
    ],
  };
}

export function createCliReleaseSbom(releaseManifest, lockfile) {
  const graph = createPnpmProductionGraph(lockfile);
  assertSourceConsistency(releaseManifest, graph, lockfile);
  const bundled = new Set(releaseManifest.bundle.externalPackages);
  const graphCoordinates = new Set(graph.nodes.map(({ coordinate }) => coordinate));
  const bundledOnly = releaseManifest.bundle.externalPackages.filter((coordinate) =>
    !graphCoordinates.has(coordinate)
  );
  const components = [
    ...releaseManifest.bundle.workspacePackages.map((coordinate) =>
      componentFromCoordinate(coordinate, { bundled: true, scope: "required" })
    ),
    ...graph.nodes.map((node) => componentFromCoordinate(node.coordinate, {
      bundled: bundled.has(node.coordinate),
      locked: true,
      scope: node.optional ? "optional" : "required",
      sha512: node.sha512,
    })),
    ...bundledOnly.map((coordinate) => componentFromCoordinate(coordinate, {
      bundled: true,
      locked: true,
      scope: "required",
      sha512: pnpmPackageSha512(lockfile, coordinate),
    })),
  ].sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"]));
  const root = rootComponent(releaseManifest);
  const rootDependencies = [...new Set([
    ...graph.roots,
    ...releaseManifest.bundle.workspacePackages,
    ...releaseManifest.bundle.externalPackages,
  ].map((coordinate) => packageIdentity(coordinate).purl))].sort();
  const dependencies = [
    { ref: root["bom-ref"], dependsOn: rootDependencies },
    ...graph.nodes.map((node) => ({
      ref: packageIdentity(node.coordinate).purl,
      dependsOn: node.dependencies.map((coordinate) => packageIdentity(coordinate).purl).sort(),
    })),
  ].sort((left, right) => left.ref.localeCompare(right.ref));

  return {
    $schema: "https://cyclonedx.org/schema/bom-1.7.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    version: 1,
    metadata: {
      lifecycles: [{ phase: "build" }],
      tools: {
        components: [{ type: "application", name: "lervo-release-sbom", version: "1" }],
      },
      component: root,
    },
    components,
    dependencies,
    properties: [
      { name: "lervo:release:inventory-source", value: "pnpm-lock-and-esbuild-metafile" },
      { name: "lervo:release:workspace-relationships", value: "not-asserted" },
    ],
  };
}

export function releaseSbomDifferences(expected, actual) {
  const differences = [];
  for (const field of [
    "$schema",
    "bomFormat",
    "specVersion",
    "version",
    "metadata",
    "components",
    "dependencies",
    "properties",
  ]) {
    if (canonicalJson(expected[field]) !== canonicalJson(actual?.[field])) differences.push(field);
  }
  return differences;
}

export function validateCliReleaseSbom(sbom, releaseManifest, lockfile) {
  if (sbom === null || typeof sbom !== "object" || Array.isArray(sbom)) {
    fail("release_sbom_invalid", "CLI release SBOM 구조가 올바르지 않습니다.");
  }
  if (Object.hasOwn(sbom, "serialNumber") || Object.hasOwn(sbom.metadata ?? {}, "timestamp")) {
    fail("release_sbom_nondeterministic_metadata", "CLI release SBOM에 비결정적 metadata가 있습니다.");
  }
  const expected = createCliReleaseSbom(releaseManifest, lockfile);
  const differences = releaseSbomDifferences(expected, sbom);
  if (differences.length > 0) {
    fail("release_sbom_mismatch", `CLI release SBOM이 승인 원본과 다릅니다: ${differences.join(", ")}`);
  }
  return sbom;
}
