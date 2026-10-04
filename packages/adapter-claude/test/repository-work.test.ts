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
if (!args.includes("--print") || !args.includes("--verbose") || args[args.indexOf("--output-format") + 1] !== "stream-json") {
  process.stderr.write("The Claude stream-json print contract is incomplete.\\n");
  process.exit(2);
}
const resumed = args.indexOf("--resume");
const created = args.indexOf("--session-id");
const session = args[resumed >= 0 ? resumed + 1 : created + 1];
const permissionMode = args[args.indexOf("--permission-mode") + 1];
process.stdout.write(JSON.stringify({type:"result",is_error:false,session_id:session,result:permissionMode === "bypassPermissions"?"external":resumed >= 0?"resumed":"completed",...(resumed >= 0 ? {} : {modelUsage:{"claude-opus":{inputTokens:10,outputTokens:30,cacheReadInputTokens:500,cacheCreationInputTokens:40,contextWindow:200000}}})})+"\\n");
process.stdout.write("Client.listTools() called after result.\\n");
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

async function progressingExecutable(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-claude-progress-"));
  roots.push(root);
  const path = resolve(root, "fake-claude-progress.mjs");
  await writeFile(
    path,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const resumed = args.indexOf("--resume");
const created = args.indexOf("--session-id");
const session = args[resumed >= 0 ? resumed + 1 : created + 1];
const progress = setInterval(() => process.stdout.write(JSON.stringify({type:"assistant",message:{role:"assistant"}})+"\\n"), 100);
setTimeout(() => { clearInterval(progress); process.stdout.write(JSON.stringify({type:"result",is_error:false,session_id:session,result:"finished"})+"\\n"); }, 1_800);
`,
    { mode: 0o700 },
  );
  await chmod(path, 0o700);
  return path;
}

async function emptyTerminalResultExecutable(
  afterFinal: "none" | "tool" | "late_tool_result" | "error",
): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-claude-empty-result-"));
  roots.push(root);
  const path = resolve(root, "fake-claude-empty-result.mjs");
  await writeFile(
    path,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const session = args[args.indexOf("--session-id") + 1];
process.stdout.write(JSON.stringify({type:"assistant",message:{role:"assistant",content:[{type:"text",text:"verified final answer"}]}})+"\\n");
if (${JSON.stringify(afterFinal)} === "tool") process.stdout.write(JSON.stringify({type:"assistant",message:{role:"assistant",content:[{type:"tool_use",name:"Bash"}]}})+"\\n");
if (${JSON.stringify(afterFinal)} === "late_tool_result") process.stdout.write(JSON.stringify({type:"user",message:{role:"user",content:[{type:"tool_result",content:"hook settled"}]}})+"\\n");
if (${JSON.stringify(afterFinal)} === "error") process.stdout.write(JSON.stringify({type:"result",subtype:"error",is_error:true,session_id:session,result:"",errors:["provider failed"]})+"\\n");
else process.stdout.write(JSON.stringify({type:"result",subtype:"success",is_error:false,session_id:session,result:""})+"\\n");
`,
    { mode: 0o700 },
  );
  await chmod(path, 0o700);
  return path;
}

async function transcriptResultExecutable(
  configDirectory: string,
  stale: boolean,
): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-claude-transcript-"));
  roots.push(root);
  const path = resolve(root, "fake-claude-transcript.mjs");
  await writeFile(
    path,
    `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const session = args[args.indexOf("--session-id") + 1];
const directory = join(${JSON.stringify(configDirectory)}, "projects", "local-repository");
mkdirSync(directory, {recursive:true});
writeFileSync(join(directory, session + ".jsonl"), JSON.stringify({
  type:"assistant", sessionId:session, cwd:process.cwd(), isSidechain:false,
  timestamp:new Date(Date.now() - ${stale ? "60000" : "0"}).toISOString(),
  message:{role:"assistant",stop_reason:"end_turn",content:[{type:"text",text:"saved final answer"}]}
}) + "\\n");
process.stdout.write(JSON.stringify({type:"result",subtype:"success",is_error:false,session_id:session,result:""}) + "\\n");
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
      expect(first.usage).toEqual({
        adapterId: "claude/repository-work",
        nativeCounterSemanticsId: "claude.stream-json.result.model-usage",
        status: "observed",
        usage: {
          inputTokens: 550,
          cachedInputTokens: 500,
          outputTokens: 30,
          reasoningOutputTokens: 0,
          totalTokens: 580,
          contextWindow: 200_000,
        },
      });
      await expect(
        executor.execute({
          repositoryRoot: root,
          instructions: "continue",
          providerSessionId: first.providerSessionId,
          timeoutMs: 5_000,
        }),
      ).resolves.toMatchObject({
        response: "resumed",
        usage: { status: "unavailable", reasonCode: "provider_usage_unreported" },
      });
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

  it("rejects malformed output before the terminal result", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-claude-invalid-root-"));
    roots.push(root);
    const path = resolve(root, "fake-claude-invalid.mjs");
    await writeFile(
      path,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const session = args[args.indexOf("--session-id") + 1];
process.stdout.write("not JSON\\n" + JSON.stringify({type:"result",is_error:false,session_id:session,result:"completed"}) + "\\n");
`,
      { mode: 0o700 },
    );
    await chmod(path, 0o700);
    const executor = new ClaudeRepositoryWorkTurnExecutor(path);
    await expect(
      executor.execute({
        repositoryRoot: root,
        instructions: "work",
        providerSessionId: null,
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({ code: "provider_protocol_failed" });
  });

  it("allows a streamed active turn to finish after its inactivity window", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-claude-progress-root-"));
    roots.push(root);
    const executor = new ClaudeRepositoryWorkTurnExecutor(await progressingExecutable());
    await expect(
      executor.execute({
        repositoryRoot: root,
        instructions: "work",
        providerSessionId: null,
        timeoutMs: 1_000,
      }),
    ).resolves.toMatchObject({ response: "finished" });
  });

  it("uses the final plain assistant message when a successful terminal result omits text", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-claude-final-root-"));
    roots.push(root);
    const executor = new ClaudeRepositoryWorkTurnExecutor(
      await emptyTerminalResultExecutable("none"),
    );
    await expect(
      executor.execute({
        repositoryRoot: root,
        instructions: "work",
        providerSessionId: null,
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({ response: "verified final answer" });
  });

  it("keeps a final streamed answer across a later tool-result notification", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-claude-late-result-root-"));
    roots.push(root);
    const executor = new ClaudeRepositoryWorkTurnExecutor(
      await emptyTerminalResultExecutable("late_tool_result"),
    );
    await expect(
      executor.execute({
        repositoryRoot: root,
        instructions: "work",
        providerSessionId: null,
        timeoutMs: 5_000,
      }),
    ).resolves.toMatchObject({ response: "verified final answer" });
  });

  it("recovers only a same-session final report written during a successful native turn", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-claude-transcript-root-"));
    const configDirectory = await mkdtemp(resolve(tmpdir(), "lervo-claude-config-"));
    roots.push(root, configDirectory);
    const request = {
      repositoryRoot: root,
      instructions: "work",
      providerSessionId: null,
      timeoutMs: 5_000,
    };
    await expect(
      new ClaudeRepositoryWorkTurnExecutor(
        await transcriptResultExecutable(configDirectory, false),
        configDirectory,
      ).execute(request),
    ).resolves.toMatchObject({ response: "saved final answer" });
    await expect(
      new ClaudeRepositoryWorkTurnExecutor(
        await transcriptResultExecutable(configDirectory, true),
        configDirectory,
      ).execute(request),
    ).rejects.toMatchObject({ code: "provider_result_failed" });
  });

  it("does not promote intermediate assistant text after a later tool call or terminal error", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-claude-intermediate-root-"));
    roots.push(root);
    for (const [afterFinal, code] of [
      ["tool", "provider_result_failed"],
      ["error", "provider_turn_failed"],
    ] as const) {
      const executor = new ClaudeRepositoryWorkTurnExecutor(
        await emptyTerminalResultExecutable(afterFinal),
      );
      await expect(
        executor.execute({
          repositoryRoot: root,
          instructions: "work",
          providerSessionId: null,
          timeoutMs: 5_000,
        }),
      ).rejects.toMatchObject({ code });
    }
  });
});
