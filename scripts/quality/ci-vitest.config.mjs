import { mergeConfig } from "vitest/config";

import base from "../../vitest.config.ts";
import { ciTestLedgerConfiguration } from "./lib/ci-test-ledger-configuration.mjs";
import CiTestSequencer from "./lib/ci-test-sequencer.mjs";
import { directBarrelImports } from "./lib/test-direct-barrel-imports.mjs";

const ledger = ciTestLedgerConfiguration();

// Direct barrel imports pay off only across a whole shard: their pin scan costs seconds once.
export default mergeConfig(base, {
  plugins: [directBarrelImports()],
  test: { sequence: { sequencer: CiTestSequencer }, ...ledger },
});
