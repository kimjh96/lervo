import { describe, expect, it } from "vitest";

import { localDrafts } from "../src/platform/storage";
import { bindVisibility } from "../src/platform/visibility";

/** An in-memory `Storage`. */
function memory(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

function drafts(storage = memory()) {
  const timers: (() => void)[] = [];
  let clock = 0;
  const target = new EventTarget();
  const store = localDrafts(storage, {
    now: () => (clock += 1),
    schedule: (run) => {
      timers.push(run);
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: () => undefined,
    page: target as unknown as Window,
  });
  return { store, storage, target, pause: () => timers.splice(0).forEach((run) => run()) };
}

describe("drafts in local storage", () => {
  it("stores a draft once typing pauses and reads unsaved text meanwhile", () => {
    const { store, storage, pause } = drafts();
    store.write("reply:wks_1", "Hel");
    store.write("reply:wks_1", "Hello");
    expect(storage.length).toBe(0);
    expect(store.read("reply:wks_1")).toBe("Hello");
    pause();
    expect(storage.length).toBe(1);
    store.write("reply:wks_1", "");
    pause();
    expect(storage.length).toBe(0);
    expect(store.read("reply:wks_1")).toBe("");
  });

  it("stores unsaved drafts when the page hides, and survives a reload", () => {
    const first = drafts();
    first.store.write("start", "Fix the login page");
    first.target.dispatchEvent(new Event("pagehide"));
    expect(drafts(first.storage).store.read("start")).toBe("Fix the login page");
  });

  it("keeps at most 64 drafts, forgetting the oldest, and at most 64 Ki code units each", () => {
    const { store, storage, pause } = drafts();
    for (let index = 0; index < 70; index += 1) {
      store.write(`reply:wks_${index}`, `draft ${index}`);
      pause();
    }
    expect(storage.length).toBe(64);
    expect(store.read("reply:wks_0")).toBe("");
    expect(store.read("reply:wks_69")).toBe("draft 69");
    store.write("long", "x".repeat(70 * 1024));
    pause();
    expect(store.read("long")).toHaveLength(64 * 1024);
  });
});

describe("window visibility", () => {
  it("marks the document while the window is hidden", () => {
    const target = new EventTarget();
    const page = Object.assign(target, {
      visibilityState: "visible" as DocumentVisibilityState,
      documentElement: { dataset: {} as DOMStringMap },
    });
    const unbind = bindVisibility(page as unknown as Parameters<typeof bindVisibility>[0]);
    expect(page.documentElement.dataset.visibility).toBeUndefined();
    page.visibilityState = "hidden";
    target.dispatchEvent(new Event("visibilitychange"));
    expect(page.documentElement.dataset.visibility).toBe("hidden");
    unbind();
    expect(page.documentElement.dataset.visibility).toBeUndefined();
  });
});
