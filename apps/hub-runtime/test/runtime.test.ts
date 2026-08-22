import { EventEmitter } from "node:events";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadHubRuntimeConfig,
  openHubRuntime,
  runHubRuntimeCli,
} from "../src/index.js";
import {
  availablePort,
  removeTemporaryRoots,
  runtimeConfigFixture,
  runtimeToken,
  temporaryRoot,
} from "./fixture.js";

afterEach(removeTemporaryRoots);

describe("Hub runtime deployment entrypoint", () => {
  it("serves the composed Hub and closes cleanup before reopening storage on SIGTERM", async () => {
    const root = await temporaryRoot();
    const port = await availablePort();
    const fixture = await runtimeConfigFixture(root, port);
    const signals = new EventEmitter();
    let started!: () => void;
    const listening = new Promise<void>((resolve) => { started = resolve; });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const running = runHubRuntimeCli(["--config", fixture.configPath], {
      cwd: root,
      signals,
      stdout(message) {
        stdout.push(message);
        if (message.includes("시작됐습니다")) started();
      },
      stderr: (message) => stderr.push(message),
    });

    await listening;
    const response = await fetch(`http://127.0.0.1:${port}/v1/trace/projects`, {
      headers: { authorization: `Bearer ${runtimeToken}` },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ schemaVersion: 1, projects: [] });

    signals.emit("SIGTERM");
    await expect(running).resolves.toBe(0);
    expect(stdout).toEqual([`Lervo Hub가 127.0.0.1:${port}에서 시작됐습니다.\n`]);
    expect(stderr).toEqual([]);
    await expect(fetch(`http://127.0.0.1:${port}/v1/trace/projects`)).rejects.toThrow();

    const reopened = await HubSyncSQLiteStore.open({ path: fixture.databasePath });
    await expect(reopened.auditIntegrity()).resolves.toMatchObject({ valid: true });
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
    await expect(runHubRuntimeCli(["--config", fixture.configPath], {
      cwd: root,
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    })).resolves.toBe(1);
    expect(stderr.join("\n")).toContain("startup_failed");
    expect(stderr.join("\n")).not.toContain(secretText);
  });

  it("returns the same shutdown promise for repeated close requests", async () => {
    const root = await temporaryRoot();
    const fixture = await runtimeConfigFixture(root, await availablePort());
    const deployment = await openHubRuntime(await loadHubRuntimeConfig(fixture.configPath));
    await deployment.listen();
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
    await expect(runHubRuntimeCli(["--config", fixture.configPath], {
      cwd: root,
      stdout: () => undefined,
      stderr: (message) => stderr.push(message),
    })).resolves.toBe(1);
    expect(stderr.join("\n")).toContain("unsafe_runtime_file");
  });
});
