import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import type { TerminalIntegrationProvider } from "@lervo/repository-knowledge";

import type {
  TerminalActivationReadiness,
  TerminalActivationReceipt,
  TerminalHookEvent,
  TerminalRuntimeActivation,
} from "./terminal-hook-contract.js";

function activationPath(
  root: string,
  provider: TerminalIntegrationProvider,
  event: TerminalHookEvent,
): string {
  return resolve(
    root,
    ".lervo/state/terminal-integration",
    `${provider}-${event === "UserPromptSubmit" ? "user-prompt-submit" : "stop"}.json`,
  );
}

export async function writeTerminalActivationReceipt(
  root: string,
  receipt: TerminalActivationReceipt,
): Promise<void> {
  const directory = resolve(root, ".lervo/state/terminal-integration");
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error("Unsafe terminal activation state directory.");
  const target = activationPath(root, receipt.provider, receipt.hookEvent);
  const temporary = resolve(directory, `.activation-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(receipt)}\n`);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

export async function readTerminalActivationReceipts(
  root: string,
): Promise<TerminalActivationReceipt[]> {
  const receipts: TerminalActivationReceipt[] = [];
  for (const provider of ["codex", "claude"] as const) {
    for (const event of ["UserPromptSubmit", "Stop"] as const) {
      try {
        const path = activationPath(root, provider, event);
        const stats = await lstat(path);
        if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 16 * 1024) continue;
        const value = JSON.parse(await readFile(path, "utf8")) as TerminalActivationReceipt;
        if (
          value.schemaVersion === 1 &&
          value.contractId === "lervo_terminal_hooks_v2" &&
          value.provider === provider &&
          value.hookEvent === event &&
          typeof value.occurredAt === "string"
        )
          receipts.push(value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError))
          throw error;
      }
    }
  }
  return receipts.sort(
    (left, right) =>
      left.provider.localeCompare(right.provider) || left.hookEvent.localeCompare(right.hookEvent),
  );
}

export async function inspectTerminalRuntimeActivation(
  root: string,
  receipts: TerminalActivationReceipt[],
): Promise<TerminalRuntimeActivation> {
  const storage = await openProjectStorage(root);
  try {
    const observations: TerminalRuntimeActivation["observations"] = [];
    for (const provider of ["codex", "claude"] as const) {
      for (const hookEvent of ["UserPromptSubmit", "Stop"] as const) {
        const receipt = receipts.find(
          (item) => item.provider === provider && item.hookEvent === hookEvent,
        );
        const event =
          receipt?.observationEventId === undefined
            ? null
            : storage.events.get(receipt.observationEventId);
        const expectedType =
          hookEvent === "UserPromptSubmit" ? "terminal.context.prepared" : "terminal.turn.observed";
        const observed =
          receipt !== undefined &&
          event !== null &&
          event.type === expectedType &&
          event.actor.kind === "provider" &&
          event.actor.provider === provider &&
          event.occurredAt === receipt.occurredAt;
        observations.push({
          provider,
          hookEvent,
          status: observed ? "observed" : "not_observed",
          occurredAt: observed ? receipt.occurredAt : null,
        });
      }
    }
    const observedCount = observations.filter((item) => item.status === "observed").length;
    return {
      status:
        observedCount === observations.length
          ? "observed"
          : observedCount === 0
            ? "not_observed"
            : "partial",
      evidenceMeaning: "hook_endpoint_observed_not_provider_authorship",
      observations,
    };
  } finally {
    await storage.close();
  }
}

export function terminalActivationReadiness(
  runtime: TerminalRuntimeActivation,
): TerminalActivationReadiness {
  const missingProviders = (["codex", "claude"] as const).filter((provider) =>
    runtime.observations.some(
      (item) => item.provider === provider && item.status === "not_observed",
    ),
  );
  const actions: TerminalActivationReadiness["actions"] = missingProviders.map((provider) =>
    provider === "codex"
      ? {
          provider,
          code: "codex_hook_review_or_activation_required",
          instruction:
            "Open Codex in this repository, run /hooks, review and trust the Lervo UserPromptSubmit and Stop command hooks, then submit one prompt and complete one turn.",
        }
      : {
          provider,
          code: "claude_hook_activation_required",
          instruction:
            "Open Claude Code in this repository, submit one prompt, and complete one turn so both installed Lervo hooks are observed.",
        },
  );
  return { status: actions.length === 0 ? "ready" : "action_required", actions };
}
