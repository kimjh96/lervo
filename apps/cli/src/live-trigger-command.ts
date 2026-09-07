import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  createLiveWebhookAdapter,
  liveWebhookAdapterDescriptor,
  openLiveWebhookServer,
} from "@lervo/adapter-webhook";
import { liveWebhookAuthorizationId } from "@lervo/live-trigger-contract";
import { SQLiteLiveTriggerReservationStore } from "@lervo/live-trigger-sqlite";

import { createLiveTriggerApplication } from "./live-trigger-application.js";
import {
  loadLiveWebhookAuthorization,
  loadLiveWebhookServerConfig,
} from "./live-trigger-config.js";
import { validateLiveTriggerStartupTarget } from "./live-trigger-startup.js";
import type { CliIo } from "./types.js";

export const liveTriggerUsage = `  lervo trigger webhook serve --config <config.json> [--once] [--json]
  lervo trigger webhook recover --config <config.json> --before <ISO-8601> [--limit <1..1000>] [--json]
  lervo trigger webhook prune --config <config.json> --before <ISO-8601> [--limit <1..1000>] [--json]`;

function waitForShutdown(): Promise<void> {
  return new Promise((resolveShutdown) => {
    const finish = () => {
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      resolveShutdown();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

function retentionArguments(args: string[]) {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      before: { type: "string" },
      limit: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (parsed.values.help) return { help: true as const };
  if (parsed.values.config === undefined || parsed.values.before === undefined)
    throw new Error("Webhook retention requires config and before values.");
  const limit = Number(parsed.values.limit ?? "100");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)
    throw new Error("Webhook retention limit must be between 1 and 1000.");
  return {
    help: false as const,
    action: parsed.positionals[1],
    config: parsed.values.config,
    before: parsed.values.before,
    limit,
    json: parsed.values.json ?? false,
  };
}

async function runRetention(args: string[], io: CliIo): Promise<number> {
  const input = retentionArguments(args);
  if (input.help) {
    io.stdout(`${liveTriggerUsage}\n`);
    return 0;
  }
  const config = await loadLiveWebhookServerConfig(resolve(io.cwd, input.config));
  const store = await SQLiteLiveTriggerReservationStore.open({
    path: resolve(config.repositoryRoot, ".lervo/data/live-trigger.sqlite"),
  });
  try {
    const affected =
      input.action === "recover"
        ? await store.recoverUnfinished({ before: input.before, limit: input.limit })
        : await store.pruneCompleted({ before: input.before, limit: input.limit });
    const result = { status: "completed", action: input.action, affected };
    io.stdout(
      input.json ? `${JSON.stringify(result, null, 2)}\n` : `${input.action}: ${affected}\n`,
    );
    return 0;
  } finally {
    await store.close();
  }
}

async function runServe(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      once: { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (parsed.values.help) {
    io.stdout(`${liveTriggerUsage}\n`);
    return 0;
  }
  if (parsed.values.config === undefined)
    throw new Error("Webhook serving requires a config file.");
  const config = await loadLiveWebhookServerConfig(resolve(io.cwd, parsed.values.config));
  const initialAuthorization = await loadLiveWebhookAuthorization(config.authorizationFile);
  if (
    initialAuthorization.adapterId !== liveWebhookAdapterDescriptor.adapterId ||
    initialAuthorization.adapterVersion !== liveWebhookAdapterDescriptor.adapterVersion ||
    initialAuthorization.credentialId !== config.credential.credentialId
  )
    throw new Error("The webhook config and authorization coordinates do not match.");
  await validateLiveTriggerStartupTarget({
    repositoryRoot: config.repositoryRoot,
    authorization: initialAuthorization,
  });
  const startupSecret = process.env[config.credential.secretEnvironmentVariable];
  if (
    startupSecret === undefined ||
    Buffer.byteLength(startupSecret, "utf8") < 32 ||
    Buffer.byteLength(startupSecret, "utf8") > 4096
  )
    throw new Error("The webhook credential environment variable is unavailable or invalid.");
  const store = await SQLiteLiveTriggerReservationStore.open({
    path: resolve(config.repositoryRoot, ".lervo/data/live-trigger.sqlite"),
  });
  const adapter = createLiveWebhookAdapter({
    sourceId: initialAuthorization.sourceId,
    credentialId: config.credential.credentialId,
    expectedPath: config.listen.path,
    maximumBodyBytes: config.maximumBodyBytes,
    maximumClockSkewMs: config.maximumClockSkewMs,
    credentialSource: {
      async load(credentialId) {
        if (credentialId !== config.credential.credentialId)
          throw new Error("Credential identifier mismatch.");
        const value = process.env[config.credential.secretEnvironmentVariable];
        if (value === undefined) throw new Error("Credential environment variable is unavailable.");
        return Buffer.from(value, "utf8");
      },
    },
  });
  let server;
  try {
    server = await openLiveWebhookServer({
      host: config.listen.host,
      port: config.listen.port,
      maximumBodyBytes: config.maximumBodyBytes,
      maximumConcurrentRequests: config.maximumConcurrentRequests,
      once: parsed.values.once ?? false,
      handler: createLiveTriggerApplication({
        adapter,
        store,
        repositoryRoot: config.repositoryRoot,
        loadAuthorization: () => loadLiveWebhookAuthorization(config.authorizationFile),
      }),
    });
    const ready = {
      status: "listening",
      host: server.host,
      port: server.port,
      path: config.listen.path,
      adapterId: liveWebhookAdapterDescriptor.adapterId,
      adapterVersion: liveWebhookAdapterDescriptor.adapterVersion,
      authorizationId: liveWebhookAuthorizationId(initialAuthorization),
    };
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(ready)}\n`
        : `Webhook listening on http://${ready.host}:${ready.port}${ready.path}\n`,
    );
    if (parsed.values.once) await server.closed;
    else {
      await waitForShutdown();
      await server.close();
    }
    return 0;
  } finally {
    await server?.close();
    await store.close();
  }
}

export async function runLiveTriggerCommand(args: string[], io: CliIo): Promise<number> {
  try {
    if (args[0] !== "webhook" || !["serve", "recover", "prune"].includes(args[1] ?? ""))
      throw new Error("Unknown live-trigger command.");
    return args[1] === "serve" ? await runServe(args, io) : await runRetention(args, io);
  } catch (error) {
    io.stderr(
      `Live trigger failed: ${error instanceof Error ? error.message : String(error)}\n${liveTriggerUsage}\n`,
    );
    return 1;
  }
}
