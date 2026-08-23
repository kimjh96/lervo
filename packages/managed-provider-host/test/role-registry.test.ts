import { describe, expect, it } from "vitest";

import {
  createRemoteDeveloperRole,
  ManagedProviderHostRoleRegistry,
  ManagedProviderHostRoleRegistryError,
} from "../src/index.js";

describe("managed provider host role registry", () => {
  it("resolves immutable custom profiles only for their fixed verification contract", () => {
    const source = {
      ...createRemoteDeveloperRole(["repo.check"]),
      roleId: "maintainer",
      name: "Maintainer",
    };
    const registry = new ManagedProviderHostRoleRegistry([source]);

    expect(registry.roleIds()).toEqual(["developer", "maintainer"]);
    const resolved = registry.resolve("maintainer", ["repo.check"]);
    expect(resolved).toMatchObject({ roleId: "maintainer", name: "Maintainer" });
    expect(registry.resolve("maintainer", ["other.check"])).toBeNull();

    resolved!.name = "Changed";
    source.name = "Changed source";
    expect(registry.resolve("maintainer", ["repo.check"])?.name).toBe("Maintainer");
  });

  it("rejects overrides and profiles that widen the remote capability boundary", () => {
    expect(() => new ManagedProviderHostRoleRegistry([
      createRemoteDeveloperRole(["repo.check"]),
    ])).toThrow(ManagedProviderHostRoleRegistryError);

    expect(() => new ManagedProviderHostRoleRegistry([{
      ...createRemoteDeveloperRole(["repo.check"]),
      roleId: "researcher",
      capabilities: {
        ...createRemoteDeveloperRole(["repo.check"]).capabilities,
        "network.access": "require_approval",
      },
    }])).toThrow(ManagedProviderHostRoleRegistryError);

    expect(() => new ManagedProviderHostRoleRegistry([], [
      "repository/testing", "repository/testing",
    ])).toThrow(ManagedProviderHostRoleRegistryError);
  });

  it("binds configured developer skills into each resolved role clone", () => {
    const registry = new ManagedProviderHostRoleRegistry([], ["repository/testing"]);
    expect(registry.resolve("developer", ["repo.check"])?.defaultSkills)
      .toEqual(["repository/testing"]);
  });
});
