import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import { runDocumentFreshnessChecks } from "../src/document-freshness-checks.js";
import { defaultDocumentFreshnessPolicy } from "../src/document-freshness-contract.js";
import { documentFreshnessFinding } from "../src/document-freshness-finding.js";
import { neverTrackedReferenceTargets } from "../src/document-freshness-reference-history.js";
import {
  documentFreshnessReferences,
  freshnessReferenceMissing,
  unresolvedDocumentReferences,
} from "../src/document-freshness-references.js";
import { MAXIMUM_DOCUMENT_REFERENCES } from "../src/document-references.js";
import { observeDocumentFreshnessFindings } from "../src/index.js";
import { sha256 } from "../src/integrity.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(resolve(root, path, ".."), { recursive: true });
  await writeFile(resolve(root, path), content);
}

function git(root: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", ...args],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
}

async function repository(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-reference-history-"));
  roots.push(root);
  await put(root, "README.md", "# Fixture\n");
  await put(root, "v2/live/engine.py", "class Limits:\n    pass\n");
  await put(root, "tools/old/run.sh", "echo old\n");
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "v2 era");
  // A file that lived only on a merged side branch still existed in history.
  git(root, "checkout", "-q", "-b", "side");
  await put(root, "side/only.ts", "export {};\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "side file");
  git(root, "rm", "-q", "side/only.ts");
  git(root, "commit", "-q", "-m", "drop side file");
  git(root, "checkout", "-q", "-");
  git(root, "merge", "-q", "--no-ff", "-m", "merge side", "side");
  git(root, "rm", "-q", "-r", "v2", "tools/old");
  git(root, "commit", "-q", "-m", "remove v2");
  return { root, head: git(root, "rev-parse", "HEAD").trim() };
}

const absentOracle = {
  exists: () => false,
  readText: () => null,
  topLevel: () => true,
};

describe("never-tracked reference targets (ADR-0558)", () => {
  it("separates removed targets from targets the repository never contained", async () => {
    const { root, head } = await repository();
    const neverTracked = await neverTrackedReferenceTargets({
      root,
      head,
      targets: [
        "v2/live/engine.py",
        "tools/old/",
        "tools/old",
        "side/only.ts",
        "fixtures/sample-input.json",
        "examples/never/",
      ],
    });
    expect([...neverTracked].sort()).toEqual(["examples/never/", "fixtures/sample-input.json"]);
  });

  it("finds files added by a root or merge commit whatever the user's log settings", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-reference-history-merge-"));
    roots.push(root);
    await put(root, "root-only/file.ts", "export {};\n");
    git(root, "init", "-q");
    git(root, "config", "log.showRoot", "false");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "root");
    git(root, "checkout", "-q", "-b", "side");
    await put(root, "side.txt", "side\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "side");
    git(root, "checkout", "-q", "-");
    git(root, "merge", "-q", "--no-ff", "--no-commit", "side");
    await put(root, "merge-only/file.ts", "export {};\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "merge with a new file");
    git(root, "rm", "-q", "-r", "root-only", "merge-only");
    git(root, "commit", "-q", "-m", "remove both");
    const head = git(root, "rev-parse", "HEAD").trim();
    expect(
      await neverTrackedReferenceTargets({
        root,
        head,
        targets: ["root-only/file.ts", "merge-only/", "fixtures/never.json"],
      }),
    ).toEqual(new Set(["fixtures/never.json"]));
  });

  it("treats every target as tracked when history cannot answer", async () => {
    const { root, head } = await repository();
    // A path git cannot take literally is never asked, so it keeps today's behaviour.
    expect(
      await neverTrackedReferenceTargets({ root, head, targets: ["../outside.md", "/abs.md"] }),
    ).toEqual(new Set());
    // A missing revision fails the lookup as a whole.
    expect(
      await neverTrackedReferenceTargets({
        root,
        head: "0".repeat(40),
        targets: ["fixtures/sample-input.json"],
      }),
    ).toEqual(new Set());
    const plain = await mkdtemp(resolve(tmpdir(), "lervo-reference-history-nogit-"));
    roots.push(plain);
    expect(
      await neverTrackedReferenceTargets({
        root: plain,
        head,
        targets: ["fixtures/sample-input.json"],
      }),
    ).toEqual(new Set());
  });

  it("treats every target as tracked in a shallow clone", async () => {
    const { root } = await repository();
    const shallow = await mkdtemp(resolve(tmpdir(), "lervo-reference-history-shallow-"));
    roots.push(shallow);
    git(shallow, "clone", "-q", "--depth", "1", `file://${root}`, "clone");
    const clone = resolve(shallow, "clone");
    expect(
      await neverTrackedReferenceTargets({
        root: clone,
        head: git(clone, "rev-parse", "HEAD").trim(),
        targets: ["fixtures/sample-input.json", "v2/live/engine.py"],
      }),
    ).toEqual(new Set());
  });

  it("marks only path mentions, never Markdown links, as never tracked", () => {
    const references = documentFreshnessReferences({
      path: "docs/evidence.md",
      content:
        "# Evidence\n\nThe run read `fixtures/sample-input.json`.\n\nSee [input](../fixtures/sample-input.json).\n",
      oracle: absentOracle,
      neverTracked: new Set(["fixtures/sample-input.json"]),
    });
    expect(references.map((item) => [item.kind, item.neverTracked])).toEqual([
      ["path_mention", true],
      ["link", false],
    ]);
    expect(references.map(freshnessReferenceMissing)).toEqual([false, true]);
  });

  it("raises no stale reason for a never-tracked mention but keeps it for a removed one", () => {
    const finding = (neverTracked: Set<string>) =>
      documentFreshnessFinding({
        documentPath: "AGENTS.md",
        documentHash: `sha256:${"a".repeat(64)}`,
        currentRevision: "b".repeat(40),
        staleness: null,
        sources: ["entrypoint_reference_missing"],
        connectedPathChanges: [],
        references: documentFreshnessReferences({
          path: "AGENTS.md",
          content: "# Rules\n\n- Fixtures such as `fixtures/sample-input.json` stay small.\n",
          oracle: absentOracle,
          neverTracked,
        }),
        publicationGroup: "entrypoint",
        supersededBy: null,
        detectedAt: "2026-11-02T00:00:00.000Z",
      });
    expect(finding(new Set(["fixtures/sample-input.json"])).reasons).toEqual([]);
    expect(finding(new Set()).reasons).toEqual(["reference_target_missing"]);
  });

  it("lets an edit keep a never-tracked mention but never introduce a new absent path", () => {
    const neverTracked = new Set(["fixtures/sample-input.json"]);
    const kept = "# Evidence\n\nThe run read `fixtures/sample-input.json`.\n";
    const invented = `${kept}\nIt also read \`fixtures/invented.json\`.\n`;
    expect(
      unresolvedDocumentReferences({
        path: "docs/evidence.md",
        content: kept,
        oracle: absentOracle,
        neverTracked,
      }),
    ).toEqual([]);
    expect(
      unresolvedDocumentReferences({
        path: "docs/evidence.md",
        content: invented,
        oracle: absentOracle,
        neverTracked,
      }).map((reference) => reference.target),
    ).toEqual(["fixtures/invented.json"]);
  });

  it("checks every replacement when the output reaches the reference cap", () => {
    const path = "docs/evidence.md";
    const fixtures = Array.from(
      { length: MAXIMUM_DOCUMENT_REFERENCES },
      (_, index) => `- \`fixtures/case-${index}.json\``,
    );
    const source = Buffer.from(`# Evidence\n\n${fixtures.join("\n")}\n\nEnd.\n`);
    const before = "End.";
    const replacement = "End, see `fixtures/invented.json`.";
    const start = source.indexOf(before);
    const output = Buffer.concat([
      source.subarray(0, start),
      Buffer.from(replacement),
      source.subarray(start + before.length),
    ]);
    const references = documentFreshnessReferences({
      path,
      content: source.toString("utf8"),
      oracle: absentOracle,
      neverTracked: new Set(fixtures.map((_, index) => `fixtures/case-${index}.json`)),
    });
    const checks = runDocumentFreshnessChecks({
      documentPath: path,
      source,
      sourceHash: sha256(source),
      currentHash: sha256(source),
      output,
      hunks: [
        {
          hunkId: "h1",
          range: { startByte: start, endByte: start + before.length },
          beforeHash: sha256(Buffer.from(before)),
          replacement,
          changeClass: "factual_reference",
          ownership: "lervo_managed",
          managedBlockId: null,
          authorityRequired: "none",
          crossCheckRequired: false,
          claims: [],
        },
      ],
      finding: { references },
      bundleEvidence: new Set(),
      policy: defaultDocumentFreshnessPolicy,
      oracle: absentOracle,
    });
    expect(checks.find((check) => check.code === "references_resolve")).toMatchObject({
      status: "failed",
      detail: "unresolved=fixtures/invented.json",
    });
  });

  it("checks the whole line when a replacement edits part of a link past the cap", () => {
    const path = "docs/evidence.md";
    const fixtures = Array.from(
      { length: MAXIMUM_DOCUMENT_REFERENCES },
      (_, index) => `- \`fixtures/case-${index}.json\``,
    );
    const source = Buffer.from(`# Evidence\n\n${fixtures.join("\n")}\n\nSee [doc](old.md).\n`);
    const start = source.indexOf("old.md");
    const output = Buffer.concat([
      source.subarray(0, start),
      Buffer.from("invented"),
      source.subarray(start + "old".length),
    ]);
    const oracle = { ...absentOracle, exists: (target: string) => target === "docs/old.md" };
    const checks = runDocumentFreshnessChecks({
      documentPath: path,
      source,
      sourceHash: sha256(source),
      currentHash: sha256(source),
      output,
      hunks: [
        {
          hunkId: "h1",
          range: { startByte: start, endByte: start + "old".length },
          beforeHash: sha256(Buffer.from("old")),
          replacement: "invented",
          changeClass: "factual_reference",
          ownership: "lervo_managed",
          managedBlockId: null,
          authorityRequired: "none",
          crossCheckRequired: false,
          claims: [],
        },
      ],
      finding: {
        references: documentFreshnessReferences({
          path,
          content: source.toString("utf8"),
          oracle,
          neverTracked: new Set(fixtures.map((_, index) => `fixtures/case-${index}.json`)),
        }),
      },
      bundleEvidence: new Set(),
      policy: defaultDocumentFreshnessPolicy,
      oracle,
    });
    expect(checks.find((check) => check.code === "references_resolve")).toMatchObject({
      status: "failed",
      detail: "unresolved=docs/invented.md",
    });
  });

  it("fails closed when a replaced line alone reaches the reference cap", () => {
    const path = "docs/evidence.md";
    const fixtures = Array.from(
      { length: MAXIMUM_DOCUMENT_REFERENCES },
      (_, index) => `\`fixtures/case-${index}.json\``,
    );
    const source = Buffer.from(`# Evidence\n\n${fixtures.join(" ")} [doc](old.md)\n`);
    const start = source.indexOf("old.md");
    const output = Buffer.concat([
      source.subarray(0, start),
      Buffer.from("invented"),
      source.subarray(start + "old".length),
    ]);
    const oracle = { ...absentOracle, exists: (target: string) => target === "docs/old.md" };
    const checks = runDocumentFreshnessChecks({
      documentPath: path,
      source,
      sourceHash: sha256(source),
      currentHash: sha256(source),
      output,
      hunks: [
        {
          hunkId: "h1",
          range: { startByte: start, endByte: start + "old".length },
          beforeHash: sha256(Buffer.from("old")),
          replacement: "invented",
          changeClass: "factual_reference",
          ownership: "lervo_managed",
          managedBlockId: null,
          authorityRequired: "none",
          crossCheckRequired: false,
          claims: [],
        },
      ],
      finding: {
        references: documentFreshnessReferences({
          path,
          content: source.toString("utf8"),
          oracle,
          neverTracked: new Set(fixtures.map((_, index) => `fixtures/case-${index}.json`)),
        }),
      },
      bundleEvidence: new Set(),
      policy: defaultDocumentFreshnessPolicy,
      oracle,
    });
    expect(checks.find((check) => check.code === "references_resolve")).toMatchObject({
      status: "failed",
      detail: "reference_limit_reached",
    });
  });

  it("checks the first line when a replacement starts at byte 0", () => {
    const path = "docs/evidence.md";
    const existing = Array.from(
      { length: MAXIMUM_DOCUMENT_REFERENCES },
      (_, index) => `\`docs/case-${index}.md\``,
    );
    const source = Buffer.from("# Evidence\n");
    const replacement = `${existing.join(" ")} [doc](invented.md)\n`;
    const output = Buffer.concat([Buffer.from(replacement), source]);
    const oracle = { ...absentOracle, exists: (target: string) => target !== "docs/invented.md" };
    const checks = runDocumentFreshnessChecks({
      documentPath: path,
      source,
      sourceHash: sha256(source),
      currentHash: sha256(source),
      output,
      hunks: [
        {
          hunkId: "h1",
          range: { startByte: 0, endByte: 0 },
          beforeHash: sha256(Buffer.alloc(0)),
          replacement,
          changeClass: "factual_reference",
          ownership: "lervo_managed",
          managedBlockId: null,
          authorityRequired: "none",
          crossCheckRequired: false,
          claims: [],
        },
      ],
      finding: { references: [] },
      bundleEvidence: new Set(),
      policy: defaultDocumentFreshnessPolicy,
      oracle,
    });
    expect(checks.find((check) => check.code === "references_resolve")?.status).toBe("failed");
  });

  it("observes an entrypoint finding only for the removed reference", async () => {
    const { root } = await repository();
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_referencehistory" }));
    await put(
      root,
      "AGENTS.md",
      [
        "# Rules",
        "",
        "- Hard limits live in `v2/live/engine.py: Limits`.",
        "- Test inputs such as `fixtures/sample-input.json` stay small.",
        "",
      ].join("\n"),
    );
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "rules");
    const observed = await observeDocumentFreshnessFindings({
      repositoryRoot: root,
      now: new Date(),
    });
    const agents = observed.findings.find((finding) => finding.documentPath === "AGENTS.md");
    expect(agents?.reasons).toContain("reference_target_missing");
    expect(
      agents?.references
        .filter((reference) => !reference.resolved)
        .map((reference) => [reference.target, reference.neverTracked]),
    ).toEqual([
      ["v2/live/engine.py", false],
      ["fixtures/sample-input.json", true],
    ]);

    await put(
      root,
      "AGENTS.md",
      "# Rules\n\n- Test inputs such as `fixtures/sample-input.json` stay small.\n",
    );
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "drop v2 rule");
    const clean = await observeDocumentFreshnessFindings({ repositoryRoot: root, now: new Date() });
    expect(clean.findings.some((finding) => finding.documentPath === "AGENTS.md")).toBe(false);
  });
});
