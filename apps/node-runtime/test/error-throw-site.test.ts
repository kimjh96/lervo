import { expect, it } from "vitest";

import { errorThrowSite } from "../src/deployment-conversation.js";

it("names the file, line, and column of the first stack frame without its directory", () => {
  const error = new Error("private message content");
  error.stack = [
    "Error: private message content",
    "    at handleDispatch (/home/owner/.local/share/lervo/runtimes/node/abc/dist/node-runtime.js:1234:56)",
    "    at next (node:internal/process/task_queues:95:5)",
  ].join("\n");
  expect(errorThrowSite(error)).toBe("node-runtime.js:1234:56");
  expect(errorThrowSite({ stack: "Error\n    at <anonymous>" })).toBeNull();
  expect(errorThrowSite(null)).toBeNull();
});
