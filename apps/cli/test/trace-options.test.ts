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
      request: { kind: "first_page", selector: "run_01234567" },
    });
    expect(
      parseTraceCommandOptions(["last", "--page-size", "25", "--event-type", "run.failed"]),
    ).toMatchObject({
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
    expect(parseTraceCommandOptions(["--deliberation", "dlb_chat0001"])).toMatchObject({
      request: { kind: "deliberation", deliberationId: "dlb_chat0001" },
    });
    expect(
      parseTraceCommandOptions(["--work", "wrk_111111111111111111111111", "--json"]),
    ).toMatchObject({
      json: true,
      request: { kind: "work", workId: "wrk_111111111111111111111111" },
    });
    expect(parseTraceCommandOptions(["last", "--full", "--json"])).toMatchObject({
      request: { kind: "full", selector: "last" },
    });
  });

  it.each([
    [["one", "two"], "Only one run ID"],
    [["last", "--cursor", "trc_fixture"], "cursor cannot be combined with run ID"],
    [["last", "--capabilities"], "capabilities cannot be combined with run ID"],
    [["--capabilities", "--root", "."], "capabilities cannot be combined with run ID"],
    [["--capabilities", "--page-size", "10"], "capabilities cannot be combined with run ID"],
    [["--full", "--page-size", "10"], "full cannot be combined with page-size"],
    [["--full", "--event-type", "run.failed"], "full cannot be combined with page-size"],
    [["last", "--deliberation", "dlb_chat0001"], "deliberation cannot be combined with run ID"],
    [["last", "--work", "wrk_111111111111111111111111"], "work cannot be combined"],
    [["--work", "not-a-work-id"], "work ID is invalid"],
    [["--page-size", "0"], "page-size must be between 1"],
    [["--event-type", "unknown.event"], "event-type values must be supported"],
    [["--event-type", "run.failed", "--event-type", "run.failed"], "unique"],
  ])("rejects contradictory or invalid options: %j", (args, message) => {
    expect(() => parseTraceCommandOptions(args)).toThrow(message);
  });
});
