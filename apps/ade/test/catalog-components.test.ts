import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { createElement, Fragment } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { entries } from "../catalog/entries";

describe("the design system catalog", () => {
  it("shows every shared component", async () => {
    const modules = (await readdir(join(import.meta.dirname, "../src/ui")))
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => name.replace(/\.tsx$/u, ""))
      .toSorted();
    expect(entries.map((entry) => entry.module).toSorted()).toEqual(modules);
  });

  it("renders every variant and states each component's use", () => {
    for (const entry of entries) {
      expect(entry.use.length, entry.name).toBeGreaterThan(0);
      expect(entry.avoid.length, entry.name).toBeGreaterThan(0);
      for (const variant of entry.variants)
        expect(
          renderToString(createElement(Fragment, null, variant.render())),
          `${entry.name}: ${variant.name}`,
        ).not.toBe("");
    }
  });
});
