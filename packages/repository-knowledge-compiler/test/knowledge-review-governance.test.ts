import { expect, it } from "vitest";

import { noCapabilityReviewAccountingDescriptor } from "../src/index.js";
import { strategyFor } from "./provider-strategies.js";

it.each([
  ["claude", "claude.print-json.model-usage.v1"],
  ["codex", "codex.exec-json.turn-usage.v1"],
] as const)(
  "describes %s review usage by its adapter's counter semantics",
  (provider, semantics) => {
    expect(noCapabilityReviewAccountingDescriptor(strategyFor(provider))).toEqual({
      kind: "resource_accounting_descriptor",
      schemaVersion: 2,
      provider,
      adapterId: `${provider}/no-capability-json`,
      adapterVersion: "1",
      accountingMode: "operation_delta",
      observationSupport: "supported",
      unavailableReason: null,
      normalizationId: `${provider}.no-capability-json.usage.v1`,
      nativeCounterSemanticsId: semantics,
      requestedModel: null,
      serviceTier: null,
    });
  },
);
