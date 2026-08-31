import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

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
    send({ id: message.id, result: { thread: { id: "thread-stdio-1" } } });
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
