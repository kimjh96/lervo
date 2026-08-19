import { createServer, type Server } from "node:http";

import { createHubTraceHttpHandler, type HubTraceHttpHandlerOptions } from "./handler.js";
import { createHubTraceWebHandler } from "./web-handler.js";

export function createHubTraceServer(options: HubTraceHttpHandlerOptions): Server {
  const apiHandler = createHubTraceHttpHandler(options);
  const webHandler = createHubTraceWebHandler();
  return createServer((request, response) => {
    if (!webHandler(request, response)) void apiHandler(request, response);
  });
}
