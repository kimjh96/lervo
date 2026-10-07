import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CONVERGENCE_DELEGATION_PATH,
  convergenceDelegationPlanHash,
  type ConvergenceDelegation,
} from "../src/delegation-contract.js";
import { validateSchema } from "@lervo/schemas";

import { knowledgePublicationRestorePoint } from "../src/knowledge-publication-repair-plan.js";
import { recordKnowledgePublicationRepair } from "../src/knowledge-publication-repair-event.js";
import {
  knowledgePublicationPathInScope,
  knowledgePublicationViolations,
  loadKnowledgePublicationScope,
} from "../src/knowledge-publication-scope.js";
import {
  migrateDerivedKnowledgePublicationSettings,
  parseKnowledgePublicationSettings,
} from "../src/knowledge-publication-settings.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const now = new Date("2026-10-06T00:00:00.000Z");
const hash = (digit: string) => `sha256:${digit.repeat(64)}`;
const binding = {
  roleId: "developer",
  version: "1.0.0",
  contractHash: hash("1"),
  profileHash: hash("2"),
  capabilityHash: hash("3"),
};
const target = {
  remote: "origin",
  baseBranch: "main",
  branch: "lervo/knowledge-outputs",
  merge: "when_checks_pass" as const,
};

function delegation(overrides: Partial<ConvergenceDelegation> = {}): ConvergenceDelegation {
  const plan: Omit<ConvergenceDelegation, "review"> = {
    schemaVersion: 1,
    projectId: "prj_publication_scope",
    state: "active",
    parentAgentId: `agt_${"a".repeat(24)}`,
    parentRoleHash: hash("1"),
    roles: { generator: binding, reviewer: binding, writer: binding, integrator: binding },
    canonicalRoots: ["docs"],
    normalizationRoots: ["README.md", "AGENTS.md", ".agents/skills", "apps/site/README.md"],
    providers: ["codex"],
    verification: [{ suiteId: "repository.default.v1", suiteHash: hash("4") }],
    integrationTarget: {
      ref: "refs/heads/lervo/knowledge-integration",
      repositoryIdentityHash: hash("5"),
    },
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    resourceCeilings: {
      maximumStages: 4,
      maximumDocuments: 4,
      maximumSourceBytes: 65_536,
      maximumProviderCalls: 4,
    },
    ...overrides,
  };
  return {
    ...plan,
    review: {
      reviewerAgentId: `agt_${"b".repeat(24)}`,
      reviewedAt: now.toISOString(),
      planHash: convergenceDelegationPlanHash(plan),
    },
  };
}

async function checkout(value?: ConvergenceDelegation): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-publication-scope-"));
  directories.push(root);
  if (value !== undefined) {
    await mkdir(dirname(resolve(root, CONVERGENCE_DELEGATION_PATH)), { recursive: true });
    await writeFile(resolve(root, CONVERGENCE_DELEGATION_PATH), JSON.stringify(value));
  }
  return root;
}

const commit = (sha: string, paths: string[], body = "Lervo convergence kco_x settled.") => ({
  sha: sha.repeat(40).slice(0, 40),
  subject: "docs: apply reviewed background knowledge",
  body,
  paths,
  committerDate: "0 +0000",
});

describe("knowledge publication settings", () => {
  it("accepts the delegation scope only without fixed roots and keeps the legacy default", () => {
    expect(parseKnowledgePublicationSettings({ ...target, scope: "delegation" })).toEqual({
      ...target,
      scope: "delegation",
    });
    expect(
      parseKnowledgePublicationSettings({
        ...target,
        scope: "delegation",
        allowedRoots: ["docs/"],
      }),
    ).toBeNull();
    expect(parseKnowledgePublicationSettings({ ...target, scope: "roots" })).toBeNull();
    expect(parseKnowledgePublicationSettings(target)).toEqual({
      ...target,
      allowedRoots: ["docs/", ".lervo/knowledge/"],
    });
  });

  it("migrates only the fixed default roots that derivation used to write", () => {
    expect(
      migrateDerivedKnowledgePublicationSettings({
        ...target,
        allowedRoots: ["docs/", ".lervo/knowledge/"],
      }),
    ).toEqual({ ...target, scope: "delegation" });
    const narrowed = { ...target, allowedRoots: ["docs/"] };
    expect(migrateDerivedKnowledgePublicationSettings(narrowed)).toBe(narrowed);
  });
});

describe("knowledge publication scope", () => {
  it("follows the active delegation's canonical and normalization roots", async () => {
    const root = await checkout(delegation());
    const scope = await loadKnowledgePublicationScope(
      root,
      { ...target, scope: "delegation" },
      now,
    );
    expect(scope).toEqual({
      source: "delegation",
      roots: ["docs", "README.md", "AGENTS.md", ".agents/skills", "apps/site/README.md"],
    });
    for (const path of [
      "README.md",
      "AGENTS.md",
      ".agents/skills/review/SKILL.md",
      "apps/site/README.md",
      "docs/specs/runtime.md",
      ".lervo/knowledge/document-normalizations/aa/record.yaml",
    ])
      expect(knowledgePublicationPathInScope(scope, path)).toBe(true);
    for (const path of ["apps/app/CHANGELOG.md", "src/index.ts", "README.md.bak"])
      expect(knowledgePublicationPathInScope(scope, path)).toBe(false);
  });

  it("admits only Lervo-managed knowledge state without an active delegation", async () => {
    const expired = await checkout(delegation({ expiresAt: "2026-10-05T00:00:00.000Z" }));
    const revoked = await checkout(delegation({ state: "revoked" }));
    const absent = await checkout();
    for (const root of [expired, revoked, absent]) {
      const scope = await loadKnowledgePublicationScope(
        root,
        { ...target, scope: "delegation" },
        now,
      );
      expect(scope).toEqual({ source: "delegation", roots: [] });
      expect(knowledgePublicationPathInScope(scope, "docs/runtime.md")).toBe(false);
      expect(knowledgePublicationPathInScope(scope, ".lervo/knowledge/policy.yaml")).toBe(true);
    }
  });

  it("lets the last change decide: a repair commit passes, tool-owned paths never do", async () => {
    const root = await checkout(delegation());
    const scope = { source: "delegation" as const, roots: ["docs", "README.md"] };
    const offending = commit("a", ["apps/app/CHANGELOG.md", "src/tool.ts", "docs/a.md"]);
    const repair = commit(
      "b",
      ["src/tool.ts"],
      `Restored.\n\nLervo-Publication-Repair: ${offending.sha}`,
    );
    expect(
      await knowledgePublicationViolations({
        repositoryRoot: root,
        commits: [offending, repair],
        scope,
        toolGenerated: new Set(["apps/app/CHANGELOG.md"]),
      }),
    ).toEqual([{ path: "apps/app/CHANGELOG.md", reason: "tool_generated", commit: offending.sha }]);
    expect(
      await knowledgePublicationViolations({
        repositoryRoot: root,
        commits: [commit("c", ["docs/CHANGELOG.md"])],
        scope,
        toolGenerated: new Set(["docs/CHANGELOG.md"]),
      }),
    ).toEqual([{ path: "docs/CHANGELOG.md", reason: "tool_generated", commit: "c".repeat(40) }]);
  });

  it("refuses an out-of-scope freshness commit whose candidate this host cannot verify", async () => {
    const root = await checkout(delegation());
    const freshness = commit(
      "d",
      ["src/notes.md"],
      `Lervo-Freshness-Candidate: kfc_${"0".repeat(24)}`,
    );
    expect(
      await knowledgePublicationViolations({
        repositoryRoot: root,
        commits: [freshness],
        scope: { source: "delegation", roots: ["docs"] },
        toolGenerated: new Set(),
      }),
    ).toEqual([{ path: "src/notes.md", reason: "outside_scope", commit: freshness.sha }]);
  });
});

describe("knowledge publication repair event", () => {
  it("records a schema-valid, path-free event once per repair commit", () => {
    const appended: { type: string; eventId: string; payload: unknown }[] = [];
    const storage = {
      events: {
        get: (eventId: string) => appended.find((event) => event.eventId === eventId) ?? null,
        append: (event: { type: string; eventId: string; payload: unknown }) =>
          appended.push(event),
      },
      manifest: { projectId: "prj_publication_scope" },
      writableEventSchemaVersion: 4,
    } as unknown as Parameters<typeof recordKnowledgePublicationRepair>[0];
    const repair = {
      repairCommit: "a".repeat(40),
      repairedCommits: ["b".repeat(40)],
      toolGeneratedPathCount: 3,
      outsideScopePathCount: 1,
      normalizationPathCount: 2,
      pathSetHash: hash("6"),
      hostHash: hash("7"),
      occurredAt: now.toISOString(),
    };
    expect(recordKnowledgePublicationRepair(storage, repair)).toBe(true);
    expect(recordKnowledgePublicationRepair(storage, repair)).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0]!.type).toBe("knowledge.publication.repaired");
    expect(
      validateSchema("knowledgePublicationRepairedEventPayload", appended[0]!.payload),
    ).toMatchObject({ valid: true });
    expect(
      validateSchema("knowledgePublicationRepairedEventPayload", {
        ...repair,
        paths: ["apps/app/CHANGELOG.md"],
      }),
    ).toMatchObject({ valid: false });
    expect(
      recordKnowledgePublicationRepair({ ...storage, writableEventSchemaVersion: 3 }, repair),
    ).toBe(false);
  });
});

describe("knowledge publication restore point", () => {
  const lervo = "knowledge@lervo.invalid";
  const entry = (sha: string, parent: string, email = lervo, body = "") => ({
    sha,
    parents: [parent],
    authorEmail: email,
    committerEmail: email,
    body,
  });

  it("restores a tool-owned path to the content before Lervo's run of changes", () => {
    expect(
      knowledgePublicationRestorePoint({
        history: [entry("c3", "c2"), entry("c2", "c1"), entry("c1", "c0", "bot@example.com")],
        complete: true,
        reason: "tool_generated",
        base: "c3",
        unpublished: new Set(),
      }),
    ).toEqual({ status: "restore", restoreFrom: "c1", undoes: ["c3", "c2"] });
  });

  it("never undoes a newer commit by a person or a tool, and recognizes a finished repair", () => {
    expect(
      knowledgePublicationRestorePoint({
        history: [entry("c3", "c2", "dev@example.com"), entry("c2", "c1")],
        complete: true,
        reason: "tool_generated",
        base: "c3",
        unpublished: new Set(),
      }),
    ).toEqual({ status: "current" });
    expect(
      knowledgePublicationRestorePoint({
        history: [entry("c3", "c2", "dev@example.com"), entry("c2", "c1")],
        complete: true,
        reason: "outside_scope",
        base: "c1",
        unpublished: new Set(["c3", "c2"]),
      }),
    ).toEqual({ status: "blocked", blocker: "developer_change" });
    expect(
      knowledgePublicationRestorePoint({
        history: [
          entry("c4", "c3", lervo, `Lervo-Publication-Repair: ${"c3".repeat(20)}`),
          entry("c3", "c2"),
        ],
        complete: true,
        reason: "outside_scope",
        base: "c2",
        unpublished: new Set(["c4", "c3"]),
      }),
    ).toEqual({ status: "current" });
  });

  it("undoes only unpublished changes of an out-of-scope path and leaves freshness to its owner", () => {
    expect(
      knowledgePublicationRestorePoint({
        history: [entry("c3", "c2"), entry("c2", "c1"), entry("c1", "c0", "dev@example.com")],
        complete: true,
        reason: "outside_scope",
        base: "c2",
        unpublished: new Set(["c3"]),
      }),
    ).toEqual({ status: "restore", restoreFrom: "c2", undoes: ["c3"] });
    expect(
      knowledgePublicationRestorePoint({
        history: [entry("c3", "c2", lervo, "Lervo-Freshness-Candidate: kfc_x")],
        complete: true,
        reason: "outside_scope",
        base: "c2",
        unpublished: new Set(["c3"]),
      }),
    ).toEqual({ status: "blocked", blocker: "reviewed_freshness" });
  });

  it("blocks instead of guessing when Lervo's run reaches past the history it read", () => {
    expect(
      knowledgePublicationRestorePoint({
        history: [entry("c2", "c1"), entry("c1", "c0")],
        complete: false,
        reason: "tool_generated",
        base: null,
        unpublished: null,
      }),
    ).toEqual({ status: "blocked", blocker: "history_unavailable" });
  });
});
