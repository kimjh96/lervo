import type {
  DiscordGatewayConnection,
  DiscordGatewayConnectionObserver,
  DiscordGatewayTransport,
} from "./types.js";

interface RuntimeWebSocket {
  binaryType: string;
  send(payload: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(name: string, listener: (event: unknown) => void): void;
}

type RuntimeWebSocketConstructor = new (url: string) => RuntimeWebSocket;

function eventValue(event: unknown, key: string): unknown {
  return typeof event === "object" && event !== null && key in event
    ? (event as Record<string, unknown>)[key]
    : undefined;
}

async function messageBytes(value: unknown): Promise<string | Uint8Array> {
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function"
  ) {
    return new Uint8Array(await (value.arrayBuffer as () => Promise<ArrayBuffer>)());
  }
  throw new Error("Discord Gateway returned an unsupported WebSocket message type.");
}

export class NodeDiscordGatewayTransport implements DiscordGatewayTransport {
  constructor(
    private readonly createWebSocket: RuntimeWebSocketConstructor = (
      globalThis as unknown as { WebSocket: RuntimeWebSocketConstructor }
    ).WebSocket,
  ) {
    if (typeof createWebSocket !== "function") {
      throw new Error("This Node runtime does not provide WebSocket support.");
    }
  }

  connect(url: string, observer: DiscordGatewayConnectionObserver): DiscordGatewayConnection {
    const socket = new this.createWebSocket(url);
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => observer.open());
    socket.addEventListener("message", (event) => {
      void messageBytes(eventValue(event, "data")).then(observer.message, (error: unknown) =>
        observer.error(error instanceof Error ? error : new Error("WebSocket message failed.")),
      );
    });
    socket.addEventListener("close", (event) => {
      const code = eventValue(event, "code");
      const reason = eventValue(event, "reason");
      observer.close(
        typeof code === "number" ? code : 1006,
        typeof reason === "string" ? reason : "",
      );
    });
    socket.addEventListener("error", () => observer.error(new Error("Discord WebSocket failed.")));
    return {
      send: (payload) => socket.send(payload),
      close: (code, reason) => socket.close(code, reason),
    };
  }
}
