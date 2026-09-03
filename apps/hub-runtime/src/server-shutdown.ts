import type { Server } from "node:http";

export const HUB_SERVER_DRAIN_TIMEOUT_MS = 10_000;

export type HubServerDrainDisposition = "graceful" | "forced";

export interface HubServerShutdownOptions {
  drainTimeoutMs?: number;
}

export async function closeHubRuntimeServer(
  server: Server,
  options: HubServerShutdownOptions = {},
): Promise<HubServerDrainDisposition> {
  if (!server.listening) return "graceful";

  const drainTimeoutMs = options.drainTimeoutMs ?? HUB_SERVER_DRAIN_TIMEOUT_MS;
  let forced = false;
  let timer: NodeJS.Timeout | undefined;

  await new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => {
      forced = true;
      server.closeAllConnections();
    }, drainTimeoutMs);
    timer.unref();

    server.close((error) => {
      if (timer !== undefined) clearTimeout(timer);
      if (error === undefined) resolve();
      else reject(error);
    });
    server.closeIdleConnections();
  });

  return forced ? "forced" : "graceful";
}
