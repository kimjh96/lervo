import { canonicalJson } from "../../shared/release-artifact-manifest.mjs";

export function distributionEntriesEqual(actual, expected, platform) {
  const observable = (entries) =>
    platform === "win32"
      ? entries.map((entry) =>
          // Windows exposes the read-only attribute, not POSIX execution or group permissions.
          entry.kind === "file" ? { ...entry, mode: entry.mode & 0o200 } : entry,
        )
      : entries;
  return canonicalJson(observable(actual)) === canonicalJson(observable(expected));
}
