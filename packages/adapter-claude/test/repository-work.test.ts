import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ClaudeRepositoryWorkTurnExecutor } from "../src/repository-work.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function executable(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-claude-work-"));
  roots.push(root);
  const path = resolve(root, "fake-claude.mjs");
  await writeFile(
    path,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const resumed = args.indexOf("--resume");
const created = args.indexOf("--session-id");
const session = args[resumed >= 0 ? resumed + 1 : created + 1];
const permissionMode = args[args.indexOf("--permission-mode") + 1];
process.stdout.write(JSON.stringify({is_error:false,session_id:session,result:permissionMode === "bypassPermissions"?"external":resumed >= 0?"resumed":"completed"}));
`,
    { mode: 0o700 },
  );
  await chmod(path, 0o700);
  return path;
}

async function timedOutExecutable(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-claude-timeout-"));
  roots.push(root);
  const path = resolve(root, "fake-claude-timeout.mjs");
  await writeFile(
    path,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const resumed = args.indexOf("--resume");
const created = args.indexOf("--session-id");
const session = args[resumed >= 0 ? resumed + 1 : created + 1];
process.stdout.write(JSON.stringify({is_error:false,session_id:session,result:"still working"}));
process.on("SIGTERM",()=>process.exit(0));
setInterval(()=>{},1000);
`,
    { mode: 0o700 },
  );
  await chmod(path, 0o700);
  return path;
}

describe("ClaudeRepositoryWorkTurnExecutor", () => {
  it("starts and resumes a native repository work session", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-claude-root-"));
    roots.push(root);
    const executor = new ClaudeRepositoryWorkTurnExecutor(await executable());
    const previousPath = process.env.PATH;
    process.env.PATH = "/missing-provider-path";
    try {
      const first = await executor.execute({
        repositoryRoot: root,
        instructions: "work",
        providerSessionId: null,
        timeoutMs: 5_000,
      });
      expect(first.providerSessionId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(first.response).toBe("completed");
      await expect(
        executor.execute({
          repositoryRoot: root,
          instructions: "continue",
          providerSessionId: first.providerSessionId,
          timeoutMs: 5_000,
        }),
      ).resolves.toMatchObject({ response: "resumed" });
      await expect(
        executor.execute({
          repositoryRoot: root,
          instructions: "publish",
          providerSessionId: null,
          externalEffectsAuthorized: true,
          timeoutMs: 5_000,
        }),
      ).resolves.toMatchObject({ response: "external" });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it("rejects a deadline termination even when Claude emitted a result and exits zero", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-claude-timeout-root-"));
    roots.push(root);
    const executor = new ClaudeRepositoryWorkTurnExecutor(await timedOutExecutable());

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
