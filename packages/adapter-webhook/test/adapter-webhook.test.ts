import {
  createLiveWebhookAdapter,
  createLiveWebhookSignature,
  openLiveWebhookServer,
} from "@lervo/adapter-webhook";
import { describe, expect, it } from "vitest";

const secret = Buffer.from("01234567890123456789012345678901", "utf8");

describe("live webhook adapter", () => {
  it("authenticates exact signed bytes without retaining native identifiers or content", async () => {
    const body = Buffer.from('{"private":"payload"}', "utf8");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const eventId = "native-event-42";
    const eventType = "issue.updated";
    let loadedSecret: Buffer | undefined;
    const adapter = createLiveWebhookAdapter({
      sourceId: "github.primary",
      credentialId: "github.webhook",
      expectedPath: "/hooks/github",
      credentialSource: {
        load: async () => {
          loadedSecret = Buffer.from(secret);
          return loadedSecret;
        },
      },
    });
    const observation = await adapter.authenticate({
      method: "POST",
      path: "/hooks/github",
      headers: {
        "x-lervo-timestamp": timestamp,
        "x-lervo-event-id": eventId,
        "x-lervo-event-type": eventType,
        "x-lervo-signature": createLiveWebhookSignature({
          secret,
          timestamp,
          eventId,
          eventType,
          body,
        }),
      },
      body,
      receivedAt: new Date(Number(timestamp) * 1000).toISOString(),
    });
    expect(observation).toMatchObject({
      sourceId: "github.primary",
      credentialId: "github.webhook",
      eventType,
    });
    expect(JSON.stringify(observation)).not.toContain(eventId);
    expect(JSON.stringify(observation)).not.toContain("private");
    expect(loadedSecret).toEqual(Buffer.alloc(secret.byteLength));
  });

  it("serves one bounded loopback request and rejects a bad signature", async () => {
    const adapter = createLiveWebhookAdapter({
      sourceId: "source.primary",
      credentialId: "source.secret",
      expectedPath: "/hook",
      credentialSource: { load: async () => Buffer.from(secret) },
    });
    const server = await openLiveWebhookServer({
      host: "127.0.0.1",
      port: 0,
      maximumBodyBytes: 1024,
      once: true,
      handler: {
        handle: async (request) => {
          await adapter.authenticate(request);
          return { statusCode: 202, body: { status: "accepted" } };
        },
      },
    });
    const response = await fetch(`http://127.0.0.1:${server.port}/hook`, {
      method: "POST",
      headers: {
        "x-lervo-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-lervo-event-id": "event-1",
        "x-lervo-event-type": "push.created",
        "x-lervo-signature": `v1=${"0".repeat(64)}`,
      },
      body: "private",
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ failureCode: "authentication_failed" });
    await server.closed;
    await expect(
      openLiveWebhookServer({
        host: "0.0.0.0" as "127.0.0.1",
        port: 0,
        maximumBodyBytes: 1024,
        handler: { handle: async () => ({ statusCode: 200, body: {} }) },
      }),
    ).rejects.toMatchObject({ code: "server_failed" });
  });
});
