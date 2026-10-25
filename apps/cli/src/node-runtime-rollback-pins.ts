import { createHash } from "node:crypto";
import { mkdir, open, readlink, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { nodeRuntimesDirectory } from "./node-runtime-pointer.js";
import { withNodeRuntimeRetentionLock } from "./node-runtime-retention-lock.js";
import { readRuntimeReferenceText } from "./node-runtime-reference-file.js";
import { runtimeReferences } from "./node-runtime-reference-text.js";
const MAXIMUM_REFERENCES = 1024;

function pinPath(homeDirectory?: string, platform?: NodeJS.Platform) {
  return resolve(
    dirname(nodeRuntimesDirectory(homeDirectory, platform)),
    "node-rollback-pins.json",
  );
}

export async function rollbackPins(homeDirectory?: string, platform?: NodeJS.Platform) {
  const text = await readRuntimeReferenceText(pinPath(homeDirectory, platform));
  const envelope: unknown = text === null ? null : JSON.parse(text);
  if (
    text !== null &&
    (envelope === null ||
      typeof envelope !== "object" ||
      (envelope as { schemaVersion?: unknown }).schemaVersion !== 1)
  )
    throw new Error("Runtime rollback pin version is invalid.");
  const pins: unknown = text === null ? {} : (envelope as { pins?: unknown }).pins;
  if (
    pins === null ||
    typeof pins !== "object" ||
    Array.isArray(pins) ||
    Object.keys(pins).length > MAXIMUM_REFERENCES ||
    Object.entries(pins).some(
      ([key, value]) =>
        !/^[a-f0-9]{64}$/u.test(key) ||
        !Array.isArray(value) ||
        value.length > 4096 ||
        value.some((name) => typeof name !== "string" || !/^[a-f0-9]{16}$/u.test(name)),
    )
  )
    throw new Error("Runtime rollback pins are invalid.");
  return pins as Record<string, string[]>;
}

/** Persist before replacing a service; a failed rollout conservatively retains its predecessor. */
export async function pinRuntimeRollbackPredecessor(input: {
  servicePath: string;
  definition: string;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}): Promise<void> {
  const root = nodeRuntimesDirectory(input.homeDirectory, input.platform);
  const insensitive = (input.platform ?? process.platform) === "darwin";
  const normalized = insensitive ? input.definition.toLowerCase() : input.definition;
  const comparedRoot = insensitive ? root.toLowerCase() : root;
  if (
    !runtimeReferences(input.definition, root, input.platform).length &&
    !normalized.includes(`${comparedRoot}/current/`)
  )
    return;
  return withNodeRuntimeRetentionLock(
    resolve(nodeRuntimesDirectory(input.homeDirectory, input.platform), ".retention.lock"),
    () => writeRollbackPin(input),
  );
}

async function writeRollbackPin(input: {
  servicePath: string;
  definition: string;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}): Promise<void> {
  const pins = await rollbackPins(input.homeDirectory, input.platform);
  const root = nodeRuntimesDirectory(input.homeDirectory, input.platform);
  let definition = input.definition;
  const insensitive = (input.platform ?? process.platform) === "darwin";
  const comparedRoot = insensitive ? root.toLowerCase() : root;
  let observed = insensitive ? definition.toLowerCase() : definition;
  if (observed.includes(`${comparedRoot}/current/`)) {
    const current = await readlink(resolve(root, "current"));
    if (!/^[a-f0-9]{16}$/u.test(current))
      throw new Error("Rollback predecessor pointer is invalid.");
    const prefix = `${comparedRoot}/current/`;
    let position = observed.indexOf(prefix);
    while (position >= 0) {
      definition =
        definition.slice(0, position) +
        `${root}/${current}/` +
        definition.slice(position + prefix.length);
      observed = insensitive ? definition.toLowerCase() : definition;
      position = observed.indexOf(prefix);
    }
  }
  const names = runtimeReferences(definition, root, input.platform);
  // Reapplying the same definition must not replace the last distinct predecessor pin.
  if (!names.length) return;
  await storeRuntimeRollbackPins(input, pins, names);
}

/** Caller holds the host runtime lock and has resolved the exact consumer identity. */
export async function storeRuntimeRollbackPins(
  input: { servicePath: string; homeDirectory?: string; platform?: NodeJS.Platform },
  pins: Record<string, string[]>,
  names: string[],
): Promise<void> {
  if (names.length > 4096 || names.some((name) => !/^[a-f0-9]{16}$/u.test(name)))
    throw new Error("Runtime rollback pin names are invalid.");
  const key = createHash("sha256").update(input.servicePath).digest("hex");
  pins[key] = names;
  if (Object.keys(pins).length > MAXIMUM_REFERENCES)
    throw new Error("Runtime rollback pin capacity exceeded.");
  const path = pinPath(input.homeDirectory, input.platform);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.next`;
  await rm(temporary, { force: true });
  try {
    const bytes = JSON.stringify({ schemaVersion: 1, pins });
    if (Buffer.byteLength(bytes) > 4 * 1024 * 1024)
      throw new Error("Runtime rollback pins exceed their byte bound.");
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
  }
}
