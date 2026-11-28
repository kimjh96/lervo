import { lervoCommandIds } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import { cliCommandCatalog } from "../src/cli-command-catalog.js";
import { knowledgeQueryHeadline, knowledgeQueryHitLine } from "../src/knowledge-query-output.js";
import { withLervoCall } from "../src/lervo-command-detail.js";
import { cliUsage } from "../src/main.js";

const commands = new Set(lervoCommandIds);

describe("Lervo calls in hosted shell lines", () => {
  it("names every command of the CLI's usage text in the contract's list", () => {
    // A new command adds its path to lervoCommandIds, and the ADE then requires its message.
    expect([...lervoCommandIds]).toEqual(
      cliCommandCatalog(cliUsage).map((command) => command.slice("lervo ".length)),
    );
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

  it("adds the call to a line that also ran other commands, keeping its output's preview", () => {
    const preview = { format: "output" as const, lines: ["…"], omittedLines: 0, omittedAt: 1 };
    const line = {
      kind: "tool_activity" as const,
      name: "Bash",
      status: "succeeded" as const,
      calls: 1,
      detail: {
        subject: { kind: "command" as const, text: 'lervo knowledge query "x"; ls' },
        preview,
      },
      output: `${knowledgeQueryHeadline(1)}\nREADME.md`,
    };
    expect(withLervoCall(line, commands)).toEqual({
      kind: "tool_activity",
      name: "Bash",
      status: "succeeded",
      calls: 1,
      detail: { ...line.detail, lervo: { command: "knowledge query", subject: "x" } },
    });
  });

  it("adds what a search found from its output, and never passes the output on", () => {
    const search = (output: string) => ({
      kind: "tool_activity" as const,
      name: "Bash",
      status: "succeeded" as const,
      calls: 1,
      detail: {
        subject: { kind: "command" as const, text: 'lervo knowledge query "limits"' },
        preview: { format: "output" as const, lines: ["…"], omittedLines: 0, omittedAt: 1 },
      },
      output,
    });
    const hits = Array.from({ length: 12 }, (_, index) => ({
      score: 100 - index,
      title: `Document ${index}`,
      path: `docs/${index}.md`,
      freshness: index === 1 ? ("stale" as const) : ("current" as const),
    }));
    const found = withLervoCall(
      search([knowledgeQueryHeadline(12), ...hits.map(knowledgeQueryHitLine)].join("\n")),
      commands,
    );
    expect(found).not.toHaveProperty("output");
    expect(found).toMatchObject({
      detail: { lervo: { command: "knowledge query", subject: "limits", found: 12 } },
    });
    if (found.kind !== "tool_activity" || found.detail?.lervo?.hits === undefined)
      throw new Error("expected the search's hits");
    const detail = found.detail as typeof found.detail & { lervo: { hits: unknown[] } };
    expect(detail.lervo.hits).toHaveLength(10);
    expect(detail.lervo.hits[1]).toEqual({
      title: "Document 1",
      path: "docs/1.md",
      freshness: "stale",
    });
    // The list stands in for the output's preview.
    expect(detail.preview).toBeUndefined();

    // A search that found nothing keeps its output's preview, which says why.
    const none = withLervoCall(
      search(`${knowledgeQueryHeadline(0)}\nRepository knowledge is not built.`),
      commands,
    );
    expect(none).toMatchObject({ detail: { lervo: { found: 0 }, preview: { lines: ["…"] } } });
    expect(none).not.toHaveProperty("output");

    // Another shell call loses its output too.
    const other = withLervoCall(
      { ...search("ok"), detail: { subject: { kind: "command" as const, text: "ls" } } },
      commands,
    );
    expect(other).not.toHaveProperty("output");
    expect(other).not.toHaveProperty("detail.lervo");
  });
});
