import { describe, expect, it } from "vitest";

import { lervoCommandIds, readLervoShellLine } from "@lervo/session-host-contract";

const commands = new Set(lervoCommandIds);
const callOf = (line: string) => readLervoShellLine(line, commands)?.call;

describe("Lervo calls in hosted shell lines", () => {
  it("recognizes a call by its longest known command path, its flag, and its quoted subject", () => {
    expect(callOf('lervo knowledge query "password limit login"')).toEqual({
      command: "knowledge query",
      subject: "password limit login",
    });
    expect(
      callOf(
        `lervo workstream update --actor agent --provider claude --patch '{"appendNotes":["a"]}' --apply-now`,
      ),
    ).toEqual({ command: "workstream update" });
    expect(callOf('lervo plan add --title "Tool runs" "Show what each run did"')).toEqual({
      command: "plan add",
      subject: "Show what each run did",
    });
    expect(callOf("lervo plan done pli_0123 --release v0.52.0")).toEqual({ command: "plan done" });
    expect(callOf("lervo role show architect")).toEqual({ command: "role show" });
    expect(callOf("lervo workstream update --help 2>&1 | head -60")).toEqual({
      command: "workstream update",
      flag: "help",
    });
    expect(callOf("lervo --version")).toEqual({ command: "", flag: "version" });
    // A newer CLI's command keeps its first word.
    expect(callOf("lervo garden prune --all")).toEqual({ command: "garden" });
  });

  it("keeps a directory change, environment, filters, messages, and later calls with the call", () => {
    for (const line of [
      'cd /work/repo && lervo knowledge query "limits"',
      'LERVO_DEBUG=1 /usr/local/bin/lervo knowledge query "limits"',
      'lervo knowledge query "limits" --json | jq ".hits[0]"',
      'lervo knowledge query "limits"; echo done',
      'echo ---; lervo knowledge query "limits" && lervo workstream current',
      'lervo knowledge query "limits" && cd docs',
    ])
      expect(readLervoShellLine(line, commands), line).toEqual({
        call: { command: "knowledge query", subject: "limits" },
      });
  });

  it("keeps the line's other commands as it spells them, joined by their operators", () => {
    const cases: [string, string, string][] = [
      [
        "lervo workstream current --context 2>&1 | head -80; echo ---; ls -la; ls docs; git log --oneline -5",
        "workstream current",
        "ls -la; ls docs; git log --oneline -5",
      ],
      ["pnpm test && lervo plan done pli_0123", "plan done", "pnpm test"],
      ["lervo workstream current && pnpm build", "workstream current", "pnpm build"],
      [
        "cd /work && git status | head -3 && lervo workstream current",
        "workstream current",
        "cd /work && git status | head -3",
      ],
      ['lervo knowledge query "x"\ncd docs || ls -a', "knowledge query", "cd docs || ls -a"],
      ["FORCE=1 pnpm build & lervo plan list", "plan list", "FORCE=1 pnpm build"],
    ];
    for (const [line, command, others] of cases)
      expect(readLervoShellLine(line, commands), line).toEqual({
        call: expect.objectContaining({ command }) as unknown,
        others,
      });
  });

  it("reads no call in a line that runs no lervo command", () => {
    for (const line of [
      "echo lervo knowledge query",
      'grep -rn "lervo" docs',
      "npx lervo knowledge lint",
      "",
    ])
      expect(readLervoShellLine(line, commands), line).toBeUndefined();
  });
});
