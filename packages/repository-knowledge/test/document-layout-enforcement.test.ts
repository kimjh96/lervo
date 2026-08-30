import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  authorizeCurrentRepositoryDocumentLayout,
  builtinProviderDocumentSurfaces,
  contentBoundRewriterDescriptor,
  contentBoundTransformDescriptor,
  evaluateCurrentRepositoryDocumentLayout,
  inspectRepositoryDocumentRewriters,
  providerSurfaceRoles,
  sha256,
} from "../src/index.js";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-layout-external-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_external_layout" }));
  await writeFile(resolve(root, "README.md"), "# External fixture\n");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository document layout enforcement", () => {
  it("keeps exact provider paths inside provider descriptors and exposes neutral roles", () => {
    expect(builtinProviderDocumentSurfaces.map((item) => item.provider)).toEqual([
      "codex",
      "claude",
    ]);
    expect(providerSurfaceRoles()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ roleId: "canonical_agent_instruction", path: "AGENTS.md" }),
        expect.objectContaining({ roleId: "provider_instruction_bridge", path: "CLAUDE.md" }),
      ]),
    );
  });

  it("accepts a structurally different external repository and an explicit adapter", async () => {
    const root = await repository();
    const operation = {
      path: "guides/getting-started.mdx",
      action: "create" as const,
      desiredHash: sha256("# Start\n"),
    };
    const evaluation = await evaluateCurrentRepositoryDocumentLayout({
      repositoryRoot: root,
      operations: [operation],
    });
    expect(evaluation.status).toBe("bounded");
    await expect(
      authorizeCurrentRepositoryDocumentLayout({ repositoryRoot: root, operations: [operation] }),
    ).resolves.toMatchObject({ schemaVersion: 1, evaluatorVersion: 1 });

    const transform = contentBoundTransformDescriptor({
      rewriterId: "fixture-markdown-transform",
      version: "1",
      scopePaths: ["guides"],
      configurationHash: sha256("fixture-config"),
      lockHash: sha256("fixture-lock"),
      maximumObservations: 8,
    });
    const rewriters = await inspectRepositoryDocumentRewriters({
      repositoryRoot: root,
      rewriters: [transform],
      dryRuns: { [transform.rewriterId]: [] },
    });
    expect(rewriters.status).toBe("compatible");
    expect(rewriters.ownership).toEqual([]);
    expect(transform.compatibility.kind).toBe("content_bound_dry_run");
  });

  it("uses one ownership adapter contract for every rewrite capability", async () => {
    const root = await repository();
    const descriptors = (["format", "autofix", "transform", "generate"] as const).map(
      (capability) =>
        contentBoundRewriterDescriptor({
          rewriterId: `fixture-${capability}`,
          version: "1",
          capability,
          scopePaths: ["."],
          configurationHash: sha256(`config-${capability}`),
          lockHash: sha256(`lock-${capability}`),
          maximumObservations: 8,
        }),
    );
    const result = await inspectRepositoryDocumentRewriters({
      repositoryRoot: root,
      rewriters: descriptors,
      dryRuns: Object.fromEntries(descriptors.map((item) => [item.rewriterId, []])),
    });

    expect(result.status).toBe("compatible");
    expect(descriptors.map((item) => item.capability)).toEqual([
      "format",
      "autofix",
      "transform",
      "generate",
    ]);
  });

  it("blocks repository capacity before apply", async () => {
    const root = await repository();
    const operations = Array.from({ length: 4096 }, (_, index) => ({
      path: `catalog/${String(index).padStart(4, "0")}.md`,
      action: "create" as const,
      desiredHash: sha256(`# ${index}\n`),
    }));
    await expect(
      authorizeCurrentRepositoryDocumentLayout({ repositoryRoot: root, operations }),
    ).rejects.toMatchObject({ code: "document_directory_file_capacity_exceeded" });
  });
});
