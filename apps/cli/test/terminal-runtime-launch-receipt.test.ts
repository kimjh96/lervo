import { afterEach, expect, it } from "vitest";
import { consumeTerminalRuntimeLaunchReceipt } from "../src/terminal-runtime-launch-receipt.js";

const processState = globalThis as typeof globalThis & { [key: symbol]: unknown };
const receipt = Symbol.for("lervo.terminalHook.verifiedEntry");
afterEach(() => {
  delete processState[receipt];
});

it("accepts a verified entry only once and rejects a different entry", () => {
  expect(consumeTerminalRuntimeLaunchReceipt("/host/runtime.mjs")).toBe(false);
  processState[receipt] = "/host/runtime.mjs";
  expect(consumeTerminalRuntimeLaunchReceipt("/host/other.mjs")).toBe(false);
  expect(consumeTerminalRuntimeLaunchReceipt("/host/runtime.mjs")).toBe(false);
  processState[receipt] = "/host/runtime.mjs";
  expect(consumeTerminalRuntimeLaunchReceipt("/host/runtime.mjs")).toBe(true);
  expect(consumeTerminalRuntimeLaunchReceipt("/host/runtime.mjs")).toBe(false);
});
