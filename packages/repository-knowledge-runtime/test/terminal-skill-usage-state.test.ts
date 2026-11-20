import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  readTerminalSkillUsage,
  refreshTerminalSkillUsage,
} from "../src/terminal-skill-usage-state.js";

const DAY = 86_400_000;
const NOW = new Date("2026-11-20T12:00:00.000Z");
const skills = [{ skillId: "deploy", path: ".agents/skills/deploy/SKILL.md", contentHash: "h" }];
let root: string;

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "lervo-skill-usage-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** An in-memory log of skill events that records the sequence each read started after. */
function storage() {
  const log: EventEnvelope[] = [];
  const reads: number[] = [];
  const append = (eventId: string, observedAt: number) =>
    log.push({
      eventId,
      seq: log.length + 1,
      eventHash: `sha256:${String(log.length + 1).padStart(64, "0")}`,
      type: "terminal.skill.observed",
      payload: {
        observedAt: new Date(observedAt).toISOString(),
        skillId: "deploy",
        path: skills[0]!.path,
      },
    } as unknown as EventEnvelope);
  const events = {
    list: (options: { afterSeq?: number; limit?: number } = {}) => {
      const afterSeq = options.afterSeq ?? 0;
      reads.push(afterSeq);
      return log.filter((event) => event.seq > afterSeq).slice(0, options.limit ?? 100);
    },
    get: (eventId: string) => log.find((event) => event.eventId === eventId) ?? null,
    latest: () => log.at(-1) ?? null,
    latestHash: () => log.at(-1)?.eventHash ?? null,
  };
  return {
    log,
    reads,
    append,
    storage: { paths: { repositoryRoot: root }, events } as unknown as ProjectStorage,
  };
}

it("skips an unchanged projection and reads only from the window's start (ADR-0597)", async () => {
  const s = storage();
  s.append("evt_skill_old_0001", NOW.getTime() - 40 * DAY);
  s.append("evt_skill_old_0002", NOW.getTime() - 35 * DAY);
  s.append("evt_skill_new_0003", NOW.getTime() - DAY);
  await refreshTerminalSkillUsage(s.storage, skills, NOW);
  expect(s.reads[0]).toBe(0);
  expect((await readTerminalSkillUsage(root))?.skills[0]).toMatchObject({
    observedInvocationCount: 1,
  });

  // Unchanged head, day and catalog: no read at all.
  const before = s.reads.length;
  await refreshTerminalSkillUsage(s.storage, skills, NOW);
  expect(s.reads).toHaveLength(before);

  // A new event moves the head; the read starts after the last event before the window.
  s.append("evt_skill_new_0004", NOW.getTime());
  await refreshTerminalSkillUsage(s.storage, skills, NOW);
  expect(s.reads.at(-2)).toBe(2);
  expect((await readTerminalSkillUsage(root))?.skills[0]).toMatchObject({
    observedInvocationCount: 2,
  });

  // A forced refresh rebuilds with the head unchanged, from the same window start.
  const forced = s.reads.length;
  await refreshTerminalSkillUsage(s.storage, skills, NOW, { force: true });
  expect(s.reads.length).toBeGreaterThan(forced);
  expect(s.reads[forced]).toBe(2);
});

it("reads the whole log again when the cursor's anchor is not in this log", async () => {
  const first = storage();
  first.append("evt_skill_old_0001", NOW.getTime() - 40 * DAY);
  first.append("evt_skill_new_0002", NOW.getTime() - DAY);
  await refreshTerminalSkillUsage(first.storage, skills, NOW);
  // A replaced event store under the same checkout: the saved anchor names no event there.
  const second = storage();
  second.append("evt_skill_other_001", NOW.getTime() - DAY);
  await refreshTerminalSkillUsage(second.storage, skills, NOW);
  expect(second.reads[0]).toBe(0);
});
