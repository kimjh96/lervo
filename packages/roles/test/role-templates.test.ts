import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureTemplateRole, isRoleTemplateId, resolveRoleContract } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("role templates", () => {
  it("writes product-owner once, as a repository role that resolves", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-role-template-"));
    roots.push(root);
    expect(await ensureTemplateRole(root, "product-owner")).toBe("written");
    const contract = await resolveRoleContract(root, "product-owner");
    expect(contract.sourceKind).toBe("repository");
    const bytes = await readFile(resolve(root, ".lervo/roles/product-owner.json"), "utf8");
    expect(await ensureTemplateRole(root, "product-owner")).toBe("present");
    expect(await readFile(resolve(root, ".lervo/roles/product-owner.json"), "utf8")).toBe(bytes);
  });

  it("resolves a role the main checkout keeps in a linked worktree, and writes none there", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-role-template-"));
    roots.push(root);
    // A main checkout and a linked worktree, as `git worktree add` lays out their Git files.
    const main = resolve(root, "main");
    const worktree = resolve(root, "work");
    await mkdir(resolve(main, ".git/worktrees/work"), { recursive: true });
    await writeFile(resolve(main, ".git/worktrees/work/commondir"), "../..\n");
    await mkdir(worktree);
    await writeFile(resolve(worktree, ".git"), `gitdir: ${resolve(main, ".git/worktrees/work")}\n`);
    expect(await ensureTemplateRole(main, "product-owner")).toBe("written");
    const kept = await resolveRoleContract(main, "product-owner");
    // The same source resolves to the same contract, so agents hired in either stay bound.
    expect((await resolveRoleContract(worktree, "product-owner")).contractHash).toBe(
      kept.contractHash,
    );
    expect(await ensureTemplateRole(worktree, "product-owner")).toBe("present");
    await expect(access(resolve(worktree, ".lervo/roles/product-owner.json"))).rejects.toThrow();
  });

  it("writes nothing for a built-in role or an unknown one", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-role-template-"));
    roots.push(root);
    expect(isRoleTemplateId("developer")).toBe(false);
    expect(await ensureTemplateRole(root, "developer")).toBe("not_template");
    expect(await ensureTemplateRole(root, "chief-of-nothing")).toBe("not_template");
  });
});
