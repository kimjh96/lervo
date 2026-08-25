import { createHash } from "node:crypto";

import type { RemoteCommandPayloadReference } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { AuthenticatedRemoteCommandHttpPayloadLoader } from "../src/index.js";

const bytes = new TextEncoder().encode("authenticated remote request source");
const reference: RemoteCommandPayloadReference = {
  artifactId: `art_${"a".repeat(64)}`,
  contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  byteCount: bytes.byteLength,
  mediaType: "text/plain; charset=utf-8",
};
const hubIdentity = `sha256:${"b".repeat(64)}`;

function response(body = bytes, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": reference.mediaType,
      "content-length": String(body.byteLength),
      "x-lervo-hub-identity": hubIdentity,
      "x-lervo-artifact-id": reference.artifactId,
      "x-lervo-content-hash": reference.contentHash,
      ...headers,
    },
  });
}

function loader(fetchImplementation: typeof fetch) {
  return new AuthenticatedRemoteCommandHttpPayloadLoader({
    baseUrl: "http://127.0.0.1:4242/",
    bearerToken: "payload-loader-token-aaaaaaaaaaaaaaaaaaaaaaaa",
    expectedHubIdentityHash: hubIdentity,
    destinationId: "hub:payload-test",
    nodeId: "node_payload_test_01",
    target: {
      projectId: "prj_payload_test_01",
      projectIdentityHash: `sha256:${"c".repeat(64)}`,
    },
    allowInsecureHttpForTests: true,
    fetch: fetchImplementation,
  });
}

describe("authenticated remote command HTTP payload loader", () => {
  it("binds the request and response to Hub, Node, project and artifact coordinates", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const request: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return response();
    };
    await expect(loader(request).load(reference)).resolves.toEqual(bytes);

    expect(requestedUrl).toContain(
      `/projects/prj_payload_test_01/artifacts/${reference.artifactId}`,
    );
    expect(requestedUrl).toContain("nodeId=node_payload_test_01");
    expect(requestedInit?.headers).toMatchObject({
      authorization: expect.stringMatching(/^Bearer /),
    });
  });

  it("rejects identity, length and content hash drift", async () => {
    await expect(
      loader(async () =>
        response(bytes, {
          "x-lervo-hub-identity": `sha256:${"d".repeat(64)}`,
        }),
      ).load(reference),
    ).rejects.toThrow("coordinates");
    await expect(loader(async () => response(bytes.slice(0, -1))).load(reference)).rejects.toThrow(
      "size",
    );
    const changed = bytes.slice();
    changed[0] = 0x41;
    await expect(loader(async () => response(changed)).load(reference)).rejects.toThrow("hash");
  });
});
