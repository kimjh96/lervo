import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  defaultRepositoryKnowledgePolicy,
  serializeRepositoryKnowledgePolicy,
} from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import { loadCanonicalReviewContext } from "../src/knowledge-review-context.js";

const roots: string[] = [];

async function fixtureFile(root: string, path: string, content: string): Promise<string> {
  await mkdir(resolve(root, path, ".."), { recursive: true });
  await writeFile(resolve(root, path), content);
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("canonical review context", () => {
  it("uses available source paths when a planned generated document is not present yet", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "Repository instructions.\n");
    await fixtureFile(root, "docs/specs/runtime.md", "# Runtime\nLocal execution.\n");
    let query = "";
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: ["docs/knowledge/documentation.md", "docs/specs/runtime.md"],
      queryKnowledge: async (input) => {
        query = input.query;
        return { hits: [] };
      },
    });
    expect(query).toContain("runtime");
    expect(documents.map((document) => document.path)).toEqual(["AGENTS.md"]);
  });

  it("loads direct source links before broad recommendations", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "Repository instructions.\n");
    await fixtureFile(root, "README.md", "[General](docs/general.md)\n");
    await fixtureFile(root, "apps/cli/README.md", "[CLI authority](../../docs/cli-authority.md)\n");
    const cliAuthority = "docs/cli-authority.md";
    const general = "docs/general.md";
    await fixtureFile(root, cliAuthority, "Exact CLI contract.\n");
    await fixtureFile(root, general, "General contract.\n");
    const hits: { path: string; contentHash: string }[] = [];
    for (let index = 0; index < 12; index += 1) {
      const path = `docs/broad-${index}.md`;
      hits.push({ path, contentHash: await fixtureFile(root, path, "Broad context.\n") });
    }
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: ["README.md", "apps/cli/README.md"],
      queryKnowledge: async () => ({ hits }),
    });
    expect(documents.map((document) => document.path).slice(0, 3)).toEqual([
      "AGENTS.md",
      cliAuthority,
      general,
    ]);
  });

  it("retrieves the exact owning contract for a repository-root dotfile", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "Repository instructions.\n");
    await fixtureFile(root, ".editorconfig", "root = true\n");
    const contract = "docs/foundation/editor-configuration.md";
    const contentHash = await fixtureFile(root, contract, "# Editor configuration\nRoot lookup.\n");
    const queries: string[] = [];
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: [".editorconfig"],
      queryKnowledge: async (input) => {
        queries.push(input.query);
        return { hits: [{ path: contract, contentHash }] };
      },
    });
    expect(queries[0]).toBe("editorconfig");
    expect(documents.map((document) => document.path)).toEqual(["AGENTS.md", contract]);
  });

  it("prioritizes an integrated repository-change adapter contract", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "Repository instructions.\n");
    const source = "apps/cli/src/managed-run-repository-change.ts";
    await fixtureFile(root, source, "export const observed = true;\n");
    const contract = "docs/specifications/execution/repository-change-adapter-boundaries.md";
    const content = "The CLI adapters preserve caller-owned transaction boundaries.\n";
    const contentHash = await fixtureFile(root, contract, content);
    const queries: string[] = [];
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: [source],
      queryKnowledge: async (input) => {
        queries.push(input.query);
        return input.query === "repository change adapter boundaries"
          ? { hits: [{ path: contract, contentHash }] }
          : { hits: [] };
      },
    });
    expect(queries[0]).toBe("repository change adapter boundaries");
    expect(documents.map((document) => document.path)).toEqual(["AGENTS.md", contract]);
    expect(documents[1]?.content).toBe(content);
  });

  it("loads the complete terminal prompt assembly contract before generic context", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "Repository instructions.\n");
    const source = "apps/cli/src/terminal-prompt-context.ts";
    await fixtureFile(root, source, "export const prompt = true;\n");
    const contract =
      "docs/specifications/execution/stage-observation-and-performance/prompt-assembly.md";
    const content = "Terminal declarations and portable-skill eligibility remain explicit.\n";
    const contentHash = await fixtureFile(root, contract, content);
    const queries: string[] = [];
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: [source],
      queryKnowledge: async (input) => {
        queries.push(input.query);
        return input.query === "prompt assembly emitted completion instructions"
          ? { hits: [{ path: contract, contentHash }] }
          : { hits: [] };
      },
    });
    expect(queries[0]).toBe("prompt assembly emitted completion instructions");
    expect(documents.map((document) => document.path)).toEqual(["AGENTS.md", contract]);
    expect(documents[1]?.content).toBe(content);
  });

  it("reserves source-specific event authority before mixed batch recommendations", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "Repository instructions.\n");
    const workerSource = "apps/cli/src/knowledge-worker-command.ts";
    const reservationSource = "apps/cli/src/managed-execution-reservation.ts";
    await fixtureFile(root, workerSource, "export const worker = true;\n");
    await fixtureFile(
      root,
      reservationSource,
      'transaction.append({ type: "managed.execution.reserved" });\n',
    );
    const eventContract =
      "docs/specifications/execution/outcome-supervision/contracts/events/idempotency-and-recovery.md";
    const eventHash = await fixtureFile(
      root,
      eventContract,
      "The managed.execution.reserved event contains executionKey and requestHash only.\n",
    );
    const workerContract = "docs/worker.md";
    const workerHash = await fixtureFile(root, workerContract, "Worker contract.\n");
    const managedContract = "docs/managed-execution.md";
    const managedHash = await fixtureFile(
      root,
      managedContract,
      "Over-bound history fails closed.\n",
    );
    const broad = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const path = `docs/broad-${index}.md`;
        return { path, contentHash: await fixtureFile(root, path, "Broad context.\n") };
      }),
    );
    const queries: string[] = [];
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: [workerSource, reservationSource],
      queryKnowledge: async (input) => {
        queries.push(input.query);
        if (input.query.includes("idempotency recovery"))
          return { hits: [{ path: eventContract, contentHash: eventHash }] };
        if (input.query === "knowledge worker command cli wrappers")
          return { hits: [{ path: workerContract, contentHash: workerHash }] };
        if (input.query === "knowledge worker command") return { hits: [] };
        if (input.query === "managed execution reservation")
          return { hits: [{ path: managedContract, contentHash: managedHash }] };
        return { hits: broad };
      },
    });
    expect(queries[0]).toBe("managed execution reservation event idempotency recovery");
    expect(queries).toContain("knowledge worker command cli wrappers");
    expect(documents.map((document) => document.path).slice(0, 4)).toEqual([
      "AGENTS.md",
      eventContract,
      workerContract,
      managedContract,
    ]);
    expect(documents).toHaveLength(20);
  });

  it("loads a test's linked contract before unrelated recommendation children", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "Repository instructions.\n");
    const source = "apps/cli/test/document-normalization-procedure.test.ts";
    await fixtureFile(root, source, 'it("normalizes documents", () => {});\n');
    const parent = "docs/specs/document-content-normalization.md";
    const contract = "docs/specs/document-content-normalization/contract.md";
    const parentHash = await fixtureFile(
      root,
      parent,
      "[Normalization contract](document-content-normalization/contract.md)\n",
    );
    await fixtureFile(root, contract, "Every repository-changing turn advances one batch.\n");
    const broad = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const path = `docs/broad-${index}.md`;
        return { path, contentHash: await fixtureFile(root, path, "Unrelated context.\n") };
      }),
    );
    const queries: string[] = [];
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: [source],
      queryKnowledge: async (input) => {
        queries.push(input.query);
        return input.query === "document normalization procedure contract"
          ? { hits: [{ path: parent, contentHash: parentHash }] }
          : { hits: broad };
      },
    });
    expect(queries[0]).toBe("document normalization procedure contract");
    expect(documents.map((document) => document.path)).toContain(contract);
    expect(documents.find((document) => document.path === contract)?.content).toContain(
      "Every repository-changing turn",
    );
  });

  it("keeps ranked release evidence for a pull request template source", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "Repository instructions.\n");
    await fixtureFile(
      root,
      ".github/PULL_REQUEST_TEMPLATE.md",
      [
        "## Summary",
        "## Scope and authority",
        "## Contract and architecture",
        "## Release impact",
        "A release PR never grants npm publication authority.",
        "## Verification",
        "## Knowledge and documentation",
        "## Risk and recovery",
        "## Checklist",
        "Read `docs/foundation/code-convention.md`.",
      ].join("\n"),
    );
    const releasePath = "docs/distribution/cli-version-management.md";
    const hits = [
      {
        path: releasePath,
        contentHash: await fixtureFile(
          root,
          releasePath,
          "A release PR grants no publication authority.\n",
        ),
      },
    ];
    for (let index = 0; index < 7; index += 1) {
      const path = `docs/request-${index}.md`;
      hits.push({ path, contentHash: await fixtureFile(root, path, "Unrelated request.\n") });
    }
    let query = "";
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: [".github/PULL_REQUEST_TEMPLATE.md"],
      queryKnowledge: async (input) => {
        query = input.query;
        return { hits };
      },
    });
    expect(query).toContain("github pull request template md");
    expect(query).toContain("release impact");
    expect(query).toContain("code convention");
    expect(query).toContain("npm publication");
    expect(documents.map((document) => document.path)).toContain(releasePath);
    expect(documents).toHaveLength(9);
  });

  it("loads bounded linked child contracts beyond the recommendation window", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "Repository instructions.\n");
    const parent = "docs/reproduction.md";
    const parentContent = [
      "# Reproduction",
      "[Capture](reproduction/capture.md)",
      "[Composition](reproduction/composition.md)",
      "[Invocation](reproduction/invocation.md)",
      "[Private](reproduction/secret.md)",
      "[Unrelated](../outside.md)",
      "[Remote](https://example.com/other.md)",
    ].join("\n");
    const hits: { path: string; contentHash: string }[] = [];
    hits.push({ path: parent, contentHash: await fixtureFile(root, parent, parentContent) });
    for (let index = 0; index < 6; index += 1) {
      const path = `docs/candidate-${index}.md`;
      hits.push({ path, contentHash: await fixtureFile(root, path, `Candidate ${index}.\n`) });
    }
    for (const name of ["capture", "composition", "invocation"])
      await fixtureFile(root, `docs/reproduction/${name}.md`, `# ${name}\nExact contract.\n`);
    await fixtureFile(root, "docs/reproduction/secret.md", "Private material.\n");
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: ["src/generate.mjs"],
      queryKnowledge: async () => ({ hits }),
    });
    expect(documents.map((document) => document.path)).toEqual([
      "AGENTS.md",
      parent,
      ...Array.from({ length: 6 }, (_, index) => `docs/candidate-${index}.md`),
      "docs/reproduction/capture.md",
      "docs/reproduction/composition.md",
      "docs/reproduction/invocation.md",
    ]);
    expect(documents.slice(-3).every((document) => document.role === "canonical_candidate")).toBe(
      true,
    );
  });

  it("loads direct authorities from the source-specific contract before broad child links", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "Repository instructions.\n");
    const template = ".github/PULL_REQUEST_TEMPLATE.md";
    await fixtureFile(root, template, "## Release impact\nFollow writing_en-human.\n");
    const contract = "docs/foundation/pull-request-contract.md";
    const policy = "packages/core/src/writing-contract.ts";
    const release = "docs/decisions/release/packaging/0221-reviewed-cli-release-preparation.md";
    const hits = [
      {
        path: "docs/roadmap/v0.md",
        contentHash: await fixtureFile(root, "docs/roadmap/v0.md", "[Broad child](v0/child.md)\n"),
      },
      {
        path: contract,
        contentHash: await fixtureFile(
          root,
          contract,
          "[Policy](../../packages/core/src/writing-contract.ts)\n" +
            "[Release](../decisions/release/packaging/0221-reviewed-cli-release-preparation.md)\n",
        ),
      },
    ];
    for (let index = 0; index < 5; index += 1) {
      const path = "docs/broad-" + index + ".md";
      hits.push({ path, contentHash: await fixtureFile(root, path, "Broad context.\n") });
    }
    await fixtureFile(root, "docs/roadmap/v0/child.md", "Broad child.\n");
    await fixtureFile(root, policy, "export const writingPolicyId = 'writing_en-human';\n");
    await fixtureFile(root, release, "CLI intent exemptions.\n");
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: [template],
      queryKnowledge: async () => ({ hits }),
    });
    const paths = documents.map((document) => document.path);
    expect(paths.slice(8, 10)).toEqual([policy, release]);
    expect(paths).toContain("docs/roadmap/v0/child.md");
    expect(documents.find((document) => document.path === policy)?.role).toBe(
      "canonical_candidate",
    );
  });

  it("refuses linked context above the aggregate byte bound", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(root, "AGENTS.md", "a".repeat(120 * 1024));
    const parent = "docs/reproduction.md";
    const hits = [
      {
        path: parent,
        contentHash: await fixtureFile(
          root,
          parent,
          `[Capture](reproduction/capture.md)\n${"p".repeat(120 * 1024 - 37)}`,
        ),
      },
    ];
    for (let index = 0; index < 6; index += 1) {
      const path = `docs/candidate-${index}.md`;
      hits.push({ path, contentHash: await fixtureFile(root, path, "c".repeat(120 * 1024)) });
    }
    await fixtureFile(root, "docs/reproduction/capture.md", "b".repeat(100 * 1024));
    await expect(
      loadCanonicalReviewContext({
        repositoryRoot: root,
        sourcePaths: ["src/generate.mjs"],
        queryKnowledge: async () => ({ hits }),
      }),
    ).rejects.toMatchObject({ code: "review_context_limit_exceeded" });
  });

  it("loads directly linked canonical instructions needed to review a source", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(
      root,
      "AGENTS.md",
      "Follow [commit convention](docs/foundation/commit-convention.md).\n" +
        "Ignore [outside](../outside.md) and [remote](https://example.com/rules.md).\n",
    );
    const path = "docs/foundation/commit-convention.md";
    const contentHash = await fixtureFile(root, path, "# Commit convention\nExact range.\n");
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: [".github/workflows/commit-convention.yml"],
      queryKnowledge: async () => ({ hits: [] }),
    });
    expect(documents.map((document) => document.path)).toEqual(["AGENTS.md", path]);
    expect(documents[1]).toMatchObject({
      role: "canonical_candidate",
      contentHash,
      content: "# Commit convention\nExact range.\n",
    });
  });

  it("keeps release authorities referenced by source-relevant repository instructions", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-review-context-"));
    roots.push(root);
    await mkdir(resolve(root, ".lervo"));
    await fixtureFile(
      root,
      ".lervo/knowledge/policy.yaml",
      serializeRepositoryKnowledgePolicy(defaultRepositoryKnowledgePolicy),
    );
    await fixtureFile(
      root,
      "AGENTS.md",
      "- Release impact and preparation: `docs/distribution/cli-version-management.md`, " +
        "`docs/decisions/release/packaging/0221-reviewed-cli-release-preparation.md`\n",
    );
    const releasePaths = [
      "docs/distribution/cli-version-management.md",
      "docs/decisions/release/packaging/0221-reviewed-cli-release-preparation.md",
    ];
    for (const path of releasePaths) await fixtureFile(root, path, `# ${path}\n`);
    const hits: { path: string; contentHash: string }[] = [];
    for (let index = 0; index < 7; index += 1) {
      const path = `docs/candidate-${index}.md`;
      hits.push({ path, contentHash: await fixtureFile(root, path, `# Candidate ${index}\n`) });
    }
    const documents = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: [".github/workflows/release-preparation.yml"],
      queryKnowledge: async () => ({ hits }),
    });
    expect(documents.map((document) => document.path).slice(-2)).toEqual(releasePaths);
  });
});
