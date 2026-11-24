import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { sha256, type TerminalIntegrationProvider } from "@lervo/repository-knowledge";

import type { ParsedSessionStartInput } from "./terminal-hook-contract.js";

/** Why a provider session epoch started: a new session, a resume, a clear, or a compaction. */
export type TerminalEpochCause = ParsedSessionStartInput["source"];

/**
 * One provider session's context epoch (ADR-0562 section 4), host-private and replaced by the next
 * session start. It records what the session start's base block delivered: the base precedes every
 * prompt of the epoch, so a rewind or a blocked prompt cannot take it from the model. Prompts do not
 * read it yet; leaving out what the base delivered waits for the resident to prove from the
 * transcript that the base is still in the model's context.
 */
export interface TerminalContextEpoch {
  schemaVersion: 2;
  /** Named in the base block, so the transcript record of that block can be found. */
  epochId: string;
  provider: TerminalIntegrationProvider;
  cause: TerminalEpochCause;
  startedAt: string;
  /** Owner rules the base delivered whole: repository path to the hash of the exact section. */
  baseRules: Record<string, string>;
  /** The transcript size when the session start ran; its base block appears after this offset. */
  transcriptOffset: number;
}

const EPOCH_SEGMENTS = [".lervo", "state", "terminal-integration", "epochs"] as const;
/** Epoch files kept per checkout; the oldest go first, so a long-lived host never grows them. */
const MAXIMUM_EPOCHS = 256;
/** Matches the instruction packing bound. */
const MAXIMUM_RULES = 64;
/** A temporary file this old belongs to a writer that did not finish. */
const ABANDONED_TEMPORARY_MS = 60_000;
const RULE_PATH = /^docs\/instructions\/generated\/[A-Za-z0-9_.-]+\.md$/u;

export function terminalEpochPath(
  root: string,
  provider: TerminalIntegrationProvider,
  providerSessionId: string,
): string {
  const digest = sha256(`${provider}\0${providerSessionId}`).slice("sha256:".length);
  return resolve(root, ...EPOCH_SEGMENTS, `${digest.slice(0, 32)}.json`);
}

/**
 * Refuses any level that is a link or not a directory, as open-turn state does. With `create`, a
 * missing level is made owner-only; without it, a missing level returns null.
 */
async function epochDirectory(root: string, create: boolean): Promise<string | null> {
  let directory = root;
  for (const segment of EPOCH_SEGMENTS) {
    directory = resolve(directory, segment);
    if (create)
      await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    const stats = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
      if (!create && error.code === "ENOENT") return null;
      throw error;
    });
    if (stats === null) return null;
    if (!stats.isDirectory() || stats.isSymbolicLink())
      throw new Error("Unsafe terminal epoch state directory.");
  }
  return directory;
}

async function pruneEpochs(directory: string, keep: string, now: number): Promise<void> {
  const entries = await Promise.all(
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map(async (entry) => ({
        name: entry.name,
        // A file another writer renamed or pruned meanwhile is simply skipped.
        modifiedAt: (await lstat(resolve(directory, entry.name)).catch(() => null))?.mtimeMs,
      })),
  ).then((all) =>
    all.filter(
      (entry): entry is { name: string; modifiedAt: number } => entry.modifiedAt !== undefined,
    ),
  );
  for (const entry of entries)
    if (/^\.epoch-.+\.tmp$/u.test(entry.name) && now - entry.modifiedAt > ABANDONED_TEMPORARY_MS)
      await rm(resolve(directory, entry.name), { force: true });
  const epochs = entries.filter((entry) => /^[a-f0-9]{32}\.json$/u.test(entry.name));
  epochs.sort(
    (left, right) =>
      Number(left.name === keep) - Number(right.name === keep) ||
      left.modifiedAt - right.modifiedAt ||
      left.name.localeCompare(right.name),
  );
  for (const entry of epochs.slice(0, Math.max(0, epochs.length - MAXIMUM_EPOCHS)))
    await rm(resolve(directory, entry.name), { force: true });
}

/** Replaces the session's epoch file atomically, owner-only and never through a link. */
export async function writeTerminalContextEpoch(
  root: string,
  providerSessionId: string,
  epoch: TerminalContextEpoch,
): Promise<void> {
  const directory = (await epochDirectory(root, true))!;
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
  await pruneEpochs(directory, basename(target), Date.now());
}

export async function removeTerminalContextEpoch(
  root: string,
  provider: TerminalIntegrationProvider,
  providerSessionId: string,
): Promise<void> {
  if ((await epochDirectory(root, false)) === null) return;
  await rm(terminalEpochPath(root, provider, providerSessionId), { force: true });
}

/** The exact-section hash `baseRules` keys on, so a changed applicability header also counts. */
export function terminalSectionHash(text: string): string {
  return sha256(text);
}

/** The base rules to record: only whole sections that reached the delivered base. */
export function baseRulesDelivered(
  sections: readonly { path: string; text: string }[],
  base: string,
): Record<string, string> {
  const rules: Record<string, string> = {};
  for (const section of sections.slice(0, MAXIMUM_RULES))
    if (RULE_PATH.test(section.path) && base.includes(section.text))
      rules[section.path] = terminalSectionHash(section.text);
  return rules;
}
