import { createServer, type Server } from "node:http";

import { createHubTraceHttpHandler, type HubTraceHttpHandlerOptions } from "./handler.js";

export function createHubTraceServer(options: HubTraceHttpHandlerOptions): Server {
  const handler = createHubTraceHttpHandler(options);
  return createServer((request, response) => {
    void handler(request, response);
  });
}
