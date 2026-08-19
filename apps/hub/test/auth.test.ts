import { describe, expect, it } from "vitest";

import { ConfiguredBearerAuthenticator } from "../src/auth.js";

const token = "lervo-test-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("configured Hub bearer authentication", () => {
  it("returns a defensive principal copy only for an exact bearer token", async () => {
    const authenticator = new ConfiguredBearerAuthenticator([{
      token,
      principalId: "operator:test",
      permissions: ["trace.read"],
      projects: [{ destinationId: "hub:primary", projectId: "prj_allowed01" }],
    }]);

    await expect(authenticator.authenticate(`Bearer ${token}`)).resolves.toEqual({
      principalId: "operator:test",
      permissions: ["trace.read"],
      projects: [{ destinationId: "hub:primary", projectId: "prj_allowed01" }],
    });
    await expect(authenticator.authenticate("Bearer wrong-token-value-that-is-long-enough-0000"))
      .resolves.toBeNull();
    await expect(authenticator.authenticate(undefined)).resolves.toBeNull();

    const first = await authenticator.authenticate(`Bearer ${token}`);
    first!.projects[0]!.projectId = "prj_mutated01";
    await expect(authenticator.authenticate(`Bearer ${token}`)).resolves.toMatchObject({
      projects: [{ projectId: "prj_allowed01" }],
    });
  });

  it("rejects unsafe credential configuration at startup", () => {
    expect(() => new ConfiguredBearerAuthenticator([])).toThrow("하나 이상");
    expect(() => new ConfiguredBearerAuthenticator([{
      token: "short",
      principalId: "operator:test",
      permissions: ["trace.read"],
      projects: [],
    }])).toThrow("token 형식");
    expect(() => new ConfiguredBearerAuthenticator([{
      token,
      principalId: "operator:test",
      permissions: ["trace.read"],
      projects: [{ destinationId: "hub:primary", projectId: "wrong" }],
    }])).toThrow("project 좌표");
  });
});
