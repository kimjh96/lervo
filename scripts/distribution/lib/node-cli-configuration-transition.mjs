import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readNodeUpgradeConfigSource } from "./node-upgrade-config-source.mjs";
import { applySharedDiscordChannelBinding } from "./node-discord-channel-binding-transition.mjs";
import {
  assertOwnedRewrittenPaths,
  executablePathRewrites,
} from "./node-executable-path-rewrites.mjs";

export class NodeCliConfigurationTransitionError extends Error {
  constructor(
    cause,
    code = "service_upgrade_unknown",
    message = "The exact Node configuration transition requires recovery.",
  ) {
    super(message, { cause });
    this.code = code;
  }
}

function fail() {
  throw new NodeCliConfigurationTransitionError();
}

const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function ownedBytes(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size > 1_048_576 ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.getuid()
    )
      fail();
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function replace(path, bytes) {
  const temporary = `${path}.cli-transition-${process.pid}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

function cliBindings(config) {
  return (
    config.discordConversations ?? (config.discordConversation ? [config.discordConversation] : [])
  )
    .filter((conversation) => conversation.deliberation)
    .map((conversation) => conversation.deliberation);
}

async function assertOwnedCliExecutable(executable) {
  if (typeof executable !== "string" || !isAbsolute(executable)) fail();
  const stat = await lstat(executable);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o022) !== 0 ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o111) === 0
  )
    fail();
}

/** Changes only one reviewed configuration scope after verified stop. */
export async function createNodeCliConfigurationTransition(input, admission) {
  try {
    return await prepare(input, admission);
  } catch (error) {
    throw error instanceof NodeCliConfigurationTransitionError
      ? error
      : new NodeCliConfigurationTransitionError(error);
  }
}

async function prepare(input, admission) {
  const original = await ownedBytes(input.config);
  const replacement = await ownedBytes(input.configurationSource);
  const source = await readNodeUpgradeConfigSource(input.config);
  const before = JSON.parse(original);
  const after = JSON.parse(replacement);
  const expected = structuredClone(before);
  const oldBindings = cliBindings(expected);
  const newBindings = cliBindings(after);
  let cliChanged = false;
  if (oldBindings.length === newBindings.length) {
    for (let index = 0; index < oldBindings.length; index += 1) {
      const executable = newBindings[index].cliExecutable;
      if (oldBindings[index].cliExecutable === executable) continue;
      await assertOwnedCliExecutable(executable);
      cliChanged = true;
      oldBindings[index].cliExecutable = executable;
    }
  }
  const oldManaged = expected.outcomeSupervision?.managedExecution;
  const newManaged = after.outcomeSupervision?.managedExecution;
  if (oldManaged && newManaged && oldManaged.cliBundle !== newManaged.cliBundle) {
    await assertOwnedCliExecutable(newManaged.cliBundle);
    cliChanged = true;
    oldManaged.cliBundle = newManaged.cliBundle;
  }
  const onlyCliChange = cliChanged && isDeepStrictEqual(expected, after);
  // ADR-0489: an ADR-0488 migration may also move CLI paths in argument lists and runtime pins.
  const pathRewrites = onlyCliChange ? null : executablePathRewrites(before, after);
  if (pathRewrites !== null) await assertOwnedRewrittenPaths(pathRewrites);
  const onlyChannelChange =
    !cliChanged && pathRewrites === null && applySharedDiscordChannelBinding(before, after);
  if (
    (!onlyCliChange && pathRewrites === null && !onlyChannelChange) ||
    source.sourceDigest !== digest(original)
  )
    fail();
  // Keep the original private coordinate names so an interrupted CLI transition cannot be bypassed.
  const journal = `${input.config}.cli-transition.json`;
  const backup = `${input.config}.cli-predecessor`;
  let prior;
  try {
    prior = JSON.parse(await ownedBytes(journal));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (
    prior &&
    !["completed", "restored"].includes(prior.state) &&
    !(
      prior.state === "prepared" &&
      prior.originalDigest === digest(original) &&
      prior.replacementDigest === digest(replacement)
    )
  )
    fail();
  try {
    const retained = await ownedBytes(backup);
    if (!prior || digest(retained) !== prior.originalDigest) fail();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (prior) fail();
  }
  const coordinate = {
    schemaVersion: 1,
    originalDigest: digest(original),
    replacementDigest: digest(replacement),
  };
  await replace(backup, original);
  await replace(journal, Buffer.from(JSON.stringify({ ...coordinate, state: "prepared" })));
  const record = (state) => replace(journal, Buffer.from(JSON.stringify({ ...coordinate, state })));
  async function applyBytes(current, desired) {
    if (digest(await ownedBytes(input.config)) !== digest(current)) fail();
    await replace(input.config, desired);
    if (!admission.replaceConfiguration(digest(current), digest(desired))) fail();
  }
  const guarded = (operation) => async () => {
    try {
      await operation();
    } catch (error) {
      throw error instanceof NodeCliConfigurationTransitionError
        ? error
        : new NodeCliConfigurationTransitionError(error);
    }
  };
  return {
    apply: guarded(async () => {
      await record("applying");
      await applyBytes(original, replacement);
      await record("applied");
    }),
    restore: guarded(async () => {
      await record("restoring");
      await applyBytes(replacement, original);
      await record("restored");
    }),
    complete: guarded(async () => record("completed")),
  };
}

/**
 * ADR-0489: completes an ADR-0488 migration that an older CLI wrote in place while the Node kept
 * running. The file already holds the migrated bytes, and the stopped Node's admission scope still
 * binds the predecessor digest. Apply moves only the frozen binding to the file's digest. Restore
 * moves the binding back first and then the predecessor bytes, so an interruption between the two
 * leaves exactly the state that this recovery accepts again.
 */
export function createMigratedConfigurationRecovery(input, admission, predecessor) {
  const guarded = (operation) => async () => {
    try {
      await operation();
    } catch (error) {
      throw error instanceof NodeCliConfigurationTransitionError
        ? error
        : new NodeCliConfigurationTransitionError(error);
    }
  };
  let migratedDigest;
  return {
    apply: guarded(async () => {
      const current = await readNodeUpgradeConfigSource(input.config);
      if (
        executablePathRewrites(JSON.parse(predecessor.bytes.toString("utf8")), current.config) ===
        null
      )
        fail();
      if (!admission.replaceConfiguration(predecessor.configDigest, current.sourceDigest)) fail();
      migratedDigest = current.sourceDigest;
    }),
    restore: guarded(async () => {
      if (migratedDigest === undefined) return;
      if (!admission.replaceConfiguration(migratedDigest, predecessor.configDigest)) fail();
      if (digest(await ownedBytes(input.config)) !== migratedDigest) fail();
      await replace(input.config, predecessor.bytes);
    }),
    complete: guarded(async () => undefined),
  };
}

/**
 * The configuration transition one guarded Node service operation applies: the ADR-0489 recovery
 * of an in-place migration, a requested replacement, or none. A rollback applies only a recovery.
 */
export async function selectNodeConfigurationTransition(input, admission, prepareOverride) {
  const predecessor = admission?.configPredecessor ?? null;
  if (predecessor !== null) {
    if (input.configurationSource !== undefined)
      throw new NodeCliConfigurationTransitionError(
        undefined,
        "service_upgrade_config_mismatch",
        "A configuration replacement cannot start while an in-place migration is unfinished.",
      );
    return createMigratedConfigurationRecovery(input, admission, predecessor);
  }
  if (input.action !== "upgrade") return undefined;
  const prepare =
    prepareOverride ??
    (input.configurationSource === undefined ? undefined : createNodeCliConfigurationTransition);
  return prepare?.(input, admission);
}
