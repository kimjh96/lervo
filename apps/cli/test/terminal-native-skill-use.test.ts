import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import { sha256 } from "@lervo/repository-knowledge";
import { terminalTranscriptPosition } from "@lervo/repository-knowledge-runtime";
import {
  queuedTerminalSkillTurns,
  TERMINAL_SKILL_QUEUE,
} from "../../../packages/repository-knowledge-runtime/src/terminal-skill-queue.js";
import { runTerminalSkillObservationCycle } from "../../../packages/repository-knowledge-runtime/src/terminal-skill-stage.js";
import {
  terminalEventDraft,
  unmanagedTerminalCoordinates,
} from "../src/terminal-event-coordinates.js";
import { openTerminalTurn, singleOpenTerminalTurn } from "../src/terminal-open-turns.js";
import { parseTerminalHookInput } from "../src/terminal-hook-input.js";
import { recordObservedTerminalTurn } from "../src/terminal-stop-observation.js";
import type { TerminalLifecycleInspection } from "../src/terminal-hook-contract.js";

const roots: string[] = [];
const now = new Date("2026-10-31T12:00:00.000Z");
const body = "# Explain simply\n\nUse concrete examples.\n";
const revision = sha256("unchanged");
const projectId = "prj_nativeskill01";
const skillLine = (skill: string) =>
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "call_private",
          name: "Skill",
          input: { skill, privateArgument: "private-tool-content" },
        },
      ],
    },
  }) + "\n";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(promptAnchor = false, provider: "claude" | "codex" = "claude") {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-native-skill-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId }));
  await mkdir(resolve(root, ".agents/skills/eli5"), { recursive: true });
  await writeFile(resolve(root, ".agents/skills/eli5/SKILL.md"), body);
  await mkdir(resolve(root, ".claude/skills"), { recursive: true });
  await symlink("../../.agents/skills/eli5", resolve(root, ".claude/skills/explain"));
  const transcriptPath = resolve(root, "private-transcript.jsonl");
  await writeFile(transcriptPath, skillLine("earlier-private-user-skill"));
  const input = parseTerminalHookInput(
    JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "session",
      prompt: promptAnchor ? "/eli5" : "Explain this",
      transcript_path: transcriptPath,
    }),
  );
  const coordinates = unmanagedTerminalCoordinates(provider, input);
  const storage = await openProjectStorage(root);
  let contextEventId: string;
  try {
    contextEventId = storage.events.append(
      terminalEventDraft({
        projectId,
        provider,
        coordinates,
        type: "terminal.context.prepared",
        occurredAt: now.toISOString(),
        payload: {
          observationId: "tobs_nativeskill01",
          executionMode: "unmanaged",
          providerSessionDigest: coordinates.providerSessionDigest,
          providerTurnDigest: null,
          sourceSnapshotId: `ksnap_${"a".repeat(24)}`,
          queryDigest: sha256("prompt"),
          contextHash: sha256("compact"),
          recommendationCount: 0,
          loadedDocuments: [],
          selectedPointers: promptAnchor
            ? [{ kind: "skill", path: ".agents/skills/eli5/SKILL.md", contentHash: sha256(body) }]
            : [],
        },
      }),
    ).event.eventId;
  } finally {
    await storage.close();
  }
  const start = await terminalTranscriptPosition(input.transcriptPath);
  await openTerminalTurn(root, {
    provider,
    ...coordinates,
    contextEventId,
    openedAt: now.toISOString(),
    transcript: start,
  });
  async function stop() {
    return recordObservedTerminalTurn({
      root,
      provider,
      coordinates,
      hookInput: parseTerminalHookInput(
        JSON.stringify({
          hook_event_name: "Stop",
          session_id: "session",
          transcript_path: transcriptPath,
        }),
      ),
      lifecycle: {
        status: "current",
        workspace: null,
        repositoryChange: { beforeRevision: revision, afterRevision: revision, changed: false },
      } as TerminalLifecycleInspection,
      workspaceCheckpointEventId: null,
      occurredAt: now.toISOString(),
    });
  }
  async function resident() {
    const storage = await openProjectStorage(root);
    try {
      await runTerminalSkillObservationCycle({ storage, now });
      return storage.events.list({ limit: 1000 });
    } finally {
      await storage.close();
    }
  }
  return { root, transcriptPath, start, contextEventId, stop, resident };
}

it("hooks retain only range metadata; the resident records one installed Claude invocation with path and hash", async () => {
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
    externalSkillCount: 2,
    skillTelemetry: "observed",
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

it("observes an explicit Codex Skill function call without inferring use from file reads", async () => {
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
  expect(
    (await f.resident()).find((e) => e.type === "terminal.skill.observed")!.payload,
  ).toMatchObject({ provider: "codex", skillId: "eli5" });
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
