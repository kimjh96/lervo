import { describe, expect, it } from "vitest";

import { isDirectLervoAuthorizationJson } from "../src/live-trigger-authorization-path.js";

describe("live trigger authorization path", () => {
  it("accepts the exact direct .lervo JSON child on POSIX and Windows", () => {
    expect(isDirectLervoAuthorizationJson(".lervo/live-webhook-authorization.json")).toBe(true);
    expect(isDirectLervoAuthorizationJson(".lervo\\live-webhook-authorization.json")).toBe(true);
  });

  it("rejects traversal, nesting, and non-JSON targets on either platform", () => {
    expect(isDirectLervoAuthorizationJson("../.lervo/authorization.json")).toBe(false);
    expect(isDirectLervoAuthorizationJson(".lervo/nested/authorization.json")).toBe(false);
    expect(isDirectLervoAuthorizationJson(".lervo\\nested\\authorization.json")).toBe(false);
    expect(isDirectLervoAuthorizationJson(".lervo/authorization.yaml")).toBe(false);
  });
});
