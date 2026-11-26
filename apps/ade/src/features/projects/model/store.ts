import { create } from "zustand";

interface ProjectStore {
  /** The project chosen last; the first listed project stands in when it is not listed. */
  readonly selected: string | null;
  /** Mark thumbnails as data URLs, by the image's SHA-256. */
  readonly marks: Readonly<Record<string, string>>;
  /** Whether the switcher shows the list of projects. */
  readonly expanded: boolean;
  /** The project whose name is being edited in place. */
  readonly renaming: string | null;
  /** The code of the last project change that failed, until the next change. */
  readonly failure: string | null;
}

export const useProjectStore = create<ProjectStore>(() => ({
  selected: null,
  marks: {},
  expanded: false,
  renaming: null,
  failure: null,
}));
