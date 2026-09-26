import { expect, it } from "vitest";

import { RunFailureLedger, terminalTurnFailure } from "../src/provider-run-failures.js";

it("keeps the adapter's own turn failure code instead of discarding it", () => {
  const failure = terminalTurnFailure("codex_turn_failed");
  expect(failure).toMatchObject({
    code: "provider_turn_failed",
    providerTurnFailureCode: "codex_turn_failed",
    message: "The provider turn failed (codex_turn_failed).",
  });
  const ledger = new RunFailureLedger();
  ledger.add(failure, "provider_turn");
  expect(ledger.details()).toEqual([
    {
      code: "provider_turn_failed",
      phase: "provider_turn",
      retryable: false,
      providerTurnFailureCode: "codex_turn_failed",
    },
  ]);
  expect(terminalTurnFailure("provider_usage_limited").code).toBe("provider_usage_limited");
  expect(terminalTurnFailure("Not A Code!").providerTurnFailureCode).toBeUndefined();
});

it("keeps an adapter error code behind a generic phase failure", () => {
  const ledger = new RunFailureLedger();
  ledger.add(
    Object.assign(new Error("The Claude turn has already started or is still active."), {
      code: "invalid_request",
    }),
    "turn_start",
  );
  expect(ledger.details()).toEqual([
    {
      code: "provider_turn_failed",
      phase: "turn_start",
      retryable: false,
      causeCode: "invalid_request",
    },
  ]);
});
