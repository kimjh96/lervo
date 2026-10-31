import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import { fixture } from "./fixture.js";
import { discoverConvergenceBaseline } from "../src/baseline.js";
import { convergenceAssessmentSources } from "../src/assessment-scope.js";
import { convergenceDelegationPlanHash, type ConvergenceDelegation } from "../src/delegation.js";
import {
  captureConvergenceChangedPaths,
  captureConvergenceSources,
  convergenceSourceBytes,
} from "../src/source-capture.js";
import { parseConvergenceSourceCapturePolicy } from "../src/source-capture-contract.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("selects changed tracked and untracked paths without treating committed files as new obligations", async () => {
  const f = await fixture();
  fixtures.push(f);
  expect(captureConvergenceChangedPaths(f.root)).toEqual([]);
  await writeFile(resolve(f.root, "README.md"), "# Changed repository\n");
  await writeFile(resolve(f.root, "new-note.md"), "# New note\n");
  await writeFile(resolve(f.root, ".gitignore"), "ignored-note.md\n");
  await writeFile(resolve(f.root, "ignored-note.md"), "# Ignored\n");
  expect(captureConvergenceChangedPaths(f.root)).toEqual([
    ".gitignore",
    "README.md",
    "new-note.md",
  ]);
});

it("keeps complete capture while assessing only paths with an exact source obligation", async () => {
  const f = await fixture(false, true);
  fixtures.push(f);
  const initial = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  expect(initial.sources.some((source) => source.path === "src/runtime.ts")).toBe(true);
  expect(initial.assessmentPaths).not.toContain("src/runtime.ts");
  await writeFile(resolve(f.root, "src/runtime.ts"), "export const maximumBackgroundCalls = 3;\n");
  const changed = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  expect(changed.assessmentPaths).toContain("src/runtime.ts");
  expect(
    convergenceAssessmentSources({
      schemaVersion: 1,
      obligationId: "test",
      baseline: changed,
      snapshotHash: changed.sourceSnapshotHash,
      receipts: [],
      stageData: {},
    }).some((source) => source.path === "src/runtime.ts"),
  ).toBe(true);
});

async function setCapturePolicy(
  f: Awaited<ReturnType<typeof fixture>>,
  sourceCapture: NonNullable<ConvergenceDelegation["sourceCapture"]>,
) {
  const { review, ...previous } = f.delegation!;
  const plan = { ...previous, sourceCapture };
  f.delegation = {
    ...plan,
    review: { ...review, planHash: convergenceDelegationPlanHash(plan) },
  };
  await writeFile(
    resolve(f.root, ".lervo/knowledge/convergence-delegation.json"),
    JSON.stringify(f.delegation),
  );
}

it("captures reviewed file and directory aliases without traversing or rewriting their target bytes", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  await rm(resolve(f.root, "README.md"));
  await symlink("docs/specs/runtime.md", resolve(f.root, "README.md"));
  await mkdir(resolve(f.root, ".claude/skills"), { recursive: true });
  await mkdir(resolve(f.root, ".agents/skills/local"), { recursive: true });
  await writeFile(
    resolve(f.root, ".agents/skills/local/SKILL.md"),
    "# Skill\n\nPreserve exact facts.\n",
  );
  await symlink("../../.agents/skills/local", resolve(f.root, ".claude/skills/local"));
  const before = await readFile(resolve(f.root, "docs/specs/runtime.md"));
  expect(() => captureConvergenceSources(f.root, "policy")).toThrow(
    expect.objectContaining({ code: "knowledge_source_kind_unsupported" }),
  );
  await setCapturePolicy(f, {
    maximumRepositoryBytes: 256 * 1024 * 1024,
    symbolicReferences: [
      { path: "README.md", target: "docs/specs/runtime.md", targetKind: "file" },
      {
        path: ".claude/skills/local",
        target: "../../.agents/skills/local",
        targetKind: "directory",
      },
    ],
  });
  const capture = captureConvergenceSources(f.root, "policy");
  expect(capture.sources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "README.md", kind: "opaque" }),
      expect.objectContaining({ path: ".claude/skills/local", kind: "opaque" }),
      expect.objectContaining({ path: "docs/specs/runtime.md", contentHash: sha256(before) }),
      expect.objectContaining({ path: ".agents/skills/local/SKILL.md", kind: "text" }),
    ]),
  );
  expect(convergenceSourceBytes(f.root, "README.md").includes(before)).toBe(false);
  expect(await readFile(resolve(f.root, "docs/specs/runtime.md"))).toEqual(before);
  await writeFile(resolve(f.root, "docs/specs/runtime.md"), "# Changed target\n");
  expect(captureConvergenceSources(f.root, "policy").snapshotHash).not.toBe(capture.snapshotHash);
  await rm(resolve(f.root, "README.md"));
  await symlink("AGENTS.md", resolve(f.root, "README.md"));
  expect(() => captureConvergenceSources(f.root, "policy")).toThrow(
    expect.objectContaining({ code: "knowledge_source_kind_unsupported" }),
  );
});

it("refuses reference escape, chains, missing captured targets, and a file substituted for a link", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const policy = {
    maximumRepositoryBytes: 256 * 1024 * 1024,
    symbolicReferences: [
      { path: "README.md", target: "docs/specs/runtime.md", targetKind: "file" as const },
    ],
  };
  expect(() =>
    parseConvergenceSourceCapturePolicy({
      ...policy,
      symbolicReferences: [{ path: "README.md", target: "../outside", targetKind: "file" }],
    }),
  ).toThrow(expect.objectContaining({ code: "knowledge_authority_unavailable" }));
  await setCapturePolicy(f, policy);
  expect(() => captureConvergenceSources(f.root, "policy")).toThrow(
    expect.objectContaining({ code: "knowledge_source_kind_unsupported" }),
  );
  await rm(resolve(f.root, "README.md"));
  await symlink("docs/specs/runtime.md", resolve(f.root, "README.md"));
  await rm(resolve(f.root, "docs/specs/runtime.md"));
  await symlink("../../AGENTS.md", resolve(f.root, "docs/specs/runtime.md"));
  expect(() => captureConvergenceSources(f.root, "policy")).toThrow(
    expect.objectContaining({ code: "knowledge_source_kind_unsupported" }),
  );
  await rm(resolve(f.root, "docs/specs/runtime.md"));
  expect(() => captureConvergenceSources(f.root, "policy")).toThrow(
    expect.objectContaining({ code: "knowledge_source_kind_unsupported" }),
  );
  await writeFile(resolve(f.root, "docs/specs/runtime.md"), "# Runtime\n");
  await writeFile(resolve(f.root, ".gitignore"), "ignored-target.md\n");
  await writeFile(resolve(f.root, "ignored-target.md"), "# Ignored target\n");
  await rm(resolve(f.root, "README.md"));
  await symlink("ignored-target.md", resolve(f.root, "README.md"));
  await rm(resolve(f.root, "docs/specs/runtime.md"));
  await writeFile(resolve(f.root, "docs/specs/runtime.md"), "# Runtime\n");
  await setCapturePolicy(f, {
    ...policy,
    symbolicReferences: [{ path: "README.md", target: "ignored-target.md", targetKind: "file" }],
  });
  expect(() => captureConvergenceSources(f.root, "policy")).toThrow(
    expect.objectContaining({ code: "knowledge_source_kind_unsupported" }),
  );
});

it("keeps every tracked opaque asset and stops at the exact reviewed capture ceiling", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  await mkdir(resolve(f.root, "assets"));
  const first = Buffer.alloc(400 * 1024, 1);
  const second = Buffer.alloc(400 * 1024, 2);
  await writeFile(resolve(f.root, "assets/first.bin"), first);
  await writeFile(resolve(f.root, "assets/second.bin"), second);
  execFileSync("git", ["-C", f.root, "add", "assets"]);
  await setCapturePolicy(f, { maximumRepositoryBytes: 512 * 1024, symbolicReferences: [] });
  expect(() => captureConvergenceSources(f.root, "policy")).toThrow(
    expect.objectContaining({ code: "knowledge_source_limit_exceeded" }),
  );
  await setCapturePolicy(f, { maximumRepositoryBytes: 2 * 1024 * 1024, symbolicReferences: [] });
  expect(captureConvergenceSources(f.root, "policy").sources).toEqual(
    expect.arrayContaining([
      { path: "assets/first.bin", contentHash: sha256(first), kind: "opaque" },
      { path: "assets/second.bin", contentHash: sha256(second), kind: "opaque" },
    ]),
  );
  expect(() =>
    parseConvergenceSourceCapturePolicy({
      maximumRepositoryBytes: 1024 * 1024 * 1024 + 1,
      symbolicReferences: [],
    }),
  ).toThrow(expect.objectContaining({ code: "knowledge_authority_unavailable" }));
});

it("excludes Lervo generated paths from change observation, baseline obligations, and legacy assessment", async () => {
  const f = await fixture();
  fixtures.push(f);
  await mkdir(resolve(f.root, ".lervo/generated/design/previews"), { recursive: true });
  await writeFile(resolve(f.root, ".lervo/generated/design/study.md"), "# Generated study\n");
  await writeFile(
    resolve(f.root, ".lervo/generated/design/previews/study.png"),
    Buffer.from([0, 1, 2]),
  );
  expect(
    execFileSync("git", ["-C", f.root, "ls-files", "--others", "--exclude-standard"], {
      encoding: "utf8",
    }),
  ).toContain(".lervo/generated/design/study.md");
  // Tracking an owned projection cannot turn it into canonical source content either.
  execFileSync("git", ["-C", f.root, "add", "-f", ".lervo/generated/design/study.md"]);
  await writeFile(resolve(f.root, "owner-note.md"), "# Owner knowledge\n");
  const changed = captureConvergenceChangedPaths(f.root);
  expect(changed).toContain("owner-note.md");
  expect(changed.some((path) => path.startsWith(".lervo/generated/"))).toBe(false);
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  expect(baseline.assessmentPaths).toContain("owner-note.md");
  expect(baseline.assessmentPaths!.some((path) => path.startsWith(".lervo/generated/"))).toBe(
    false,
  );
  expect(baseline.sources.some((source) => source.path.startsWith(".lervo/generated/"))).toBe(
    false,
  );
  const generated = {
    path: ".lervo/generated/design/study.md",
    kind: "text" as const,
    contentHash: sha256("legacy"),
  };
  expect(
    convergenceAssessmentSources({
      schemaVersion: 1,
      obligationId: "legacy",
      baseline: { ...baseline, sources: [generated], assessmentPaths: [generated.path] },
      snapshotHash: baseline.sourceSnapshotHash,
      receipts: [],
      stageData: {},
    }),
  ).toEqual([]);
});
