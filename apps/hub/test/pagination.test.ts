import { describe, expect, it, vi } from "vitest";

import { createCursorPager } from "../assets/trace-pagination.js";

describe("Hub trace web cursor pager", () => {
  it("replaces the current page and can return to the previous cursor", async () => {
    const load = vi.fn(async (cursor: string | null) => cursor === null ? {
      items: ["first page"],
      nextCursor: "cursor-two",
    } : {
      items: ["second page"],
      nextCursor: null,
    });
    const pager = createCursorPager(load);

    await expect(pager.firstPage()).resolves.toMatchObject({
      page: { items: ["first page"] },
      navigation: { pageNumber: 1, hasPrevious: false, hasNext: true },
    });
    await expect(pager.nextPage()).resolves.toMatchObject({
      page: { items: ["second page"] },
      navigation: { pageNumber: 2, hasPrevious: true, hasNext: false },
    });
    await expect(pager.previousPage()).resolves.toMatchObject({
      page: { items: ["first page"] },
      navigation: { pageNumber: 1, hasPrevious: false, hasNext: true },
    });
    expect(load.mock.calls.map(([cursor]) => cursor)).toEqual([null, "cursor-two", null]);
  });

  it("keeps the current cursor when loading the next page fails", async () => {
    const pager = createCursorPager(async (cursor) => {
      if (cursor !== null) throw new Error("network failed");
      return { items: ["current page"], nextCursor: "cursor-failing" };
    });

    await pager.firstPage();
    await expect(pager.nextPage()).rejects.toThrow("network failed");
    expect(pager.navigation()).toEqual({
      pageNumber: 1,
      hasPrevious: false,
      hasNext: true,
      loading: false,
    });
  });
});
