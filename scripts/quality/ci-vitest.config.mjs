import { mergeConfig } from "vitest/config";

import base from "../../vitest.config.ts";
import { ciTestLedgerConfiguration } from "./lib/ci-test-ledger-configuration.mjs";
import CiTestSequencer from "./lib/ci-test-sequencer.mjs";

const ledger = ciTestLedgerConfiguration();

export default mergeConfig(base, { test: { sequence: { sequencer: CiTestSequencer }, ...ledger } });
