import type { SentImage } from "@lervo/session-host-contract";

import type { PreparedImage } from "../../../ports";

/** The protocol's images for prepared ones: format and bytes, without the size the card shows. */
export function sentImages(images: readonly PreparedImage[]): SentImage[] {
  return images.map(({ mediaType, data }) => ({ mediaType, data }));
}

/** An image the browser can draw, from its format and Base64 bytes. */
export function dataUrl(mediaType: string, data: string): string {
  return `data:${mediaType};base64,${data}`;
}

/**
 * An image's identity: the SHA-256 of its bytes in lowercase hex, as the session host and the
 * core name it (Lervo ADE sessions, "Images in a message").
 */
export async function imageIdOf(data: string): Promise<string> {
  const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Images the conversation shows, as data URLs by identity, within `maxCharacters`; the least
 * recently used leave first. An identity names the same bytes in every session, so one cache
 * serves them all.
 */
export class ImageCache {
  private readonly urls = new Map<string, string>();
  private characters = 0;

  constructor(private readonly maxCharacters: number) {}

  get(imageId: string): string | undefined {
    const url = this.urls.get(imageId);
    if (url === undefined) return undefined;
    // Reading an image makes it the most recently used.
    this.urls.delete(imageId);
    this.urls.set(imageId, url);
    return url;
  }

  put(imageId: string, url: string): void {
    const previous = this.urls.get(imageId);
    if (previous !== undefined) {
      this.urls.delete(imageId);
      this.characters -= previous.length;
    }
    if (url.length > this.maxCharacters) return;
    this.urls.set(imageId, url);
    this.characters += url.length;
    for (const [oldest, kept] of this.urls) {
      if (this.characters <= this.maxCharacters) break;
      this.urls.delete(oldest);
      this.characters -= kept.length;
    }
  }
}

/** The interface's image cache: about a hundred sent images. */
export const imageCache = new ImageCache(24 * 1024 * 1024);

/**
 * Puts images the user is sending into the cache under their identity, so the message's bubble
 * shows them at once, without asking the session host, and returns their identities.
 */
export async function remember(images: readonly PreparedImage[]): Promise<string[]> {
  return Promise.all(
    images.map(async (image) => {
      const imageId = await imageIdOf(image.data);
      imageCache.put(imageId, dataUrl(image.mediaType, image.data));
      return imageId;
    }),
  );
}
