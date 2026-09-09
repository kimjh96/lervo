import { createHash, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";

import type { DiscordWebhookCredentialSink } from "@lervo/adapter-discord";
import { readOwnerOnlyText } from "@lervo/runtime-security";

async function ownerOnlyDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("The Discord webhook credential directory is invalid.");
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error("The Discord webhook credential directory must be owner-only.");
  }
}

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export class DiscordWebhookCredentialFileSink implements DiscordWebhookCredentialSink {
  constructor(private readonly directory: string) {}

  async store(input: { effectId: string; webhookId: string; token: string }) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(input.effectId) ||
      !/^[0-9]{1,32}$/u.test(input.webhookId) ||
      input.token.length < 20 ||
      input.token.length > 4_096 ||
      !/^[\x21-\x7e]+$/u.test(input.token)
    ) {
      throw new Error("The Discord webhook credential material is invalid.");
    }
    await ownerOnlyDirectory(this.directory);
    const path = resolve(this.directory, `${input.effectId}.token`);
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(`${input.token}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const existing = (await readOwnerOnlyText(path, 4_096)).trim();
      if (!sameSecret(existing, input.token)) {
        throw new Error("The Discord webhook credential target already contains other material.", {
          cause: error,
        });
      }
    }
    return {
      credentialReferenceHash: `sha256:${createHash("sha256").update(path).digest("hex")}`,
    };
  }
}
