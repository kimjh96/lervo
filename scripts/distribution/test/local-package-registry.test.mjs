import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  isolatedRegistryConfiguration,
  isolatedRegistryEnvironment,
} from "../lib/local-package-registry.mjs";

describe("local package registry boundary", () => {
  it("allows only Lervo publication and has no external uplink", () => {
    const configuration = isolatedRegistryConfiguration();
    assert.deepEqual(configuration.uplinks, {});
    assert.deepEqual(configuration.packages["@lervo/*"], {
      access: "$all",
      publish: "$all",
      unpublish: "nobody",
    });
    assert.deepEqual(configuration.packages["**"], {
      access: "$all",
      publish: "nobody",
      unpublish: "nobody",
    });
    assert.equal(configuration.web.enable, false);
  });

  it("removes inherited registry configuration and credentials", () => {
    const environment = isolatedRegistryEnvironment("/fixture/npmrc", "/fixture/cache", {
      PATH: "/bin",
      NPM_CONFIG_REGISTRY: "https://unexpected.invalid/",
      npm_config_proxy: "https://unexpected.invalid/",
      NPM_TOKEN: "secret",
      NODE_AUTH_TOKEN: "secret",
      PNPM_TOKEN: "secret",
      pnpm_config_registry: "https://unexpected.invalid/",
      pnpm_config_verify_deps_before_run: "install",
    });
    assert.equal(environment.PATH, "/bin");
    assert.equal(environment.NPM_CONFIG_REGISTRY, undefined);
    assert.equal(environment.npm_config_proxy, undefined);
    assert.equal(environment.NPM_TOKEN, undefined);
    assert.equal(environment.NODE_AUTH_TOKEN, undefined);
    assert.equal(environment.PNPM_TOKEN, undefined);
    assert.equal(environment.NPM_CONFIG_USERCONFIG, "/fixture/npmrc");
    assert.equal(environment.NPM_CONFIG_CACHE, "/fixture/cache");
    assert.equal(environment.NPM_CONFIG_AUDIT, "false");
    assert.equal(environment.NPM_CONFIG_FUND, "false");
    assert.equal(environment.pnpm_config_registry, undefined);
  });

  it("keeps consumer commands from reinstalling regardless of how the smoke started", () => {
    for (const source of [{}, { pnpm_config_verify_deps_before_run: "install" }])
      assert.equal(
        isolatedRegistryEnvironment("/fixture/npmrc", "/fixture/cache", source)
          .pnpm_config_verify_deps_before_run,
        "false",
      );
  });
});
