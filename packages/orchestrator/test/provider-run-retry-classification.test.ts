import { describe, expect, it } from "vitest";

import { classifyRunFailure } from "../src/provider-run-failures.js";
import { ManagedProviderRunError } from "../src/provider-run-types.js";

describe("managed provider retry classification", () => {
  it("retries a provider that never named a model and keeps a rejected turn terminal", () => {
    // A transient capacity result must not end the assignment the way a rejected request does.
    expect(
      classifyRunFailure(
        new ManagedProviderRunError("provider_model_unavailable", "The provider named no model."),
        "provider_turn",
      ),
    ).toMatchObject({ retryable: true });
    expect(
      classifyRunFailure(
        new ManagedProviderRunError("provider_capacity_unavailable", "Capacity is exhausted."),
        "provider_turn",
      ),
    ).toMatchObject({ retryable: true });
    expect(
      classifyRunFailure(
        new ManagedProviderRunError("provider_turn_failed", "The provider turn failed."),
        "provider_turn",
      ),
    ).toMatchObject({ retryable: false });
  });
});
