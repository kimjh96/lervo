import {
  MAX_TOOL_PREVIEW_CHARACTERS,
  MAX_TOOL_PREVIEW_LINE_CHARACTERS,
  MAX_TOOL_PREVIEW_LINES,
} from "@lervo/adapter-contract";
import { describe, expect, it } from "vitest";

import { claudeToolDetail } from "../src/hosted-tool-detail.js";

const places = { workingDirectory: "/work/repo", home: "/home/me" };
const succeeded = (content: unknown, structured?: unknown) => ({
  content,
  failed: false,
  structured,
});

describe("Claude Code tool detail", () => {
  it("shows an edit as its structured patch, and as old and new text without one", () => {
    const input = {
      file_path: "/work/repo/src/login.ts",
      old_string: "export const maximum = 64;",
      new_string: "/** Every limit. */\nexport const maximum = 1024;",
    };
    const patched = claudeToolDetail(
      { name: "Edit", input },
      succeeded("The file has been updated.", {
        structuredPatch: [
          {
            oldStart: 3,
            oldLines: 2,
            newStart: 3,
            newLines: 3,
            lines: [
              "-export const maximum = 64;",
              "+/** Every limit. */",
              "+export const maximum = 1024;",
              " export const minimum = 8;",
            ],
          },
        ],
      }),
      places,
    );
    expect(patched).toEqual({
      subject: { kind: "path", text: "src/login.ts" },
      counts: { added: 2, removed: 1 },
      preview: {
        format: "diff",
        lines: [
          "@@ -3,2 +3,3 @@",
          "-export const maximum = 64;",
          "+/** Every limit. */",
          "+export const maximum = 1024;",
          " export const minimum = 8;",
        ],
        omittedLines: 0,
        omittedAt: 5,
      },
    });
    const plain = claudeToolDetail({ name: "Edit", input }, succeeded("Updated."), places);
    expect(plain?.preview?.lines).toEqual([
      "-export const maximum = 64;",
      "+/** Every limit. */",
      "+export const maximum = 1024;",
    ]);
  });

  it("counts what a read, a write, and a search found, with paths in the workspace", () => {
    expect(
      claudeToolDetail(
        { name: "Read", input: { file_path: "/home/me/notes.md" } },
        succeeded("1\tone\n2\ttwo\n", { file: { numLines: 2 } }),
        places,
      ),
    ).toEqual({ subject: { kind: "path", text: "~/notes.md" }, counts: { lines: 2 } });
    expect(
      claudeToolDetail(
        { name: "Write", input: { file_path: "/etc/hosts.new", content: "a\nb\n" } },
        succeeded("File created."),
        places,
      ),
    ).toMatchObject({
      subject: { kind: "path", text: "/etc/hosts.new" },
      counts: { added: 2, removed: 0 },
      preview: { format: "diff", lines: ["+a", "+b"] },
    });
    expect(
      claudeToolDetail(
        { name: "Grep", input: { pattern: "maximum" } },
        succeeded("Found 2 files\n/work/repo/src/login.ts\n/work/repo/docs/limits.md"),
        places,
      ),
    ).toMatchObject({
      subject: { kind: "pattern", text: "maximum" },
      counts: { files: 2 },
      preview: { lines: ["src/login.ts", "docs/limits.md"] },
    });
    expect(
      claudeToolDetail(
        { name: "Grep", input: { pattern: "maximum", output_mode: "content" } },
        succeeded("/work/repo/src/login.ts:1:export const maximum = 64;", { numLines: 1 }),
        places,
      ),
    ).toMatchObject({ counts: { matches: 1 } });
  });

  it("previews a command's output by its start and its end, within the bounds", () => {
    const output = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join("\n");
    const detail = claudeToolDetail(
      { name: "Bash", input: { command: "pnpm test" } },
      succeeded([{ type: "text", text: output }]),
      places,
    );
    const preview = detail?.preview;
    expect(detail?.subject).toEqual({ kind: "command", text: "pnpm test" });
    expect(preview?.lines).toHaveLength(MAX_TOOL_PREVIEW_LINES);
    expect(preview?.lines.slice(0, 2)).toEqual(["line 1", "line 2"]);
    expect(preview?.lines.at(-1)).toBe("line 200");
    expect(preview?.omittedAt).toBe(6);
    expect(preview?.omittedLines).toBe(200 - MAX_TOOL_PREVIEW_LINES);

    const wide = claudeToolDetail(
      { name: "Bash", input: { command: "cat wide.log" } },
      succeeded(Array.from({ length: 30 }, () => "x".repeat(1000)).join("\n")),
      places,
    );
    const lines = wide?.preview?.lines ?? [];
    expect(lines.every((line) => [...line].length <= MAX_TOOL_PREVIEW_LINE_CHARACTERS)).toBe(true);
    expect(lines.reduce((sum, line) => sum + [...line].length, 0)).toBeLessThanOrEqual(
      MAX_TOOL_PREVIEW_CHARACTERS,
    );
    expect((wide?.preview?.omittedLines ?? 0) + lines.length).toBe(30);
  });

  it("previews a failed call's error, and leaves out tools that name nothing", () => {
    expect(
      claudeToolDetail(
        { name: "Bash", input: { command: "ls && false" } },
        { content: "Exit code 1\nlogin.ts", failed: true, structured: "Error: Exit code 1" },
        places,
      ),
    ).toEqual({
      subject: { kind: "command", text: "ls && false" },
      preview: {
        format: "output",
        lines: ["Exit code 1", "login.ts"],
        omittedLines: 0,
        omittedAt: 2,
      },
    });
    expect(
      claudeToolDetail({ name: "TodoWrite", input: { todos: [] } }, succeeded("ok"), places),
    ).toBeUndefined();
    expect(
      claudeToolDetail({ name: "mcp__docs__search", input: {} }, succeeded("ok"), places),
    ).toBeUndefined();
    // A watch and a message to another session name what they are about.
    expect(
      claudeToolDetail(
        {
          name: "Monitor",
          input: { description: "main CI for the merge", command: "gh run list" },
        },
        succeeded("Monitor started"),
        places,
      )?.subject,
    ).toEqual({ kind: "text", text: "main CI for the merge" });
    expect(
      claudeToolDetail(
        { name: "SendMessage", input: { to: "Drawing Understanding", message: "…" } },
        succeeded("sent"),
        places,
      )?.subject,
    ).toEqual({ kind: "text", text: "Drawing Understanding" });
  });
});
