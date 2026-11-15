import { sha256Schema } from "@lervo/schemas";
import { expect, it } from "vitest";

// Run by test-direct-barrel-imports-ledger.test.mjs in a nested Vitest with the ledger and the
// direct-import plugin on. The plugin imports this name from `common.ts`, never loading the barrel.
it("imports one barrel name from its declaring module", () => {
  expect(sha256Schema.type).toBe("string");
});
