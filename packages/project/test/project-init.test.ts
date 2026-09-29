import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyInitPlan,
  createInitPlan,
  loadProjectManifest,
  LervoInitError,
} from "../src/index.js";

const temporaryRoots: string[] = [];

async function temporaryRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-init-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Lervo project initialization", () => {
  it("uses one dry-run plan for apply and becomes idempotent", async () => {
    const root = await temporaryRepository();
    const plan = await createInitPlan({
      root,
      name: "sample-project",
      now: new Date("2026-08-18T00:00:00Z"),
      projectId: "prj_01234567",
    });

    expect(plan.status).toBe("ready");
    await expect(readFile(resolve(root, ".lervo/project.yaml"), "utf8")).rejects.toThrow();

    const result = await applyInitPlan(plan);
    expect(result.created).toContain(".lervo/project.yaml");
    expect(result.created).toContain(".lervo/knowledge/policy.yaml");
    expect(result.created).toContain(".lervo/knowledge/document-layout.yaml");
    expect(result.created).toEqual(
      expect.arrayContaining([".lervo", ".lervo/knowledge", ".lervo/.gitignore"]),
    );
    expect(await readFile(resolve(root, ".lervo/.gitignore"), "utf8")).toBe(
      "data/\nstate/\nknowledge/convergence-delegation.json\n",
    );
    expect(result.created).toHaveLength(7);
    expect(await readFile(resolve(root, ".gitignore"), "utf8")).toContain("docs/knowledge/");
    await expect(access(resolve(root, ".lervo/documents"))).rejects.toThrow();
    await expect(access(resolve(root, ".lervo/verifications"))).rejects.toThrow();
    await expect(access(resolve(root, ".lervo/generated"))).rejects.toThrow();
    await expect(access(resolve(root, ".lervo/state"))).rejects.toThrow();
    expect(await loadProjectManifest(root)).toEqual(plan.projectManifest);
    const knowledgePolicy = await readFile(resolve(root, ".lervo/knowledge/policy.yaml"), "utf8");
    expect(knowledgePolicy).toContain("  - .changes/**\n");
    expect(knowledgePolicy).toContain("  - '**/Pods/**'\n");
    expect(knowledgePolicy).toContain("  - '**/.cxx/**'\n");
    expect(knowledgePolicy).toContain("  - '**/build-device/**'\n");
    expect(knowledgePolicy).toContain("  language: en\n");
    expect(knowledgePolicy).toContain("  maxTotalBytes: 67108864\n");
    const decisionTaxonomy = await readFile(
      resolve(root, ".lervo/knowledge/document-layout.yaml"),
      "utf8",
    );
    expect(decisionTaxonomy).toContain("decisionRoot: docs/decisions\n");
    expect(decisionTaxonomy).toContain("maxLeafDocuments: 24\n");
    expect(decisionTaxonomy).toContain("id: architecture\n");
    expect(decisionTaxonomy).not.toContain("managed provider");
    expect(decisionTaxonomy).not.toContain("id: foundation\n");

    const secondPlan = await createInitPlan({ root });
    expect(secondPlan.status).toBe("ready");
    expect(secondPlan.projectManifest?.projectId).toBe("prj_01234567");
    expect(secondPlan.operations.every((operation) => operation.action === "unchanged")).toBe(true);
    expect((await applyInitPlan(secondPlan)).created).toEqual([]);
  });

  it("preserves existing user documents byte for byte", async () => {
    const root = await temporaryRepository();
    const documents = new Map([
      ["README.md", "# User document\n\nPreserve paragraphs and whitespace exactly.\n"],
      ["AGENTS.md", "User-authored instructions.\n"],
      ["CLAUDE.md", "Existing Claude configuration.\n"],
    ]);
    for (const [path, content] of documents) {
      await writeFile(resolve(root, path), content, "utf8");
    }

    await applyInitPlan(await createInitPlan({ root, projectId: "prj_01234567" }));

    for (const [path, content] of documents) {
      await expect(readFile(resolve(root, path), "utf8")).resolves.toBe(content);
    }
  });

  it("preserves a valid existing project identity", async () => {
    const root = await temporaryRepository();
    const firstPlan = await createInitPlan({
      root,
      projectId: "prj_existing1",
      now: new Date("2026-08-18T00:00:00Z"),
    });
    await applyInitPlan(firstPlan);

    const nextPlan = await createInitPlan({
      root,
      name: "ignored-name",
      projectId: "prj_different1",
    });

    expect(nextPlan.projectManifest?.projectId).toBe("prj_existing1");
    expect(nextPlan.projectManifest?.name).not.toBe("ignored-name");
  });

  it("blocks an invalid existing repository knowledge policy", async () => {
    const root = await temporaryRepository();
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_01234567" }));
    await writeFile(resolve(root, ".lervo/knowledge/policy.yaml"), "schemaVersion: 2\n");

    const plan = await createInitPlan({ root });
    expect(plan.status).toBe("blocked");
    expect(plan.operations).toContainEqual(
      expect.objectContaining({ path: ".lervo/knowledge/policy.yaml", action: "conflict" }),
    );
    await expect(applyInitPlan(plan)).rejects.toMatchObject({ code: "init_conflict" });
  });

  it("blocks an invalid existing decision taxonomy", async () => {
    const root = await temporaryRepository();
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_01234567" }));
    await writeFile(
      resolve(root, ".lervo/knowledge/document-layout.yaml"),
      "schemaVersion: 1\nroutes: []\n",
    );

    const plan = await createInitPlan({ root });
    expect(plan.status).toBe("blocked");
    expect(plan.operations).toContainEqual(
      expect.objectContaining({
        path: ".lervo/knowledge/document-layout.yaml",
        action: "conflict",
      }),
    );
    await expect(applyInitPlan(plan)).rejects.toMatchObject({ code: "init_conflict" });
  });

  it("blocks the whole plan instead of overwriting an invalid manifest", async () => {
    const root = await temporaryRepository();
    await writeFile(resolve(root, ".lervo"), "user-owned file\n", "utf8");

    const plan = await createInitPlan({ root, projectId: "prj_01234567" });

    expect(plan.status).toBe("blocked");
    await expect(applyInitPlan(plan)).rejects.toBeInstanceOf(LervoInitError);
    await expect(readFile(resolve(root, ".lervo"), "utf8")).resolves.toBe("user-owned file\n");
  });

  it("does not initialize beside a previous-brand managed directory", async () => {
    const root = await temporaryRepository();
    await mkdir(resolve(root, ".roven"));
    await writeFile(resolve(root, ".roven/project.yaml"), "previous state\n", "utf8");

    const plan = await createInitPlan({ root, projectId: "prj_01234567" });

    expect(plan.status).toBe("blocked");
    expect(plan.projectManifest).toBeNull();
    expect(plan.operations).toEqual([
      expect.objectContaining({ path: ".lervo", action: "conflict" }),
    ]);
    await expect(applyInitPlan(plan)).rejects.toBeInstanceOf(LervoInitError);
    await expect(access(resolve(root, ".lervo"))).rejects.toThrow();
    await expect(readFile(resolve(root, ".roven/project.yaml"), "utf8")).resolves.toBe(
      "previous state\n",
    );
  });

  it("does not create sibling files when an existing project manifest is invalid", async () => {
    const root = await temporaryRepository();
    await mkdir(resolve(root, ".lervo"));
    await writeFile(
      resolve(root, ".lervo/project.yaml"),
      "schemaVersion: 1\nprojectId: invalid\n",
      "utf8",
    );

    const plan = await createInitPlan({ root, projectId: "prj_01234567" });

    expect(plan.status).toBe("blocked");
    await expect(applyInitPlan(plan)).rejects.toThrow("does not satisfy the contract");
    await expect(access(resolve(root, ".lervo/documents.yaml"))).rejects.toThrow();
    await expect(readFile(resolve(root, ".lervo/project.yaml"), "utf8")).resolves.toBe(
      "schemaVersion: 1\nprojectId: invalid\n",
    );
  });

  it("preserves an unused verification path without eagerly claiming the feature directory", async () => {
    const root = await temporaryRepository();
    await mkdir(resolve(root, ".lervo"));
    await writeFile(resolve(root, ".lervo/verifications"), "user-owned bytes\n", "utf8");

    const plan = await createInitPlan({ root, projectId: "prj_01234567" });

    expect(plan.status).toBe("ready");
    expect(plan.operations.some((operation) => operation.path === ".lervo/verifications")).toBe(
      false,
    );
    await applyInitPlan(plan);
    await expect(readFile(resolve(root, ".lervo/verifications"), "utf8")).resolves.toBe(
      "user-owned bytes\n",
    );
    await expect(access(resolve(root, ".lervo/project.yaml"))).resolves.toBeUndefined();
  });

  it("stops when a create target changes after planning", async () => {
    const root = await temporaryRepository();
    const plan = await createInitPlan({ root, projectId: "prj_01234567" });
    await writeFile(resolve(root, ".lervo"), "raced file\n", "utf8");

    await expect(applyInitPlan(plan)).rejects.toThrow("was created after the plan was generated");
    await expect(readFile(resolve(root, ".lervo"), "utf8")).resolves.toBe("raced file\n");
  });

  it("rejects a forged plan that writes outside the managed .lervo tree", async () => {
    const root = await temporaryRepository();
    const plan = await createInitPlan({ root, projectId: "prj_01234567" });
    plan.operations.push({
      kind: "file",
      path: "user.txt",
      action: "create",
      content: "escaped",
    });

    await expect(applyInitPlan(plan)).rejects.toMatchObject({ code: "unsafe_path" });
    await expect(access(resolve(root, "user.txt"))).rejects.toThrow();
    await expect(access(resolve(root, ".lervo"))).rejects.toThrow();
  });

  it("does not leave a staging tree after atomic fresh initialization", async () => {
    const root = await temporaryRepository();
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_01234567" }));
    expect((await readdir(root)).filter((name) => name.startsWith(".lervo.init-"))).toEqual([]);
  });

  it("publishes no partial .lervo tree when staging fails midway", async () => {
    const root = await temporaryRepository();
    const plan = await createInitPlan({ root, projectId: "prj_01234567" });
    plan.operations.push({
      kind: "file",
      path: ".lervo/directory-that-was-not-created/file.txt",
      action: "create",
      content: "must not be published",
    });

    await expect(applyInitPlan(plan)).rejects.toThrow();
    await expect(access(resolve(root, ".lervo"))).rejects.toThrow();
    expect((await readdir(root)).filter((name) => name.startsWith(".lervo.init-"))).toEqual([]);
  });

  it("does not follow a .lervo symbolic link during planning", async () => {
    const root = await temporaryRepository();
    const outside = await temporaryRepository();
    await writeFile(resolve(outside, "project.yaml"), "outside: secret\n", "utf8");
    await symlink(outside, resolve(root, ".lervo"));

    const plan = await createInitPlan({ root, projectId: "prj_01234567" });

    expect(plan.status).toBe("blocked");
    expect(plan.projectManifest).toBeNull();
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toEqual(
      expect.objectContaining({ path: ".lervo", action: "conflict" }),
    );
    await expect(loadProjectManifest(root)).rejects.toThrow("cannot be a symbolic link");
  });
});
