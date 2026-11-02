import { describe, expect, it } from "vitest";

import {
  documentHeaderStatus,
  historicalHeaderStatus,
  parseDocumentHeader,
} from "../src/document-header-grammar.js";
import { historicalDocumentMarker } from "../src/historical-documents.js";

const path = "docs/decisions/foundation/0560-remove.md";

describe("ADR header grammar", () => {
  it("parses links, bare numbers, named parts, and the bulleted supersession list", () => {
    const header = parseDocumentHeader({
      path,
      content: [
        "# ADR-0560: Remove unused subsystems",
        "",
        "Status: `accepted`",
        "Amends: [ADR-0452 open collaboration](0452-open.md) (authority), [ADR-0463](../knowledge/0463-fresh.md)",
        "Supersedes, fully or in the named part:",
        "",
        "- Search tooling: ADR-0055, ADR-0056; in the named part: ADR-0053 (assessment), ADR-0061 (selection chain).",
        "- Executive control, in the named part: ADR-0390 (organization control).",
        "  Related: [ADR-0020 product identity](0020-identity.md)",
        "Part of [Roadmap](../../roadmap.md). The [canary](../../canary.md) is evidence only.",
        "",
        "## Context",
        "Amends: [ADR-0001](0001-late.md)",
      ].join("\n"),
    });
    expect(header.status).toBe("accepted");
    expect(header.statusLine).toBe(3);
    expect(
      header.targets.map(
        (item) =>
          `${item.relation}:${item.direction}:${item.target.kind === "path" ? item.target.path : `ADR-${item.target.number}`}:${item.line}${item.part === undefined ? "" : `:${item.part}`}`,
      ),
    ).toEqual([
      "amends:outgoing:docs/decisions/foundation/0452-open.md:4",
      "amends:outgoing:docs/decisions/knowledge/0463-fresh.md:4",
      "supersedes:outgoing:ADR-0055:7",
      "supersedes:outgoing:ADR-0056:7",
      "supersedes_part:outgoing:ADR-0053:7:assessment",
      "supersedes_part:outgoing:ADR-0061:7:selection chain",
      "supersedes_part:outgoing:ADR-0390:8:organization control",
      "related:outgoing:docs/decisions/foundation/0020-identity.md:9",
      "part_of:outgoing:docs/roadmap.md:10",
    ]);
  });

  it("reads reverse declarations and a superseded status with its successor", () => {
    const header = parseDocumentHeader({
      path: "docs/decisions/0385-identities.md",
      content: [
        "---",
        "lervo:",
        "  route: x",
        "---",
        "# ADR-0385: Identities",
        "",
        "- Status: superseded by [ADR-0394](0394-webhook.md)",
        "- Amended by [ADR-0561](0561-owner.md): `lervo capability install` changed.",
        "Superseded in part by ADR-0400 (routing).",
      ].join("\n"),
    });
    expect(header.status).toBe("superseded");
    expect(header.targets).toEqual([
      {
        relation: "supersedes",
        direction: "incoming",
        target: { kind: "path", path: "docs/decisions/0394-webhook.md" },
        line: 7,
      },
      {
        relation: "amends",
        direction: "incoming",
        target: { kind: "path", path: "docs/decisions/0561-owner.md" },
        line: 8,
      },
      {
        relation: "supersedes_part",
        direction: "incoming",
        target: { kind: "adr", number: "0400" },
        line: 9,
        part: "routing",
      },
    ]);
  });

  it("does not read prose that merely starts with a key word", () => {
    expect(
      parseDocumentHeader({
        path,
        content: "# Title\n\nRelated work by [someone](x.md) is out of scope.\n",
      }).targets,
    ).toEqual([]);
  });
});

describe("historical status line", () => {
  it.each([
    ["Status: `superseded`", "superseded"],
    ["- Status: superseded by [ADR-0394](0394.md)", "superseded"],
    ["Status: `historical`  ", "historical"],
    ["Status: `superseded_before_execution`", "superseded_before_execution"],
    ["**Status:** archived", "archived"],
  ])("treats %s as historical", (line, status) => {
    const content = `# ADR-0001: Example\n\n${line}\nDecision date: 2026-01-01\n`;
    expect(documentHeaderStatus(content)).toBe(status);
    expect(historicalHeaderStatus(status)).toBe(true);
    expect(historicalDocumentMarker({ path, content, archiveScopes: [] })).toBe("status_line");
  });

  it.each(["Status: `accepted`", "Status: `partially_superseded`", "Status: active"])(
    "keeps %s current",
    (line) => {
      const content = `# ADR-0001: Example\n\n${line}\n`;
      expect(historicalDocumentMarker({ path, content, archiveScopes: [] })).toBeNull();
    },
  );

  it("ignores a status line below the header", () => {
    const content = "# Plan\n\n## Steps\n\nStatus: `superseded`\n";
    expect(historicalDocumentMarker({ path, content, archiveScopes: [] })).toBeNull();
  });
});
