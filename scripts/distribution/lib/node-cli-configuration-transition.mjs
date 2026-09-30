import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readNodeUpgradeConfigSource } from "./node-upgrade-config-source.mjs";
import { applySharedDiscordChannelBinding } from "./node-discord-channel-binding-transition.mjs";

export class NodeCliConfigurationTransitionError extends Error {
  constructor(cause) {
    super("The exact Node configuration transition requires recovery.", { cause });
    this.code = "service_upgrade_unknown";
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
  const onlyChannelChange = !cliChanged && applySharedDiscordChannelBinding(before, after);
  if ((!onlyCliChange && !onlyChannelChange) || source.sourceDigest !== digest(original)) fail();
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
