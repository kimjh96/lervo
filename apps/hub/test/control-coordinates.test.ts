import { describe, expect, it } from "vitest";

import { parseControlCoordinates } from "../assets/control-coordinates.js";

const valid = {
  destinationId: "hub:primary",
  projectId: "prj_control01",
  deliveryId: `rcd_${"a".repeat(64)}`,
  reviewGrant: `hcrg_1787184900_${"b".repeat(64)}`,
};

describe("Hub control fragment coordinates", () => {
  it("accepts the four bounded review coordinates", () => {
    expect(parseControlCoordinates(new URLSearchParams(valid).toString())).toEqual(valid);
  });

  it("rejects missing, duplicate and extra coordinates", () => {
    const base = new URLSearchParams(valid);
    const duplicate = new URLSearchParams(base);
    duplicate.append("projectId", valid.projectId);
    const extra = new URLSearchParams(base);
    extra.set("token", "must-not-enter-url");
    const missing = new URLSearchParams(base);
    missing.delete("reviewGrant");

    expect(parseControlCoordinates(duplicate.toString())).toBeNull();
    expect(parseControlCoordinates(extra.toString())).toBeNull();
    expect(parseControlCoordinates(missing.toString())).toBeNull();
  });
});
