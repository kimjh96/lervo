import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, vi } from "vitest";
import {
  applyInitPlan,
  createInitPlan,
  planEventWriterActivation,
  applyEventWriterActivationPlan,
} from "@lervo/project";
import { createEventReaderCapabilities } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { sha256 } from "@lervo/repository-knowledge";
import {
  absentTerminalTranscript,
  terminalTranscriptPosition,
} from "@lervo/repository-knowledge-runtime";
import { runTerminalSkillObservationCycle } from "../../../packages/repository-knowledge-runtime/src/terminal-skill-stage.js";
import {
  terminalEventDraft,
  unmanagedTerminalCoordinates,
} from "../src/terminal-event-coordinates.js";
import { openTerminalTurn } from "../src/terminal-open-turns.js";
import { parseTerminalHookInput } from "../src/terminal-hook-input.js";
import { recordObservedTerminalTurn } from "../src/terminal-stop-observation.js";
import type { TerminalLifecycleInspection } from "../src/terminal-hook-contract.js";
const execute = promisify(execFile);
export async function commitSkills(root: string) {
  await execute("git", ["-C", root, "add", "-f", ".agents/skills", ".claude/skills"]);
  await execute("git", [
    "-C",
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "--quiet",
    "--no-gpg-sign",
    "-m",
    "fixture",
  ]);
}
const roots: string[] = [];
export const now = new Date(Date.now() + 60_000);
export const body = "# Explain simply\n\nUse concrete examples.\n";
const revision = sha256("unchanged");
const projectId = "prj_nativeskill01";
export const skillLine = (skill: string) =>
  JSON.stringify({
    type: "assistant",
    sessionId: "session",
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

export async function fixture(
  promptAnchor = false,
  provider: "claude" | "codex" = "claude",
  activated = true,
  transcriptAtPrompt = true,
) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-native-skill-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId }));
  await mkdir(resolve(root, ".agents/skills/eli5"), { recursive: true });
  vi.stubEnv("HOME", root);
  vi.stubEnv("CODEX_HOME", resolve(root, ".codex"));
  await writeFile(resolve(root, ".agents/skills/eli5/SKILL.md"), body);
  await mkdir(resolve(root, ".claude/skills"), { recursive: true });
  await symlink("../../.agents/skills/eli5", resolve(root, ".claude/skills/explain"));
  await symlink("../../.agents/skills/eli5", resolve(root, ".claude/skills/eli5"));
  await execute("git", ["-C", root, "init", "--quiet"]);
  await commitSkills(root);
  if (activated) {
    const evidence = {
      schemaVersion: 1,
      projectId,
      observedAt: now.toISOString(),
      readers: [
        {
          readerId: "reader_native001",
          readerKind: "local",
          peerIdentityHash: null,
          capabilities: createEventReaderCapabilities(),
        },
      ],
    };
    const plan = await planEventWriterActivation({
      repositoryRoot: root,
      targetEventSchemaVersion: 7,
      evidence,
    });
    await applyEventWriterActivationPlan({
      plan,
      approval: plan.planId,
      currentEvidence: evidence,
    });
  }
  const transcriptDirectory = resolve(
    root,
    provider === "claude" ? ".claude/projects/project" : ".codex/sessions/2026/10",
  );
  await mkdir(transcriptDirectory, { recursive: true });
  const transcriptPath = resolve(transcriptDirectory, "private-transcript.jsonl");
  if (transcriptAtPrompt) await writeFile(transcriptPath, skillLine("earlier-private-user-skill"));
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
  const start = await terminalTranscriptPosition(provider, input.transcriptPath);
  const transcriptAbsent = await absentTerminalTranscript(provider, input.transcriptPath);
  await openTerminalTurn(root, {
    provider,
    ...coordinates,
    contextEventId,
    openedAt: now.toISOString(),
    transcript: start,
    ...(transcriptAbsent === null ? {} : { transcriptAbsent }),
  });
  async function stop(stopTranscriptPath = transcriptPath) {
    return recordObservedTerminalTurn({
      root,
      provider,
      coordinates,
      hookInput: parseTerminalHookInput(
        JSON.stringify({
          hook_event_name: "Stop",
          session_id: "session",
          transcript_path: stopTranscriptPath,
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
