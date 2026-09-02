import { describe, expect, it, vi } from "vitest";

import { SlackAssignmentWebApiTransport } from "../src/index.js";
import { BOT_TOKEN, CHANNEL_ID, TEAM_ID } from "./assignment-fixture.js";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const request = {
  botToken: BOT_TOKEN,
  teamId: TEAM_ID,
  channelId: CHANNEL_ID,
  threadTs: null,
  text: "Verified handoff",
};

describe("Slack assignment Web API transport", () => {
  it("maps one exact Slack receipt and disables markup and unfurls", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: `Bearer ${BOT_TOKEN}` });
      expect(JSON.parse(String(init?.body))).toEqual({
        channel: CHANNEL_ID,
        text: request.text,
        mrkdwn: false,
        unfurl_links: false,
        unfurl_media: false,
      });
      return response({ ok: true, channel: CHANNEL_ID, ts: "1788336000.123456" });
    });
    const transport = new SlackAssignmentWebApiTransport({
      fetch,
      now: () => new Date("2026-09-02T08:00:02.000Z"),
    });

    await expect(transport.send(request)).resolves.toEqual({
      status: "delivered",
      messageTs: "1788336000.123456",
      deliveredAt: "2026-09-02T08:00:02.000Z",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("separates definitive API rejection from ambiguous transport evidence", async () => {
    const rejected = new SlackAssignmentWebApiTransport({
      fetch: async () => response({ ok: false, error: "not_in_channel" }),
    });
    await expect(rejected.send(request)).resolves.toEqual({ status: "rejected" });

    for (const fetch of [
      async () => response({ ok: true, channel: CHANNEL_ID }),
      async () => {
        throw new Error("connection reset");
      },
    ]) {
      const unknown = new SlackAssignmentWebApiTransport({ fetch });
      await expect(unknown.send(request)).resolves.toEqual({ status: "unknown" });
    }
  });
});
