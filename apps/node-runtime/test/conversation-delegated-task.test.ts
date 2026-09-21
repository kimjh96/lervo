import { describe, expect, it } from "vitest";

import { delegatedTaskContent } from "../src/conversation-delegated-task.js";

describe("delegated task content", () => {
  it("carries the coordinator's natural bounded subtask without a synthetic persona", () => {
    const task = delegatedTaskContent("현재 상태와 막힌 이유를 정리해 주세요.");

    expect(task).toBe("현재 상태와 막힌 이유를 정리해 주세요.");
    expect(task).not.toContain("위임받은 담당 에이전트");
    expect(task).not.toContain("원 요청:");
    expect(task).not.toContain("위임 요약:");
  });

  it("does not rewrite authority or scope", () => {
    expect(delegatedTaskContent("Run the exact bounded review.")).toBe(
      "Run the exact bounded review.",
    );
  });

  it("fails closed when the subtask is empty or exceeds the bounded transport", () => {
    expect(() => delegatedTaskContent("  ")).toThrow("exceeds the bounded");
    expect(() => delegatedTaskContent("가".repeat(1_025))).toThrow("exceeds the bounded");
  });
});
