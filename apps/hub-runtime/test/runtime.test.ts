import { EventEmitter } from "node:events";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";
import type { TLSSocket } from "node:tls";

import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import { createProjectRegistrationRequest } from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import { loadHubRuntimeConfig, openHubRuntime, runHubRuntimeCli } from "../src/index.js";
import {
  availablePort,
  enableRuntimeTls,
  enableRuntimeSigningFile,
  removeTemporaryRoots,
  rotatedRuntimeToken,
  runtimeConfigFixture,
  runtimeDestinationId,
  runtimeProjectId,
  runtimeToken,
  runtimeTlsCertificate,
  temporaryRoot,
  ownerFile,
  writeRotatedRuntimeSigning,
  writeRuntimeCredentials,
} from "./fixture.js";

afterEach(removeTemporaryRoots);

describe("Hub runtime deployment entrypoint", () => {
  it("serves the composed Hub over TLS 1.3 with an explicitly trusted certificate", async () => {
    const root = await temporaryRoot();
    const port = await availablePort();
    const fixture = await runtimeConfigFixture(root, port);
    await enableRuntimeTls(root, fixture);
    const deployment = await openHubRuntime(await loadHubRuntimeConfig(fixture.configPath));
    await expect(deployment.listen()).resolves.toEqual({
      host: "127.0.0.1",
      port,
      protocol: "https",
    });

    const response = await new Promise<{
      status: number | undefined;
      body: string;
      protocol: string;
    }>((resolvePromise, reject) => {
      const request = httpsRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: "/v1/trace/projects",
          method: "GET",
          ca: runtimeTlsCertificate,
          minVersion: "TLSv1.3",
          headers: { authorization: `Bearer ${runtimeToken}` },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          const protocol = (incoming.socket as TLSSocket).getProtocol() ?? "";
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.on("end", () =>
            resolvePromise({
              status: incoming.statusCode,
              body: Buffer.concat(chunks).toString("utf8"),
              protocol,
            }),
          );
        },
      );
      request.once("error", reject);
      request.end();
    });
    expect(response.status).toBe(200);
    expect(response.protocol).toBe("TLSv1.3");
    expect(JSON.parse(response.body)).toMatchObject({ schemaVersion: 1, projects: [] });

    const health = await new Promise<{
      status: number | undefined;
      identity: string | undefined;
      body: string;
    }>((resolvePromise, reject) => {
      const request = httpsRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: "/v1/health/ready",
          method: "GET",
          ca: runtimeTlsCertificate,
          minVersion: "TLSv1.3",
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
          incoming.on("end", () =>
            resolvePromise({
              status: incoming.statusCode,
              identity: incoming.headers["x-lervo-hub-identity"] as string | undefined,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      request.once("error", reject);
      request.end();
    });
    expect(health).toEqual({
      status: 200,
      identity: `sha256:${"9".repeat(64)}`,
      body: JSON.stringify({ schemaVersion: 1, status: "ready" }),
    });
    await deployment.close();
  });

  it("reloads TLS and new signing key IDs together while retaining the prior material on failure", async () => {
    const root = await temporaryRoot();
    const port = await availablePort();
    const fixture = await runtimeConfigFixture(root, port);
    await enableRuntimeSigningFile(root, fixture);
    await enableRuntimeTls(root, fixture);
    const deployment = await openHubRuntime(await loadHubRuntimeConfig(fixture.configPath));
    await deployment.listen();
    await writeRotatedRuntimeSigning(root);
    const first = deployment.reloadRuntimeMaterials();
    const second = deployment.reloadRuntimeMaterials();
    expect(second).toBe(first);
    await first;

    await writeRotatedRuntimeSigning(root, {
      policyKeyId: "key_runtime_policy_02",
      commandKeyId: "key_runtime_command_02",
    });
    await expect(deployment.reloadRuntimeMaterials()).rejects.toMatchObject({
      code: "runtime_material_reload_failed",
    });
    await ownerFile(resolve(root, "tls.key"), "invalid-private-key-material");
    await expect(deployment.reloadRuntimeMaterials()).rejects.toMatchObject({
      code: "runtime_material_reload_failed",
    });

    const response = await new Promise<number | undefined>((resolvePromise, reject) => {
      const request = httpsRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: "/v1/trace/projects",
          method: "GET",
          ca: runtimeTlsCertificate,
          minVersion: "TLSv1.3",
          headers: { authorization: `Bearer ${runtimeToken}` },
        },
        (incoming) => {
          incoming.resume();
          incoming.on("end", () => resolvePromise(incoming.statusCode));
        },
      );
      request.once("error", reject);
      request.end();
    });
    expect(response).toBe(200);
    await deployment.close();
  });

  it("atomically reloads an owner-only credential snapshot and retains the prior snapshot on failure", async () => {
    const root = await temporaryRoot();
    const port = await availablePort();
    const fixture = await runtimeConfigFixture(root, port);
    const deployment = await openHubRuntime(await loadHubRuntimeConfig(fixture.configPath));
    await deployment.listen();
    const endpoint = `http://127.0.0.1:${port}/v1/trace/projects`;
    const status = async (token: string) =>
      (
        await fetch(endpoint, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status;

    expect(await status(runtimeToken)).toBe(200);
    expect(await status(rotatedRuntimeToken)).toBe(401);
    await writeRuntimeCredentials(root, rotatedRuntimeToken);
    const first = deployment.reloadCredentials();
    const second = deployment.reloadCredentials();
    expect(second).toBe(first);
    await first;
    expect(await status(runtimeToken)).toBe(401);
    expect(await status(rotatedRuntimeToken)).toBe(200);

    await writeFile(resolve(root, "credentials.json"), "private-invalid-credential-json", {
      mode: 0o600,
    });
    await expect(deployment.reloadCredentials()).rejects.toMatchObject({
      code: "credential_reload_failed",
    });
    expect(await status(rotatedRuntimeToken)).toBe(200);
    await deployment.close();
  });

  it("serves the composed Hub and closes cleanup before reopening storage on SIGTERM", async () => {
    const root = await temporaryRoot();
    const port = await availablePort();
    const fixture = await runtimeConfigFixture(root, port);
    const signals = new EventEmitter();
    let started!: () => void;
    const listening = new Promise<void>((resolve) => {
      started = resolve;
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const running = runHubRuntimeCli(["--config", fixture.configPath], {
      cwd: root,
      signals,
      stdout(message) {
        stdout.push(message);
        if (message.includes("started on")) started();
      },
      stderr: (message) => stderr.push(message),
    });

    await listening;
    const response = await fetch(`http://127.0.0.1:${port}/v1/trace/projects`, {
      headers: { authorization: `Bearer ${runtimeToken}` },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ schemaVersion: 1, projects: [] });

    const registration = createProjectRegistrationRequest({
      destinationId: runtimeDestinationId,
      requestedAt: "2026-08-22T00:00:00.000Z",
      manifest: {
        schemaVersion: 1,
        projectId: runtimeProjectId,
        name: "runtime-sync",
        root: ".",
        createdAt: "2026-08-22T00:00:00.000Z",
        dataPolicy: {
          eventMetadataRetentionDays: 90,
          artifactRetentionDays: 30,
          persistRawPrompts: false,
          persistDocumentBodiesInEvents: false,
          hubSyncEnabled: true,
          eventPayloadMode: "allowlist",
        },
      },
    });
    const syncEndpoint = new URL(
      `/v1/sync/projects/${runtimeProjectId}/registration`,
      `http://127.0.0.1:${port}`,
    );
    syncEndpoint.searchParams.set("destinationId", runtimeDestinationId);
    syncEndpoint.searchParams.set("projectIdentityHash", registration.projectIdentityHash);
    const syncResponse = await fetch(syncEndpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${runtimeToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(registration),
    });
    expect(syncResponse.status).toBe(201);
    await expect(syncResponse.json()).resolves.toMatchObject({
      status: "registered",
      destinationId: runtimeDestinationId,
      projectId: runtimeProjectId,
    });

    signals.emit("SIGTERM");
    await expect(running).resolves.toBe(0);
    expect(stdout).toEqual([`Lervo Hub started on 127.0.0.1:${port}.\n`]);
    expect(stderr).toEqual([]);
    await expect(fetch(`http://127.0.0.1:${port}/v1/trace/projects`)).rejects.toThrow();

    const reopened = await HubSyncSQLiteStore.open({ path: fixture.databasePath });
    await expect(reopened.auditIntegrity()).resolves.toMatchObject({
      valid: true,
      projectCount: 1,
    });
    await reopened.close();
  });

  it("returns a fixed startup error without echoing invalid key bytes", async () => {
    const root = await temporaryRoot();
    const fixture = await runtimeConfigFixture(root, await availablePort());
    const secretText = "private-key-material-must-not-be-printed";
    const keyPath = resolve(root, "policy.pem");
    await writeFile(keyPath, secretText);
    await chmod(keyPath, 0o600);
    const stderr: string[] = [];
    await expect(
      runHubRuntimeCli(["--config", fixture.configPath], {
        cwd: root,
        stdout: () => undefined,
        stderr: (message) => stderr.push(message),
      }),
    ).resolves.toBe(1);
    expect(stderr.join("\n")).toContain("startup_failed");
    expect(stderr.join("\n")).not.toContain(secretText);
  });

  it("returns the same shutdown promise for repeated close requests", async () => {
    const root = await temporaryRoot();
    const fixture = await runtimeConfigFixture(root, await availablePort());
    const deployment = await openHubRuntime(await loadHubRuntimeConfig(fixture.configPath));
    await expect(deployment.listen()).resolves.toMatchObject({ protocol: "http" });
    const first = deployment.close();
    const second = deployment.close();
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ status: "stopped" });
  });

  it("refuses a database directory readable by another OS account", async () => {
    if (process.platform === "win32") return;
    const root = await temporaryRoot();
    const fixture = await runtimeConfigFixture(root, await availablePort());
    await mkdir(resolve(root, "state"), { mode: 0o755 });
    await chmod(resolve(root, "state"), 0o755);
    const stderr: string[] = [];
    await expect(
      runHubRuntimeCli(["--config", fixture.configPath], {
        cwd: root,
        stdout: () => undefined,
        stderr: (message) => stderr.push(message),
      }),
    ).resolves.toBe(1);
    expect(stderr.join("\n")).toContain("unsafe_runtime_file");
  });
});
