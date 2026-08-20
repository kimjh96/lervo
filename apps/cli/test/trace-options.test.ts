import { describe, expect, it } from "vitest";

import { parseTraceCommandOptions } from "../src/trace-options.js";

describe("trace command options", () => {
  it("parses capabilities, full, filtered page, and cursor requests as separate modes", () => {
    expect(parseTraceCommandOptions(["--capabilities"])).toMatchObject({
      help: false,
      request: { kind: "capabilities" },
    });
    expect(parseTraceCommandOptions(["run_01234567", "--json"])).toMatchObject({
      help: false,
      json: true,
      request: { kind: "implicit_full", selector: "run_01234567" },
    });
    expect(parseTraceCommandOptions([
      "last",
      "--page-size",
      "25",
      "--event-type",
      "run.failed",
    ])).toMatchObject({
      request: {
        kind: "first_page",
        selector: "last",
        limit: 25,
        eventTypes: ["run.failed"],
      },
    });
    expect(parseTraceCommandOptions(["--cursor", "trc_fixture"])).toMatchObject({
      request: { kind: "cursor", cursor: "trc_fixture" },
    });
    expect(parseTraceCommandOptions(["last", "--full", "--json"])).toMatchObject({
      request: { kind: "full", selector: "last" },
    });
  });

  it.each([
    [["one", "two"], "run ID는 하나만"],
    [["last", "--cursor", "trc_fixture"], "cursor는 run ID"],
    [["last", "--capabilities"], "capabilities는 run ID"],
    [["--capabilities", "--root", "."], "capabilities는 run ID"],
    [["--capabilities", "--page-size", "10"], "capabilities는 run ID"],
    [["--full", "--page-size", "10"], "full은 page-size"],
    [["--full", "--event-type", "run.failed"], "full은 page-size"],
    [["--page-size", "0"], "page-size는 1 이상"],
    [["--event-type", "unknown.event"], "event-type은 지원하는 값"],
    [["--event-type", "run.failed", "--event-type", "run.failed"], "중복 없이"],
  ])("rejects contradictory or invalid options: %j", (args, message) => {
    expect(() => parseTraceCommandOptions(args)).toThrow(message);
  });
});
