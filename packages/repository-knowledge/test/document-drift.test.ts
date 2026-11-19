import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { parse, stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import { evaluateRepositoryDocumentStaleness } from "../src/document-staleness-evaluation.js";
import type { DocumentStalenessGitPort } from "../src/document-staleness-git.js";
import {
  readRecordedDocumentLifecycleSummary,
  recordDocumentLifecycle,
} from "../src/document-lifecycle-observation.js";
import { DOCUMENT_LIFECYCLE_RECORD_PATH } from "../src/document-lifecycle-record.js";
import { documentStalenessStatePath } from "../src/document-staleness-state.js";
import {
  documentDriftAttentionIssues,
  observeDocumentFreshnessFindings,
  scanConfiguredRepositoryKnowledge,
  lintRepositoryKnowledge,
  readRecordedDocumentStalenessReport,
  type KnowledgeLintIssue,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(resolve(root, path, ".."), { recursive: true });
  await writeFile(resolve(root, path), content);
}

function git(root: string, ...args: string[]): void {
  execFileSync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", ...args],
    { cwd: root, stdio: "ignore" },
  );
}

const AGENTS = [
  "# Argo repository instructions",
  "",
  "- Hard risk limits live in `v2/argo_v2/live/engine.py: Limits`; never weaken them.",
  "- The new engine keeps them in `v4/argo4/live/engine.py: Limits`.",
  "",
  "<!-- lervo:begin block=repository_instruction_routes schema=2 -->",
  "- Lervo-managed text may mention `managed/only/path.py`.",
  "<!-- lervo:end block=repository_instruction_routes -->",
  "",
].join("\n");

/** Models Argo: entrypoints still point at a v2 tree that a later commit removed. */
async function argoLikeRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-document-drift-"));
  roots.push(root);
  await put(
    root,
    "README.md",
    "# Argo\n\nThe running system is [v2](v2/README.md), deployed from `v2/argo_v2/live/engine.py`.\n",
  );
  await put(root, "AGENTS.md", AGENTS);
  await put(root, "v2/README.md", "# v2\n");
  await put(root, "v2/argo_v2/live/engine.py", "class Limits:\n    pass\n");
  await put(root, "v4/argo4/live/engine.py", "class RiskLimits:\n    pass\n");
  await put(root, "v4/argo4/policy.py", "POLICY = 1\n");
  await put(root, "docs/design.md", "# Design\n\nThe engine is `v2/argo_v2/live/engine.py`.\n");
  await put(root, "docs/stable.md", "# Stable\n\nThe policy is `v4/argo4/policy.py`.\n");
  await put(root, "docs/notes.md", "# Notes\n\nNo repository references.\n");
  await put(
    root,
    "docs/broken.md",
    "# Broken\n\nSee [evidence](../evidence/trade-analysis.json).\n",
  );
  await put(
    root,
    "docs/archive/v1-final-design.md",
    "# Argo Final Design v1\n\nSee [handoff](IMPLEMENTATION-HANDOFF.md) and `v2/argo_v2/live/engine.py`.\n",
  );
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_documentdrift" }));
  const layoutPath = resolve(root, ".lervo/knowledge/document-layout.yaml");
  const layout = parse(await readFile(layoutPath, "utf8")) as {
    documentPolicy: { roles: Array<Record<string, unknown>> };
  };
  layout.documentPolicy.roles.push({
    roleId: "argo_preserved_02",
    scopePath: ".",
    path: "IMPLEMENTATION-HANDOFF.md",
    cardinality: "one",
    lifecycleOwner: "user",
    relocation: "preserve",
    rewritePolicy: "reviewed_exact",
    required: false,
  });
  await writeFile(layoutPath, stringify(layout, { lineWidth: 0 }));
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "v2 era");
  git(root, "rm", "-q", "-r", "v2");
  git(root, "commit", "-q", "-m", "remove v2");
  return root;
}

function codes(issues: readonly KnowledgeLintIssue[], code: string) {
  return issues
    .filter((issue) => issue.code === code)
    .map((issue) => ({ path: issue.path, target: issue.target, reasons: issue.reasons }));
}

describe("document drift lint", () => {
  it("reports missing role targets, broken links, entrypoint references, and stale documents", async () => {
    const root = await argoLikeRepository();
    const lint = await lintRepositoryKnowledge(root, { documentStaleness: "evaluate" });

    expect(codes(lint.issues, "document_role_target_missing")).toEqual([
      {
        path: "IMPLEMENTATION-HANDOFF.md",
        target: "IMPLEMENTATION-HANDOFF.md",
        reasons: undefined,
      },
    ]);
    expect(codes(lint.issues, "markdown_link_target_missing")).toEqual([
      { path: "docs/broken.md", target: "evidence/trade-analysis.json", reasons: undefined },
    ]);
    expect(codes(lint.issues, "entrypoint_reference_missing")).toEqual([
      { path: "AGENTS.md", target: "v2/argo_v2/live/engine.py", reasons: ["path_missing"] },
      { path: "AGENTS.md", target: "v4/argo4/live/engine.py", reasons: ["symbol_missing"] },
      { path: "README.md", target: "v2/README.md", reasons: ["path_missing"] },
      { path: "README.md", target: "v2/argo_v2/live/engine.py", reasons: ["path_missing"] },
    ]);
    expect(codes(lint.issues, "document_stale")).toEqual([
      {
        path: "AGENTS.md",
        target: "v2/argo_v2/live/engine.py",
        reasons: ["connected_path_changed"],
      },
      {
        path: "README.md",
        target: "v2/argo_v2/live/engine.py",
        reasons: ["connected_path_changed"],
      },
      {
        path: "docs/design.md",
        target: "v2/argo_v2/live/engine.py",
        reasons: ["connected_path_changed"],
      },
    ]);
    expect(lint.documentStaleness).toMatchObject({
      status: "observed",
      evaluated: 4,
      current: 1,
      stale: 3,
      unknown: 0,
    });
    expect(lint.valid).toBe(true);
    const serialized = JSON.stringify(lint.issues);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("class Limits");
    expect(serialized).not.toContain("managed/only/path.py");
    expect(serialized).not.toContain("docs/archive");
  });

  it("projects drift as bounded agent-owned attention and records staleness only when asked", async () => {
    const root = await argoLikeRepository();
    const foreground = await lintRepositoryKnowledge(root);
    expect(await readRecordedDocumentStalenessReport(root)).toBeNull();
    const attention = documentDriftAttentionIssues(foreground);
    expect(attention.length).toBeGreaterThan(0);
    expect(attention.every((item) => item.command === "lervo knowledge lint --json")).toBe(true);
    expect(attention.find((item) => item.code === "document_stale")?.detail).toBe(
      "path=AGENTS.md target=v2/argo_v2/live/engine.py reasons=connected_path_changed",
    );

    await lintRepositoryKnowledge(root, { documentStaleness: "evaluate_and_record" });
    const recorded = await readRecordedDocumentStalenessReport(root);
    expect(recorded?.stale.map((finding) => [finding.path, finding.changedPaths])).toEqual([
      ["AGENTS.md", ["v2/argo_v2/live/engine.py"]],
      ["README.md", ["v2/argo_v2/live/engine.py"]],
      ["docs/design.md", ["v2/argo_v2/live/engine.py"]],
    ]);
    expect(await readFile(resolve(root, documentStalenessStatePath), "utf8")).not.toContain(
      "class Limits",
    );
    // ADR-0562 shadow: read-only lint never evaluates the lifecycle; the recording call does, once
    // per staleness coordinate, and sweeps a small repository completely on its first day.
    await expect(access(resolve(root, DOCUMENT_LIFECYCLE_RECORD_PATH))).rejects.toThrow();
    const recording = await recordDocumentLifecycle({ root, now: new Date() });
    expect(recording).toMatchObject({ status: "recorded", deferred: 0 });
    const summary = await readRecordedDocumentLifecycleSummary(root);
    expect(summary?.revision).toBe(recorded?.currentRevision);
    expect(summary?.summary.cadence).toMatchObject({ periodDays: 14, perDay: 16, unassessed: 0 });
    const lifecycleText = await readFile(resolve(root, DOCUMENT_LIFECYCLE_RECORD_PATH), "utf8");
    expect(Object.keys((JSON.parse(lifecycleText) as { documents: object }).documents)).toContain(
      "AGENTS.md",
    );
    expect(lifecycleText).not.toContain("class Limits");
    expect(await recordDocumentLifecycle({ root, now: new Date() })).toEqual({
      status: "skipped_current",
    });
    expect(
      documentDriftAttentionIssues({
        issues: Array.from({ length: 20 }, (_, index) => ({
          code: "markdown_link_target_missing",
          severity: "warning" as const,
          path: `docs/${index}.md`,
          message: "missing",
        })),
      }).at(-1),
    ).toEqual({
      code: "document_drift_attention_truncated",
      command: "lervo knowledge lint --json",
      detail: "omitted=4",
    });
  });

  it("keeps staleness unavailable outside Git instead of reporting documents current", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-document-drift-nogit-"));
    roots.push(root);
    await put(root, "docs/design.md", "# Design\n\nThe engine is `src/engine.py`.\n");
    await put(root, "src/engine.py", "ENGINE = 1\n");
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_documentnogit" }));
    const lint = await lintRepositoryKnowledge(root);
    expect(lint.documentStaleness).toMatchObject({ status: "unavailable", current: 0 });
    expect(codes(lint.issues, "document_stale")).toEqual([]);
  });
});

describe("document staleness evaluation", () => {
  const head = "a".repeat(40);
  const verified = "b".repeat(40);

  function port(input: {
    committedAt?: string;
    objects: Record<string, string | null>;
  }): DocumentStalenessGitPort {
    return {
      headRevision: async () => head,
      latestPathRevisions: async () =>
        new Map([
          [
            "docs/design.md",
            {
              revision: verified,
              committedAt: input.committedAt ?? "2026-09-27T00:00:00+09:00",
              order: 1,
            },
          ],
        ]),
      objectNames: async (lookups) =>
        new Map(lookups.map((lookup) => [lookup, input.objects[lookup] ?? null])),
    };
  }

  const documents = [
    { path: "docs/design.md", content: "# Design\n\nSee `v2/engine.py`.\n" },
    { path: "docs/notes.md", content: "# Notes\n" },
  ];
  const common = {
    coverage: "complete" as const,
    documents,
    normalizationRecords: [],
    ignored: () => false,
    topLevel: () => true,
    now: new Date("2026-10-05T00:00:00Z"),
  };

  it("separates stale, current, unknown, and unevaluated documents", async () => {
    const stale = await evaluateRepositoryDocumentStaleness({
      ...common,
      git: port({
        objects: {
          [`${verified}:docs/design.md`]: "1".repeat(40),
          [`${head}:docs/design.md`]: "1".repeat(40),
          [`${verified}:v2/engine.py`]: "2".repeat(40),
        },
      }),
    });
    expect(stale.counts).toEqual({
      documents: 2,
      evaluated: 1,
      current: 0,
      stale: 1,
      unknown: 0,
      unevaluated: 1,
    });
    expect(stale.stale[0]).toMatchObject({
      path: "docs/design.md",
      changedPaths: ["v2/engine.py"],
    });

    const current = await evaluateRepositoryDocumentStaleness({
      ...common,
      git: port({
        objects: {
          [`${verified}:docs/design.md`]: "1".repeat(40),
          [`${head}:docs/design.md`]: "1".repeat(40),
          [`${verified}:v2/engine.py`]: "2".repeat(40),
          [`${head}:v2/engine.py`]: "2".repeat(40),
        },
      }),
    });
    expect(current.counts).toMatchObject({ current: 1, stale: 0, unknown: 0 });

    const unknown = await evaluateRepositoryDocumentStaleness({
      ...common,
      git: port({
        committedAt: "not-a-time",
        objects: { [`${head}:v2/engine.py`]: "2".repeat(40) },
      }),
    });
    expect(unknown.counts).toMatchObject({ current: 0, unknown: 1 });
    expect(unknown.unknown[0]?.reasons).toEqual(["staleness_evidence_inconsistent"]);

    const unavailable = await evaluateRepositoryDocumentStaleness({
      ...common,
      git: {
        ...port({ objects: {} }),
        latestPathRevisions: async () => {
          throw new Error("shallow clone");
        },
      },
    });
    expect(unavailable).toMatchObject({
      status: "unavailable",
      counts: { current: 0, unevaluated: 2 },
    });
  });
});

it("keeps complete staleness state across partial observations and restores complete admission", async () => {
  const root = await argoLikeRepository();
  const { scan } = await scanConfiguredRepositoryKnowledge(root);
  const options = { preparedScan: scan, documentStaleness: "evaluate_and_record" as const };
  const complete = await lintRepositoryKnowledge(root, options);
  const statePath = resolve(root, documentStalenessStatePath);
  const recorded = await readFile(statePath, "utf8");
  const partial = await lintRepositoryKnowledge(root, {
    ...options,
    preparedScan: {
      ...scan,
      coverage: "partial",
      skippedForBudget: { count: 1, bytes: 64, classes: ["other_documents"] },
    },
  });
  expect(partial.documentStaleness).toMatchObject({
    coverage: "partial",
    status: "unavailable",
    current: 0,
  });
  expect(await readFile(statePath, "utf8")).toBe(recorded);
  expect(
    (
      await observeDocumentFreshnessFindings({
        repositoryRoot: root,
        now: new Date(),
        lint: partial,
      })
    ).stalenessReportCurrent,
  ).toBe(false);
  expect(await lintRepositoryKnowledge(root, options)).toEqual(complete);
  expect((await readRecordedDocumentStalenessReport(root))?.coverage).toBe("complete");
});
