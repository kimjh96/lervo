#!/usr/bin/env node

import { appendFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const providerSessionId = sessionArgument();
const hookCallbackIds = new Map();
const pendingControls = new Map();
let controlSequence = 0;

function sessionArgument() {
  const prefix = "--session-id=";
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (value === undefined) throw new Error("The Claude fixture session ID is missing.");
  return value;
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function permissionMode() {
  const index = process.argv.indexOf("--permission-mode");
  return index < 0 ? "default" : (process.argv[index + 1] ?? "default");
}

function callbackId(initialization, event) {
  const value = initialization.request.hooks?.[event]?.[0]?.hookCallbackIds?.[0];
  if (typeof value !== "string") throw new Error(`The ${event} hook callback is missing.`);
  return value;
}

function hookInput(event, toolInput, toolUseId) {
  return {
    session_id: providerSessionId,
    transcript_path: "/tmp/lervo-installed-continuation-transcript.jsonl",
    cwd: process.cwd(),
    permission_mode: "default",
    hook_event_name: event,
    tool_name: "Write",
    tool_input: toolInput,
    tool_use_id: toolUseId,
  };
}

function requestHook(event, toolInput, toolUseId, continuation) {
  const requestId = `fixture-control-${++controlSequence}`;
  pendingControls.set(requestId, continuation);
  send({
    type: "control_request",
    request_id: requestId,
    request: {
      subtype: "hook_callback",
      callback_id: hookCallbackIds.get(event),
      input: hookInput(event, toolInput, toolUseId),
      tool_use_id: toolUseId,
    },
  });
}

function semanticEvaluation(instructions) {
  const request = JSON.parse(instructions.slice(instructions.lastIndexOf("\n") + 1));
  return {
    checks: request.checks.map(({ checkId }) => ({
      checkId,
      status: "passed",
      violationCount: 0,
    })),
  };
}

function result(message, content, structuredOutput) {
  send({
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: content,
    ...(structuredOutput === undefined ? {} : { structured_output: structuredOutput }),
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 1,
    },
    modelUsage: {
      "fixture-model": {
        inputTokens: 1,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 1,
        costUSD: 0,
        contextWindow: 200000,
      },
    },
    permission_denials: [],
    uuid: `00000000-0000-4000-8000-${String(controlSequence + 10).padStart(12, "0")}`,
    user_message_uuid: message.uuid,
    session_id: providerSessionId,
  });
}

async function mainTurn(message, instructions) {
  const target = process.env.LERVO_INSTALLED_CONTINUATION_TARGET;
  const promptLog = process.env.LERVO_INSTALLED_CONTINUATION_CLAUDE_PROMPT_LOG;
  if (target === undefined || promptLog === undefined) {
    throw new Error("The installed continuation fixture coordinates are missing.");
  }
  await appendFile(promptLog, instructions, "utf8");
  const content = 'export const continuedBy = "claude";\n';
  const toolUseId = "installed-continuation-write";
  const toolInput = { file_path: "src/result.ts", content };
  requestHook("PreToolUse", toolInput, toolUseId, async (response) => {
    if (response.response?.response?.hookSpecificOutput?.permissionDecision !== "allow") {
      throw new Error(`The Claude managed write was not authorized: ${JSON.stringify(response)}`);
    }
    await writeFile(target, content, "utf8");
    requestHook("PostToolUse", toolInput, toolUseId, async () => {
      result(message, "Installed cross-provider continuation complete.");
    });
  });
}

async function handle(line) {
  const message = JSON.parse(line);
  if (message.type === "control_request" && message.request?.subtype === "initialize") {
    hookCallbackIds.set("PreToolUse", callbackId(message, "PreToolUse"));
    hookCallbackIds.set("PostToolUse", callbackId(message, "PostToolUse"));
    send({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: message.request_id,
        response: {
          commands: [],
          agents: [],
          output_style: "default",
          available_output_styles: [],
          models: [],
          account: {},
        },
      },
    });
    send({
      type: "system",
      subtype: "init",
      apiKeySource: "none",
      claude_code_version: "0.0.0-fixture",
      cwd: process.cwd(),
      tools: ["Read", "Glob", "Grep", "Write", "Edit"],
      mcp_servers: [],
      model: "fixture-model",
      permissionMode: permissionMode(),
      slash_commands: [],
      output_style: "default",
      skills: [],
      plugins: [],
      uuid: "00000000-0000-4000-8000-000000000001",
      session_id: providerSessionId,
    });
    return;
  }
  if (message.type === "control_response") {
    const continuation = pendingControls.get(message.response?.request_id);
    if (continuation === undefined) return;
    pendingControls.delete(message.response.request_id);
    await continuation(message);
    return;
  }
  if (message.type !== "user") return;
  if (message.shouldQuery === false) {
    const contextLog = process.env.LERVO_INSTALLED_CONTINUATION_CLAUDE_CONTEXT_LOG;
    const content = message.message?.content?.[0]?.text ?? "";
    if (contextLog !== undefined) {
      await appendFile(contextLog, `${JSON.stringify(content)}\n`, "utf8");
    }
  }
  send({ ...message, isReplay: true });
  if (message.shouldQuery === false) return;
  const instructions = message.message?.content?.[0]?.text ?? "";
  if (instructions.includes("Evaluate the JSON request below")) {
    const evaluation = semanticEvaluation(instructions);
    result(message, JSON.stringify(evaluation), evaluation);
    return;
  }
  await mainTurn(message, instructions);
}

lines.on("line", (line) => {
  void handle(line).catch(async (error) => {
    const debugLog = process.env.LERVO_INSTALLED_CONTINUATION_DEBUG_LOG;
    if (debugLog !== undefined) {
      await appendFile(debugLog, `${error.stack ?? String(error)}\n`, "utf8");
    }
    process.exitCode = 1;
    lines.close();
  });
});
