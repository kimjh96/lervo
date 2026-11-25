import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useIntl } from "react-intl";

import { ImageViewer, type ViewedImage } from "../../../ui/ImageViewer";
import { imageCache } from "../model/images";

interface Images {
  readonly read: (imageId: string) => Promise<string>;
  readonly open: (images: readonly ViewedImage[], index: number) => void;
}

const ImagesContext = createContext<Images | null>(null);

/**
 * Reads the images a conversation's messages carried through `read`, and shows one at full size
 * when a message or a waiting thumbnail opens it (Lervo ADE sessions, "Images in a message").
 */
export function ConversationImagesProvider(
  props: PropsWithChildren<{ read: (imageId: string) => Promise<string> }>,
) {
  const intl = useIntl();
  const [viewing, setViewing] = useState<{
    images: readonly ViewedImage[];
    index: number;
    /** Each opening mounts a fresh viewer, so one opened while another closes starts open. */
    opened: number;
  } | null>(null);
  const { read } = props;
  const images = useMemo<Images>(
    () => ({
      read,
      open: (shown, index) =>
        setViewing((current) => ({ images: shown, index, opened: (current?.opened ?? 0) + 1 })),
    }),
    [read],
  );
  return (
    <ImagesContext value={images}>
      {props.children}
      {/* The viewer plays its own opening and closing; a presence around it would fade it as a
          whole, and WebKit draws no backdrop blur under a fading element. */}
      {/* motion: Overlays: command palette, menus, popovers */}
      {viewing === null ? null : (
        <ImageViewer
          key={viewing.opened}
          images={viewing.images}
          index={viewing.index}
          labels={{
            dialog: intl.formatMessage({ id: "images.viewer.label" }),
            close: intl.formatMessage({ id: "images.viewer.close" }),
            previous: intl.formatMessage({ id: "images.viewer.previous" }),
            next: intl.formatMessage({ id: "images.viewer.next" }),
            count: intl.formatMessage(
              { id: "images.viewer.count" },
              { index: viewing.index + 1, count: viewing.images.length },
            ),
          }}
          onIndex={(index) => setViewing({ ...viewing, index })}
          onClose={() => setViewing(null)}
        />
      )}
    </ImagesContext>
  );
}

function useImages(): Images {
  const images = useContext(ImagesContext);
  if (images === null) throw new Error("Images render inside ConversationImagesProvider.");
  return images;
}

/** Opens images at full size, from the image at `index`. */
export function useOpenImages(): Images["open"] {
  return useImages().open;
}

/**
 * The image `imageId` names, as a URL once it is read, or `missing` when the session host keeps
 * no such image or the mark names none.
 */
export function useImageUrl(imageId: string | undefined): {
  url: string | undefined;
  missing: boolean;
} {
  const { read } = useImages();
  const cached = imageId === undefined ? undefined : imageCache.get(imageId);
  const [loaded, setLoaded] = useState<{ imageId: string; url: string | null } | null>(null);
  useEffect(() => {
    if (imageId === undefined || cached !== undefined) return;
    let live = true;
    read(imageId).then(
      (url) => {
        imageCache.put(imageId, url);
        if (live) setLoaded({ imageId, url });
      },
      () => {
        if (live) setLoaded({ imageId, url: null });
      },
    );
    return () => {
      live = false;
    };
  }, [imageId, cached, read]);
  if (imageId === undefined) return { url: undefined, missing: true };
  if (cached !== undefined) return { url: cached, missing: false };
  const answer = loaded?.imageId === imageId ? loaded : null;
  return { url: answer?.url ?? undefined, missing: answer?.url === null };
}
