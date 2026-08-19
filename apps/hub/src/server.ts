import { createServer, type Server } from "node:http";

import { createHubTraceHttpHandler, type HubTraceHttpHandlerOptions } from "./handler.js";
import {
  createHubPolicyHttpHandler,
  type HubPolicyHttpHandlerOptions,
} from "./policy-handler.js";
import { createHubTraceWebHandler } from "./web-handler.js";

export function createHubTraceServer(options: HubTraceHttpHandlerOptions): Server {
  return createHubServer({ trace: options });
}

export function createHubServer(options: {
  trace: HubTraceHttpHandlerOptions;
  policy?: HubPolicyHttpHandlerOptions;
}): Server {
  const traceHandler = createHubTraceHttpHandler(options.trace);
  const policyHandler = options.policy === undefined
    ? undefined
    : createHubPolicyHttpHandler(options.policy);
  const webHandler = createHubTraceWebHandler();
  return createServer((request, response) => {
    if (webHandler(request, response)) return;
    if (request.url?.startsWith("/v1/policy/") && policyHandler !== undefined) {
      void policyHandler(request, response);
    } else {
      void traceHandler(request, response);
    }
  });
}
