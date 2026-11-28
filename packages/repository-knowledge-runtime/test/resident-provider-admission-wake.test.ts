import { describe, expect, it } from "vitest";

import { providerAdmissionWakes } from "../src/resident-ownership-wakes.js";

describe("an admission record change wakes an ineligible resident", () => {
  it("wakes once the record no longer says that no provider is admitted", () => {
    // An explicit probe removed the record, or an admission found a delegated provider.
    expect(providerAdmissionWakes({ role: "ineligible" }, null)).toBe(true);
    expect(providerAdmissionWakes({ role: "ineligible" }, { waiting: false })).toBe(true);
  });

  it("keeps the scheduled wake while the record still waits, and ignores other roles", () => {
    // The host's own failing admission rewrites the record; that must never loop the resident.
    expect(providerAdmissionWakes({ role: "ineligible" }, { waiting: true })).toBe(false);
    expect(providerAdmissionWakes({ role: "owner" }, null)).toBe(false);
    expect(providerAdmissionWakes({ role: "waiting_owner" }, { waiting: false })).toBe(false);
    expect(providerAdmissionWakes(null, null)).toBe(false);
  });
});
