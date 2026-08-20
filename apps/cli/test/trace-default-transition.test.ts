import {
  readTraceCapabilitiesReport,
  readTracePageReport,
  readTraceReport,
} from "@lervo/diagnostics";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTraceDefaultTransitionFixture,
  type TraceDefaultTransitionFixture,
} from "./trace-default-transition-fixture.js";

describe("trace default transition compatibility", () => {
  let fixture: TraceDefaultTransitionFixture;

  beforeAll(async () => {
    fixture = await createTraceDefaultTransitionFixture();
  });

  afterAll(async () => {
    if (fixture !== undefined) await fixture.dispose();
  });

  it("uses a bounded default while preserving explicit full consumers", async () => {
    const capabilityResult = await fixture.trace(["--capabilities"]);
    expect(capabilityResult.exitCode).toBe(0);
    expect(capabilityResult.stderr).toBe("");
    const capabilities = readTraceCapabilitiesReport(JSON.parse(capabilityResult.stdout));
    expect(capabilities).toMatchObject({
      defaultMode: "page",
      deprecations: [],
    });

    const defaultResult = await fixture.trace(["last", "--json"]);
    expect(defaultResult.exitCode).toBe(0);
    expect(defaultResult.stderr).toBe("");
    const defaultPage = readTracePageReport(JSON.parse(defaultResult.stdout));
    expect(defaultPage.events).toHaveLength(capabilities.limits.defaultPageSize);
    expect(defaultPage.page.hasMore).toBe(true);

    const explicit = await fixture.trace(["last", "--full", "--json"]);
    expect(explicit.exitCode).toBe(0);
    expect(explicit.stderr).toBe("");
    const fullReport = readTraceReport(JSON.parse(explicit.stdout));
    expect(fullReport.events).toHaveLength(fixture.eventCount);
    expect(fullReport.events.slice(0, defaultPage.events.length)).toEqual(defaultPage.events);
  });

  it("lets a bounded consumer use the declared page size without losing cursor continuity", async () => {
    const capabilityResult = await fixture.trace(["--capabilities"]);
    const capabilities = readTraceCapabilitiesReport(JSON.parse(capabilityResult.stdout));
    const pageMode = capabilities.modes.find(({ mode }) => mode === "page");
    expect(pageMode).toMatchObject({
      explicit: false,
      reportKind: "page",
      reportSchemaVersion: 1,
      eventTypeFilter: true,
      cursorContinuation: true,
    });

    const first = await fixture.trace([
      "last",
      "--page-size",
      String(capabilities.limits.defaultPageSize),
      "--json",
    ]);
    expect(first.exitCode).toBe(0);
    expect(first.stderr).toBe("");
    const firstPage = readTracePageReport(JSON.parse(first.stdout));
    expect(firstPage.events).toHaveLength(capabilities.limits.defaultPageSize);
    expect(firstPage.page).toMatchObject({ hasMore: true, returnedCount: 50 });
    expect("status" in firstPage).toBe(false);

    const second = await fixture.trace(["--cursor", firstPage.page.nextCursor!, "--json"]);
    expect(second.exitCode).toBe(0);
    expect(second.stderr).toBe("");
    const secondPage = readTracePageReport(JSON.parse(second.stdout));
    expect(secondPage.page).toMatchObject({ hasMore: false, returnedCount: 1 });
    expect([
      ...firstPage.events.map(({ seq }) => seq),
      ...secondPage.events.map(({ seq }) => seq),
    ]).toEqual(Array.from({ length: fixture.eventCount }, (_, index) => index + 1));
  });
});
