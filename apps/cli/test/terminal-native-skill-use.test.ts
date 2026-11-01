import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import { sha256 } from "@lervo/repository-knowledge";
import {
  queuedTerminalSkillTurns,
  TERMINAL_SKILL_QUEUE,
} from "../../../packages/repository-knowledge-runtime/src/terminal-skill-queue.js";
import { singleOpenTerminalTurn } from "../src/terminal-open-turns.js";
import { parseTerminalHookInput } from "../src/terminal-hook-input.js";
import { fixture, now, body, skillLine } from "./terminal-native-skill-fixture.js";

it("hooks retain range coordinates and a prefix digest; the resident records one installed Claude invocation with path and hash", async () => {
  const f = await fixture();
  await appendFile(f.transcriptPath, skillLine("eli5"));
  const stop = await f.stop();
  expect(await singleOpenTerminalTurn(f.root, now)).toBeNull();
  const queue = await queuedTerminalSkillTurns(f.root, now);
  expect(queue).toHaveLength(1);
  expect(queue[0]).toMatchObject({
    start: f.start,
    end: { offset: (await stat(f.transcriptPath)).size },
    turnEventId: stop.eventId,
  });
  const path = resolve(f.root, TERMINAL_SKILL_QUEUE, `${f.contextEventId}.json`);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  const queued = await readFile(path, "utf8");
  expect(queued).not.toContain("private-tool-content");
  expect(queued).not.toContain("earlier-private-user-skill");
  const storage = await openProjectStorage(f.root);
  try {
    expect(
      storage.events.list({ limit: 1000 }).some((e) => e.type === "terminal.skill.observed"),
    ).toBe(false);
  } finally {
    await storage.close();
  }
  const events = await f.resident();
  const observed = events.filter((e) => e.type === "terminal.skill.observed");
  expect(observed).toHaveLength(1);
  expect(observed[0]!.payload).toMatchObject({
    skillId: "eli5",
    path: ".agents/skills/eli5/SKILL.md",
    contentHash: sha256(body),
    provider: "claude",
    source: "provider_transcript",
  });
  expect(events.find((e) => e.type === "terminal.skill.turn_assessed")!.seq).toBeGreaterThan(
    events.find((e) => e.eventId === stop.eventId)!.seq,
  );
  expect(JSON.stringify(observed)).not.toContain(f.transcriptPath);
  expect(JSON.stringify(observed)).not.toContain("private-tool-content");
  expect(await readdir(resolve(f.root, TERMINAL_SKILL_QUEUE))).toEqual([]);
  expect((await f.resident()).filter((e) => e.type === "terminal.skill.observed")).toHaveLength(1);
});

it("keeps plugin and user identifiers out of events and resolves a provider link to its repository skill", async () => {
  const f = await fixture();
  await appendFile(
    f.transcriptPath,
    skillLine("anthropic-skills:docs") + skillLine("private-user-skill") + skillLine("explain"),
  );
  await f.stop();
  const events = (await f.resident()).filter((e) => e.type.startsWith("terminal.skill."));
  expect(events.filter((e) => e.type === "terminal.skill.observed")).toHaveLength(1);
  expect(events.find((e) => e.type === "terminal.skill.turn_assessed")!.payload).toMatchObject({
    externalSkillCount: 1,
    unknownSkillCount: 1,
    skillTelemetry: "unknown",
  });
  expect(JSON.stringify(events)).not.toContain("anthropic-skills:docs");
  expect(JSON.stringify(events)).not.toContain("private-user-skill");
});

it("reads only the stopped range, including neither earlier nor later entries", async () => {
  const f = await fixture();
  await appendFile(f.transcriptPath, skillLine("eli5"));
  await f.stop();
  await appendFile(f.transcriptPath, skillLine("later-private-skill"));
  const events = await f.resident();
  expect(events.filter((e) => e.type === "terminal.skill.observed")).toHaveLength(1);
  expect(
    events.find((e) => e.type === "terminal.skill.turn_assessed")!.payload.externalSkillCount,
  ).toBe(0);
});

it("drops a range above 4 MiB as truncated without partial invocation evidence", async () => {
  const f = await fixture();
  await appendFile(f.transcriptPath, skillLine("eli5") + " ".repeat(4 * 1024 * 1024));
  await expect(f.stop()).resolves.toBeDefined();
  const events = await f.resident();
  expect(events.filter((e) => e.type === "terminal.skill.observed")).toEqual([]);
  expect(events.find((e) => e.type === "terminal.skill.turn_assessed")!.payload).toMatchObject({
    skillTelemetry: "truncated",
    externalSkillCount: 0,
  });
});

it("accepts a range of exactly 4 MiB and rejects malformed JSON without partial evidence", async () => {
  const f = await fixture();
  const invocation = skillLine("eli5");
  await appendFile(
    f.transcriptPath,
    invocation + " ".repeat(4 * 1024 * 1024 - Buffer.byteLength(invocation)),
  );
  await f.stop();
  expect(
    (await f.resident()).find((e) => e.type === "terminal.skill.turn_assessed")!.payload
      .skillTelemetry,
  ).toBe("observed");
  const malformed = await fixture();
  await appendFile(malformed.transcriptPath, skillLine("eli5") + "broken-json\n");
  await malformed.stop();
  const events = await malformed.resident();
  expect(events.filter((e) => e.type === "terminal.skill.observed")).toEqual([]);
  expect(
    events.find((e) => e.type === "terminal.skill.turn_assessed")!.payload.skillTelemetry,
  ).toBe("unavailable");
});

it.each([
  "missing_before_stop",
  "missing_after_stop",
  "rotated_before_stop",
  "rotated_after_stop",
  "shrunken_before_stop",
  "shrunken_after_stop",
  "unreadable",
])("records unavailable without failing Stop or the cycle: %s", async (failure) => {
  const f = await fixture();
  await appendFile(f.transcriptPath, skillLine("eli5"));
  const damage = async () => {
    if (failure.startsWith("missing")) await rm(f.transcriptPath);
    else if (failure.startsWith("rotated")) {
      await rename(f.transcriptPath, `${f.transcriptPath}.old`);
      await writeFile(f.transcriptPath, skillLine("eli5"));
    } else if (failure.startsWith("shrunken")) await truncate(f.transcriptPath, 0);
    else {
      await rm(f.transcriptPath);
      await mkdir(f.transcriptPath);
    }
  };
  if (failure.endsWith("before_stop")) await damage();
  await expect(f.stop()).resolves.toBeDefined();
  if (!failure.endsWith("before_stop")) await damage();
  const events = await f.resident();
  expect(events.filter((e) => e.type === "terminal.skill.observed")).toEqual([]);
  expect(events.find((e) => e.type === "terminal.skill.turn_assessed")!.payload).toMatchObject({
    skillTelemetry: "unavailable",
    externalSkillCount: 0,
  });
});

it("reads a first turn from the start of a transcript the provider created after its prompt", async () => {
  const f = await fixture(false, "claude", true, false);
  expect(f.start).toBeNull();
  // Claude writes file-history records without a session; they must not void the turn.
  const history = (type: string) =>
    JSON.stringify({ type, messageId: "message", snapshot: { trackedFileBackups: {} } }) + "\n";
  await writeFile(
    f.transcriptPath,
    history("file-history-snapshot") + skillLine("eli5") + history("file-history-delta"),
  );
  await f.stop();
  const events = await f.resident();
  expect(events.filter((e) => e.type === "terminal.skill.observed")).toHaveLength(1);
  expect(events.find((e) => e.type === "terminal.skill.observed")!.payload).toMatchObject({
    skillId: "eli5",
    source: "provider_transcript",
  });
  expect(
    events.find((e) => e.type === "terminal.skill.turn_assessed")!.payload.skillTelemetry,
  ).toBe("observed");
});

it("keeps an absent-at-prompt transcript unavailable when Stop names a different transcript", async () => {
  const f = await fixture(false, "claude", true, false);
  const other = resolve(f.transcriptPath, "../other-transcript.jsonl");
  await writeFile(other, skillLine("eli5"));
  await f.stop(other);
  const events = await f.resident();
  expect(events.some((e) => e.type === "terminal.skill.observed")).toBe(false);
  expect(
    events.find((e) => e.type === "terminal.skill.turn_assessed")!.payload.skillTelemetry,
  ).toBe("unavailable");
});

it("records an explicit prompt pointer with prompt_invocation independently of transcript availability", async () => {
  const f = await fixture(true);
  await rm(f.transcriptPath);
  await f.stop();
  const events = await f.resident();
  expect(events.find((e) => e.type === "terminal.skill.observed")!.payload).toMatchObject({
    source: "prompt_invocation",
    skillId: "eli5",
    contentHash: sha256(body),
  });
  expect(
    events.find((e) => e.type === "terminal.skill.turn_assessed")!.payload.skillTelemetry,
  ).toBe("unavailable");
});

it("keeps synthetic Codex Skill calls at unknown coverage until an installed fixture proves the format", async () => {
  const f = await fixture(false, "codex");
  await appendFile(
    f.transcriptPath,
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "function_call",
        name: "Skill",
        arguments: JSON.stringify({ skill: "eli5" }),
      },
    }) + "\n",
  );
  await f.stop();
  const events = await f.resident();
  expect(events.filter((event) => event.type === "terminal.skill.observed")).toEqual([]);
  expect(
    events.find((event) => event.type === "terminal.skill.turn_assessed")!.payload,
  ).toMatchObject({ provider: "codex", skillTelemetry: "unknown" });
});

it("accepts absent Codex transcript paths and ignores invalid optional paths", () => {
  for (const transcript_path of [undefined, null, 42, "x".repeat(4097), "unsafe\0path"]) {
    expect(
      parseTerminalHookInput(
        JSON.stringify({ hook_event_name: "Stop", session_id: "codex-session", transcript_path }),
      ).transcriptPath,
    ).toBeUndefined();
  }
});
