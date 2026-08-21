import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runServer } from "verdaccio";
import { stringify } from "yaml";

export function isolatedRegistryConfiguration() {
  return {
    storage: "./storage",
    auth: { htpasswd: { file: "./htpasswd", max_users: -1 } },
    uplinks: {},
    packages: {
      "@lervo/*": { access: "$all", publish: "$all", unpublish: "nobody" },
      "**": { access: "$all", publish: "nobody", unpublish: "nobody" },
    },
    publish: { allow_offline: true },
    web: { enable: false },
    log: { type: "stdout", format: "pretty", level: "fatal" },
  };
}

export async function startLocalPackageRegistry(registryRoot) {
  const configPath = resolve(registryRoot, "config.yaml");
  await writeFile(configPath, stringify(isolatedRegistryConfiguration()), "utf8");
  const application = await runServer(configPath);
  const server = await new Promise((resolve, reject) => {
    const candidate = application.listen(0, "127.0.0.1", () => resolve(candidate));
    candidate.once("error", reject);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  assert.equal(address.address, "127.0.0.1");
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}

export function isolatedRegistryEnvironment(
  userConfigPath,
  cachePath,
  sourceEnvironment = process.env,
) {
  const environment = { ...sourceEnvironment };
  for (const name of Object.keys(environment)) {
    if (
      /^npm_config_/iu.test(name) ||
      /^(?:npm|node)_auth_token$/iu.test(name) ||
      /^(?:npm|pnpm)_token$/iu.test(name)
    ) {
      delete environment[name];
    }
  }
  return {
    ...environment,
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_CACHE: cachePath,
    NPM_CONFIG_FUND: "false",
    npm_config_provenance: "false",
    NPM_CONFIG_USERCONFIG: userConfigPath,
  };
}
