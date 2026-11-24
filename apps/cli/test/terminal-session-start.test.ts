import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { runTerminalHookCommand } from "../src/terminal-hook-command.js";
import { parseTerminalHookIngress, parseTerminalHookInput } from "../src/terminal-hook-input.js";
import { DisabledTerminalStageObservation } from "../src/terminal-stage-observation.js";

const ports = vi.hoisted(() => ({ base: vi.fn(), root: vi.fn() }));
vi.mock("../src/terminal-degraded-context.js", async (original) => ({
  ...(await original<typeof import("../src/terminal-degraded-context.js")>()),
  prepareTerminalBaseParts: ports.base,
}));
vi.mock("../src/terminal-repository-root.js", () => ({
  resolveTerminalRepositoryRoot: ports.root,
}));

let root: string;
beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(join(tmpdir(), "lervo-session-start-"));
  ports.root.mockResolvedValue(root);
  ports.base.mockResolvedValue({
    lines: [
      "AGENTS.md pointer",
      "publication.language=en",
      "Applied owner rule: full clause",
      "Lervo workstream: recorded title (revision 3).",
      "If this turn changes repository-authored bytes, record the next bounded revision.",
    ],
    rules: [],
  });
});
afterEach(async () => rm(root, { recursive: true, force: true }));

async function sessionStart(source: unknown) {
  const output: string[] = [];
  const projectSearchQueries = vi.fn().mockRejectedValue(new Error("must not call a provider"));
  const code = await runTerminalHookCommand(
    ["--provider", "claude", "--contract", "2"],
    {
      cwd: root,
      stdout: (value) => output.push(value),
      stderr: () => undefined,
      stdin: async () =>
        JSON.stringify({ hook_event_name: "SessionStart", session_id: "session-1", source }),
    },
    {
      createTerminalStageObservation: () => new DisabledTerminalStageObservation(),
      projectSearchQueries,
    },
  );
  expect(projectSearchQueries).not.toHaveBeenCalled();
  return { code, output: JSON.parse(output.join("")) as Record<string, unknown> };
}

it("answers a compaction with the base block and starts a new epoch (ADR-0562)", async () => {
  const { code, output } = await sessionStart("compact");
  expect(code).toBe(0);
  const hook = output.hookSpecificOutput as { hookEventName: string; additionalContext: string };
  expect(hook.hookEventName).toBe("SessionStart");
  expect(hook.additionalContext).toContain(
    "Lervo base context for this context compaction (epoch tepoch_",
  );
  expect(hook.additionalContext).toContain("Applied owner rule: full clause");
  expect(hook.additionalContext).toContain("Lervo workstream: recorded title (revision 3).");
  // Worker workspaces get a different bookkeeping line, so the base leaves it to each prompt.
  expect(hook.additionalContext).not.toContain("If this turn changes repository-authored bytes");
  const directory = join(root, ".lervo/state/terminal-integration/epochs");
  const [file] = await readdir(directory);
  expect((await stat(join(directory, file!))).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(join(directory, file!), "utf8"))).toMatchObject({
    schemaVersion: 2,
    provider: "claude",
    cause: "compact",
    baseRules: {},
    transcriptOffset: 0,
  });
  // A later start of the same session replaces its epoch rather than adding one.
  await sessionStart("resume");
  expect(await readdir(directory)).toEqual([file]);
});

it("still answers with the base block when the epoch cannot be written safely", async () => {
  // A link in the state path is refused, and the session still gets its base block.
  await mkdir(join(root, ".lervo"), { recursive: true });
  const elsewhere = await mkdtemp(join(tmpdir(), "lervo-session-elsewhere-"));
  await symlink(elsewhere, join(root, ".lervo/state"));
  const { output } = await sessionStart("startup");
  expect((output.hookSpecificOutput as { additionalContext: string }).additionalContext).toContain(
    "Lervo base context for this session start (epoch tepoch_",
  );
  expect(await readdir(elsewhere)).toEqual([]);
  await rm(elsewhere, { recursive: true, force: true });
});

it("removes the previous epoch before a start that then fails", async () => {
  await sessionStart("startup");
  const directory = join(root, ".lervo/state/terminal-integration/epochs");
  expect(await readdir(directory)).toHaveLength(1);
  ports.base.mockRejectedValue(new Error("base unavailable"));
  expect(await sessionStart("compact")).toEqual({ code: 0, output: {} });
  // No epoch from before the compaction survives, so the next prompt delivers everything.
  expect(await readdir(directory)).toEqual([]);
});

it("answers nothing, never a blocking failure, when the repository cannot be read", async () => {
  ports.root.mockRejectedValue(new Error("not a repository"));
  expect(await sessionStart("startup")).toEqual({ code: 0, output: {} });
});

it("reads the session start source and keeps prompt parsing strict", () => {
  const input = (source: unknown) =>
    JSON.stringify({ hook_event_name: "SessionStart", session_id: "s", source });
  expect(parseTerminalHookIngress(input("clear"))).toEqual({
    event: "SessionStart",
    providerSessionId: "s",
    source: "clear",
  });
  // An unknown source still starts an epoch, as a new session.
  expect(parseTerminalHookIngress(input("telepathy"))).toMatchObject({ source: "startup" });
  expect(() => parseTerminalHookInput(input("startup"))).toThrow(
    "Unsupported provider hook event.",
  );
  expect(() =>
    parseTerminalHookIngress(JSON.stringify({ hook_event_name: "SessionStart", session_id: "" })),
  ).toThrow("The provider session coordinate is missing or invalid.");
});
