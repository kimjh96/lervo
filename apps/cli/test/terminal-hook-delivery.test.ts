import { expect, it } from "vitest";

import { inProcessHookFallback } from "../src/terminal-hook-delivery.js";

const unix = "linux" as const;

it("maps what the launcher left to the closed reason it stands for", () => {
  expect(inProcessHookFallback(undefined, {}, unix)).toBe("unreported");
  expect(inProcessHookFallback(undefined, {}, "win32")).toBe("not_offered");
  expect(inProcessHookFallback("none", {}, unix)).toBe("no_server");
  expect(inProcessHookFallback("", {}, unix)).toBe("not_offered");
  expect(inProcessHookFallback("connecting", {}, unix)).toBe("unreachable");
  expect(inProcessHookFallback("sent", {}, unix)).toBe("unreachable");
  for (const [reason, fallback] of [
    ["runtime_mismatch", "declined_runtime_mismatch"],
    ["environment_mismatch", "declined_environment_mismatch"],
    ["busy", "declined_busy"],
    ["request_too_large", "declined_request_too_large"],
    ["invalid_request", "declined_invalid_request"],
  ])
    expect(inProcessHookFallback(`${JSON.stringify({ declined: reason })}\n`, {}, unix)).toBe(
      fallback,
    );
  // A cut decline line, an unknown reason, or a prototype key says no more than no answer.
  expect(inProcessHookFallback('{"declined":"bu', {}, unix)).toBe("unreachable");
  expect(inProcessHookFallback('{"declined":"later"}\n', {}, unix)).toBe("unreachable");
  expect(inProcessHookFallback('{"declined":"constructor"}', {}, unix)).toBe("unreachable");
  // A switched-off socket wins over whatever else the launcher left.
  for (const offer of [undefined, "none", "", "sent"])
    expect(inProcessHookFallback(offer, { LERVO_TERMINAL_CONTEXT_SOCKET: "0" }, unix)).toBe(
      "disabled",
    );
});
