import { describe, expect, it, vi } from "vitest";

import { HubJsonHttpClient } from "../src/hub-json-http-client.js";

const options = {
  bearerToken: "hub-json-http-token-aaaaaaaaaaaaaaaaaaaaaaaa",
  expectedHubIdentityHash: `sha256:${"9".repeat(64)}`,
  destinationId: "hub:json-http",
};

function verifiedResponse(body = "{}", headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-lervo-hub-identity": options.expectedHubIdentityHash,
      ...headers,
    },
  });
}

describe("Hub identity-bound JSON HTTP client", () => {
  it("supports a public identity-bound request without loading a bearer credential", async () => {
    const request = vi.fn<typeof fetch>(async () => verifiedResponse());
    const client = new HubJsonHttpClient({
      expectedHubIdentityHash: options.expectedHubIdentityHash,
      destinationId: options.destinationId,
      fetch: request,
    });
    await expect(
      client.requestJson({
        url: new URL("https://hub.example.test/v1/health/capabilities"),
        method: "GET",
        acceptedStatuses: [200],
        credentialMode: "none",
      }),
    ).resolves.toMatchObject({ authentication: { status: "verified" } });
    expect(new Headers(request.mock.calls[0]![1]?.headers).has("authorization")).toBe(false);
    await expect(
      client.requestJson({
        url: new URL("https://hub.example.test/v1/private"),
        method: "GET",
        acceptedStatuses: [200],
        credentialMode: "bearer",
      }),
    ).rejects.toThrow("requires a bearer credential");
  });

  it("uses an explicit credential mode for bearer and public requests", async () => {
    const request = vi.fn<typeof fetch>(async () => verifiedResponse());
    const client = new HubJsonHttpClient({ ...options, fetch: request });
    const url = new URL("https://hub.example.test/v1/example");

    await client.requestJson({
      url,
      method: "POST",
      body: { value: true },
      acceptedStatuses: [200],
      credentialMode: "bearer",
    });
    await client.requestJson({
      url,
      method: "GET",
      acceptedStatuses: [200],
      credentialMode: "none",
    });

    expect(new Headers(request.mock.calls[0]![1]?.headers).get("authorization")).toBe(
      `Bearer ${options.bearerToken}`,
    );
    expect(new Headers(request.mock.calls[1]![1]?.headers).has("authorization")).toBe(false);
  });

  it("fails closed on an unknown credential mode before making a request", async () => {
    const request = vi.fn<typeof fetch>();
    const client = new HubJsonHttpClient({ ...options, fetch: request });

    await expect(
      client.requestJson({
        url: new URL("https://hub.example.test/v1/example"),
        method: "GET",
        acceptedStatuses: [200],
        credentialMode: "future-mode" as "none",
      }),
    ).rejects.toThrow("credential mode is invalid");
    expect(request).not.toHaveBeenCalled();
  });

  it("returns an unverified proof without parsing another Hub body", async () => {
    const client = new HubJsonHttpClient({
      ...options,
      fetch: vi.fn(
        async () =>
          new Response("not-json-and-must-not-be-trusted", {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-lervo-hub-identity": `sha256:${"8".repeat(64)}`,
            },
          }),
      ),
    });

    await expect(
      client.requestJson({
        url: new URL("https://hub.example.test/v1/example"),
        method: "GET",
        acceptedStatuses: [200],
        credentialMode: "none",
      }),
    ).resolves.toEqual({
      authentication: {
        status: "unverified",
        destinationId: options.destinationId,
        peerIdentityHash: null,
      },
      body: null,
    });
  });

  it("aborts a stalled request at the configured timeout", async () => {
    const stalledFetch = ((
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), {
          once: true,
        });
      })) as typeof fetch;
    const client = new HubJsonHttpClient({
      ...options,
      requestTimeoutMs: 10,
      fetch: stalledFetch,
    });

    await expect(
      client.requestJson({
        url: new URL("https://hub.example.test/v1/example"),
        method: "GET",
        acceptedStatuses: [200],
        credentialMode: "none",
      }),
    ).rejects.toThrow("request aborted");
  });

  it("rejects a declared response larger than its bounded JSON limit", async () => {
    const client = new HubJsonHttpClient({
      ...options,
      maxResponseBytes: 1_024,
      fetch: vi.fn(async () => verifiedResponse("{}", { "content-length": "2048" })),
    });

    await expect(
      client.requestJson({
        url: new URL("https://hub.example.test/v1/example"),
        method: "GET",
        acceptedStatuses: [200],
        credentialMode: "none",
      }),
    ).rejects.toThrow("response size");
  });
});
