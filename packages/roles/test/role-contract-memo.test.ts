import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { listRoleContracts } from "../src/index.js";
import { memoizedRoleRegistry } from "../src/role-contract-memo.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

it("resolves an unchanged registry once and hands out independent clones", () => {
  let resolutions = 0;
  const sources = new Map([["a", { source: { roleId: "a" }, path: ".lervo/roles/a.json" }]]);
  const resolve = () => {
    resolutions += 1;
    return [{ roleId: "a", definition: { profile: { name: "A" } } }] as never;
  };
  const first = memoizedRoleRegistry(sources, resolve);
  (first[0] as unknown as { definition: { profile: { name: string } } }).definition.profile.name =
    "mutated";
  const second = memoizedRoleRegistry(new Map(sources), resolve);
  expect(resolutions).toBe(1);
  expect(second[0]).toMatchObject({ definition: { profile: { name: "A" } } });
  memoizedRoleRegistry(
    new Map([["a", { source: { roleId: "a", version: "2" }, path: ".lervo/roles/a.json" }]]),
    resolve,
  );
  expect(resolutions).toBe(2);
});

it("resolves a changed repository role source again", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-role-memo-"));
  roots.push(root);
  await mkdir(resolve(root, ".lervo/roles"), { recursive: true });
  const write = (description: string) =>
    writeFile(
      resolve(root, ".lervo/roles/legal-researcher.json"),
      JSON.stringify({
        schemaVersion: 1,
        kind: "lervo_repository_role",
        roleId: "legal-researcher",
        version: "1.0.0",
        extends: [{ roleId: "researcher", version: "1.0.0" }],
        profile: { name: "Legal Researcher", description },
        checks: [],
      }),
    );
  await write("Specializes the verified researcher contract for legal source analysis.");
  const before = (await listRoleContracts(root)).find(
    (contract) => contract.roleId === "legal-researcher",
  )!;
  expect(await listRoleContracts(root)).toContainEqual(before);
  await write("Specializes the verified researcher contract for contract and statute analysis.");
  const after = (await listRoleContracts(root)).find(
    (contract) => contract.roleId === "legal-researcher",
  )!;
  expect(after.contractHash).not.toBe(before.contractHash);
});
