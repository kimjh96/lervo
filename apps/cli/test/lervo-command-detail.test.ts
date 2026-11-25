import { lervoCommandIds } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import { cliCommandCatalog } from "../src/cli-command-catalog.js";
import { lervoInvocation, withLervoCall } from "../src/lervo-command-detail.js";
import { cliUsage } from "../src/main.js";

const commands = new Set(lervoCommandIds);

describe("Lervo calls in hosted shell lines", () => {
  it("names every command of the CLI's usage text in the contract's list", () => {
    // A new command adds its path to lervoCommandIds, and the ADE then requires its message.
    expect([...lervoCommandIds]).toEqual(
      cliCommandCatalog(cliUsage).map((command) => command.slice("lervo ".length)),
    );
  });

  it("recognizes a call by its longest known command path, its flag, and its quoted subject", () => {
    expect(lervoInvocation('lervo knowledge query "password limit login"', commands)).toEqual({
      command: "knowledge query",
      subject: "password limit login",
    });
    expect(
      lervoInvocation(
        `lervo workstream update --actor agent --provider claude --patch '{"appendNotes":["a"]}' --apply-now`,
        commands,
      ),
    ).toEqual({ command: "workstream update" });
    expect(
      lervoInvocation('lervo plan add --title "Tool runs" "Show what each run did"', commands),
    ).toEqual({ command: "plan add", subject: "Show what each run did" });
    expect(lervoInvocation("lervo plan done pli_0123 --release v0.52.0", commands)).toEqual({
      command: "plan done",
    });
    expect(lervoInvocation("lervo role show architect", commands)).toEqual({
      command: "role show",
    });
    expect(lervoInvocation("lervo workstream update --help 2>&1 | head -60", commands)).toEqual({
      command: "workstream update",
      flag: "help",
    });
    expect(lervoInvocation("lervo --version", commands)).toEqual({
      command: "",
      flag: "version",
    });
    // A newer CLI's command keeps its first word.
    expect(lervoInvocation("lervo garden prune --all", commands)).toEqual({ command: "garden" });
  });

  it("allows a directory change, environment, filters, and follow-up calls around the call", () => {
    for (const line of [
      'cd /work/repo && lervo knowledge query "limits"',
      'LERVO_DEBUG=1 /usr/local/bin/lervo knowledge query "limits"',
      'lervo knowledge query "limits" --json | jq ".hits[0]"',
      'lervo knowledge query "limits"; echo done',
      'lervo knowledge query "limits" && lervo workstream current',
    ])
      expect(lervoInvocation(line, commands), line).toMatchObject({
        command: "knowledge query",
        subject: "limits",
      });
  });

  it("leaves a line whose own work is something else as a shell call", () => {
    for (const line of [
      "pnpm test && lervo plan done pli_0123",
      "lervo workstream current && pnpm build",
      "echo lervo knowledge query",
      'grep -rn "lervo" docs',
      "npx lervo knowledge lint",
      "",
    ])
      expect(lervoInvocation(line, commands), line).toBeUndefined();
  });

  it("adds the call to a shell line's detail and leaves every other item as it was", () => {
    const line = {
      kind: "tool_activity" as const,
      name: "Bash",
      status: "succeeded" as const,
      calls: 1,
      detail: { subject: { kind: "command" as const, text: 'lervo knowledge query "x"' } },
    };
    expect(withLervoCall(line, commands)).toEqual({
      ...line,
      detail: { ...line.detail, lervo: { command: "knowledge query", subject: "x" } },
    });
    const read = {
      ...line,
      name: "Read",
      detail: { subject: { kind: "path" as const, text: "a" } },
    };
    expect(withLervoCall(read, commands)).toBe(read);
    const text = { kind: "agent_message" as const, text: "lervo knowledge query" };
    expect(withLervoCall(text, commands)).toBe(text);
  });
});
