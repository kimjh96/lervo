import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { repositoryRoot } from "./lib/installed-cli.mjs";

const execFileAsync = promisify(execFile);

async function run(script, args) {
  return execFileAsync(process.execPath, [resolve(repositoryRoot, script), ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 180_000,
  });
}

const fixtureRoot = await mkdtemp(resolve(tmpdir(), "lervo-node-distribution-smoke-"));
try {
  const archive = resolve(fixtureRoot, `lervo-node-${process.platform}-${process.arch}.tar.gz`);
  const artifact = `${archive}.artifact.json`;
  const installed = resolve(fixtureRoot, "installed");
  const built = await run("scripts/distribution/build-node-runtime-distribution.mjs", [
    "--output",
    archive,
    "--write",
  ]);
  assert.match(built.stdout, /Created and verified the standalone Lervo Node distribution\./u);
  const descriptor = JSON.parse(await readFile(artifact, "utf8"));
  const verified = await run("scripts/distribution/verify-node-runtime-distribution.mjs", [
    "--archive",
    archive,
    "--artifact",
    artifact,
    "--expected-sha256",
    descriptor.sha256,
  ]);
  assert.match(verified.stdout, /Lervo Node distribution verification passed/u);
  const installedResult = await run("scripts/distribution/install-node-runtime-distribution.mjs", [
    "--archive",
    archive,
    "--artifact",
    artifact,
    "--expected-sha256",
    descriptor.sha256,
    "--target",
    installed,
    "--write",
  ]);
  assert.match(installedResult.stdout, /The service was not enabled\./u);
  await access(resolve(installed, "dist/bin.js"));
  await access(resolve(installed, "lervo-node-distribution.manifest.json"));

  const hubToken = resolve(fixtureRoot, "hub.token");
  const discordToken = resolve(fixtureRoot, "discord.token");
  const config = resolve(fixtureRoot, "node-runtime.json");
  await Promise.all([
    writeFile(hubToken, `${"h".repeat(40)}\n`, { mode: 0o600 }),
    writeFile(discordToken, `discord.${"d".repeat(40)}\n`, { mode: 0o600 }),
    writeFile(
      config,
      JSON.stringify({
        schemaVersion: 1,
        repositoryRoot: ".",
        hub: {
          baseUrl: "https://hub.example.test/",
          bearerTokenFile: hubToken,
          destinationId: "hub:packed-node",
          hubIdentityHash: `sha256:${"9".repeat(64)}`,
        },
        sync: { workerId: "node:packed-consumer" },
        discordConversation: {
          integrationId: "itg_packeddiscord",
          applicationId: "999999999999999999",
          botTokenFile: discordToken,
          intents: 37_377,
          allowedGuildIds: ["123456789012345678"],
          allowDirectMessages: false,
          workerId: "discord-packed-consumer",
          agentParticipantId: "ptc_packedagent",
          conversations: [
            {
              tenantKey: "123456789012345678",
              conversationKey: "223456789012345678",
              conversationId: "cnv_packedconsumer",
            },
          ],
          participants: [
            {
              tenantKey: "123456789012345678",
              userId: "323456789012345678",
              participantId: "ptc_packedoperator",
            },
          ],
          command: {
            roleId: "developer",
            provider: "codex",
            risk: "medium",
            verificationSuiteIds: ["repo.check"],
            lifetimeMs: 120_000,
          },
        },
      }),
      { mode: 0o600 },
    ),
  ]);
  await Promise.all([chmod(hubToken, 0o600), chmod(discordToken, 0o600), chmod(config, 0o600)]);
  const preflight = await execFileAsync(
    process.execPath,
    [resolve(installed, "dist/bin.js"), "--check-config", config],
    { cwd: fixtureRoot, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(preflight.stdout, "Lervo Node configuration preflight passed.\n");

  await assert.rejects(
    run("scripts/distribution/install-node-runtime-distribution.mjs", [
      "--archive",
      archive,
      "--artifact",
      artifact,
      "--expected-sha256",
      descriptor.sha256,
      "--target",
      installed,
      "--write",
    ]),
  );

  await assert.rejects(
    run("scripts/distribution/verify-node-runtime-distribution.mjs", [
      "--archive",
      archive,
      "--artifact",
      artifact,
      "--expected-sha256",
      `sha256:${"0".repeat(64)}`,
    ]),
  );
  console.log(
    `Standalone Lervo Node distribution smoke check passed (${descriptor.platform.os}-${descriptor.platform.arch}-${descriptor.platform.libc})`,
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
