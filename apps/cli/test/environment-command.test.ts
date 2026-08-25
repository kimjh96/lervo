import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

describe("environment command", () => {
  it("requires explicit ephemeral intent for a direct adapter query", async () => {
    const stderr: string[] = [];
    expect(
      await runCli(["environment", "query", "--adapter", "tailscale"], {
        cwd: process.cwd(),
        stdout: () => undefined,
        stderr: (message) => stderr.push(message),
      }),
    ).toBe(1);
    expect(stderr.join("")).toContain("--ephemeral");
  });

  it("returns normalized JSON without persisting an ephemeral query", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-environment-"));
    const stdout: string[] = [];
    const code = await runCli(
      ["environment", "query", "--adapter", "tailscale", "--ephemeral", "--json"],
      {
        cwd: root,
        stdout: (message) => stdout.push(message),
        stderr: () => undefined,
      },
      {
        executeEnvironmentQuery: async ({ source }) => ({
          schemaVersion: 1,
          sourceId: source.sourceId,
          adapterId: source.adapterId,
          scope: source.scope,
          status: "available",
          observedAt: "2026-08-22T00:00:00.000Z",
          validUntil: "2026-08-22T00:01:00.000Z",
          subjects: [],
          verification: [
            { kind: "source_session", status: "verified", checkedAt: "2026-08-22T00:00:00.000Z" },
          ],
        }),
      },
    );
    expect(code).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      persistence: "ephemeral",
      observation: { adapterId: "tailscale" },
    });
    await expect(
      readFile(resolve(root, ".lervo/state/environment/src_ephemeral_query.observation.json")),
    ).rejects.toThrow();
  });

  it("persists a registered source observation and resolves a logical target", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-environment-"));
    await mkdir(resolve(root, ".lervo/environment-sources"), { recursive: true });
    await mkdir(resolve(root, ".lervo/environment-targets"), { recursive: true });
    await writeFile(
      resolve(root, ".lervo/environment-sources/src_fixture_local.source.yaml"),
      [
        "schemaVersion: 1",
        "sourceId: src_fixture_local",
        "adapterId: fixture.network",
        "scope: project",
        "capabilities: [network.peer]",
        "maximumValiditySeconds: 300",
        "sharing: local_only",
        "configuration: {}",
        "",
      ].join("\n"),
    );
    await writeFile(
      resolve(root, ".lervo/environment-targets/tgt_always_on_host.target.yaml"),
      [
        "schemaVersion: 1",
        "targetId: tgt_always_on_host",
        "requiredCapabilities: [network.peer]",
        "selectors:",
        "  - label: device.hostname",
        "    equals: WORKER",
        "preferredSourceIds: [src_fixture_local]",
        "",
      ].join("\n"),
    );
    const io = {
      cwd: root,
      stdout: (_message: string) => undefined,
      stderr: (_message: string) => undefined,
    };
    const now = new Date();
    const stdout: string[] = [];
    expect(
      await runCli(
        ["environment", "query", "--target", "tgt_always_on_host", "--json"],
        {
          ...io,
          stdout: (message) => stdout.push(message),
        },
        {
          executeEnvironmentQuery: async ({ source }) => ({
            schemaVersion: 1,
            sourceId: source.sourceId,
            adapterId: source.adapterId,
            scope: source.scope,
            status: "available",
            observedAt: now.toISOString(),
            validUntil: new Date(now.getTime() + 300_000).toISOString(),
            subjects: [
              {
                subjectId: "sub_0123456789abcdef01234567",
                kind: "device",
                labels: { "device.hostname": "WORKER" },
                capabilities: ["network.peer"],
                endpoints: [],
              },
            ],
            verification: [
              { kind: "source_session", status: "verified", checkedAt: now.toISOString() },
            ],
          }),
        },
      ),
    ).toBe(0);
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      resolution: { status: "resolved", candidate: { sourceId: "src_fixture_local" } },
    });
    expect(
      JSON.parse(
        await readFile(
          resolve(root, ".lervo/state/environment/src_fixture_local.observation.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      sourceId: "src_fixture_local",
      subjects: [{ labels: { "device.hostname": "WORKER" } }],
    });
  });
});
