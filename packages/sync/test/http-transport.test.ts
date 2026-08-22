import {
  defaultProjectDataPolicy,
  type ProjectManifest,
} from "@lervo/schemas";
import {
  calculateProjectIdentityHash,
  createProjectRegistrationRequest,
} from "@lervo/sync-contract";
import { describe, expect, it, vi } from "vitest";

import { AuthenticatedHubHttpTransport } from "../src/index.js";

const manifest: ProjectManifest = {
  schemaVersion: 1,
  projectId: "prj_sync_http_01",
  name: "sync-http-fixture",
  root: ".",
  createdAt: "2026-08-22T00:00:00.000Z",
  dataPolicy: { ...defaultProjectDataPolicy, hubSyncEnabled: true },
};
const target = {
  projectId: manifest.projectId,
  projectIdentityHash: calculateProjectIdentityHash(manifest),
};
const options = {
  baseUrl: "https://hub.example.test/",
  bearerToken: "hub-sync-http-token-aaaaaaaaaaaaaaaaaaaaaaaa",
  expectedHubIdentityHash: `sha256:${"9".repeat(64)}`,
  destinationId: "hub:sync-http",
  target,
};

describe("authenticated Hub sync HTTP transport", () => {
  it("requires HTTPS unless a local fixture explicitly allows HTTP", () => {
    expect(() => new AuthenticatedHubHttpTransport({
      ...options,
      baseUrl: "http://hub.example.test/",
    })).toThrow("HTTPS URL");
    expect(() => new AuthenticatedHubHttpTransport({
      ...options,
      baseUrl: "https://user:secret@hub.example.test/",
    })).toThrow("HTTPS URL");
  });

  it("rejects request coordinate drift before making a network call", async () => {
    const request = vi.fn<typeof fetch>();
    const transport = new AuthenticatedHubHttpTransport({ ...options, fetch: request });
    const registration = createProjectRegistrationRequest({
      manifest,
      destinationId: "hub:other",
      requestedAt: "2026-08-22T00:00:00.000Z",
    });
    await expect(transport.registerProject(registration)).rejects.toThrow("설정과 다릅니다");
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps the validated credential and coordinates even if caller-owned options change", async () => {
    const mutable = structuredClone(options);
    const request = vi.fn<typeof fetch>(async () => new Response("{}", {
      status: 201,
      headers: {
        "content-type": "application/json",
        "x-lervo-hub-identity": options.expectedHubIdentityHash,
      },
    }));
    const transport = new AuthenticatedHubHttpTransport({ ...mutable, fetch: request });
    const registration = createProjectRegistrationRequest({
      manifest,
      destinationId: options.destinationId,
      requestedAt: "2026-08-22T00:00:00.000Z",
    });
    mutable.bearerToken = "changed-token-cccccccccccccccccccccccccccccccc";
    mutable.destinationId = "hub:changed";
    mutable.target.projectId = "prj_changed_01";

    await expect(transport.registerProject(registration)).resolves.toMatchObject({
      authentication: { status: "verified", destinationId: options.destinationId },
    });
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toContain(`/projects/${manifest.projectId}/registration`);
    expect(String(url)).toContain("destinationId=hub%3Async-http");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${options.bearerToken}`,
    );
  });

  it("returns an unverified proof without parsing a response from another Hub", async () => {
    const transport = new AuthenticatedHubHttpTransport({
      ...options,
      fetch: vi.fn(async () => new Response("not-json-and-must-not-be-trusted", {
        status: 201,
        headers: {
          "content-type": "application/json",
          "x-lervo-hub-identity": `sha256:${"8".repeat(64)}`,
        },
      })),
    });
    const registration = createProjectRegistrationRequest({
      manifest,
      destinationId: options.destinationId,
      requestedAt: "2026-08-22T00:00:00.000Z",
    });
    await expect(transport.registerProject(registration)).resolves.toEqual({
      authentication: {
        status: "unverified",
        destinationId: options.destinationId,
        peerIdentityHash: null,
      },
      body: null,
    });
  });

  it("aborts a stalled request at the configured timeout", async () => {
    const stalledFetch = ((_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), {
          once: true,
        });
      })) as typeof fetch;
    const transport = new AuthenticatedHubHttpTransport({
      ...options,
      requestTimeoutMs: 10,
      fetch: stalledFetch,
    });
    const registration = createProjectRegistrationRequest({
      manifest,
      destinationId: options.destinationId,
      requestedAt: "2026-08-22T00:00:00.000Z",
    });
    await expect(transport.registerProject(registration)).rejects.toThrow("request aborted");
  });

  it("rejects a declared response larger than its bounded JSON limit", async () => {
    const transport = new AuthenticatedHubHttpTransport({
      ...options,
      maxResponseBytes: 1_024,
      fetch: vi.fn(async () => new Response("{}", {
        status: 201,
        headers: {
          "content-length": "2048",
          "content-type": "application/json",
          "x-lervo-hub-identity": options.expectedHubIdentityHash,
        },
      })),
    });
    const registration = createProjectRegistrationRequest({
      manifest,
      destinationId: options.destinationId,
      requestedAt: "2026-08-22T00:00:00.000Z",
    });
    await expect(transport.registerProject(registration)).rejects.toThrow("응답 크기");
  });
});
