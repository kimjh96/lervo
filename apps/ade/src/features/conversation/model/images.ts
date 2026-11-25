import type { SentImage } from "@lervo/session-host-contract";

import type { PreparedImage } from "../../../ports";

/** The protocol's images for prepared ones: format and bytes, without the size the card shows. */
export function sentImages(images: readonly PreparedImage[]): SentImage[] {
  return images.map(({ mediaType, data }) => ({ mediaType, data }));
}
