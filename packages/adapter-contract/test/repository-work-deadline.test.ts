import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RepositoryWorkProgressDeadline,
  repositoryWorkMaximumDurationMs,
} from "../src/repository-work-deadline.js";

afterEach(() => vi.useRealTimers());

describe("repository work progress deadline", () => {
  it("extends the inactivity window on progress but stops at the absolute bound", async () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const deadline = new RepositoryWorkProgressDeadline(100, expired);

    await vi.advanceTimersByTimeAsync(80);
    deadline.observeProgress();
    await vi.advanceTimersByTimeAsync(80);
    deadline.observeProgress();
    await vi.advanceTimersByTimeAsync(80);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60);
    expect(expired).toHaveBeenCalledOnce();
    deadline.close();
  });

  it("expires after inactivity and clamps the absolute duration", async () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const deadline = new RepositoryWorkProgressDeadline(100, expired);
    await vi.advanceTimersByTimeAsync(100);
    expect(expired).toHaveBeenCalledOnce();
    deadline.observeProgress();
    await vi.advanceTimersByTimeAsync(300);
    expect(expired).toHaveBeenCalledOnce();
    expect(repositoryWorkMaximumDurationMs(1_800_000)).toBe(5_400_000);
    expect(repositoryWorkMaximumDurationMs(3_600_000)).toBe(5_400_000);
  });
});
