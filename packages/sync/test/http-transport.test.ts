import { defaultProjectDataPolicy, type ProjectManifest } from "@lervo/schemas";
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
    expect(
      () =>
        new AuthenticatedHubHttpTransport({
          ...options,
          baseUrl: "http://hub.example.test/",
        }),
    ).toThrow("HTTPS URL");
    expect(
      () =>
        new AuthenticatedHubHttpTransport({
          ...options,
          baseUrl: "https://user:secret@hub.example.test/",
        }),
    ).toThrow("HTTPS URL");
  });

  it("rejects request coordinate drift before making a network call", async () => {
    const request = vi.fn<typeof fetch>();
    const transport = new AuthenticatedHubHttpTransport({ ...options, fetch: request });
    const registration = createProjectRegistrationRequest({
      manifest,
      destinationId: "hub:other",
      requestedAt: "2026-08-22T00:00:00.000Z",
    });
    await expect(transport.registerProject(registration)).rejects.toThrow(
      "differ from the transport configuration",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps the validated credential and coordinates even if caller-owned options change", async () => {
    const mutable = structuredClone(options);
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response("{}", {
          status: 201,
          headers: {
            "content-type": "application/json",
            "x-lervo-hub-identity": options.expectedHubIdentityHash,
          },
        }),
    );
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
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${options.bearerToken}`);
  });

  it("reads the authenticated peer capability surface without sending the bearer secret", async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            capability: "event_reader",
            readableEventSchemaVersions: [1, 2],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-lervo-hub-identity": options.expectedHubIdentityHash,
            },
          },
        ),
    );
    const transport = new AuthenticatedHubHttpTransport({ ...options, fetch: request });

    await expect(transport.readEventReaderCapabilities()).resolves.toMatchObject({
      authentication: {
        status: "verified",
        peerIdentityHash: options.expectedHubIdentityHash,
      },
      body: { capability: "event_reader", readableEventSchemaVersions: [1, 2] },
    });
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toBe("https://hub.example.test/v1/health/capabilities");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  });
});
