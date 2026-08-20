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

  it("keeps the current implicit full consumer compatible and provides an explicit migration", async () => {
    const capabilityResult = await fixture.trace(["--capabilities"]);
    expect(capabilityResult.exitCode).toBe(0);
    expect(capabilityResult.stderr).toBe("");
    const capabilities = readTraceCapabilitiesReport(JSON.parse(capabilityResult.stdout));
    expect(capabilities).toMatchObject({
      defaultMode: "implicit_full",
      deprecations: [{
        code: "trace_implicit_full_deprecated",
        mode: "implicit_full",
        replacementMode: "full",
        changesIn: "0.1.0",
        nextDefaultMode: "page",
      }],
    });

    const implicit = await fixture.trace(["last", "--json"]);
    expect(implicit.exitCode).toBe(0);
    expect(implicit.stderr.match(/trace_implicit_full_deprecated/g)).toHaveLength(1);
    expect(implicit.stderr).not.toContain(fixture.runId);
    const implicitReport = readTraceReport(JSON.parse(implicit.stdout));
    expect(implicitReport.events).toHaveLength(fixture.eventCount);

    const explicit = await fixture.trace(["last", "--full", "--json"]);
    expect(explicit.exitCode).toBe(0);
    expect(explicit.stderr).toBe("");
    expect(readTraceReport(JSON.parse(explicit.stdout))).toEqual(implicitReport);
  });

  it("lets a bounded consumer use the declared page size without losing cursor continuity", async () => {
    const capabilityResult = await fixture.trace(["--capabilities"]);
    const capabilities = readTraceCapabilitiesReport(JSON.parse(capabilityResult.stdout));
    const pageMode = capabilities.modes.find(({ mode }) => mode === "page");
    expect(pageMode).toMatchObject({
      explicit: true,
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
