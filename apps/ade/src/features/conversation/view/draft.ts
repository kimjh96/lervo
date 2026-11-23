import { useState } from "react";

import { useDrafts } from "../../../ports";

/**
 * Text the user types, kept as a draft under `key` across reloads and restarts (ADE quality,
 * "No user input is lost"). Without a key, the text lives only while the input does.
 */
export function useDraft(key: string | undefined): readonly [string, (text: string) => void] {
  const drafts = useDrafts();
  const read = (from: string | undefined) => (from === undefined ? "" : drafts.read(from));
  const [draft, setDraft] = useState(() => ({ key, text: read(key) }));
  if (draft.key !== key) setDraft({ key, text: read(key) });
  const update = (text: string) => {
    setDraft({ key, text });
    if (key !== undefined) drafts.write(key, text);
  };
  return [draft.key === key ? draft.text : read(key), update] as const;
}
