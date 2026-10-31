import { appendFile, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import { sha256 } from "@lervo/repository-knowledge";
import { terminalTranscriptPosition } from "@lervo/repository-knowledge-runtime";
import { privateTerminalSkillTurns } from "../../../packages/repository-knowledge-runtime/src/terminal-skill-private.js";
import { fixture, now, body, skillLine, commitSkills } from "./terminal-native-skill-fixture.js";

it("rejects a repository-controlled transcript and a provider directory symlink escape", async () => {
  const f = await fixture();
  const forged = resolve(f.root, "forged.jsonl");
  await writeFile(forged, skillLine("eli5"));
  expect(await terminalTranscriptPosition("claude", forged)).toBeNull();
  const escape = resolve(f.root, ".claude/projects/escape");
  await symlink(f.root, escape);
  expect(await terminalTranscriptPosition("claude", resolve(escape, "forged.jsonl"))).toBeNull();
  // Replacing a parent after prompt capture cannot redirect the resident either.
  const directory = resolve(f.root, ".claude/projects/project");
  await rm(directory, { recursive: true });
  await symlink(f.root, directory);
  await writeFile(resolve(f.root, "private-transcript.jsonl"), skillLine("eli5"));
  await f.stop();
  const events = await f.resident();
  expect(events.filter((event) => event.type === "terminal.skill.observed")).toEqual([]);
  expect(
    events.find((event) => event.type === "terminal.skill.turn_assessed")!.payload.skillTelemetry,
  ).toBe("unavailable");
});

it("rejects another user's transcript at prompt capture and resident read", async () => {
  const f = await fixture();
  await appendFile(f.transcriptPath, skillLine("eli5"));
  await f.stop();
  const current = process.getuid!();
  vi.spyOn(process as { getuid: () => number }, "getuid").mockReturnValue(current + 1);
  expect(await terminalTranscriptPosition("claude", f.transcriptPath)).toBeNull();
  const events = await f.resident();
  expect(
    events.find((event) => event.type === "terminal.skill.turn_assessed")!.payload.skillTelemetry,
  ).toBe("unavailable");
  expect(events.filter((event) => event.type === "terminal.skill.observed")).toEqual([]);
});

it("rejects an in-place rewrite that retains the inode and byte length", async () => {
  const f = await fixture();
  await appendFile(f.transcriptPath, skillLine("eli5"));
  await f.stop();
  const original = await readFile(f.transcriptPath, "utf8");
  await writeFile(
    f.transcriptPath,
    original.replace("earlier-private-user-skill", "changed-private-user-skill"),
  );
  const events = await f.resident();
  expect(
    events.find((event) => event.type === "terminal.skill.turn_assessed")!.payload.skillTelemetry,
  ).toBe("unavailable");
  expect(events.filter((event) => event.type === "terminal.skill.observed")).toEqual([]);
});

it.each(["foreign-session", null])(
  "rejects range entries without the hook session identity: %s",
  async (sessionId) => {
    const f = await fixture();
    const entry = JSON.parse(skillLine("eli5"));
    entry.sessionId = sessionId;
    await appendFile(f.transcriptPath, skillLine("eli5") + JSON.stringify(entry) + "\n");
    await f.stop();
    const events = await f.resident();
    expect(
      events.find((event) => event.type === "terminal.skill.turn_assessed")!.payload.skillTelemetry,
    ).toBe("unavailable");
    expect(events.filter((event) => event.type === "terminal.skill.observed")).toEqual([]);
  },
);

it.each(["other_repository_skill", "external_link", "provider_directory"])(
  "never attributes a conflicting Claude surface to the portable name: %s",
  async (conflict) => {
    const f = await fixture();
    const surface = resolve(f.root, ".claude/skills/eli5");
    await rm(surface);
    if (conflict === "other_repository_skill") {
      await mkdir(resolve(f.root, ".agents/skills/other"));
      await writeFile(resolve(f.root, ".agents/skills/other/SKILL.md"), "Other skill");
      await symlink("../../.agents/skills/other", surface);
    } else if (conflict === "external_link") await symlink("/outside/user-skills/eli5", surface);
    else {
      await mkdir(surface);
      await writeFile(resolve(surface, "SKILL.md"), "Provider skill");
    }
    await commitSkills(f.root);
    await appendFile(f.transcriptPath, skillLine("eli5"));
    await f.stop();
    const events = await f.resident();
    expect(events.filter((event) => event.type === "terminal.skill.observed")).toEqual([]);
    expect(
      events.find((event) => event.type === "terminal.skill.turn_assessed")!.payload,
    ).toMatchObject({ skillTelemetry: "unknown", ambiguousSkillCount: 1, externalSkillCount: 0 });
  },
);

it("uses the Stop revision after skill bytes and HEAD change before the resident runs", async () => {
  const f = await fixture();
  await appendFile(f.transcriptPath, skillLine("eli5"));
  await f.stop();
  await writeFile(resolve(f.root, ".agents/skills/eli5/SKILL.md"), "Different instructions");
  await commitSkills(f.root);
  const events = await f.resident();
  expect(
    events.find((event) => event.type === "terminal.skill.observed")!.payload.contentHash,
  ).toBe(sha256(body));
});

it("leaves an uncommitted skill unknown without a current hash or an external classification", async () => {
  const f = await fixture();
  await mkdir(resolve(f.root, ".agents/skills/uncommitted"));
  await writeFile(
    resolve(f.root, ".agents/skills/uncommitted/SKILL.md"),
    "Uncommitted instructions",
  );
  await appendFile(f.transcriptPath, skillLine("uncommitted"));
  await f.stop();
  const events = await f.resident();
  expect(events.filter((event) => event.type === "terminal.skill.observed")).toEqual([]);
  expect(
    events.find((event) => event.type === "terminal.skill.turn_assessed")!.payload,
  ).toMatchObject({ skillTelemetry: "unknown", unknownSkillCount: 1, externalSkillCount: 0 });
});

it("keeps observations private while an older writer is selected so old readers see only known types", async () => {
  const f = await fixture(false, "claude", false);
  await appendFile(f.transcriptPath, skillLine("eli5"));
  await f.stop();
  const events = await f.resident();
  expect(events.some((event) => event.type.startsWith("terminal.skill."))).toBe(false);
  // This is the pre-ADR-0542 terminal reader's allowlist, independent of the new schemas.
  expect(
    events.every((event) =>
      ["terminal.context.prepared", "terminal.turn.observed"].includes(event.type),
    ),
  ).toBe(true);
  const privateTurns = await privateTerminalSkillTurns(f.root, now);
  expect(privateTurns).toHaveLength(1);
  expect(
    privateTurns[0]!.events.find((event) => event.type === "terminal.skill.observed")!.payload
      .contentHash,
  ).toBe(sha256(body));
  expect(JSON.stringify(privateTurns)).not.toContain(f.transcriptPath);
  const storage = await openProjectStorage(f.root);
  try {
    expect(storage.events.verifyIntegrity().valid).toBe(true);
  } finally {
    await storage.close();
  }
});

it("cannot substitute the current catalog when the queued commit is unavailable", async () => {
  const f = await fixture();
  await appendFile(f.transcriptPath, skillLine("eli5"));
  await f.stop();
  const path = resolve(
    f.root,
    ".lervo/state/knowledge/terminal-skills/queue",
    `${f.contextEventId}.json`,
  );
  const queued = JSON.parse(await readFile(path, "utf8"));
  queued.repositoryRevision = "f".repeat(40);
  await writeFile(path, JSON.stringify(queued));
  const events = await f.resident();
  expect(events.filter((event) => event.type === "terminal.skill.observed")).toEqual([]);
  expect(
    events.find((event) => event.type === "terminal.skill.turn_assessed")!.payload,
  ).toMatchObject({ skillTelemetry: "unknown", externalSkillCount: 0 });
});
