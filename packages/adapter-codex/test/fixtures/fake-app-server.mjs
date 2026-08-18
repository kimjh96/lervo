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
  if (message.method === "turn/start") {
    send({ id: message.id, result: { turn: { id: "turn-stdio-1" } } });
    send({ method: "turn/started", params: { threadId: "thread-stdio-1", turn: { id: "turn-stdio-1" } } });
    return;
  }
  if (message.method === "thread/unsubscribe" || message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
  }
});
