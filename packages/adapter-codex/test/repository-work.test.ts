import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { CodexRepositoryWorkTurnExecutor } from "../src/repository-work.js";

const roots: string[] = [];
const execute = promisify(execFile);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function executable(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-codex-work-"));
  roots.push(root);
  const path = resolve(root, "fake-codex.mjs");
  await writeFile(
    path,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const resumed = args.includes("resume");
const external = args.includes("sandbox_workspace_write.network_access=true");
const repositoryMetadata = args.includes("--add-dir");
process.stdout.write(JSON.stringify({type:"thread.started",thread_id:"11111111-1111-4111-8111-111111111111"})+"\\n");
process.stdout.write(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:external?"external":resumed&&repositoryMetadata?"resumed-with-metadata":repositoryMetadata?"completed-with-metadata":"completed"}})+"\\n");
`,
    { mode: 0o700 },
  );
  await chmod(path, 0o700);
  return path;
}

async function timedOutExecutable(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-codex-timeout-"));
  roots.push(root);
  const path = resolve(root, "fake-codex-timeout.mjs");
  await writeFile(
    path,
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({type:"thread.started",thread_id:"11111111-1111-4111-8111-111111111111"})+"\\n");
process.stdout.write(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"still working"}})+"\\n");
process.on("SIGTERM",()=>process.exit(0));
setInterval(()=>{},1000);
`,
    { mode: 0o700 },
  );
  await chmod(path, 0o700);
  return path;
}

describe("CodexRepositoryWorkTurnExecutor", () => {
  it("starts and resumes a native repository work session", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-codex-root-"));
    roots.push(root);
    await execute("git", ["init", "-b", "main"], { cwd: root });
    const executor = new CodexRepositoryWorkTurnExecutor(await executable());
    const first = await executor.execute({
      repositoryRoot: root,
      instructions: "work",
      providerSessionId: null,
      timeoutMs: 5_000,
    });
    expect(first).toMatchObject({
      provider: "codex",
      providerSessionId: "11111111-1111-4111-8111-111111111111",
      response: "completed-with-metadata",
    });
    await expect(
      executor.execute({
        repositoryRoot: root,
        instructions: "continue",
        providerSessionId: first.providerSessionId,
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({ response: "resumed-with-metadata" });
    await expect(
      executor.execute({
        repositoryRoot: root,
        instructions: "publish",
        providerSessionId: null,
        externalEffectsAuthorized: true,
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({ response: "external" });
  });

  it("rejects a deadline termination even when Codex emitted commentary and exits zero", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-codex-timeout-root-"));
    roots.push(root);
    await execute("git", ["init", "-b", "main"], { cwd: root });
    const executor = new CodexRepositoryWorkTurnExecutor(await timedOutExecutable());

    await expect(
      executor.execute({
        repositoryRoot: root,
        instructions: "work",
        providerSessionId: null,
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: "provider_turn_timeout" });
  });
});
