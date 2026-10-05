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
    stdout: `${JSON.stringify({ host: null, verdict: null, publication: null }, null, 2)}\n`,
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
  expect(await run(root, ["owner", "claim"])).toMatchObject({ code: 1 });
});
