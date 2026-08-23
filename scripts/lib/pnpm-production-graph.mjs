const semanticVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

export class PnpmProductionGraphError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PnpmProductionGraphError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PnpmProductionGraphError(code, message);
}

function descriptor(name, resolution) {
  if (typeof name !== "string" || typeof resolution !== "string") {
    fail("release_sbom_lock_dependency_invalid", "The lockfile dependency coordinates are invalid.");
  }
  const version = resolution.split("(", 1)[0];
  if (!semanticVersionPattern.test(version)) {
    fail("release_sbom_lock_dependency_invalid", "The lockfile dependency version is invalid.");
  }
  return {
    coordinate: `${name}@${version}`,
    name,
    resolution,
    snapshotKey: `${name}@${resolution}`,
    version,
  };
}

export function pnpmPackageSha512(lockfile, coordinate) {
  const packages = lockfile?.packages;
  const integrity = packages?.[coordinate]?.resolution?.integrity;
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) {
    fail("release_sbom_lock_integrity_missing", "Production dependency integrity is missing.");
  }
  const bytes = Buffer.from(integrity.slice("sha512-".length), "base64");
  if (bytes.byteLength !== 64) {
    fail("release_sbom_lock_integrity_invalid", "Production dependency integrity is invalid.");
  }
  return bytes.toString("hex");
}

function entries(value) {
  if (value === undefined) return [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("release_sbom_lock_dependency_invalid", "The lockfile dependency relation is invalid.");
  }
  return Object.entries(value);
}

export function createPnpmProductionGraph(lockfile, importerId = "apps/cli") {
  if (lockfile?.lockfileVersion !== "9.0") {
    fail("release_sbom_lock_version_unsupported", "The pnpm lockfile version is unsupported.");
  }
  const importer = lockfile.importers?.[importerId];
  if (!importer) fail("release_sbom_lock_importer_missing", "The CLI lockfile importer is missing.");

  const nodes = new Map();
  const visitedStates = new Set();
  const visit = (item, optionalPath) => {
    const stateKey = `${item.snapshotKey}:${optionalPath ? "optional" : "required"}`;
    if (visitedStates.has(stateKey)) return;
    visitedStates.add(stateKey);
    const snapshot = lockfile.snapshots?.[item.snapshotKey];
    if (!snapshot) fail("release_sbom_lock_snapshot_missing", "A dependency snapshot is missing.");

    const current = nodes.get(item.coordinate) ?? {
      coordinate: item.coordinate,
      dependencies: new Set(),
      name: item.name,
      optional: true,
      sha512: pnpmPackageSha512(lockfile, item.coordinate),
      version: item.version,
    };
    if (!optionalPath) current.optional = false;
    nodes.set(item.coordinate, current);

    for (const [name, resolution] of entries(snapshot.dependencies)) {
      const child = descriptor(name, resolution);
      current.dependencies.add(child.coordinate);
      visit(child, optionalPath);
    }
    for (const [name, resolution] of entries(snapshot.optionalDependencies)) {
      const child = descriptor(name, resolution);
      current.dependencies.add(child.coordinate);
      visit(child, true);
    }
  };

  const roots = entries(importer.dependencies).map(([name, value]) => {
    const item = descriptor(name, value?.version);
    visit(item, false);
    return item.coordinate;
  }).sort();
  if (roots.length === 0) {
    fail("release_sbom_lock_roots_missing", "The CLI has no production dependencies.");
  }

  return {
    roots,
    nodes: [...nodes.values()].map((node) => ({
      ...node,
      dependencies: [...node.dependencies].sort(),
    })).sort((left, right) => left.coordinate.localeCompare(right.coordinate)),
  };
}
