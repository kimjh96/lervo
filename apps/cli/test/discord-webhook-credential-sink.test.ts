import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DiscordWebhookCredentialFileSink } from "../src/discord-webhook-credential-sink.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Discord webhook credential file sink", () => {
  it("stores one owner-only token idempotently without returning credential bytes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-discord-webhook-"));
    roots.push(root);
    await chmod(root, 0o700);
    const sink = new DiscordWebhookCredentialFileSink(root);
    const input = {
      effectId: "ceoe_webhook01",
      webhookId: "623456789012345678",
      token: "w".repeat(40),
    };

    const first = await sink.store(input);
    const second = await sink.store(input);
    const path = resolve(root, "ceoe_webhook01.token");

    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toContain(input.token);
    expect(await readFile(path, "utf8")).toBe(`${input.token}\n`);
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o077).toBe(0);
    }
    await expect(sink.store({ ...input, token: "x".repeat(40) })).rejects.toThrow(
      "already contains other material",
    );
  });
});
