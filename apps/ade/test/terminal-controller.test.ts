import type { ClientMessage } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import { TerminalController } from "../src/features/terminal/model/controller";
import {
  type HostTransport,
  SessionHostClient,
  type ShellMessage,
} from "../src/platform/session-host";

function frame(channel: number, sequence: number, text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(12 + bytes.length);
  const view = new DataView(buffer);
  view.setUint32(0, channel);
  view.setBigUint64(4, BigInt(sequence));
  new Uint8Array(buffer, 12).set(bytes);
  return buffer;
}

async function host() {
  let control: (message: ShellMessage) => void = () => undefined;
  let terminal: (frame: ArrayBuffer) => void = () => undefined;
  const sent: ClientMessage[] = [];
  const inputs: [number, string][] = [];
  const transport: HostTransport = {
    async connect(onControl, onTerminal) {
      control = onControl;
      terminal = onTerminal;
    },
    async send(message) {
      sent.push(message);
      if (message.kind === "session.open")
        queueMicrotask(() =>
          control({
            kind: "session.opened",
            requestId: message.requestId,
            sessionId: "ses_1",
            workspaceId: message.workspaceId,
            conversationMode: "cli",
            channel: 3,
          }),
        );
    },
    async input(channel, bytes) {
      inputs.push([channel, new TextDecoder().decode(bytes)]);
    },
  };
  const client = new SessionHostClient(
    transport,
    () => 0 as unknown as ReturnType<typeof setTimeout>,
  );
  client.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    client,
    sent,
    inputs,
    frame: (buffer: ArrayBuffer) => terminal(buffer),
    control: (message: ShellMessage) => control(message),
  };
}

describe("the terminal controller", () => {
  it("opens the CLI conversation, writes its channel's output once, and relays input and size", async () => {
    const fake = await host();
    const written: string[] = [];
    const controller = new TerminalController(fake.client, "wsp_1", {
      write: (bytes) => written.push(new TextDecoder().decode(bytes)),
    });
    await controller.open();
    expect(fake.sent[0]).toMatchObject({
      kind: "session.open",
      workspaceId: "wsp_1",
      conversationMode: "cli",
    });
    expect(fake.sent[1]).toMatchObject({
      kind: "session.attach",
      sessionId: "ses_1",
      afterSequence: 0,
    });

    fake.frame(frame(3, 1, "hello "));
    fake.frame(frame(9, 2, "other channel"));
    fake.frame(frame(3, 1, "repeat"));
    fake.frame(frame(3, 2, "world"));
    expect(written).toEqual(["hello ", "world"]);

    controller.input(new TextEncoder().encode("ls\r"));
    controller.resize(120, 40);
    controller.resize(120, 40);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.inputs).toEqual([[3, "ls\r"]]);
    expect(fake.sent.filter((message) => message.kind === "session.resize")).toEqual([
      { kind: "session.resize", sessionId: "ses_1", columns: 120, rows: 40 },
    ]);

    controller.close();
    // Sends reach the shell in order, one after another.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.sent.at(-1)).toEqual({ kind: "session.detach", sessionId: "ses_1" });
  });
});
