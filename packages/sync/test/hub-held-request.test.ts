import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

import { afterEach, expect, it } from "vitest";

import { holdHubRequest } from "../src/hub-held-request.js";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});

it("ends a held request that outlives its deadline, so a silently dropped hop reconnects (ADR-0602)", async () => {
  // A hop that accepts and then never answers, as a proxy whose far side vanished.
  const server = createServer(() => undefined);
  servers.push(server);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const started = Date.now();
  await expect(
    holdHubRequest({
      url: new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/hold`),
      bearerToken: "t".repeat(40),
      expectedHubIdentityHash: `sha256:${"9".repeat(64)}`,
      destinationId: "hub:one",
      signal: new AbortController().signal,
      deadlineMilliseconds: 300,
    }),
  ).rejects.toMatchObject({ code: "ERR_HUB_HOLD_DEADLINE" });
  expect(Date.now() - started).toBeLessThan(5_000);
});
