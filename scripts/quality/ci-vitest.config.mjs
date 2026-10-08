import { mergeConfig } from "vitest/config";

import base from "../../vitest.config.ts";
import CiTestSequencer from "./lib/ci-test-sequencer.mjs";

export default mergeConfig(base, { test: { sequence: { sequencer: CiTestSequencer } } });
