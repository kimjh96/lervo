import { readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { MAXIMUM_CAPTURED_AGENT_TURN_BYTES, sha256 } from "@lervo/repository-knowledge";

import {
  boundedUtf8Tail,
  INSTRUCTION_CAPTURE_ROOT,
  readPrivate,
  writePrivate,
} from "./instruction-capture-private-file.js";

const AGENT_TURN_ROOT = `${INSTRUCTION_CAPTURE_ROOT}/agent-turns`;
const MAXIMUM_AGENT_TURN_SLOTS = 16;
const AGENT_TURN_RETENTION_MILLISECONDS = 6 * 3_600_000;
const SESSION_KEY = /^[a-f0-9]{24}$/u;

function sessionKey(provider: "codex" | "claude", providerSessionId: string): string {
  return sha256(`${provider}\0${providerSessionId}`).slice("sha256:".length, "sha256:".length + 24);
}

/**
 * Keeps the latest agent reply of one terminal session so the next owner turn is assessed with
 * it: an implicit correction only makes sense against what the agent just said. One bounded slot
 * per session, overwritten each turn, expiring after six hours.
 */
export async function recordPrecedingAgentTurn(input: {
  repositoryRoot: string;
  provider: "codex" | "claude";
  providerSessionId: string;
  agentTurn: string | null;
  now: Date;
}): Promise<void> {
  const key = sessionKey(input.provider, input.providerSessionId);
  const directory = resolve(input.repositoryRoot, AGENT_TURN_ROOT);
  if (input.agentTurn === null || input.agentTurn.trim() === "") {
    await rm(resolve(directory, `${key}.json`), { force: true });
    return;
  }
  let names: string[] = [];
  try {
    names = (await readdir(directory)).filter((name) => name !== `${key}.json`).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (names.length >= MAXIMUM_AGENT_TURN_SLOTS) {
    const aged = await Promise.all(
      names.map(async (name) => ({
        name,
        modified: await stat(resolve(directory, name)).then(
          (observed) => observed.mtimeMs,
          () => 0,
        ),
      })),
    );
    aged.sort((left, right) => left.modified - right.modified);
    for (const entry of aged.slice(0, names.length - MAXIMUM_AGENT_TURN_SLOTS + 1))
      await rm(resolve(directory, entry.name), { force: true });
  }
  await writePrivate(input.repositoryRoot, AGENT_TURN_ROOT, `${key}.json`, {
    schemaVersion: 1,
    text: boundedUtf8Tail(input.agentTurn, MAXIMUM_CAPTURED_AGENT_TURN_BYTES),
    recordedAt: input.now.toISOString(),
  });
}

export async function readPrecedingAgentTurn(input: {
  repositoryRoot: string;
  provider: "codex" | "claude";
  providerSessionId: string;
  now: Date;
}): Promise<string | null> {
  const key = sessionKey(input.provider, input.providerSessionId);
  if (!SESSION_KEY.test(key)) return null;
  const value = (await readPrivate(
    resolve(input.repositoryRoot, AGENT_TURN_ROOT, `${key}.json`),
  )) as { schemaVersion?: unknown; text?: unknown; recordedAt?: unknown } | null;
  if (
    value?.schemaVersion !== 1 ||
    typeof value.text !== "string" ||
    typeof value.recordedAt !== "string" ||
    !(input.now.getTime() - Date.parse(value.recordedAt) < AGENT_TURN_RETENTION_MILLISECONDS)
  )
    return null;
  return value.text;
}

/** Removes agent-turn slots older than their retention, or unreadable ones. */
export async function pruneExpiredAgentTurns(repositoryRoot: string, now: Date): Promise<void> {
  const slots = resolve(repositoryRoot, AGENT_TURN_ROOT);
  try {
    for (const name of await readdir(slots)) {
      const value = (await readPrivate(resolve(slots, name))) as { recordedAt?: unknown } | null;
      const recordedAt = typeof value?.recordedAt === "string" ? Date.parse(value.recordedAt) : NaN;
      if (!(now.getTime() - recordedAt < AGENT_TURN_RETENTION_MILLISECONDS))
        await rm(resolve(slots, name), { force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
