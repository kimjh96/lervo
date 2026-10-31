import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
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
const now = new Date(Date.now() + 60_000);
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
    repositoryRevision: null,
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
  for (const name of await readdir(resolve(path, TERMINAL_SKILL_QUEUE)))
    await utimes(resolve(path, TERMINAL_SKILL_QUEUE, name), now, now);
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
  expect(await terminalTranscriptPosition("claude", resolve(path, "linked-transcript"))).toBeNull();
});

it("enqueue never scans, expires, or evicts another producer's record using the hook clock", async () => {
  const path = await root();
  const newer = { ...record(1), enqueuedAt: new Date(now.getTime() + 60_000).toISOString() };
  await enqueueTerminalSkillTurn(path, newer);
  await enqueueTerminalSkillTurn(path, { ...record(2), enqueuedAt: "2000-01-01T00:00:00.000Z" });
  expect(await readdir(resolve(path, TERMINAL_SKILL_QUEUE))).toHaveLength(2);
  expect(await queuedTerminalSkillTurns(path, now)).toEqual([]);
  expect(
    JSON.parse(
      await readFile(resolve(path, TERMINAL_SKILL_QUEUE, `${newer.contextEventId}.json`), "utf8"),
    ),
  ).toEqual(newer);
  expect(await queuedTerminalSkillTurns(path, new Date(now.getTime() + 60_000))).toEqual([newer]);
});

it("publishes concurrent enqueues atomically and never overwrites the first context", async () => {
  const path = await root();
  await Promise.all(
    Array.from({ length: 140 }, (_, index) => enqueueTerminalSkillTurn(path, record(index))),
  );
  expect(await readdir(resolve(path, TERMINAL_SKILL_QUEUE))).toHaveLength(140);
  await enqueueTerminalSkillTurn(path, { ...record(139), turnEventId: record(138).contextEventId });
  expect(
    JSON.parse(
      await readFile(
        resolve(path, TERMINAL_SKILL_QUEUE, `${record(139).contextEventId}.json`),
        "utf8",
      ),
    ),
  ).toEqual(record(139));
  expect(await queuedTerminalSkillTurns(path, now)).toHaveLength(128);
});

it("leaves expired and malformed files whose modification time is newer than the resident snapshot", async () => {
  const path = await root();
  const expired = { ...record(1), enqueuedAt: "2000-01-01T00:00:00.000Z" };
  await enqueueTerminalSkillTurn(path, expired);
  const file = resolve(path, TERMINAL_SKILL_QUEUE, `${expired.contextEventId}.json`);
  const malformed = resolve(path, TERMINAL_SKILL_QUEUE, `${record(2).contextEventId}.json`);
  await writeFile(malformed, "incomplete");
  const future = new Date(now.getTime() + 60_000);
  await utimes(file, future, future);
  await utimes(malformed, future, future);
  expect(await queuedTerminalSkillTurns(path, now)).toEqual([]);
  expect(await readdir(resolve(path, TERMINAL_SKILL_QUEUE))).toHaveLength(2);
  expect(await queuedTerminalSkillTurns(path, future)).toEqual([]);
  expect(await readdir(resolve(path, TERMINAL_SKILL_QUEUE))).toEqual([]);
});
