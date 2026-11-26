import type { ImageMark } from "@lervo/session-host-contract";
import { type CSSProperties } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { imageCache } from "../model/images";
import { useImageUrl, useOpenImages } from "./ConversationImages";
import styles from "./MessageImages.module.css";
import { sizes } from "../../../design/generated/sizes";

/** The longest a lone image shows in a bubble; several show as square tiles. */
const ONE_WIDTH = sizes.image.single;
const ONE_HEIGHT = sizes.image.singleHeight;
const TILE = sizes.image.tile;

/** The size a lone image shows at: its own shape within the bubble's bound. */
export function shownSize(mark: ImageMark): { width: number; height: number } {
  if (mark.width === undefined || mark.height === undefined)
    return { width: ONE_WIDTH, height: Math.round((ONE_WIDTH * 3) / 4) };
  const scale = Math.min(1, ONE_WIDTH / mark.width, ONE_HEIGHT / mark.height);
  return {
    width: Math.max(1, Math.round(mark.width * scale)),
    height: Math.max(1, Math.round(mark.height * scale)),
  };
}

function MessageImage(props: {
  mark: ImageMark;
  size: { width: number; height: number };
  alt: string;
  onOpen: () => void;
}) {
  const { url, missing } = useImageUrl(props.mark.imageId);
  const box: CSSProperties = { width: props.size.width, height: props.size.height };
  if (missing)
    return (
      <span className={styles.ghost} style={box} role="img" aria-label={props.alt}>
        <FormattedMessage
          id="conversation.images.missing"
          values={{
            sized: props.mark.width === undefined || props.mark.height === undefined ? "no" : "yes",
            width: props.mark.width,
            height: props.mark.height,
          }}
        />
      </span>
    );
  return (
    // The button carries the image's text, so it is named while the image loads too.
    <button
      type="button"
      className={styles.open}
      style={box}
      aria-label={props.alt}
      onClick={props.onOpen}
    >
      {/* motion: A message arrives live */}
      {url === undefined ? null : <img className={styles.image} src={url} alt={props.alt} />}
    </button>
  );
}

/**
 * The images a user message carried, inside its bubble above the text (image mockup,
 * "A"): a lone image in its own shape, several as square tiles. Each opens at full size; an image
 * the session host does not keep shows as a quiet tile with its size.
 */
export function MessageImages(props: { images: readonly ImageMark[]; alone: boolean }) {
  const intl = useIntl();
  const open = useOpenImages();
  const one = props.images.length === 1;
  const alt = (mark: ImageMark, index: number) =>
    intl.formatMessage(
      { id: "conversation.images.alt" },
      {
        number: index + 1,
        count: props.images.length,
        sized: mark.width === undefined || mark.height === undefined ? "no" : "yes",
        width: mark.width,
        height: mark.height,
      },
    );
  const openAt = (index: number) => {
    const shown = props.images.flatMap((mark, at) => {
      const url = mark.imageId === undefined ? undefined : imageCache.get(mark.imageId);
      return url === undefined ? [] : [{ src: url, alt: alt(mark, at), at }];
    });
    const position = shown.findIndex((image) => image.at === index);
    if (position !== -1) open(shown, position);
  };
  return (
    <div className={styles.media} data-alone={props.alone ? "" : undefined}>
      {props.images.map((mark, index) => (
        <MessageImage
          // Marks never change or move, so their place names them.
          key={index}
          mark={mark}
          size={one ? shownSize(mark) : { width: TILE, height: TILE }}
          alt={alt(mark, index)}
          onOpen={() => openAt(index)}
        />
      ))}
    </div>
  );
}
