import { readRepositoryFile } from "@lervo/context";
import { inspectEventWriterCoordinate } from "@lervo/project";

/** One turn owns these private bytes; missing/oversized inputs remain unavailable, never empty. */
export async function captureHostOutcomeBaselines(
  repositoryRoot: string,
  paths: readonly string[],
  required = false,
) {
  const baselines = new Map<string, Uint8Array>();
  if (paths.length > 64) return baselines;
  if (!required) {
    try {
      if (
        (await inspectEventWriterCoordinate(repositoryRoot)).coordinate
          .selectedEventSchemaVersion !== 6
      )
        return baselines;
    } catch {
      return baselines;
    }
  }
  let total = 0;
  for (const path of paths) {
    try {
      const bytes = await readRepositoryFile(repositoryRoot, path, 1048576);
      if (total + bytes.byteLength > 8 * 1048576) continue;
      total += bytes.byteLength;
      baselines.set(path, bytes);
    } catch {
      /* No baseline is available for this exact path. */
    }
  }
  return baselines;
}
