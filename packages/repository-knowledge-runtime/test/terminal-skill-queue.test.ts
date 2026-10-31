import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import {
  enqueueTerminalSkillTurn,
  queuedTerminalSkillTurns,
  terminalTranscriptPosition,
  TERMINAL_SKILL_QUEUE,
  type QueuedTerminalSkillTurn,
} from "../src/terminal-skill-queue.js";

const roots: string[] = [];
const now = new Date("2026-10-31T12:00:00.000Z");
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function root() {
  const path = await mkdtemp(resolve(tmpdir(), "lervo-skill-queue-"));
  roots.push(path);
  return path;
}
function record(index: number): QueuedTerminalSkillTurn {
  return {
    provider: "claude",
    providerSessionDigest: sha256("session"),
    providerTurnDigest: null,
    contextEventId: `evt_${index.toString().padStart(24, "0")}`,
    turnEventId: `evt_${"f".repeat(24)}`,
    start: null,
    end: null,
    enqueuedAt: now.toISOString(),
  };
}

it("deduplicates one context, expires at 24 hours and bounds the queue at 128 records", async () => {
  const path = await root();
  for (let index = 0; index < 130; index++) await enqueueTerminalSkillTurn(path, record(index));
  await enqueueTerminalSkillTurn(path, record(129));
  const records = await queuedTerminalSkillTurns(path, now);
  expect(records).toHaveLength(128);
  const queued = resolve(path, TERMINAL_SKILL_QUEUE, `${record(129).contextEventId}.json`);
  expect((await stat(queued)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(queued, "utf8"))).toEqual(record(129));
  expect(await queuedTerminalSkillTurns(path, new Date(now.getTime() + 24 * 3_600_000))).toEqual(
    [],
  );
  expect(await readdir(resolve(path, TERMINAL_SKILL_QUEUE))).toEqual([]);
});

it("rejects symlinked state and transcript files without changing hook availability", async () => {
  const path = await root();
  const outside = await root();
  await mkdir(resolve(path, ".lervo/state/knowledge"), { recursive: true });
  await symlink(outside, resolve(path, ".lervo/state/knowledge/terminal-skills"));
  await expect(enqueueTerminalSkillTurn(path, record(1))).resolves.toBeUndefined();
  expect(await readdir(outside)).toEqual([]);
  const transcript = resolve(outside, "transcript");
  await writeFile(transcript, "private");
  await symlink(transcript, resolve(path, "linked-transcript"));
  expect(await terminalTranscriptPosition(resolve(path, "linked-transcript"))).toBeNull();
});
