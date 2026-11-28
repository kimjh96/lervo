import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertRoleNameAvailable,
  derivedRoleId,
  editedRoleSource,
  grantsRequestType,
  listRoleContracts,
  nextRoleVersion,
  previewRoleContracts,
  projectRoleSource,
  readOwnRoleSource,
  removeRoleSource,
  resolveRoleContract,
  roleDependents,
  writeRoleSource,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-project-role-"));
  roots.push(root);
  return root;
}

const machining = {
  roleId: "machining",
  name: "Machining Engineer",
  description: "Owns machining feasibility and toolpath review.",
  template: { roleId: "developer", version: "1.0.0" },
};

describe("project role authoring", () => {
  it("derives a role ID from a name, and a hashed one from a name without ASCII words", () => {
    expect(derivedRoleId("Drawing Understanding", new Set())).toBe("drawing-understanding");
    expect(derivedRoleId("3D Machining", new Set())).toBe("d-machining");
    expect(derivedRoleId("Machining", new Set(["machining", "machining-2"]))).toBe("machining-3");
    const korean = derivedRoleId("가공", new Set());
    expect(korean).toMatch(/^role-[0-9a-f]{8}$/u);
    expect(derivedRoleId("가공", new Set([korean]))).toBe(`${korean}-2`);
  });

  it("starts a role from its template at 1.0.0 and checks its words", () => {
    const source = projectRoleSource({ ...machining, requestTypes: ["review", "review"] });
    expect(source).toMatchObject({
      roleId: "machining",
      version: "1.0.0",
      extends: [{ roleId: "developer", version: "1.0.0" }],
      profile: {
        name: "Machining Engineer",
        description: "Owns machining feasibility and toolpath review.",
        requestTypes: ["review"],
      },
      checks: [],
    });
    expect(() => projectRoleSource({ ...machining, name: "  " })).toThrow(
      expect.objectContaining({ code: "role_profile_invalid" }),
    );
    expect(() => projectRoleSource({ ...machining, requestTypes: ["Bad Type"] })).toThrow(
      expect.objectContaining({ code: "role_profile_invalid" }),
    );
  });

  it("edits at the next minor version and writes nothing for an edit that changes nothing", () => {
    const source = projectRoleSource(machining);
    expect(editedRoleSource(source, { name: machining.name })).toBeNull();
    const edited = editedRoleSource(source, {
      description: "Owns machining.",
      requestTypes: ["organization.coordinate"],
    });
    expect(edited).toMatchObject({
      version: "1.1.0",
      profile: { description: "Owns machining.", requestTypes: ["organization.coordinate"] },
    });
    expect(editedRoleSource(edited!, { requestTypes: [] })?.profile.requestTypes).toBeUndefined();
    expect(nextRoleVersion("2.9.4-beta.1")).toBe("2.10.0");
  });

  it("refuses a name another role has, ignoring case", () => {
    const roles = [{ roleId: "developer", name: "Developer" }];
    expect(() => assertRoleNameAvailable(roles, "developer", "machining")).toThrow(
      expect.objectContaining({ code: "role_name_conflict" }),
    );
    expect(() => assertRoleNameAvailable(roles, "Developer", "developer")).not.toThrow();
  });

  it("writes, reads, and removes a checkout's own source, and resolves it with its ancestry", async () => {
    const root = await repository();
    const source = projectRoleSource(machining);
    await writeRoleSource(root, source, "create");
    await expect(writeRoleSource(root, source, "create")).rejects.toMatchObject({
      code: "role_exists",
    });
    const own = await readOwnRoleSource(root, "machining");
    expect(own?.source).toEqual(source);
    expect(own?.bytes).toBe(await readFile(resolve(root, ".lervo/roles/machining.json"), "utf8"));
    const contract = await resolveRoleContract(root, "machining");
    expect(grantsRequestType(contract, "implementation")).toBe(true);
    expect(grantsRequestType(contract, "organization.coordinate")).toBe(false);

    const lead = projectRoleSource({
      ...machining,
      roleId: "machining-lead",
      name: "Machining Lead",
      template: { roleId: "machining", version: "1.0.0" },
    });
    const preview = await previewRoleContracts(root, [lead]);
    expect(roleDependents(preview, "machining")).toEqual(["machining-lead"]);
    expect(roleDependents(await listRoleContracts(root), "machining")).toEqual([]);

    await writeRoleSource(root, editedRoleSource(source, { name: "Machinist" })!, "replace");
    expect((await resolveRoleContract(root, "machining")).version).toBe("1.1.0");
    await removeRoleSource(root, "machining");
    expect(await readOwnRoleSource(root, "machining")).toBeNull();
    expect(await readOwnRoleSource(root, "developer")).toBeNull();
  });
});
