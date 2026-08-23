import { describe, expect, it } from "vitest";

import { ReloadableBearerAuthenticator } from "../src/index.js";

const first = "first-bearer-token-aaaaaaaaaaaaaaaa";
const second = "second-bearer-token-bbbbbbbbbbbbbbb";

function credential(token: string, principalId: string) {
  return [{
    token,
    principalId,
    permissions: ["trace.read" as const],
    projects: [],
  }];
}

describe("reloadable Hub bearer authentication", () => {
  it("replaces a complete validated snapshot without exposing mutable principals", async () => {
    const authenticator = new ReloadableBearerAuthenticator(credential(first, "operator:first"));
    const observed = await authenticator.authenticate(`Bearer ${first}`);
    observed!.permissions.length = 0;
    authenticator.replace(credential(second, "operator:second"));
    await expect(authenticator.authenticate(`Bearer ${first}`)).resolves.toBeNull();
    await expect(authenticator.authenticate(`Bearer ${second}`)).resolves.toMatchObject({
      principalId: "operator:second",
      permissions: ["trace.read"],
    });
  });

  it("keeps the current snapshot if replacement validation fails", async () => {
    const authenticator = new ReloadableBearerAuthenticator(credential(first, "operator:first"));
    expect(() => authenticator.replace(credential("short", "operator:second"))).toThrow();
    await expect(authenticator.authenticate(`Bearer ${first}`)).resolves.toMatchObject({
      principalId: "operator:first",
    });
  });
});
