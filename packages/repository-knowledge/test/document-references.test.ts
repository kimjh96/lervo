import { describe, expect, it } from "vitest";

import { extractDocumentReferences } from "../src/document-references.js";
import {
  archiveScopes,
  historicalDocumentMarker,
  queryTargetsHistory,
} from "../src/historical-documents.js";

describe("document reference extraction", () => {
  it("extracts links, backticked paths, path symbols, and fence paths deterministically", () => {
    const references = extractDocumentReferences({
      path: "docs/guide.md",
      content: [
        "# Guide",
        "",
        "See [design](../v2/DESIGN.md#limits), [site](https://example.com), [top](#top),",
        "![diagram](<./images/flow chart.svg>) and [mail](mailto:team@example.com).",
        "Limits live in `v2/argo_v2/live/engine.py: Limits` and `v2/argo_v2/live/engine.py:42`.",
        "The runtime is `v4/` with `scripts/run` and `text/markdown`, not `@scope/pkg` or `*.md`.",
        "[ref]: /docs/archive/v1.md",
        "",
        "```python title=v2/argo_v2/model.py",
        "print('[not a link](missing.md) `not/a/path.py`')",
        "```",
        "Escaping [link](../../outside.md) is dropped.",
      ].join("\n"),
    });
    expect(references).toEqual([
      { kind: "markdown_link", target: "v2/DESIGN.md", line: 3 },
      { kind: "markdown_link", target: "docs/images/flow chart.svg", line: 4 },
      { kind: "code_symbol", target: "v2/argo_v2/live/engine.py", symbol: "Limits", line: 5 },
      { kind: "code_path", target: "v2/argo_v2/live/engine.py", line: 5 },
      { kind: "code_path", target: "v4", line: 6 },
      { kind: "code_path", target: "scripts/run", weak: true, line: 6 },
      { kind: "code_path", target: "text/markdown", weak: true, line: 6 },
      { kind: "markdown_link", target: "docs/archive/v1.md", line: 7 },
      { kind: "fence_path", target: "v2/argo_v2/model.py", line: 9 },
    ]);
  });
});

describe("historical document markers", () => {
  const scopes = archiveScopes(null);

  it("recognizes the archive scope, front matter, and a leading banner", () => {
    expect(scopes).toEqual(["docs/archive"]);
    expect(
      historicalDocumentMarker({
        path: "docs/archive/v1-final-design.md",
        content: "# Argo Final Design v1\n",
        archiveScopes: scopes,
      }),
    ).toBe("archive_scope");
    expect(
      historicalDocumentMarker({
        path: "docs/design.md",
        content: "---\ntitle: Old\nstatus: superseded\n---\n# Old design\n",
        archiveScopes: scopes,
      }),
    ).toBe("front_matter");
    expect(
      historicalDocumentMarker({
        path: "docs/goals.md",
        content: "> **Historical (v1, 2026-09-27).** Not the current design.\n\n# Goals\n",
        archiveScopes: scopes,
      }),
    ).toBe("banner");
    expect(
      historicalDocumentMarker({
        path: "docs/plan.md",
        content: "# Plan\n\n> Archived: replaced by v4.\n",
        archiveScopes: scopes,
      }),
    ).toBe("banner");
  });

  it("does not treat incidental history words as markers", () => {
    for (const content of [
      "# History of the venue\n\nThe historical data loader runs hourly.\n",
      "# Plan\n\nIntro.\n\nMore.\n\n> Historical: too late to be a banner.\n",
      "> Historically, this module was slow.\n",
      "---\nstatus: active\n---\n# Current\n",
    ])
      expect(
        historicalDocumentMarker({ path: "docs/current.md", content, archiveScopes: scopes }),
      ).toBeNull();
    expect(
      historicalDocumentMarker({
        path: "docs/archived.md",
        content: "# x\n",
        archiveScopes: scopes,
      }),
    ).toBeNull();
  });

  it("detects history-targeted queries by whole fixed terms", () => {
    expect(queryTargetsHistory("argo final design")).toBe(false);
    expect(queryTargetsHistory("v1 archived design")).toBe(true);
    expect(queryTargetsHistory("Design HISTORY")).toBe(true);
    expect(queryTargetsHistory("historically")).toBe(false);
  });
});
