import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { runKnowledgeConvergenceCommand } from "../src/knowledge-convergence-command.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function run(cwd: string, args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runKnowledgeConvergenceCommand(args, {
    cwd,
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

it("reports host identity and verdict without exposing Hub coordinates", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-owner-command-"));
  roots.push(root);
  expect(await run(root, ["owner", "status", "--json"])).toMatchObject({
    code: 0,
    stdout: `${JSON.stringify({ host: null, verdict: null, remediation: null, publication: null }, null, 2)}\n`,
  });
  await mkdir(resolve(root, ".lervo/state/knowledge"), { recursive: true });
  await writeFile(
    resolve(root, ".lervo/state/knowledge/convergence-owner-host.json"),
    JSON.stringify({
      schemaVersion: 1,
      hostId: `hst_${"1".repeat(32)}`,
      hostLabel: "mac",
      coordination: {
        mode: "hub",
        hub: {
          baseUrl: "https://hub.example.invalid",
          bearerTokenFile: "/secure/hub-token",
          destinationId: "hub-fixture",
          hubIdentityHash: `sha256:${"a".repeat(64)}`,
        },
      },
    }),
  );
  const status = await run(root, ["owner", "status"]);
  expect(status.code).toBe(0);
  expect(JSON.parse(status.stdout)).toMatchObject({
    host: { hostLabel: "mac", mode: "hub", hostHash: expect.stringMatching(/^sha256:/u) },
    verdict: null,
  });
  expect(status.stdout).not.toContain("hub.example.invalid");
  expect(status.stdout).not.toContain("/secure/hub-token");
  await writeFile(
    resolve(root, ".lervo/state/knowledge/convergence-owner.json"),
    JSON.stringify({
      schemaVersion: 1,
      recordedHolderKey: null,
      verdict: {
        role: "unverifiable",
        reason: "convergence_owner_unverifiable",
        mode: "hub",
        hostHash: `sha256:${"1".repeat(64)}`,
        hostLabel: "mac",
        holder: null,
        validUntil: null,
        wakeAt: null,
        grantedAt: null,
        yieldUntil: null,
        observedAt: "2026-10-05T00:00:00.000Z",
        failureCode: "hub_forbidden",
        httpStatus: 403,
      },
    }),
  );
  const forbidden = JSON.parse((await run(root, ["owner", "status"])).stdout);
  expect(forbidden.verdict).toMatchObject({ failureCode: "hub_forbidden", httpStatus: 403 });
  // Without a project manifest the remediation still names the permissions to grant.
  expect(forbidden.remediation).toContain(
    "Grant workspace.read and workspace.coordinate for this repository's project at the configured Hub destination",
  );
  expect(forbidden.remediation).toContain("(HTTP 403)");
  expect(JSON.stringify(forbidden)).not.toContain("/secure/hub-token");
  expect(await run(root, ["owner", "claim"])).toMatchObject({ code: 1 });
});
