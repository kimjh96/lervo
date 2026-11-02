import { expect, it } from "vitest";

import { ConversationPlatformError, getPlatformJson } from "../src/index.js";

const read = (response: Response) =>
  getPlatformJson({
    url: "https://discord.example/api/channels/1/messages",
    headers: {},
    fetch: async () => response,
  }).then(
    () => null,
    (error: unknown) => error,
  );

it("labels a rejected history read with its HTTP status and never the body", async () => {
  const error = (await read(
    new Response(JSON.stringify({ message: "private detail" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    }),
  )) as ConversationPlatformError & { cause?: { code?: string; message?: string } };
  expect(error).toBeInstanceOf(ConversationPlatformError);
  expect(error.code).toBe("platform_ingress_failed");
  expect(error.cause?.code).toBe("http_429");
  expect(JSON.stringify({ code: error.cause?.code, message: error.cause?.message })).not.toContain(
    "private detail",
  );
});

it("labels malformed platform responses with stable codes", async () => {
  const error = (await read(
    new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
  )) as { cause?: { code?: string } };
  expect(error.cause?.code).toBe("response_content_type_mismatch");
});
