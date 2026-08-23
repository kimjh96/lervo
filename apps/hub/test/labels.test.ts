import { eventTypes } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { eventLabel, fieldLabel } from "../assets/trace-labels.js";

describe("Hub trace web labels", () => {
  it("gives every current event type a human-readable Korean label", () => {
    for (const type of eventTypes) {
      expect(eventLabel(type), type).not.toBe(type);
      expect(eventLabel(type), type).toMatch(/[A-Za-z]/);
    }
  });

  it("keeps unknown evidence fields visible instead of inventing a meaning", () => {
    expect(fieldLabel("documentId")).toBe("Document");
    expect(fieldLabel("futureEvidenceCoordinate")).toBe("futureEvidenceCoordinate");
  });
});
