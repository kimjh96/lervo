import { createInterface } from "node:readline";
import { delimiter, dirname } from "node:path";

if (
  process.argv.includes("--require-runtime-path") &&
  !process.env.PATH?.split(delimiter).includes(dirname(process.execPath))
) {
  process.exit(5);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
if (
  process.argv.includes("--require-isolated-profile") &&
  (process.env.HOME !== "/fixture/owner-home" ||
    process.env.CODEX_HOME !== "/fixture/owner-config" ||
    process.env.LERVO_TEST_INHERITED_CREDENTIAL !== undefined)
)
  process.exit(6);

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "fake" } });
    return;
  }
  if (message.method === "initialized") return;
  if (message.method === "thread/start") {
    if (process.argv.includes("--reject-thread-start")) {
      send({ id: message.id, error: { code: -32000, message: "private provider detail" } });
      return;
    }
    if (process.argv.includes("--ignore-thread-start")) return;
    if (process.argv.includes("--exit-on-thread-start")) {
      process.exit(7);
    }
    send({
      id: message.id,
      result: { thread: { id: "thread-stdio-1" }, model: "codex-observed-fixture" },
    });
    send({ method: "thread/started", params: { thread: { id: "thread-stdio-1" } } });
    return;
  }
  if (message.method === "thread/inject_items") {
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method === "mcpServerStatus/list") {
    send({
      id: message.id,
      result: {
        data: [
          {
            name: "research-search",
            pluginId: null,
            serverInfo: { name: "fixture", version: "1.0.0" },
            tools: {},
            resources: [],
            resourceTemplates: [],
            authStatus: "not_supported",
          },
        ],
        nextCursor: null,
      },
    });
    return;
  }
  if (message.method === "turn/start") {
    if (
      message.params?.effort !== "low" ||
      message.params?.outputSchema?.properties?.evidenceTokens?.type !== "array" ||
      message.params?.outputSchema?.additionalProperties !== false
    ) {
      send({ id: message.id, error: { code: -32602, message: "missing output schema" } });
      return;
    }
    send({ id: message.id, result: { turn: { id: "turn-stdio-1" } } });
    send({
      method: "turn/started",
      params: { threadId: "thread-stdio-1", turn: { id: "turn-stdio-1" } },
    });
    send({
      method: "item/started",
      params: {
        threadId: "thread-stdio-1",
        turnId: "turn-stdio-1",
        item: { type: "fileChange", id: "change-stdio-1", status: "inProgress", changes: [] },
      },
    });
    send({
      id: "approval-stdio-1",
      method: "item/fileChange/requestApproval",
      params: {
        threadId: "thread-stdio-1",
        turnId: "turn-stdio-1",
        itemId: "change-stdio-1",
        startedAtMs: Date.now(),
      },
    });
    return;
  }
  if (message.id === "approval-stdio-1" && message.result?.decision) {
    send({
      method: "serverRequest/resolved",
      params: { threadId: "thread-stdio-1", requestId: "approval-stdio-1" },
    });
    return;
  }
  if (message.method === "thread/unsubscribe" || message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
  }
});
