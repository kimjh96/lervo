import type { ReleaseDependencyClosure } from "./host-release-verification.js";

/**
 * ADR-0571: the npm packages installed beside the verified tarball must be exactly the closure
 * the tag's committed manifest names. The tarball pins only its direct dependencies, so without
 * this check a later registry publish deep in the tree would change what a host runs for the same
 * tag. Overrides steer pnpm to the closure; the check after install decides.
 */
interface PackageCoordinate {
  name: string;
  version: string;
}

function parseCoordinate(coordinate: string): PackageCoordinate {
  const separator = coordinate.lastIndexOf("@");
  return { name: coordinate.slice(0, separator), version: coordinate.slice(separator + 1) };
}

/** A range selector that covers one version and no other version of the same package listed. */
function majorSelector(version: string): string {
  const [major, minor] = version.split(".");
  return major === "0" ? `0.${minor ?? "0"}` : (major ?? version);
}

/**
 * pnpm overrides that pin every closure package. A package listed at several versions is pinned
 * per major (or per minor below 1.0); when even that is ambiguous it is left to the check.
 */
export function closureOverrides(closure: ReleaseDependencyClosure): Record<string, string> {
  const versions = new Map<string, string[]>();
  for (const { name, version } of closure.portable.map(parseCoordinate))
    versions.set(name, [...(versions.get(name) ?? []), version]);
  const overrides: Record<string, string> = {};
  for (const [name, list] of [...versions].sort(([a], [b]) => a.localeCompare(b))) {
    if (list.length === 1) {
      overrides[name] = list[0] as string;
      continue;
    }
    const selectors = list.map(majorSelector);
    if (new Set(selectors).size !== selectors.length) continue;
    list.forEach((version, index) => (overrides[`${name}@${selectors[index]}`] = version));
  }
  return overrides;
}

/**
 * The package coordinate of one pnpm virtual-store directory, such as `@scope+name@1.2.3_peer`,
 * or null for entries that are not packages (`node_modules`, `lock.yaml`) or are file installs.
 */
export function virtualStoreCoordinate(entry: string): PackageCoordinate | null {
  const separator = entry.indexOf("@", entry.startsWith("@") ? 1 : 0);
  if (separator <= 0) return null;
  const version = entry.slice(separator + 1).split("_")[0] ?? "";
  if (version.startsWith("file+")) return null;
  return { name: entry.slice(0, separator).replace("+", "/"), version };
}

export interface ClosureDifference {
  /** Installed packages the closure does not name, as `name@version`. */
  unexpected: string[];
  /** Closure packages that were not installed, as `name@version`. */
  missing: string[];
}

/**
 * Compares the virtual-store entries of an install with the closure. Every portable package must
 * be present, and nothing else may be, except platform-specific packages of a listed family at
 * the family's exact version; a host installs only the ones for its own platform.
 */
export function compareInstalledClosure(
  storeEntries: readonly string[],
  closure: ReleaseDependencyClosure,
): ClosureDifference {
  const installed = new Set<string>();
  const unexpected: string[] = [];
  for (const entry of storeEntries) {
    const coordinate = virtualStoreCoordinate(entry);
    if (coordinate === null) continue;
    const text = `${coordinate.name}@${coordinate.version}`;
    installed.add(text);
    const portable = closure.portable.includes(text);
    const platform = closure.platformFamilies.some(
      (family) =>
        coordinate.name.startsWith(family.prefix) && coordinate.version === family.version,
    );
    if (!portable && !platform) unexpected.push(text);
  }
  const missing = closure.portable.filter((coordinate) => !installed.has(coordinate));
  return { unexpected: unexpected.sort(), missing };
}
