#!/usr/bin/env node

import { appendFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const threadId = "thread-installed-capability";
const turnId = "turn-installed-capability";
let connectedServerNames = [];
let pendingMainTurn = false;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function completeTurn(content) {
  send({
    method: "item/completed",
    params: {
      threadId,
      turnId,
      item: { type: "agentMessage", id: "result-installed-capability", text: content },
    },
  });
  send({
    method: "turn/completed",
    params: { threadId, turn: { id: turnId, status: "completed", durationMs: 1 } },
  });
}

function semanticEvaluation(instructions) {
  const request = JSON.parse(instructions.slice(instructions.lastIndexOf("\n") + 1));
  return JSON.stringify({
    checks: request.checks.map(({ checkId }) => ({
      checkId,
      status: "passed",
      violationCount: 0,
    })),
  });
}

async function handle(line) {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "lervo-installed-capability-fixture" } });
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "thread/start") {
    connectedServerNames = Object.keys(message.params?.config?.mcp_servers ?? {});
    send({ id: message.id, result: { thread: { id: threadId } } });
    send({ method: "thread/started", params: { thread: { id: threadId } } });
    return;
  }
  if (message.method === "thread/inject_items") {
    const contextLog = process.env.LERVO_INSTALLED_CAPABILITY_CONTEXT_LOG;
    if (contextLog !== undefined) {
      await appendFile(contextLog, `${JSON.stringify(message.params?.items ?? [])}\n`, "utf8");
    }
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method === "mcpServerStatus/list") {
    send({
      id: message.id,
      result: {
        data: connectedServerNames.map((name) => ({
          name,
          pluginId: null,
          serverInfo: { name, version: "1.0.0" },
          tools: {},
          resources: [],
          resourceTemplates: [],
          authStatus: "not_supported",
        })),
        nextCursor: null,
      },
    });
    return;
  }
  if (message.method === "turn/start") {
    const instructions = message.params?.input?.[0]?.text ?? "";
    send({ id: message.id, result: { turn: { id: turnId } } });
    send({ method: "turn/started", params: { threadId, turn: { id: turnId } } });
    if (instructions.includes("Evaluate the JSON request below")) {
      completeTurn(semanticEvaluation(instructions));
      return;
    }
    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;
    const promptLog = process.env.LERVO_INSTALLED_CAPABILITY_PROMPT_LOG;
    if (targetPath === undefined || promptLog === undefined) {
      throw new Error("The installed capability fixture coordinates are missing.");
    }
    await appendFile(promptLog, instructions, "utf8");
    pendingMainTurn = true;
    send({
      method: "item/started",
      params: {
        threadId,
        turnId,
        item: {
          type: "fileChange",
          id: "change-installed-capability",
          status: "inProgress",
          changes: [{ path: "src/result.ts", kind: { type: "add" }, diff: "fixture diff" }],
        },
      },
    });
    send({
      id: "approval-installed-capability",
      method: "item/fileChange/requestApproval",
      params: {
        threadId,
        turnId,
        itemId: "change-installed-capability",
        startedAtMs: Date.now(),
      },
    });
    return;
  }
  if (message.id === "approval-installed-capability" && pendingMainTurn) {
    if (message.result?.decision !== "accept") throw new Error("The managed write was declined.");
    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;
    await writeFile(
      targetPath,
      process.env.LERVO_INSTALLED_CAPABILITY_CONTENT ??
        "export const installedCapabilityJourney = true;\n",
      "utf8",
    );
    pendingMainTurn = false;
    send({
      method: "item/completed",
      params: {
        threadId,
        turnId,
        item: {
          type: "fileChange",
          id: "change-installed-capability",
          status: "completed",
          changes: [{ path: "src/result.ts", kind: { type: "add" }, diff: "fixture diff" }],
        },
      },
    });
    completeTurn(
      process.env.LERVO_INSTALLED_CAPABILITY_RESULT ?? "Installed capability journey complete.",
    );
    return;
  }
  if (message.method === "thread/unsubscribe" || message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
  }
}

lines.on("line", (line) => {
  void handle(line).catch(async (error) => {
    const debugLog = process.env.LERVO_INSTALLED_CAPABILITY_DEBUG_LOG;
    if (debugLog !== undefined) {
      await appendFile(debugLog, `${error.stack ?? String(error)}\n`, "utf8");
    }
    process.exitCode = 1;
    lines.close();
  });
});
