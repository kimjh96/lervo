import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import CiTestLedgerReporter from "./ci-test-ledger-reporter.mjs";

/**
 * Vitest configuration for the observe-only test input ledger (ADR-0565). The ledger is on when
 * the CI test job names its directory and the `LERVO_CI_TEST_LEDGER` repository variable is not
 * `off`. It preloads the recorder into every worker and, through the inherited `NODE_OPTIONS`,
 * into their children; adds the binding setup file; and adds the ledger reporter beside Vitest's
 * own default reporters. Test selection, order and verdicts are untouched.
 */
export function ciTestLedgerConfiguration(environment = process.env) {
  const directory = environment.LERVO_CI_TEST_LEDGER_DIRECTORY;
  if (environment.LERVO_CI_TEST_LEDGER === "off" || !directory || !isAbsolute(directory)) return {};
  // CommonJS preloads without starting the ESM loader, which keeps each child's startup short.
  const recorder = fileURLToPath(new URL("./ci-test-input-recorder.cjs", import.meta.url));
  const nodeOptions = [environment.NODE_OPTIONS, `--require=${JSON.stringify(recorder)}`]
    .filter(Boolean)
    .join(" ");
  return {
    env: { NODE_OPTIONS: nodeOptions },
    setupFiles: [fileURLToPath(new URL("./ci-test-input-binding.mjs", import.meta.url))],
    // An explicit list replaces Vitest's defaults, so they are repeated here unchanged.
    reporters: [
      "default",
      ...(environment.GITHUB_ACTIONS === "true" ? ["github-actions"] : []),
      new CiTestLedgerReporter({ directory }),
    ],
  };
}
