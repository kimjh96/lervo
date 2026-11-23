import { describe, expect, it } from "vitest";

import { eventWriterBlocker } from "../src/event-writer-activation-blockers.js";
import { TARGET_EVENT_SCHEMA_VERSION } from "../src/event-writer-target.js";

describe("event writer activation blockers", () => {
  it("name the version the activation targets, not an earlier rollout's", () => {
    for (const code of [
      "event_writer_activation_blocked",
      "reader_inventory_hub_unavailable",
      "reader_inventory_node_health_stale",
    ]) {
      const { message } = eventWriterBlocker({ code }, TARGET_EVENT_SCHEMA_VERSION);
      expect(message, code).toContain(`event schema ${TARGET_EVENT_SCHEMA_VERSION}`);
      expect(message, code).not.toMatch(/event schema 4\b/u);
    }
  });

  it("keeps an unknown code bounded with the generic step", () => {
    expect(eventWriterBlocker({ code: "Not A Code" }, 10)).toMatchObject({
      code: "event_writer_activation_failed",
    });
  });
});
