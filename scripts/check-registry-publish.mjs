import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { readJson, repositoryRoot, runPnpm } from "./lib/installed-cli.mjs";
import {
  isolatedRegistryEnvironment,
  startLocalPackageRegistry,
} from "./lib/local-package-registry.mjs";
import { packCliArtifact } from "./lib/packed-cli-artifact.mjs";

const cliManifestPath = resolve(repositoryRoot, "apps/cli/package.json");

async function publishCli(tarballPath, registryUrl, environment) {
  return runPnpm([
    "publish",
    tarballPath,
    "--registry",
    registryUrl,
    "--tag",
    "preflight",
    "--access",
    "public",
    "--no-git-checks",
  ], {
    cwd: dirname(tarballPath),
    env: environment,
  });
}

async function expectPublishConflict(tarballPath, registryUrl, environment) {
  try {
    await publishCli(tarballPath, registryUrl, environment);
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (process.env.LERVO_REGISTRY_PREFLIGHT_DEBUG === "1") {
      console.error(output);
    }
    assert.match(output, /\[E409\]\s+409 Conflict/u);
    return;
  }
  assert.fail("같은 package version의 재게시는 거부되어야 합니다.");
}

async function viewJson(args, registryUrl, environment, cwd) {
  const { stdout } = await runPnpm([
    ...args,
    "--registry",
    registryUrl,
    "--json",
  ], { cwd, env: environment });
  return JSON.parse(stdout);
}

async function verifyPublishedMetadata(manifest, registryUrl, environment, cwd) {
  const metadata = await viewJson(
    ["view", `@lervo/cli@${manifest.version}`],
    registryUrl,
    environment,
    cwd,
  );
  assert.equal(metadata.name, "@lervo/cli");
  assert.equal(metadata.version, manifest.version);
  assert.equal(metadata.license, manifest.license);
  assert.equal(typeof metadata.dist?.integrity, "string");
  assert.match(metadata.dist.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
  return metadata.dist.integrity;
}

async function verifyDistTags(expected, registryUrl, environment, cwd) {
  const tags = await viewJson(
    ["view", "@lervo/cli", "dist-tags"],
    registryUrl,
    environment,
    cwd,
  );
  assert.deepEqual(tags, expected);
}

async function installPublishedCli(consumerRoot, version, registryUrl, environment) {
  await writeFile(
    resolve(consumerRoot, "package.json"),
    `${JSON.stringify({
      name: "lervo-registry-consumer",
      version: "0.0.0",
      private: true,
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    resolve(consumerRoot, ".npmrc"),
    `registry=https://registry.npmjs.org/\n@lervo:registry=${registryUrl}/\n`,
    "utf8",
  );
  await runPnpm([
    "add",
    "--prefer-offline",
    "--save-exact",
    `@lervo/cli@${version}`,
  ], { cwd: consumerRoot, env: environment });

  const installedManifest = await readJson(
    resolve(consumerRoot, "node_modules/@lervo/cli/package.json"),
  );
  assert.equal(installedManifest.name, "@lervo/cli");
  assert.equal(installedManifest.version, version);
  const consumerManifest = await readJson(resolve(consumerRoot, "package.json"));
  assert.deepEqual(consumerManifest.dependencies, { "@lervo/cli": version });
  const executed = await runPnpm(["exec", "lervo", "--version"], {
    cwd: consumerRoot,
    env: environment,
  });
  assert.equal(executed.stdout, `lervo ${version}\n`);
  assert.equal(executed.stderr, "");
}

async function main() {
  const cliManifest = await readJson(cliManifestPath);
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), "lervo-registry-preflight-"));
  let registry;
  try {
    const archiveRoot = resolve(fixtureRoot, "archive");
    const consumerRoot = resolve(fixtureRoot, "consumer");
    const registryRoot = resolve(fixtureRoot, "registry");
    const userConfigPath = resolve(fixtureRoot, "user.npmrc");
    await Promise.all([
      mkdir(archiveRoot),
      mkdir(consumerRoot),
      mkdir(registryRoot),
      writeFile(userConfigPath, "", "utf8"),
    ]);
    registry = await startLocalPackageRegistry(registryRoot);
    const environment = isolatedRegistryEnvironment(
      userConfigPath,
      resolve(fixtureRoot, "package-cache"),
    );
    const tarballPath = await packCliArtifact(archiveRoot, cliManifest.version);

    await publishCli(tarballPath, registry.url, environment);
    const integrity = await verifyPublishedMetadata(
      cliManifest,
      registry.url,
      environment,
      archiveRoot,
    );
    await verifyDistTags(
      { latest: cliManifest.version, preflight: cliManifest.version },
      registry.url,
      environment,
      archiveRoot,
    );
    await installPublishedCli(
      consumerRoot,
      cliManifest.version,
      registry.url,
      environment,
    );
    await expectPublishConflict(tarballPath, registry.url, environment);
    assert.equal(
      await verifyPublishedMetadata(
        cliManifest,
        registry.url,
        environment,
        archiveRoot,
      ),
      integrity,
    );
  } finally {
    await registry?.close();
    await rm(fixtureRoot, { recursive: true, force: true });
  }

  console.log(`CLI registry 게시 사전검사 통과 (${cliManifest.version})`);
}

try {
  await main();
} catch (error) {
  if (process.env.LERVO_REGISTRY_PREFLIGHT_DEBUG === "1") console.error(error);
  console.error("registry_publish_preflight_failed: CLI registry 게시 사전검사를 완료하지 못했습니다.");
  process.exitCode = 1;
}
