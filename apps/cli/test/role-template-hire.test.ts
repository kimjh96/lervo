import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

function io(cwd: string, stdout: string[] = [], stderr: string[] = []) {
  return {
    cwd,
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("hiring a template role", () => {
  it("writes the product-owner role on a project's first hire, then keeps it", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-role-template-"));
    roots.push(root);
    expect(await runCli(["init", "--root", root, "--name", "template-fixture"], io(root))).toBe(0);
    const rolePath = resolve(root, ".lervo/roles/product-owner.json");
    await expect(readFile(rolePath)).rejects.toThrow();

    const first: string[] = [];
    expect(
      await runCli(
        [
          "agent",
          "hire",
          "--role",
          "product-owner",
          "--name",
          "Elio",
          "--root",
          root,
          "--write",
          "--json",
        ],
        io(root, first),
      ),
    ).toBe(0);
    expect(JSON.parse(first.join(""))).toMatchObject({
      roleId: "product-owner",
      displayName: "Elio",
    });
    const written = JSON.parse(await readFile(rolePath, "utf8")) as {
      roleId: string;
      extends: unknown;
    };
    expect(written).toMatchObject({
      roleId: "product-owner",
      extends: [{ roleId: "ceo", version: "1.0.0" }],
    });

    // Hiring again keeps the file as it is.
    const before = await readFile(rolePath, "utf8");
    expect(
      await runCli(
        ["agent", "hire", "--role", "product-owner", "--root", root, "--write", "--json"],
        io(root),
      ),
    ).toBe(0);
    expect(await readFile(rolePath, "utf8")).toBe(before);
  });

  it("never replaces a product-owner role the project already wrote", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-role-template-"));
    roots.push(root);
    expect(await runCli(["init", "--root", root, "--name", "template-fixture"], io(root))).toBe(0);
    const rolePath = resolve(root, ".lervo/roles/product-owner.json");
    const own = {
      schemaVersion: 1,
      kind: "lervo_repository_role",
      roleId: "product-owner",
      version: "2.0.0",
      extends: [{ roleId: "ceo", version: "1.0.0" }],
      profile: {
        name: "Product Lead",
        description: "Leads this product.",
        requestTypes: ["product.plan"],
      },
      checks: [],
    };
    await mkdir(resolve(root, ".lervo/roles"), { recursive: true });
    await writeFile(rolePath, `${JSON.stringify(own, null, 2)}\n`);
    expect(
      await runCli(
        ["agent", "hire", "--role", "product-owner", "--root", root, "--write"],
        io(root),
      ),
    ).toBe(0);
    expect(JSON.parse(await readFile(rolePath, "utf8"))).toEqual(own);
  });

  it("leaves other unknown roles failing as before", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-role-template-"));
    roots.push(root);
    expect(await runCli(["init", "--root", root, "--name", "template-fixture"], io(root))).toBe(0);
    expect(
      await runCli(
        ["agent", "hire", "--role", "chief-of-nothing", "--root", root, "--write"],
        io(root),
      ),
    ).toBe(1);
  });
});
