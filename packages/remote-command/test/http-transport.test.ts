import {
  AuthenticatedRemoteCommandHttpTransport,
} from "@lervo/remote-command";
import { describe, expect, it, vi } from "vitest";

const options = {
  baseUrl: "https://hub.example.test/",
  bearerToken: "remote-command-http-token-aaaaaaaaaaaaaaaaaaaa",
  expectedHubIdentityHash: `sha256:${"1".repeat(64)}`,
  destinationId: "hub:http-transport",
  nodeId: "node_http_transport",
  target: {
    projectId: "prj_http_transport",
    projectIdentityHash: `sha256:${"2".repeat(64)}`,
  },
};

describe("remote command authenticated HTTP transport", () => {
  it("requires HTTPS outside an explicit local fixture", () => {
    expect(() => new AuthenticatedRemoteCommandHttpTransport({
      ...options,
      baseUrl: "http://hub.example.test/",
    })).toThrow("HTTPS URL");
    expect(() => new AuthenticatedRemoteCommandHttpTransport({
      ...options,
      baseUrl: "https://user:secret@hub.example.test/",
    })).toThrow("HTTPS URL");
  });

  it("aborts a stalled request at the configured timeout", async () => {
    const stalledFetch = ((
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), {
        once: true,
      });
    })) as typeof fetch;
    const transport = new AuthenticatedRemoteCommandHttpTransport({
      ...options,
      requestTimeoutMs: 10,
      fetch: stalledFetch,
    });

    await expect(transport.pullRemoteCommands({
      destinationId: options.destinationId,
      target: options.target,
      nodeId: options.nodeId,
      requestedAt: "2026-08-19T00:00:00.000Z",
      leaseDurationMs: 30_000,
      limit: 1,
    })).rejects.toThrow("request aborted");
  });

  it("rejects coordinate drift before making a network request", async () => {
    const request = vi.fn<typeof fetch>();
    const transport = new AuthenticatedRemoteCommandHttpTransport({
      ...options,
      fetch: request,
    });
    await expect(transport.pullRemoteCommands({
      destinationId: "hub:other",
      target: options.target,
      nodeId: options.nodeId,
      requestedAt: "2026-08-19T00:00:00.000Z",
      leaseDurationMs: 30_000,
      limit: 1,
    })).rejects.toThrow("설정과 다릅니다");
    expect(request).not.toHaveBeenCalled();
  });
});
