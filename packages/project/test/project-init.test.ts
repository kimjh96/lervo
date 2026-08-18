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
  RovenInitError,
} from "../src/index.js";

const temporaryRoots: string[] = [];

async function temporaryRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "roven-init-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Roven project initialization", () => {
  it("uses one dry-run plan for apply and becomes idempotent", async () => {
    const root = await temporaryRepository();
    const plan = await createInitPlan({
      root,
      name: "sample-project",
      now: new Date("2026-08-18T00:00:00Z"),
      projectId: "prj_01234567",
    });

    expect(plan.status).toBe("ready");
    await expect(readFile(resolve(root, ".roven/project.yaml"), "utf8")).rejects.toThrow();

    const result = await applyInitPlan(plan);
    expect(result.created).toContain(".roven/project.yaml");
    expect(await loadProjectManifest(root)).toEqual(plan.projectManifest);

    const secondPlan = await createInitPlan({ root });
    expect(secondPlan.status).toBe("ready");
    expect(secondPlan.projectManifest?.projectId).toBe("prj_01234567");
    expect(secondPlan.operations.every((operation) => operation.action === "unchanged")).toBe(true);
    expect((await applyInitPlan(secondPlan)).created).toEqual([]);
  });

  it("preserves existing user documents byte for byte", async () => {
    const root = await temporaryRepository();
    const documents = new Map([
      ["README.md", "# 사용자 문서\n\n문단과 공백을 그대로 둡니다.\n"],
      ["AGENTS.md", "사용자가 작성한 지침입니다.\n"],
      ["CLAUDE.md", "기존 Claude 설정입니다.\n"],
    ]);
    for (const [path, content] of documents) {
      await writeFile(resolve(root, path), content, "utf8");
    }

    await applyInitPlan(
      await createInitPlan({ root, projectId: "prj_01234567" }),
    );

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

  it("blocks the whole plan instead of overwriting an invalid manifest", async () => {
    const root = await temporaryRepository();
    await writeFile(resolve(root, ".roven"), "user-owned file\n", "utf8");

    const plan = await createInitPlan({ root, projectId: "prj_01234567" });

    expect(plan.status).toBe("blocked");
    await expect(applyInitPlan(plan)).rejects.toBeInstanceOf(RovenInitError);
    await expect(readFile(resolve(root, ".roven"), "utf8")).resolves.toBe("user-owned file\n");
  });

  it("does not create sibling files when an existing project manifest is invalid", async () => {
    const root = await temporaryRepository();
    await mkdir(resolve(root, ".roven"));
    await writeFile(
      resolve(root, ".roven/project.yaml"),
      "schemaVersion: 1\nprojectId: invalid\n",
      "utf8",
    );

    const plan = await createInitPlan({ root, projectId: "prj_01234567" });

    expect(plan.status).toBe("blocked");
    await expect(applyInitPlan(plan)).rejects.toThrow("계약에 맞지 않습니다");
    await expect(access(resolve(root, ".roven/documents.yaml"))).rejects.toThrow();
    await expect(readFile(resolve(root, ".roven/project.yaml"), "utf8")).resolves.toBe(
      "schemaVersion: 1\nprojectId: invalid\n",
    );
  });

  it("stops when a create target changes after planning", async () => {
    const root = await temporaryRepository();
    const plan = await createInitPlan({ root, projectId: "prj_01234567" });
    await writeFile(resolve(root, ".roven"), "raced file\n", "utf8");

    await expect(applyInitPlan(plan)).rejects.toThrow("계획 이후 생성");
    await expect(readFile(resolve(root, ".roven"), "utf8")).resolves.toBe("raced file\n");
  });

  it("rejects a forged plan that writes outside the managed .roven tree", async () => {
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
    await expect(access(resolve(root, ".roven"))).rejects.toThrow();
  });

  it("does not leave a staging tree after atomic fresh initialization", async () => {
    const root = await temporaryRepository();
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_01234567" }));
    expect((await readdir(root)).filter((name) => name.startsWith(".roven.init-"))).toEqual([]);
  });

  it("publishes no partial .roven tree when staging fails midway", async () => {
    const root = await temporaryRepository();
    const plan = await createInitPlan({ root, projectId: "prj_01234567" });
    plan.operations.push({
      kind: "file",
      path: ".roven/directory-that-was-not-created/file.txt",
      action: "create",
      content: "must not be published",
    });

    await expect(applyInitPlan(plan)).rejects.toThrow();
    await expect(access(resolve(root, ".roven"))).rejects.toThrow();
    expect((await readdir(root)).filter((name) => name.startsWith(".roven.init-"))).toEqual([]);
  });

  it("does not follow a .roven symbolic link during planning", async () => {
    const root = await temporaryRepository();
    const outside = await temporaryRepository();
    await writeFile(resolve(outside, "project.yaml"), "outside: secret\n", "utf8");
    await symlink(outside, resolve(root, ".roven"));

    const plan = await createInitPlan({ root, projectId: "prj_01234567" });

    expect(plan.status).toBe("blocked");
    expect(plan.projectManifest).toBeNull();
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toEqual(
      expect.objectContaining({ path: ".roven", action: "conflict" }),
    );
    await expect(loadProjectManifest(root)).rejects.toThrow("심볼릭 링크일 수 없습니다");
  });
});
