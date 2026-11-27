import { expect, it } from "vitest";

import {
  NoCapabilityInvocationFailure,
  parseNoCapabilityResultText,
  parsedNoCapabilityJsonObject,
} from "../src/index.js";

it("reads a bare, fenced, or embedded JSON reply", () => {
  expect(parseNoCapabilityResultText('{"ok":true}', "Claude")).toEqual({ ok: true });
  expect(parseNoCapabilityResultText('```json\n{"ok":true}\n```', "Claude")).toEqual({ ok: true });
  expect(parseNoCapabilityResultText('Result: {"ok":true} done', "Codex")).toEqual({ ok: true });
});

it("names the provider in a typed run failure for a reply that is not JSON", () => {
  expect(() => parseNoCapabilityResultText("no object", "Codex")).toThrow(
    new NoCapabilityInvocationFailure("run_failed", "Codex final response is not JSON."),
  );
  expect(() => parseNoCapabilityResultText("{ broken }", "Claude")).toThrow(
    "Claude final response is not a single JSON object.",
  );
  expect(() => parsedNoCapabilityJsonObject("[]", "Not an object.")).toThrow(
    expect.objectContaining({ kind: "run_failed", message: "Not an object.", details: {} }),
  );
});
