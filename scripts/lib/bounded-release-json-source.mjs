import { sha256 } from "./release-artifact-manifest.mjs";

export function createBoundedReleaseSourceSnapshot(path, contents, maximumSize) {
  return {
    path,
    contents,
    maximumSize,
    byteCount: contents.length,
    sha256: sha256(contents),
  };
}

export function parseCanonicalReleaseJson(contents) {
  let value;
  try {
    value = JSON.parse(contents.toString("utf8"));
  } catch {
    throw new TypeError("release JSON source is invalid");
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !contents.equals(Buffer.from(`${JSON.stringify(value, null, 2)}\n`))
  )
    throw new TypeError("release JSON source is not canonical");
  return value;
}
