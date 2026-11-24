import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { sha256, type TerminalIntegrationProvider } from "@lervo/repository-knowledge";

import { TERMINAL_AGENTS_POINTER } from "./terminal-compact-format.js";
import { capContextBytes, MAXIMUM_COMPACT_CONTEXT_BYTES } from "./terminal-context-budget.js";
import { prepareTerminalBaseContext } from "./terminal-degraded-context.js";
import type { ParsedSessionStartInput } from "./terminal-hook-contract.js";

/** Why a provider session epoch started: a new session, a resume, a clear, or a compaction. */
export type TerminalEpochCause = ParsedSessionStartInput["source"];

/**
 * One provider session's context epoch (ADR-0562 section 4). The base block is delivered once per
 * epoch; `delivered` will hold the hashes of the blocks already shown in it, so a later turn sends
 * only what changed. Host-private state, rebuilt by the next session start.
 */
export interface TerminalContextEpoch {
  schemaVersion: 1;
  epochId: string;
  provider: TerminalIntegrationProvider;
  cause: TerminalEpochCause;
  startedAt: string;
  delivered: Record<string, string>;
}

const EPOCH_DIRECTORY = ".lervo/state/terminal-integration/epochs";

export function terminalEpochPath(
  root: string,
  provider: TerminalIntegrationProvider,
  providerSessionId: string,
): string {
  const digest = sha256(`${provider}\0${providerSessionId}`).slice("sha256:".length);
  return resolve(root, EPOCH_DIRECTORY, `${digest.slice(0, 32)}.json`);
}

/** Epoch files kept per checkout; the oldest go first, so a long-lived host never grows them. */
const MAXIMUM_EPOCHS = 256;

/** Creates each level owner-only and refuses any level that is a link, as open-turn state does. */
async function epochDirectory(root: string): Promise<string> {
  let directory = root;
  for (const segment of [".lervo", "state", "terminal-integration", "epochs"]) {
    directory = resolve(directory, segment);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink())
      throw new Error("Unsafe terminal epoch state directory.");
  }
  return directory;
}

async function pruneEpochs(directory: string, keep: string): Promise<void> {
  const entries = await Promise.all(
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^[a-f0-9]{32}\.json$/u.test(entry.name))
      .map(async (entry) => ({
        name: entry.name,
        modifiedAt: (await lstat(resolve(directory, entry.name))).mtimeMs,
      })),
  );
  entries.sort(
    (left, right) =>
      Number(left.name === keep) - Number(right.name === keep) ||
      left.modifiedAt - right.modifiedAt ||
      left.name.localeCompare(right.name),
  );
  for (const entry of entries.slice(0, Math.max(0, entries.length - MAXIMUM_EPOCHS)))
    await rm(resolve(directory, entry.name), { force: true });
}

/** Replaces the session's epoch file atomically, owner-only and never through a link. */
export async function writeTerminalContextEpoch(
  root: string,
  providerSessionId: string,
  epoch: TerminalContextEpoch,
): Promise<void> {
  const directory = await epochDirectory(root);
  const target = terminalEpochPath(root, epoch.provider, providerSessionId);
  const temporary = resolve(directory, `.epoch-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(epoch)}\n`);
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
  await pruneEpochs(directory, basename(target));
}

const CAUSE_LABELS: Record<TerminalEpochCause, string> = {
  startup: "session start",
  resume: "session resume",
  clear: "context clear",
  compact: "context compaction",
};

/**
 * The base block for a provider `SessionStart` (ADR-0562 section 4): the repository pointer, the
 * publication policy, the applied owner rules, and the workstream headline, from independent local
 * reads with no repository snapshot. A compaction or clear starts a new epoch, so the model gets
 * the base back after it lost the earlier turns. The epoch is recorded even when a read fails, and
 * a failed epoch write still answers with the base block.
 */
export async function prepareTerminalSessionStart(input: {
  root: string;
  provider: TerminalIntegrationProvider;
  session: ParsedSessionStartInput;
  deadline: number;
  now: Date;
}): Promise<string> {
  const lines = await prepareTerminalBaseContext(input.root, input.deadline);
  // A lost epoch only means the next prompt delivers everything; the base block still goes out.
  await writeTerminalContextEpoch(input.root, input.session.providerSessionId, {
    schemaVersion: 1,
    epochId: `tepoch_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    provider: input.provider,
    cause: input.session.source,
    startedAt: input.now.toISOString(),
    delivered: {},
  }).catch(() => undefined);
  return capContextBytes(
    [
      lines[0] ?? TERMINAL_AGENTS_POINTER,
      `Lervo base context for this ${CAUSE_LABELS[input.session.source]}.`,
      ...lines.slice(1),
    ].join("\n\n"),
    MAXIMUM_COMPACT_CONTEXT_BYTES,
  );
}
