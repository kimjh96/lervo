import { resolve } from "node:path";
import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";

const PATH = ".lervo/state/knowledge/maintenance-schedule.json";

/** A bounded reservation counter; it schedules read-only preparation and grants no effect authority. */
export async function reserveFreshnessPreparation(root: string): Promise<boolean> {
  const path = resolve(root, PATH);
  const read = await readPrivateJsonFile(path, 1024);
  const value =
    read.status === "read"
      ? (read.value as { schemaVersion?: unknown; convergenceTurns?: unknown } | null)
      : null;
  const turns =
    value?.schemaVersion === 1 &&
    Number.isInteger(value.convergenceTurns) &&
    typeof value.convergenceTurns === "number" &&
    value.convergenceTurns >= 0 &&
    value.convergenceTurns <= 2
      ? value.convergenceTurns
      : 0;
  await writePrivateJsonFile(path, {
    schemaVersion: 1,
    convergenceTurns: turns >= 2 ? 0 : turns + 1,
  });
  return turns >= 2;
}
